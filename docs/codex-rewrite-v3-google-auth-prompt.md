# Codex prompt — rewrite the plan to Google sign-in + no Cloud Functions (v3.0 draft)

Paste the block below into Codex. It rewrites the plan's auth/enforcement foundation to
Google sign-in, no Cloud Functions, and profile-based rule enforcement (no custom
claims). Codex may modify ONLY `docs/bht-home-implementation-plan.md` — not app code.

---

ROLE
You are a senior React/Firebase engineer. Produce a REWRITTEN FIRST DRAFT of an existing
implementation plan, changing its authentication and enforcement foundation to a new
direction (below). Update the plan file in place as a new version. Modify ONLY the plan
document — do NOT change app code, rules, or any other file. This is a first draft of a
new direction; it will go through several review rounds, so be concrete but expect revision.

THE PIVOT (why we're rewriting)
The product owner wants the app to run with NO Cloud Functions (stay on Firebase's free
plan, no billing) and to manage everything from inside the app. So the auth foundation
changes from the v2.3 design to:
1. LOGIN: replace anonymous auth + in-browser PIN with **Google sign-in (Firebase
   native), restricted to the company's email domain**. Every staff member already has a
   company Google Workspace account. Devices are a MIX of shared and personal (note the
   shared-device sign-in/out friction as a UX risk, not a blocker).
2. NO CLOUD FUNCTIONS anywhere. Remove the `mintPinSession` Function, the Functions
   package, and any Blaze/billing requirement. If something previously required a
   Function, redesign it to run client-side + security rules, or as an admin action in
   the app.
3. ENFORCEMENT VIA PROFILE LOOKUP, NOT CUSTOM CLAIMS ("Option B"). Do not rely on custom
   claims / a provisioning script to stamp role/location into the token. Instead, security
   rules determine a requester's role and authorized locations by reading their user
   profile document from Firestore via `get()`. Admins create/manage users, attach the
   company email, and set role/location entirely in the app UI — no scripts, no manual
   claim step.

WHAT STAYS LOCKED (do not relitigate; only the auth/enforcement mechanism changes)
- Exact-location privacy (Lone Mountain != Mesquite).
- The Home redesign + Location Issues board + issue detail/activity timeline (see mockup).
- Central transactional `issueStatusService`; activity subcollection + `latestActivity`.
- Location-wide per-user notification fan-out via active `shiftAssignments` (client-side).
- Supervisor mark-in-progress / post-update / resolve / void (void = reason + VOIDED under
  Resolved).
- `userHomeState/{...}` reviewed-debrief reference; deterministic offline issue IDs.

READ FIRST
1. docs/bht-home-implementation-plan.md  (current v2.3 — the plan to rewrite)
2. docs/mockups/bht-home-final.html       (visual source of truth — unchanged)

VERIFY AGAINST CODE (cite file:line for every claim you make or change)
src/firebase.js, src/components/PinLogin.jsx, src/App.jsx, src/services/authPolicyService.js,
src/components/BhtHub.jsx, src/components/DashboardSummaryPanel.jsx,
src/components/SupervisorEocPanel.jsx, src/components/SupervisorDashboard.jsx,
src/services/bhtIssueReportService.js, src/services/offlineSyncService.js,
src/services/notificationService.js, src/services/shiftDebriefService.js,
src/services/accessGrantService.js, src/hooks/useScopedIssues.js,
src/hooks/useScopedAlerts.js, src/hooks/useUserScope.js, src/utils/orgModel.js,
firestore.rules, firestore.indexes.json, firebase.json, scripts/provisionAuthClaims.js.

DESIGN THESE CONCRETELY (the hard parts)
1. LOGIN FLOW: how `PinLogin` (or its replacement) does Google sign-in; how the app
   restricts to the company domain (client check AND a rules check on
   `request.auth.token.email` / `email_verified`); what happens for a valid Google account
   that has no matching staff profile (deny + clear message).
2. IDENTITY RESOLUTION — the key design problem. Rules can only `get()` a document by a
   KNOWN path, not query by email. Define exactly how a rule resolves the requester's
   profile (role + authorizedLocations) from their Google identity. Options to evaluate:
   (a) key the profile doc by `request.auth.uid` and link uid<->profile on first login;
   (b) a `usersByAuthUid/{uid}` or email-keyed mapping doc the admin/app maintains.
   Account for: the admin creates the profile BEFORE the user's first login (no uid yet),
   so specify the first-login linking step and who writes it safely.
3. RULES VIA get(): provide concrete rule snippets for eocIssues + activity + alerts +
   shiftDebriefs that read the requester's profile via `get()` to check role and
   location. Enforce exact-location (no aliasing), fail closed, no legacy bypass. State
   the per-evaluation `get()` limits and how caching keeps you within them.
4. LIST QUERIES + get(): this is the highest-risk area. Rules don't filter results, so the
   client must constrain every board/count query to exactly the requester's authorized
   locations (read from their own profile at login). Specify exact `where(... 'in' ...)`
   constraints, the 30-disjunction math, the exact firestore.indexes.json entries, and an
   emulator proof that list reads succeed/deny correctly with profile-`get()` rules.
5. BACKUP / TEMPORARY CROSS-LOCATION ACCESS without Functions: redesign so a
   supervisor/admin grants it via the app (client write to `issueAccess/{...}` or the
   profile's authorizedLocations, with start + expiration timestamps), enforced by rules
   via `get()` + `request.time`. No Function sync; keep it admin-only.
6. REMOVE cleanly: `mintPinSession`, the `functions/` package, billing requirement, custom
   claims (`role`/`locations`/`issueLocations` in the token) and the provisioning-script
   dependency — and update every section that referenced them.
7. KEEP & re-anchor to the new model: issueStatusService atomic boundary, activity +
   latestActivity, fan-out, userHomeState, offline determinism, the full UI plan.

OUTPUT
- Rewrite docs/bht-home-implementation-plan.md in place; set the title/status to a new
  version (e.g. v3.0 — "Google sign-in, no Cloud Functions, profile-based enforcement"),
  and note it's a first draft of the new direction.
- Include: a changelog of what changed from v2.3 and why; the concrete login + identity-
  resolution design; concrete rule snippets; the list-query/index plan; a build sequence
  (auth foundation first); emulator-testable acceptance criteria; and a Residual Risks
  section (call out the profile-`get()`-in-list reliance and shared-device login friction).
- Do NOT modify app code. End your chat reply (not the file) with a go/no-go and any
  blockers or open questions you couldn't resolve from the code.
