# SPRC Ops Hub

SPRC Ops Hub centralizes daily operations across three levels:
- BHT task execution: transports, EOCs, documentation
- Supervisor oversight: queues, assignments, issue resolution
- Admin governance: scope control, templates, audit, access

## Project Alignment (Master Instructions)
- Master instruction alignment is documented in `docs/PROJECT_ALIGNMENT.md`.
- Project-specific session startup instructions are documented in `PROJECT_INSTRUCTIONS.md`.
- This repo keeps **React + Vite** as an approved project exception to vanilla JS defaults.
- Cloud Functions are feature-dependent. Protected template administration, retention, and privacy actions require their deployed Functions; simpler UI-only workflows do not automatically require a Function change.
- PWA implementation is deferred by owner decision for now.

## Recent EOC Behavior (Current)
- EOC completer identity is read-only and uses the logged-in user.
- EOC drafts autosave during completion and auto-restore when reopening the same task.
- House/Van EOC sections stay expanded (no collapse/hide toggles).
- Keyboard flow supports rapid answering (`1` = OK, `2` = Repair, `Enter` = next unresolved).
- Sticky bottom actions keep `Next Unanswered` and `Submit EOC` accessible on mobile and desktop.
- EOC mobile layout now uses a simplified progress bar, larger answer targets, and a compact mobile-first header.
- Van EOC visibility is constrained to each BHT's assigned van list (`vanIds`); house EOC stays location+shift scoped.
- EOC template workflow now has a two-step admin/supervisor flow:
  - `Library`: create templates, edit owned templates, and clone shared templates to make safe editable copies
  - `Assignments`: set one default template per location + shift (no per-user override path)
- Reassigning a location+shift default template applies to the next generated EOC cycle; existing EOC tasks keep their pinned template version.
- Shift model is location-aware:
  - OTC uses `1st Shift` and `2nd Shift`
  - RES uses `1st Shift - Day`, `1st Shift - Night`, `2nd Shift - Day`, `2nd Shift - Night`
- RES checklist templates are now split by `templateScope` (`RES Day`, `RES Night`) for both House and Van EOCs.
- Due-day behavior:
  - OTC `2nd Shift` remains Wednesday cadence
  - RES `2nd` day/night shifts use Thursday cadence

## Login Behavior (Current)
- Staff select their Ops profile with a unique six-digit PIN.
- The local session locks after 60 minutes of inactivity.
- PIN login includes timeout guards so degraded connectivity fails clearly instead of staying on `Checking...`.
- Global Firebase claim enforcement remains off. The familiar PIN screen uses the server-backed custom-token path for the three synthetic Test House profiles plus the approved three-profile Lone Mountain BHT cohort. Two Lone Mountain profiles have completed first secure login; one remains. Other valid profiles retain compatibility behavior until the guarded all-active-profile stage.
- Security-foundation Phases 1–9, the complete local role/offline/device contract matrix, and the synthetic production canary are complete. Protected callables remain app-layer protected. App Check enforcement, global strict authorization, broad all-profile activation, and compatibility retirement remain disabled.
- The v13 offline shell correction is merged and Hosting-deployed. Automated production-process evidence and Mark's real Android Chrome full-close/offline reopen both passed. PR #19's final strict-cutover guard is also merged and Hosting-deployed; the privacy-safe readiness/cutover/rollback tools are in `Main`. Strict authorization and broad all-profile activation remain off.
- Final compatibility cleanup now has a separate machine-checkable release gate. `npm run inspect:security-compatibility-retirement` safely inventories the old paths while they are still required; after strict cutover, `npm run verify:security-compatibility-retired` must pass before the security update can be closed.

## Recent Dashboard/Modal Behavior (Current)
- BHT home is now a tighter action-hub experience:
  - greeting + assignment context at top
  - prominent action rows for `Start transport`, `Van EOC`, and `House EOC`
  - same-day completed transports summarized in a compact activity list
- First-login BHT onboarding is now available as a one-time guided overlay stored in local browser state.
- Header navigation is simplified on mobile:
  - short app label (`Ops Hub`)
  - bell-style notification entry point for unread alerts
  - dropdown menu for `Change PIN` and `Lock / Sign Out`
- Notification delivery is now centralized:
  - shared `notificationService` builds EOC, fleet, transport, and issue-update alert payloads
  - shared scope hooks drive header counts and supervisor queue filtering
- Supervisor dashboard summary is now extracted into a dedicated `DashboardSummaryPanel` to isolate queue + KPI logic from the main admin surface.
- Compliance admin surface is now employee-centric:
  - one searchable employee workspace for add/deactivate/manage flows
  - tap/select employee to manage all their compliance items in one place
  - responsive detail behavior: side panel on larger screens, full-screen detail sheet on mobile
- Cintas is now a dedicated top-level dashboard tab (separate from Compliance) and includes location-based compliance management.
- Compliance warning cards (`Overdue Tasks`, `Upcoming Compliance`) now support direct inline resolution via `Quick Update`:
  - edit `Last Completed`, `Next Due Date`, and `Notes` directly from the warning card
  - save writes to `complianceItems` and records an audit log entry
- `Open Compliance Tab` buttons in compliance warning cards use contrast-safe styling for readability on tinted cards.
- Transport reminder dialog (`REMIND THE CLIENT ABOUT DC PAPERWORK`) now uses the same shared high-contrast modal style as other app dialogs.
- Fleet maintenance now has a dedicated top-level supervisor/admin tab:
  - vehicle maintenance profiles (`eocVehicles`) include oil/renewal settings and per-vehicle milestone overrides
  - global mileage templates are managed in `fleetMaintenanceTemplates`
  - service logs are captured in `vehicleServiceRecords` (with optional external document URL)
  - dashboard queue now blends EOC + compliance + fleet status
  - fleet overdue visibility is persistent via `fleetTasks` and is not removed by marking alerts as read
