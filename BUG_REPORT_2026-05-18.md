# SPRC Ops Hub — Bug Audit
**Date:** 2026-05-18  
**Scope:** Static source audit of `src/` (~30 files read in depth) + `firestore.rules` (partial). Lint passed clean; full build could not be exercised in this environment.  
**Method:** Read-through audit looking for runtime crashes, React anti-patterns, state/race bugs, async/Firestore bugs, missing error handling, logic errors, and security weaknesses. Severity is the author's best estimate — each finding includes a file:line so you can verify.

---

## How to read this

- **Blocker** — likely user-visible incorrect behavior or data loss in normal operation
- **Major** — performance, security, or correctness problem that will hurt at scale or in edge cases
- **Minor** — bug that is unlikely to fire in normal use but should be cleaned up
- **Polish** — code smell, dead code, or architectural concern

Each finding has a one-line **Fix** suggestion. Treat them as starting points, not prescriptions.

---

## Live browser confirmation (added after running against `http://localhost:5173`)

Logged in as `admin_owner` and walked through every admin tab. Findings:

### New Blocker — B0. Firebase Auth API key is invalid in this build
On submit, the console shows:
```
Anonymous auth bootstrap failed: FirebaseError: Firebase: Error 
(auth/api-key-not-valid.-please-pass-a-valid-api-key.)
```
The `apiKey` in `src/firebase.js` (`AIzaSyDkeTilCGBAxaR9Vz4uiIHsxLENvvRsy7U`) is being rejected by Firebase. PIN login still completes because `ensureAuthSession` catches the failure and proceeds with `authUid: null`. Downstream the EOC task engine then fails with `FirebaseError: Missing or insufficient permissions` (logged from `App.jsx:337`).

The user reaches a working UI, but **the app is operating without an authenticated session** — which means every Firestore rule that requires `request.auth` is being bypassed in the success direction (reads of unprotected collections work, but anything claim-gated will deny).

**Fix:** Replace the API key in `src/firebase.js` with a current one from the Firebase console for project `sprc-tx-l`. Verify in the console that Anonymous sign-in is enabled.

### B1 confirmed — the render loop is real and active
After login, the console immediately starts spewing:
```
Maximum update depth exceeded. This can happen when a component calls 
setState inside useEffect, but useEffect either doesn't have a dependency 
array, or one of the dependencies changes on every render.
```
This is the unmemoized scope arrays in `useUserScope.js` cascading into `useScopedAlerts` / `useScopedIssues` / `useScopedFleet`, which then set state, which re-renders, which makes new array identities, which sets state again…

Concrete impact observed:
- **Dashboard tab's "Loading stats…" is permanently stuck** — the panel never finishes rendering because of the loop. This is user-visible.
- **325+ console errors** within 90 seconds of login; **~7 errors per second** sustained.
- Browsing other tabs (Users, EOC, Compliance, Properties, Fleet, Cintas, Audit) **still works** — the loop is non-fatal for those panels. But Dashboard is effectively broken.

This was Major in my static report; live evidence puts it firmly in **Blocker**.

### B3 confirmed — login error swallowing
The PIN login completed with no message to the user despite a real failure happening behind the scenes (the Firebase API key error). The user has no signal that anything went wrong until they get into a tab that breaks.

### Other live observations
- Transports / Users / EOC / Compliance / Properties / Fleet / Cintas / Audit all rendered. No additional crashes.
- The Audit tab shows 78 entries — including `EOC_TASK_IGNORE` records from 03:19 PM today, which confirms recent admin activity is being logged correctly.
- The Users tab confirms the user IDs still use the legacy `tech_*` prefix (e.g. `tech_lm_multi`, `tech_mesquite_a`) while the role column shows `BHT`. This is fine — but the `firestore.rules` `'tech'` legacy role acceptance (p1 in this report) should be removed once you're confident no doc still has `role: 'tech'` server-side.
- Login screen contrast is poor: the "Enter 4-digit PIN" placeholder is very low-contrast white on the gradient background, hard to read. (p3 polish item.)

### Recommended order of operations
1. **Replace the Firebase API key** (B0). Until this is fixed, nothing else really works.
2. **Memoize the scope arrays in `useUserScope`** (B1). This will silence the console flood and unbreak the Dashboard panel.
3. **Surface real login errors** (B3) so the next outage like B0 is visible.
4. Then come back to the rest of the report.

---

## Blocker

### B1. Real-time listeners thrash on every render
`useUserScope` returns the callbacks `inEocScope`, `inComplianceScope`, `inTransportScope`. Their `useCallback` memoization depends on `allowedTransportSites` / `allowedComplianceSites` / `normalizedScopes`. But `rawScopes`, `normalizedScopes`, `primaryScopes`, and `activeBackupGrants` are recomputed inline on every render (no `useMemo`). The downstream arrays therefore get new references every render, invalidating the `useCallback`s.

