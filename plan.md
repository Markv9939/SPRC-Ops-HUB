# SPRC TX Log

## What This Is

A **transport logging app** for SPRC (a facility with two sites: PHP and RTC). Staff ("techs") use it on their phones to log client transports — recording when they depart, arrive at destinations, and return. Supervisors can review all transports, filter/export data, and manage user accounts.

**Live at:** https://sprc-tx-l.web.app

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 (Vite 7, SPA) |
| Database | Cloud Firestore |
| Auth | PIN-based (4-digit numeric, looked up against Firestore `users` collection — no Firebase Auth) |
| Hosting | Firebase Hosting (project: `sprc-tx-l`) |
| Export | xlsx library for Excel spreadsheet export |
| Styling | Plain CSS with custom properties (no framework) |

---

## How The App Works

### Transport Workflow (Tech View)

1. **Login** — Enter 4-digit PIN. 5 failed attempts = 5-minute lockout. 60-minute inactivity auto-lock.
2. **Home screen** — See your open/returned transports. Overdue transports (>8 hrs without return) show a red badge.
3. **New Transport** — Creates a transport with departure time, site auto-set from user profile.
4. **Add clients** — Type a name, autocomplete suggests from history. Selecting a suggestion auto-adds it. Can also type a new name and click "+ Add". Shown as removable chips.
5. **Add reasons** — Toggle buttons: Medical X appointment, Outside Provider, Court, Admin (e.g., SSA), Recreational, Other.
6. **ARRIVE** — Tap "ARRIVE" → DC paperwork reminder modal → confirms → logs arrival time.
7. **Add destinations** — Name (optional) + address (required). Autocomplete suggests from history; selecting a suggestion auto-adds it. Can add multiple destinations.
8. **Notes** — Optional freeform text.
9. **Finish TX** — Validates: at least 1 arrival, 1 client, and all destinations have addresses. Opens DC Paperwork modal (Collected / N/A / Other with required note). On submit → status becomes `returned`.
10. **Close Checklist** — Supervisor (or tech via return flow) reviews the transport, sees all data + DC paperwork status. Validates requirements, then closes it.

### Supervisor View

- **Transports tab** — See all transports across both sites. Filter by date range (default: current month), driver, overdue status, client name search. Export filtered results to Excel.
- **Manage Users tab** — Full CRUD for user accounts (name, PIN, role, site, active status).
- **Dashboard tab** — Monthly aggregated stats for completed (`returned`/`closed`) transports. Month picker with prev/next navigation, site filter (All/PHP/RTC). Shows: total count, breakdown by reason, breakdown by tech, DC paperwork status counts. Uses one-time `getDocs` query (not real-time) with client-side filtering.

---

## File Map

### Source Files (`src/`)

| File | What It Does |
|------|-------------|
| `main.jsx` | React entry point |
| `App.jsx` | Top-level routing and state. Manages login, auto-lock (60 min), role-based views (tech vs supervisor). Creates new transports. |
| `firebase.js` | Firebase/Firestore initialization and config |
| `index.css` | All global styles — CSS variables, glass cards, buttons, chips, badges, status colors, animations, SPRC watermark logo |
| `hooks/useAutocomplete.js` | Reusable hook for Firestore autocomplete. Debounced (150ms), prefix matching, filters active-only, max 5 results. |

### Components (`src/components/`)

