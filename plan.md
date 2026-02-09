---
name: SPRC TX Log App Plan
overview: "Vite + React + Firestore transport logging app with PIN auth, multi-stop workflow, DC checks, Close Checklist, suggestions, overdue tracking, supervisor dashboard with Excel export, user management, and Firebase Hosting deployment."
todos: []
isProject: false
---

# SPRC TX Log — Implementation Plan

## Project Status: ALL PHASES COMPLETE

All core phases (1–6) are implemented. The app is built and ready for Firebase Hosting deployment.

**Deployment:** Firebase Hosting (project: `sprc-tx-l`). Netlify config exists but is not actively used.

---

## Architecture

- **Framework:** Vite + React (SPA)
- **Database:** Firestore (collections: `users`, `transports`, `clients`, `destinations`)
- **Auth:** PIN-based (not Firebase Auth) — 4-digit PIN lookup against Firestore `users` collection
- **Hosting:** Firebase Hosting (`dist/` folder)
- **Export:** xlsx library for Excel export

---

## File / Component Map

| Component | File | Purpose |
|-----------|------|---------|
| Entry | [main.jsx](src/main.jsx) | React root |
| App | [App.jsx](src/App.jsx) | Routing (home / transport / closeChecklist / supervisor), current user state, 60-min auto-lock |
| PIN Login | [PinLogin.jsx](src/components/PinLogin.jsx) | Firestore user lookup by PIN, 5-fail lockout (5 min), returns `{ id, name, role, site }` |
| Header | [Header.jsx](src/components/Header.jsx) | App header with user info and logout |
| Transport List | [TransportList.jsx](src/components/TransportList.jsx) | Tech home: own transports (real-time Firestore query), overdue badges, clickable to continue, "New Transport" button |
| Transport Card | [TransportCard.jsx](src/components/TransportCard.jsx) | Full transport workflow: uses ClientAutocomplete and DestinationAutocomplete components, tracks client usage with lastUsedAt timestamps |
| Client Autocomplete | [ClientAutocomplete.jsx](src/components/ClientAutocomplete.jsx) | Reusable client autocomplete: input + "+ Add" button, filters active clients, updates lastUsedAt on use |
| Destination Autocomplete | [DestinationAutocomplete.jsx](src/components/DestinationAutocomplete.jsx) | Reusable destination autocomplete: two-field input (name optional, address required), dedupes by address |
| Autocomplete Dropdown | [AutocompleteDropdown.jsx](src/components/AutocompleteDropdown.jsx) | Base dropdown UI: positioned below input, z-index 1000, mobile-optimized |
| Autocomplete Hook | [useAutocomplete.js](src/hooks/useAutocomplete.js) | Custom hook: debounced search (150ms), Firestore queries, active filter, max 5 results |
| DC Check Modal | [DCCheckModal.jsx](src/components/DCCheckModal.jsx) | Post-ARRIVE modal: All signed / Missing signature / Incomplete / Other (note required) |
| Close Checklist | [CloseChecklist.jsx](src/components/CloseChecklist.jsx) | Validates clients + stops, blocks Close until requirements met, sets status to `closed` |
| Supervisor Dashboard | [SupervisorDashboard.jsx](src/components/SupervisorDashboard.jsx) | Two tabs: Transports (filters, Excel export) and Manage Users (CRUD) |
| Firebase Config | [firebase.js](src/firebase.js) | Firestore init, project config |
| Firestore Rules | [firestore.rules](firestore.rules) | Open rules with field validation (PIN-based auth, no Firebase Auth) |
| Seed Script | [scripts/seedUsers.js](scripts/seedUsers.js) | Resets users collection with test data |
| Migration Script | [scripts/migrateExistingClients.js](scripts/migrateExistingClients.js) | One-time: adds active and lastUsedAt fields to existing clients |
| Cleanup Script | [scripts/deactivateStaleClients.js](scripts/deactivateStaleClients.js) | Periodic: deactivates clients unused for 90+ days |
| Styles | [index.css](src/index.css) | Global styles including autocomplete dropdown styles |

---

## Data Model

- **users**: `id`, `name`, `pin`, `role` (`tech` | `supervisor`), `site` (`PHP` | `RTC`), `active`
- **clients**: `id`, `label`, `normalizedLabel`, `active`, `lastUsedAt`, `createdAt`
- **destinations**: `id`, `name`, `address`, `normalizedName`, `normalizedAddress`, `createdAt`
- **transports**: `id`, `site`, `createdByUserId`, `createdByName`, `status` (`open` | `returned` | `closed`), `departedAt`, `returnedAt`, `clients[]`, `reasons[]`, `destinations[]` (name + address), `stops[]` (arrivedAt + dcCheck), `closeChecklist`, `createdAt`, `updatedAt`, `closedAt`

---

## Phase 1 — Authentication + Roles + Persistence ✅ COMPLETE

- Firestore `users` collection with PIN lookup
- 5-failure lockout (5-minute duration) via localStorage
- Role-based views: tech sees own transports, supervisor sees all
- Real-time Firestore queries for transport list
- Clickable transport cards to continue open transports

---

## Phase 2 — Multi-Stop Workflow, DC Check, Close Checklist ✅ COMPLETE