That means every consumer (`useScopedAlerts`, `useScopedIssues`, `useScopedFleet`, and the supervisor transport `useEffect`) **tears down its Firestore `onSnapshot` and resubscribes on every parent render** — including the once-a-minute session-scope refresh in `App.jsx` and every typing keystroke in the filter inputs on the Supervisor dashboard.

Symptoms: flicker as lists empty/repopulate, wasted reads, possible Firestore quota pressure on busy days.

- `src/hooks/useUserScope.js` lines 49–63 (no `useMemo`)
- Cascaded into `src/hooks/useScopedAlerts.js:68`, `useScopedIssues.js:55`, `useScopedFleet.js:63`, `SupervisorDashboard.jsx:916`

**Fix:** Wrap `rawScopes`, `normalizedScopes`, `primaryScopes`, `activeBackupGrants` in `useMemo` keyed off primitives (`user?.id`, JSON-stringified scope lists, or similar) so the downstream callbacks become stable.

### B2. "Transports" date-range filter silently drops transports near midnight
```js
// SupervisorDashboard.jsx:888-889
const startTimestamp = Timestamp.fromDate(new Date(startDate + 'T00:00:00'))
const endTimestamp   = Timestamp.fromDate(new Date(endDate   + 'T23:59:59'))
```
`new Date('YYYY-MM-DDTHH:MM:SS')` (no zone) is parsed in the **browser's local timezone**. A supervisor in Phoenix selecting "May 18" gets `2026-05-18T07:00:00Z` to `2026-05-19T06:59:59Z`. A transport recorded at 23:30 Phoenix on May 17 (`2026-05-18T06:30:00Z`) is *before* the start boundary and silently excluded from the May 18 report. The reverse is true if a supervisor connects from a different time zone (Mountain/Pacific tablets, remote work, etc.).

**Fix:** Anchor the boundaries to the same `America/Phoenix` zone the EOC engine already uses. Build the `Date` from `formatPhoenixDate` + a fixed UTC offset, or compute the timestamp arithmetically.

### B3. Login error messages are swallowed
`PinLogin.handleSubmit` wraps the entire flow in `try { … } catch (err) { setError('Login failed. Please try again.') }`. The `withTimeout` helper throws specific messages ("Login timed out while loading access policy. Please try again.") that never reach the user. The recent CHANGELOG entry promises these messages will surface; they currently don't.

- `src/components/PinLogin.jsx:249-251`

**Fix:** `setError(err?.message || 'Login failed. Please try again.')`, or branch on `err.name === 'Error'` with a custom timeout class.

---

## Major

### M1. `useEocAssignments` re-fetches on every session refresh
The effect deps are `[user]`. `user` is a fresh object after every `refreshScopedSessionUser` (App.jsx every 60s), so the entire assignment lookup re-runs each minute — plus on every re-render where a parent reassigns user.
- `src/hooks/useEocAssignments.js:60`

**Fix:** Use `[user?.id]`. Nothing else from `user` is read inside the effect.

### M2. `touchClientUsage` resets `createdAt` on every transport edit
`setDoc(clients/<n>, { createdAt: serverTimestamp(), … }, { merge: true })` re-stamps `createdAt` every time a transport is updated. The `clients` collection loses its actual creation history.
- `src/components/TransportCard.jsx:109-126`

**Fix:** Use a transaction to read first and only set `createdAt` if the doc didn't exist, or split into two calls (one-time `setDoc` with no merge, then `updateDoc { lastUsedAt }`).

### M3. `window.alert` is now async — but the rest of the codebase calls it as if synchronous
`installAlertDialogBridge` replaces native `alert` with a non-blocking Promise-based dialog. But existing call sites continue with the "alert → then act" pattern:

- `App.jsx:254-255`: `alert('Session expired…'); handleLogout()` — user is logged out before the dialog renders
- `App.jsx:459-460`: `alert('You already have an active transport…'); resumeActiveTransport(...)` — page nav happens under the dialog
- Many alerts in TransportCard, SupervisorDashboard, PinLogin

Most of these "happen" to be benign because the next action is also non-destructive, but the user experience is jarring and any place that depends on alert blocking has lost that contract.

**Fix:** For the cases that actually need sequencing, switch them to `await showAlertDialog(...)`. Otherwise leave them but be aware no UI flow can rely on native blocking.