| Component | File | What It Does |
|-----------|------|-------------|
| PinLogin | `PinLogin.jsx` | PIN input, queries `users` where pin matches and active=true. 5-fail lockout via localStorage. |
| Header | `Header.jsx` | Sticky header with SPRC logo, app title, username, Lock button |
| TransportList | `TransportList.jsx` | Tech home screen. Real-time Firestore listener for user's transports. Shows status badges, overdue detection (>8 hrs). Click to open/continue. |
| TransportCard | `TransportCard.jsx` | The main transport editing screen. Manages the full workflow: clients, reasons, ARRIVE, destinations, notes, Finish TX. Contains the arrive reminder modal inline. |
| ClientAutocomplete | `ClientAutocomplete.jsx` | Input + "+ Add" button. Uses `useAutocomplete` hook against `clients` collection. Selecting a suggestion auto-adds it. Upserts client to Firestore with `lastUsedAt` tracking. |
| DestinationAutocomplete | `DestinationAutocomplete.jsx` | Two fields: name (optional) + address (required). Custom Firestore search (not using the shared hook — searches by both name and address fields). Selecting a suggestion auto-adds it. Dedupes by normalized address. |
| AutocompleteDropdown | `AutocompleteDropdown.jsx` | Shared dropdown UI. Renders via `createPortal` to `document.body` to escape parent overflow. Positions with `getBoundingClientRect()`, updates on scroll/resize. z-index 9999. |
| DCPaperworkModal | `DCCheckModal.jsx` | Modal with 3 options: Collected, N/A, Other (requires note). Returns `{status, otherNote}`. Triggers when user taps "Finish TX". |
| CloseChecklist | `CloseChecklist.jsx` | Pre-close validation. Checks: has clients, has stops with addresses. Displays DC paperwork status. Sets status to `closed` with `closedAt` timestamp. |
| SupervisorDashboard | `SupervisorDashboard.jsx` | Three tabs. **Transports:** date range filter, driver filter, overdue filter, client search, Excel export. **Users:** add/edit/delete users with inline form. **Dashboard:** monthly stats for completed transports — totals, breakdowns by reason/tech/DC paperwork status, with month nav and site filter. |

### Scripts (`scripts/`)

| Script | Command | What It Does |
|--------|---------|-------------|
| `seedUsers.js` | `npm run seed` | Resets `users` collection with 3 test users (2 techs, 1 supervisor). Uses client SDK. |
| `migrateExistingClients.js` | `npm run migrate-clients` | One-time migration: adds `active=true` and `lastUsedAt` to existing client docs. Uses admin SDK. |
| `deactivateStaleClients.js` | `npm run cleanup-clients` | Marks clients as `active=false` if unused for 90+ days. Uses admin SDK. Needs `serviceAccountKey.json`. |

### Config Files

| File | Purpose |
|------|---------|
| `firebase.json` | Firebase config — Firestore rules/indexes paths, hosting config (public: dist, SPA rewrite) |
| `.firebaserc` | Firebase project alias (default: `sprc-tx-l`) |
| `firestore.rules` | Security rules (see below) |
| `firestore.indexes.json` | Composite indexes for client autocomplete queries |
| `vite.config.js` | Standard Vite + React config |
| `package.json` | Dependencies and npm scripts |

---

## Firestore Data Model

### `users` collection
| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name |
| `pin` | string | 4-digit login PIN |
| `role` | string | `tech` or `supervisor` |
| `site` | string | `PHP` or `RTC` |
| `active` | boolean | Can this user log in? |

### `transports` collection
| Field | Type | Description |
|-------|------|-------------|
| `site` | string | `PHP` or `RTC` (from user profile) |
| `createdByUserId` | string | User doc ID |
| `createdByName` | string | User display name |
| `status` | string | `open` → `arrived` → `returned` → `closed` |
| `departedAt` | timestamp | When transport started |
| `returnedAt` | timestamp | When Finish TX was submitted |
| `closedAt` | timestamp | When Close Checklist completed |
| `clients` | array of strings | Client names |
| `reasons` | array of strings | Selected reason labels |
| `destinations` | array of objects | `{name, address}` for each destination |
| `stops` | array of objects | `{arrivedAt}` — one entry per ARRIVE tap |
| `dcPaperworkStatus` | string | `collected`, `na`, or `other` (set at Finish) |
| `dcPaperworkOtherNote` | string | Required note when status is `other` |
| `notes` | string | Freeform notes |
| `createdAt` | timestamp | Auto-set |
| `updatedAt` | timestamp | Auto-set on every save |

### `clients` collection
| Field | Type | Description |
|-------|------|-------------|
| `label` | string | Display name (as entered) |
| `normalizedLabel` | string | Lowercase, trimmed, collapsed spaces (used for search) |
| `active` | boolean | Shown in autocomplete when true. Set false after 90 days unused. |
| `lastUsedAt` | timestamp | Updated every time client is added to a transport |
| `createdAt` | timestamp | First time this client was entered |

### `destinations` collection
| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Location name (optional) |
| `address` | string | Street address |
| `normalizedName` | string | Lowercase for search |
| `normalizedAddress` | string | Lowercase for search and dedup (also used as doc ID) |
| `createdAt` | timestamp | First time this destination was entered |