- Multi-stop support: ARRIVE logs time first, then fill in destination details
- DC Check modal after each ARRIVE (cannot skip)
- RETURN sets `returnedAt`, navigates to Close Checklist
- Close Checklist validates clients + stops before allowing close
- Clients as chips (add/remove), multi-select reasons from spec list

---

## Phase 3 — Suggestions and Dedupe ✅ ENHANCED

- **NEW:** Full reusable autocomplete system with dedicated components
- **ClientAutocomplete:** input + "+ Add" button, filters already-added clients, tracks usage with `lastUsedAt`
- **DestinationAutocomplete:** two-field input (name optional, address required), dedupes by `normalizedAddress`
- **AutocompleteDropdown:** reusable base component, positioned below input, z-index 1000, mobile-optimized
- **useAutocomplete hook:** debounced search (150ms), Firestore range queries, active filter, max 5 results
- **90-day cleanup:** automatic client deactivation after 90 days of non-use (preserves historical data)
- Firestore composite indexes for efficient queries (active + normalizedLabel, active + lastUsedAt)

---

## Phase 4 — Overdue and Notifications ✅ PARTIAL

- Overdue definition: >8 hours since departure without return
- Red border + "OVERDUE" badge on transport cards
- Overdue filter in supervisor dashboard
- Push notifications skipped (requires Cloud Functions / paid Firebase plan)

---

## Phase 5 — Supervisor Dashboard and Excel Export ✅ COMPLETE

- Default current-month view with date range filter
- Filters: driver dropdown, overdue status (all/yes/no), fuzzy client search
- Excel export: one row per transport with all fields (destinations, arrivals, status, notes)

---

## Phase 6 — Security and Production ✅ COMPLETE

- Firestore rules: open with field validation (PIN-based auth model, no Firebase Auth)
- 60-minute auto-lock with activity tracking (mousedown, keydown, scroll, touchstart)
- 5-failure PIN lockout (5-minute duration)

---

## Recent Changes (Post-Phase 6)

### UI Redesign (commit 0175df8)
- Restructured ARRIVE flow: log time first, fill location details after
- Redesigned UI across Header, TransportCard, TransportList, CloseChecklist
- Moved inline styles to [index.css](src/index.css) for cleaner components

### User Management Dashboard (commit 16fc005)
- Added "Manage Users" tab to Supervisor Dashboard
- Full CRUD: add, edit, delete users directly from the UI
- User form: ID, Name, PIN, Role (tech/supervisor), Site (PHP/RTC), Active status
- Added Firebase project config files (`.firebaserc`, `firebase.json`, `firestore.indexes.json`)
- Updated Firestore rules to allow user collection writes
- Updated seed script with current user data

### App-Wide Autocomplete System (current commit)
- **New reusable components:** ClientAutocomplete, DestinationAutocomplete, AutocompleteDropdown
- **Custom hook:** useAutocomplete for debounced Firestore queries
- **Client lifecycle management:** active/inactive status with 90-day auto-cleanup
- **Usage tracking:** lastUsedAt timestamp updates on every client use
- **Migration script:** migrateExistingClients.js (one-time setup)
- **Cleanup script:** deactivateStaleClients.js (periodic maintenance)
- **Documentation:** AUTOCOMPLETE_README.md (full docs), SETUP_AUTOCOMPLETE.md (setup guide)
- **Firestore indexes:** composite indexes for active + normalizedLabel/lastUsedAt queries
- **Mobile-optimized:** 16px font (prevents iOS zoom), 44px tap targets, keyboard-aware
- **DRY architecture:** all autocompletes use shared components and hooks

---

## Deployment

- **Platform:** Firebase Hosting (project ID: `sprc-tx-l`)
- **Build:** `npm run build` → outputs to `dist/`
- **Deploy:** `npx firebase-tools deploy --only hosting` (requires `firebase login` first)
- **Local dev:** `npm run dev`
- **Scripts:**
  - `npm run seed` — Reset users collection with test data
  - `npm run migrate-clients` — One-time migration to add active/lastUsedAt fields
  - `npm run cleanup-clients` — Deactivate clients unused for 90+ days
- **First-time setup:**
  1. `npm install firebase-admin` (for cleanup scripts)
  2. `firebase deploy --only firestore:indexes` (deploy composite indexes)
  3. `npm run migrate-clients` (if you have existing clients)
  4. Set up periodic cleanup (cron or Cloud Function)

---

## Known Issues / Future Work

1. **Autocomplete scalability** — Now resolved with Firestore range queries (no client-side filtering). Limited to 5 results per query for performance.
2. **Client cleanup automation** — Periodic cleanup script created but needs deployment as Cloud Function or cron job for full automation.
3. **Push notifications** — Skipped; requires Cloud Functions / paid Firebase plan.
4. **Data model note** — Plan spec had `stops[]` with destination info. Implementation uses separate `destinations[]` and `stops[]` arrays. Functionally equivalent.
5. **Firestore rules** — Currently open (allow read/write: true) since app uses PIN auth, not Firebase Auth. Security relies on client-side enforcement.

## Future Enhancements

- Add "Recently used" section at top of client autocomplete
- Add client usage count badge in suggestions
- Add "Show inactive clients" toggle for supervisors
- Add client merge functionality for duplicates
- Add reactivation notification when inactive client is used
- Add bulk cleanup tools in Supervisor Dashboard