- EOC supervisor/admin surface is now focused on:
  - EOC issue lifecycle management
  - template library + assignment management
- Property and house operations now have a dedicated top-level `Properties` tab:
  - property profile management in `eocProperties`
  - house EOC status board sourced from `eocTasks`
  - assignment model remains user/shift-driven from Users flows

## Source of Truth
- Living operational blueprint: `MASTER_PLAN.md`
- Detailed work/release evidence: `PROGRESS_LOG.md`
- Security foundation evidence: `docs/security/PHASE_1_SECURITY_FOUNDATION_BASELINE.md`, `docs/security/PHASE_2_DORMANT_SERVER_FOUNDATION.md`, `docs/security/PHASE_3_DORMANT_CLIENT_BOOTSTRAP.md`, `docs/security/PHASE_4_TO_8_LOCAL_SECURITY_READINESS.md`, `docs/security/PHASE_9_PROTECTED_OPERATIONAL_MUTATIONS.md`, and `docs/security/SECURITY_CANARY_AND_ROLLBACK.md`
- Older V2 blueprint retained for historical comparison: `plan.md`
- Instruction alignment + approved exceptions: `docs/PROJECT_ALIGNMENT.md`
- Session startup + operating rules: `PROJECT_INSTRUCTIONS.md`
- Change history: `CHANGELOG.md`
- Deployment and security release safety: `docs/CUTOVER_RUNBOOK.md`
- Business context: `docs/SPRC_Master_Context.md`
- SPRC Hub integration reference: `docs/CEO_Hub_Progress.md`

## Runtime
- App entry: `src/App.jsx`
- Active roles: `bht`, `supervisor`, `admin`
- Data backend: Firebase Firestore with server-verified PIN credentials, stable custom-token identities, and strict current-session rules
- Profile selection: the familiar six-digit PIN mapped server-side to permanent `users/{id}` records; sessions persist per device for an absolute maximum of 84 hours

## Commands
- Install: `npm install`
- Dev: `npm run dev`
- Build: `npm run build`
- Lint: `npm run lint`
- Security foundation unit contracts: `npm run test:security-foundation`
- Security foundation emulator contracts: `npm run test:security-foundation:emulator`
- Local security readiness audit: `npm run verify:security-readiness`
- Guarded canary stage model tests: `npm run test:security-canary-stage`
- Secure client/account/RES browser gate: `npm run test:security-client:emulator` (inside the documented Node 22 Firebase emulator wrapper)
- Focused secure templates/photos browser gate: `npm run test:security-templates-photos:browser` (inside the documented Firebase emulator/seed wrapper)
- Focused secure EOC/offline-replay browser gate: `npm run test:security-eoc-offline:browser` (inside the documented Firebase emulator/seed wrapper)
- Focused secure debriefs/alerts browser gate: `npm run test:security-debriefs-alerts:browser` (inside the documented Firebase emulator/seed wrapper)
- Focused secure issues/feedback/audit browser gate: `npm run test:security-issues-feedback-audit:browser` (inside the documented Firebase emulator/seed wrapper)
- Focused secure transports browser gate: `npm run test:security-transports:browser` (inside the documented Firebase emulator/seed wrapper)
- Focused secure operations-administration browser gate: `npm run test:security-operations-admin:browser` (inside the documented Firebase emulator/seed wrapper)
- Focused secure settings browser gate: `npm run test:security-settings:browser` (inside the documented Firebase emulator/seed wrapper)
- Complete secure offline/reconnect browser gate: `npm run test:security-offline-matrix:emulator` (inside the documented Node 22 Firebase emulator wrapper)
- Read-only App Check aggregate observation after approved monitoring rollout: `npm run security:canary -- --mode=app-check-observe --project=sprc-tx-l --hours=24`
- Read-only live Identity/Users and rollback-anchor status: `npm run security:canary -- --mode=identity-status --project=sprc-tx-l --backup=<absolute verified backup path> --backup-sha256=<exact SHA-256>`
- Compatibility-retirement release gate: `npm run verify:security-compatibility-retired`
- Smoke: `npm run smoke:phase9:full`
- RES shift/template migration: `npm run migrate:res-shift-model`
- Compliance employee bulk import: `npm run compliance:employees:add`

## Daily Delivery Workflow
Use this sequence for each logical batch so owner testing can happen quickly on phone/tablet:
1. Make one cohesive change batch.
2. Run checks needed for that batch (`npm run build`, `npm run lint`, and `npm run smoke:phase9:full` when release-ready).
3. After explicit owner approval, deploy the authorized layers:
   - Hosting/UI changes: `firebase deploy --only hosting --project sprc-tx-l`
   - Firestore rules changes: `firebase deploy --only firestore:rules --project sprc-tx-l`
4. Validate on iPhone and iPad critical paths.
5. Record release-relevant results in `CHANGELOG.md`.

## Hosting Standard
- Firebase Hosting (`sprc-tx-l`) is the only supported deployment target.

## Operating Rule
If implementation and documentation conflict, stop and verify current code/evidence. Update `MASTER_PLAN.md` before treating a changed workflow as the approved blueprint, and record significant implementation/release evidence in `PROGRESS_LOG.md`.