### Firestore Indexes
- `clients`: composite index on `active` (ASC) + `normalizedLabel` (ASC) — for autocomplete
- `clients`: composite index on `active` (ASC) + `lastUsedAt` (ASC) — for cleanup script

---

## Firestore Security Rules

The app uses **PIN auth, not Firebase Auth**, so `request.auth` is always null. Rules are permissive with field-level validation:

- **users, clients, destinations** — Open read/write
- **transports — create:** Validates required fields exist, status must be in allowed values, site must be PHP or RTC
- **transports — update:** Prevents changing `createdByUserId`, `createdByName`, `site`. When status changes to `returned` or `closed`, requires `dcPaperworkStatus` to be set (must be `collected`, `na`, or `other`; if `other`, `dcPaperworkOtherNote` must be a non-empty string).
- **transports — delete:** Open (should be supervisor-only in production)

---

## Development & Deployment

```bash
# Local development
npm run dev

# Build for production
npm run build          # outputs to dist/

# Deploy everything (hosting + firestore rules)
npx firebase deploy

# Deploy just hosting
npx firebase deploy --only hosting

# Deploy just firestore rules
npx firebase deploy --only firestore:rules

# Utility scripts
npm run seed              # Reset users to test data
npm run migrate-clients   # One-time: add active/lastUsedAt to existing clients
npm run cleanup-clients   # Deactivate clients unused 90+ days (needs serviceAccountKey.json)
```

### Dependencies
- `firebase` ^12.9.0
- `react` ^19.2.0 / `react-dom` ^19.2.0
- `xlsx` ^0.18.5
- Dev: Vite 7, ESLint 9

---

## Commit History (Newest First)

| Commit | Description |
|--------|-------------|
| *(pending)* | Add supervisor Dashboard tab with monthly stats (reason/tech/paperwork breakdowns) |
| `985a6fa` | Update plan.md |
| `d7ddc51` | Auto-add destination on autocomplete selection (match client behavior) |
| `1822c8d` | Restructure DC paperwork flow (moved to Finish step), autocomplete portal fix, arrive reminder modal |
| `d31cb45` | Implement autocomplete system with reusable components, useAutocomplete hook, 90-day client lifecycle |
| `1995765` | Update plan.md |
| `16fc005` | Add Firebase project config, user management dashboard (CRUD in supervisor view) |
| `0175df8` | UI redesign, restructure destinations/ARRIVE flow |
| `34b675c` | Restructure ARRIVE flow: log time first, fill location after |
| `5afd2af` | Phase 6: Security rules, auto-lock, deployment config |
| `63a3f54` | Phases 3-5: Suggestions, overdue tracking, supervisor dashboard |
| `6f75051` | Phase 2: Multi-stop workflow, DC checks, close checklist |
| `1437b19` | Firestore transports with role-based access |
| `b0af371` | Add seed script |
| `1799b80` | Phase 1: Firestore PIN login with lockout |

---

## Known Limitations

1. **No server-side auth** — PIN auth is client-side only. Anyone with the Firestore project ID could read/write data directly. For production hardening, would need Firebase Auth (anonymous or email) with custom claims for role enforcement.
2. **No push notifications** — Requires Cloud Functions (paid Firebase plan).
3. **Client cleanup is manual** — `npm run cleanup-clients` must be run manually or set up as a cron/Cloud Function.
4. **TransportList backwards compatibility** — Still handles legacy `stops[]` array format (with destination info embedded in stops) from earlier data model.

---

## Possible Future Work

- Push notifications for overdue transports (needs Cloud Functions)
- Server-side auth hardening (Firebase Auth + custom claims)
- Automated client cleanup via Cloud Function
- "Recently used" section in client autocomplete
- Client merge tool for duplicates
- Bulk management tools in supervisor dashboard

---

## Upcoming Features & Bugs

- **Supervisor Dashboard Mobile Navigation**
  - Problem: On small screens, the top tab strip overflows horizontally and hides the EOC tab.
  - Solution: Replace the tab strip with a mobile-friendly dropdown on narrow viewports while keeping tabs on desktop.
  - Acceptance: All tabs are accessible without horizontal scrolling on mobile.

- **Default Supervisor Landing Tab**
  - Problem: Supervisors land on Transports by default.
  - Solution: Default the active tab to Dashboard on login.
  - Acceptance: Supervisors see Dashboard content immediately after login.