### M4. PIN hashing has no per-user salt
`hashPin(pin) = sha256("sprc-pin-v1:" + pin)`. The pepper is hardcoded in client code so it isn't a secret. Implications:
- Two users with the same PIN have the same `pinHash`. Anyone who sees one user's hash can identify everyone else with the same PIN.
- The keyspace is 10,000 (4-digit numeric). A precomputed rainbow table over all PINs is trivial.
- The lockout (5 attempts, 5 min) is enforced in `localStorage` — an attacker can clear storage. The lockout is per-device, not per-account.
- The PIN database is gated by Firestore rules, but the moment anyone gains read access to `users.pinHash` (rule misconfiguration, backup leak), every user's PIN is recoverable.

- `src/utils/pinHash.js`, lockout in `src/components/PinLogin.jsx:36-70`

**Fix:** Per-user random salt stored alongside `pinHash`; or migrate to `bcrypt`/`argon2` via a Cloud Function so the work factor is server-side. Server-side counter for failed attempts to prevent client-side bypass.

### M5. Fleet task sync runs every 5 minutes per supervisor and admin
`syncFleetTasksForUserScope` reads all `eocVehicles`, `fleetVehicleRuntime`, `fleetMaintenanceTemplates`, and open `fleetTasks` every 5 minutes. With 12 supervisors logged in, that's 12× those scans concurrently, racing on writes. The transactional `runTransaction` cases will retry; the non-transactional `writeBatch` cases can clobber.
- `src/App.jsx:409-434`

**Fix:** Move this to a scheduled Cloud Function (every 5 min server-side, runs once); or elect a single client by ordering on `user.id`; or debounce so only the first supervisor in a session runs it.

### M6. `eocTaskEngine.syncEocTasksForUserScope` issues sequential `getDoc` reads inside the loop
Each "desired" task triggers a separate `getDoc(eocTasks/<cycleKey>)` round trip before being added to the batch. For a location with ~20 tasks that's 20 sequential round trips before the batch commits.
- `src/services/eocTaskEngine.js:239-255`

**Fix:** Issue all `getDoc`s in `Promise.all` first, then build the batch.

### M7. "Cancel transport" hard-deletes the document
`handleCancelTransport` calls `deleteDoc(transports/<id>)`. No audit log entry, no soft-delete marker, no reason captured. Compare to user soft-delete which records `deletedBy/deletedAt/deleteReason` and writes an audit log. A BHT can erase a created-and-cancelled transport with no trace.
- `src/components/TransportCard.jsx:172-194`

**Fix:** Soft-delete with `{ deleted: true, status: 'cancelled', cancelledBy, cancelledAt, cancelReason }` and write an `auditLogs` entry. Hide cancelled transports from the BHT list while keeping them visible to admins.

### M8. Supervisor "Transports" tab filters can briefly show stale data
The Firestore listener (transports for date range) and the filter effect (`filteredTransports`) are two separate `useEffect`s. When `startDate`/`endDate` change, the filter effect re-runs immediately on the *old* `transports` array; the snapshot listener catches up a tick later. For a few hundred ms the dashboard shows pre-filter data.
- `src/components/SupervisorDashboard.jsx:918-954`

**Fix:** Derive `filteredTransports` via `useMemo` instead of an effect, so it always reflects the current `transports`.

### M9. `xlsx@0.18.5` (SheetJS Community) has known prototype-pollution CVEs
SheetJS Community's 0.18.x line has unpatched CVEs (CVE-2023-30533 family). The current Excel export is the only consumer.
- `package.json` `"xlsx": "^0.18.5"`

**Fix:** Switch to `exceljs` or pin to the SheetJS Pro distribution if there's a license, or upgrade to a patched fork.

---

## Minor

### m1. `new Date(s.arrivedAt)` will produce "Invalid Date" if `arrivedAt` is a Firestore Timestamp
In the Arrivals list. No current code path writes `stops[].arrivedAt`, so this only matters if legacy data has Timestamp stops — but if it does, the time label silently shows "Invalid Date".
- `src/components/TransportCard.jsx:426`

**Fix:** `const d = s.arrivedAt?.toDate ? s.arrivedAt.toDate() : new Date(s.arrivedAt)`.

### m2. Scope-filtered alert/issue/fleet listeners read every doc globally before filtering
`useScopedAlerts`, `useScopedIssues`, `useScopedFleet` all subscribe with only a status filter, then filter to scope client-side. Every supervisor receives every other location's events. Scales linearly with the org.
- `src/hooks/useScopedAlerts.js:38`, `useScopedIssues.js:26,40`, `useScopedFleet.js:37,48`

**Fix:** Add `where('locationId', 'in', […])` or `where('mainLocation', 'in', […])` clauses where the scope size is ≤ 10.

### m3. `auditLogs` listener has no `limit()`
Admins with thousands of audit entries load all of them on every dashboard mount.
- `src/components/SupervisorDashboard.jsx:227-231`

