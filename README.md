# SPRC Ops Hub

SPRC Ops Hub centralizes daily operations across three levels:
- BHT task execution: transports, EOCs, documentation
- Supervisor oversight: queues, assignments, issue resolution
- Admin governance: scope control, templates, audit, access

## Project Alignment (Master Instructions)
- Master instruction alignment is documented in `docs/PROJECT_ALIGNMENT.md`.
- Project-specific session startup instructions are documented in `PROJECT_INSTRUCTIONS.md`.
- This repo keeps **React + Vite** as an approved project exception to vanilla JS defaults.
- Cloud Functions are **optional** for current runtime and cutover.
- PWA implementation is deferred by owner decision for now.

## Recent EOC Behavior (Current)
- EOC completer identity is read-only and uses the logged-in user.
- EOC drafts autosave during completion and auto-restore when reopening the same task.
- House/Van EOC sections stay expanded (no collapse/hide toggles).
- Keyboard flow supports rapid answering (`1` = OK, `2` = Repair, `Enter` = next unresolved).
- Sticky bottom actions keep `Next Unanswered` and `Submit EOC` accessible on mobile and desktop.
- Van EOC visibility is constrained to each BHT's assigned van list (`vanIds`); house EOC stays location+shift scoped.

## Recent Login Behavior (Current)
- PIN login includes timeout guards on backend/auth lookups so degraded connectivity fails with a clear error instead of staying on `Checking...`.

## Recent Dashboard/Modal Behavior (Current)
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

## Source of Truth
- Blueprint: `plan.md`
- Instruction alignment + approved exceptions: `docs/PROJECT_ALIGNMENT.md`
- Session startup + operating rules: `PROJECT_INSTRUCTIONS.md`
- Change history: `CHANGELOG.md`
- Cutover: `docs/CUTOVER_RUNBOOK.md`
- UAT walkthrough: `docs/UAT_WALKTHROUGH_PHASE9.md`
- Regression matrix: `docs/REGRESSION_UAT_PHASE9.md`

## Runtime
- App entry: `src/App.jsx`
- Active roles: `bht`, `supervisor`, `admin`
- Data backend: Firestore + Auth claims

## Commands
- Install: `npm install`
- Dev: `npm run dev`
- Build: `npm run build`
- Lint: `npm run lint`
- Smoke: `npm run smoke:phase9:full`
- Reset baseline (destructive): `npm run reset:uat`
- Compliance employee bulk import: `npm run compliance:employees:add`
- Claims provision: `npm run claims:provision`
- Claims verify: `npm run claims:verify`

## Daily Delivery Workflow
Use this sequence for each logical batch so owner testing can happen quickly on phone/tablet:
1. Make one cohesive change batch.
2. Run checks needed for that batch (`npm run build`, `npm run lint`, and `npm run smoke:phase9:full` when release-ready).
3. Deploy:
   - Hosting/UI changes: `firebase deploy --only hosting --project sprc-tx-l`
   - Firestore rules changes: `firebase deploy --only firestore:rules --project sprc-tx-l`
4. Validate on iPhone and iPad critical paths.
5. Record evidence/results in `docs/REGRESSION_UAT_PHASE9.md` and `CHANGELOG.md`.

## Hosting Standard
- Primary: Firebase Hosting (`sprc-tx-l`).
- Secondary/fallback config exists in `netlify.toml` and is not the default path unless explicitly chosen.

## Operating Rule
If implementation and docs conflict, update code to match `plan.md` or revise `plan.md` first.