- **Dashboard EOC Summary + Inline Issue Resolution**
  - Problem: Dashboard lacks EOC status and requires switching tabs to resolve issues.
  - Solution: Add open-issue and missed-assignment counts plus inline issue resolution from Dashboard.
  - Acceptance: Supervisors can resolve open EOC issues directly from Dashboard.

- **Compliance Tracking System** *(DONE)*
  - Goal: Replace Excel-based compliance tracking with in-app records.
  - Scope: FPCC, TB Test, CPR & First Aid, Food Handlers, Drivers License, Annual Orientation, Performance Evaluation, Misc., Cintas Service Sheet.
  - Data model: `complianceEmployees`, `complianceItems`, `cintasServices` collections.

  **Implementation Progress:**
  1. ~~Create `src/components/CompliancePanel.jsx`~~ — DONE. Full component with 4 sub-tabs (Employees, Items, Cintas, Import), category constants, CRUD, Excel import with preview, status badges.
  2. ~~Update `SupervisorDashboard.jsx`~~ — DONE:
     - ~~Added `compliance` to TAB_LABELS~~
     - ~~Imported CompliancePanel + getStatus~~
     - ~~Added `complianceItems` state + real-time listener~~
     - ~~Add `complianceSummary` useMemo (overdue + upcoming counts)~~
     - ~~Render compliance summary card on Dashboard tab (after EOC Summary section)~~
     - ~~Render `<CompliancePanel />` when `activeTab === 'compliance'`~~
  3. ~~Update `firestore.rules` — add open read/write rules for `complianceEmployees`, `complianceItems`, `cintasServices`~~ (deployed 2026-02-10)
  4. ~~Update `firestore.indexes.json` — add composite indexes for `complianceItems` (category+dueDate, employeeId+category)~~ (deployed 2026-02-10)
  5. ~~Build verification — `npm run build`~~ (completed 2026-02-10)
  6. ~~One-time compliance + Cintas seed from Excel files~~ (completed 2026-02-10; source files should not be reused)
  7. ~~Compliance/Cintas seed data imported into Firestore~~ (completed 2026-02-10)

### Google Places Autocomplete for Destinations

Replace the "Click here to search in Google Maps" link with real-time address autocomplete powered by the Google Places API. Existing Firestore-based suggestions (previously saved destinations) still appear alongside Google results.

**Prerequisites:**
1. Get a Google API key from https://console.cloud.google.com/
2. Enable the **Places API** in the API Library
3. (Recommended) Restrict the key: HTTP referrers → `localhost:*` + production domain; API restrictions → Places API only

**Implementation steps:**

1. **Add API key via environment variable** — Create `.env.local` in project root:
   ```
   VITE_GOOGLE_PLACES_API_KEY=your_key_here
   ```
   Add `.env.local` to `.gitignore` if not already there.

2. **Load Google Maps script in `index.html`** — Add before closing `</head>`:
   ```html
   <script>
     (function() {
       var key = '%VITE_GOOGLE_PLACES_API_KEY%';
       if (key && !key.startsWith('%')) {
         var s = document.createElement('script');
         s.src = 'https://maps.googleapis.com/maps/api/js?key=' + key + '&libraries=places';
         s.async = true;
         document.head.appendChild(s);
       }
     })();
   </script>
   ```
   Note: Vite replaces `%VITE_*%` in index.html with env values at build time.

3. **Modify `src/components/DestinationAutocomplete.jsx`:**
   - Add `useEffect` to initialize `google.maps.places.AutocompleteService` once Google script loads
   - Add `googleSuggestions` state alongside existing `suggestions` (Firestore)
   - **Hybrid search** on address field: Firestore results first (labeled "Recent"), then a divider, then Google Places results via `AutocompleteService.getPlacePredictions()`
   - **On Google Place selection:** call `PlacesService.getDetails()` to get full address + place name, auto-fill both fields
   - **Remove** the "Click here to search in Google Maps" `<a>` tag (no longer needed)
   - Keep existing Firestore persistence (destinations still saved on add)

**Files modified:**
- `.env.local` — new file, API key (git-ignored)
- `.gitignore` — add `.env.local` if missing
- `index.html` — add Google Maps script tag
- `src/components/DestinationAutocomplete.jsx` — add Google Places integration, hybrid dropdown