**Fix:** `.limit(200)` and add a "Load more" button.

### m4. `signOut(auth)` failure on logout is silent
If the auth signOut errors, the user is locally cleared but Firebase still has the anonymous session bound. The next anonymous sign-in might reuse stale auth claims.
- `src/App.jsx:218-220`

**Fix:** Show a toast on failure so the user knows to refresh.

### m5. Badge count recomputes the scope filter from raw rows instead of reusing the already-scoped lists
`useScopedAlerts` builds `scopedEoc` and `scopedFleet`, then re-walks the raw `rows` to compute `unreadCount`. If the filter logic ever diverges the badge will disagree with the visible list.
- `src/hooks/useScopedAlerts.js:58-64`

**Fix:** `setUnreadCount(scopedEoc.length + scopedFleet.length)`.

### m6. `navigator.onLine` is unreliable
Captive portals and some corporate networks report `online: true` without internet. The "Offline mode" guards will let writes through and produce auth errors instead of friendly messages.
- `src/utils/networkGuard.js`

**Fix:** Treat `navigator.onLine` as the cheap pre-check, but also catch Firestore errors that indicate network failure and surface "offline-ish" UX.

### m7. `_orig_sd_check.jsx` is a backup left in the component tree
- `src/components/_orig_sd_check.jsx`

**Fix:** Delete it (or move to a `legacy/` folder outside src).

### m8. `SupervisorDashboard` initializes `isMobile` from `window.innerWidth` at module load
Crashes under SSR. App is client-only via Vite so fine in practice; flagging for portability.
- `src/components/SupervisorDashboard.jsx:69`

### m9. `accessGrantService.startOfDay/endOfDay` parse dates in local time
`new Date(\`${dateStr}T00:00:00.000\`)` has no zone. If two admins in different time zones edit grants, the same date string yields different `Timestamp`s.
- `src/services/accessGrantService.js:44-49`

**Fix:** Anchor to Phoenix (or UTC) explicitly.

### m10. `EocChecklist` runs up to 4 parallel template listeners and applies whichever wins
Race-prone: a slow `eocTemplateLibrary` fetch can let the legacy `eocChecklistTemplate` fallback show first, then flip the UI mid-fill if the assigned template arrives late. Probably rare given Firestore latency but a real user-visible flicker if the network is slow.
- `src/components/EocChecklist.jsx:119-253`

**Fix:** Wait for the highest-priority source (`assignedTemplate` if `templateId` is set) before rendering any items; render a loading state until then.

---

## Polish / Questions

### p1. `firestore.rules` still accepts the legacy `'tech'` role
`validRole(role) { role in ['bht', 'supervisor', 'admin', 'tech']; }` and `roleIsBht(role) { role == 'bht' || role == 'tech'; }`. Intentional during migration; remove once the migration script is complete to shrink the attack surface.
- `firestore.rules:21, 25`

### p2. `client.toLowerCase()` and similar assume strings
Several places call `.toLowerCase()` on items that come from Firestore arrays without a typeof guard. Most are written by app code so it's a string. Worth wrapping in `String(value || '').toLowerCase()` for defense in depth.

### p3. PIN UI uses inline styles instead of CSS classes
`PinLogin` has ~200 lines of inline styles. Tedious to maintain; recommend extracting to CSS variables / classes in line with the rest of the app's theme.

### p4. `App.jsx` is doing a lot
It owns transport snapshot subscriptions, session refresh, alert install, onboarding gating, and routing. Splitting into a `SessionProvider` + role-based router would make each piece easier to test.

---

## What this audit did *not* cover

- **`firestore.rules` past line 200.** I checked the helper functions and the top of the matchers; the per-collection rules need their own pass.
- **`CompliancePanel`, `PropertiesPanel`, `FleetPanel`, `CintasPanel`, `EocTemplateManager`, `AccessGrantPanel`.** These large panels were not read in detail. Worth a second pass.
- **Migration scripts in `scripts/`.** Untouched.
- **Live browser testing.** The sandbox couldn't run the dev server (Linux native binaries unavailable). For runtime confirmation of B1 (listener thrashing), B2 (timezone), B3 (error messages), and M3 (alert async): start `npm run dev` locally and reproduce each one in the browser. I can drive that interactively once you have Claude in Chrome connected.
- **Performance under load.** No profiling, no stress test.

---

## Suggested next steps

1. Triage B1 / B2 / B3 first — they're cheap fixes with disproportionate impact.
2. Plan M5 (server-side fleet sync) before the supervisor count grows.
3. Plan M4 (PIN hashing) as a security follow-up — needs a migration since existing `pinHash` values would be unsalted.
4. Walk through the panels not covered (Compliance, Properties, Fleet, Cintas) for a second round.
