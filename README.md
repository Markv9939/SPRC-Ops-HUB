# SPRC Ops Hub

SPRC Ops Hub centralizes daily operations across three levels:
- BHT task execution: transports, EOCs, documentation
- Supervisor oversight: queues, assignments, issue resolution
- Admin governance: scope control, templates, audit, access

## Recent EOC Behavior (Current)
- EOC completer identity is read-only and uses the logged-in user.
- EOC drafts autosave during completion and auto-restore when reopening the same task.
- House/Van EOC sections stay expanded (no collapse/hide toggles).
- Keyboard flow supports rapid answering (`1` = OK, `2` = Repair, `Enter` = next unresolved).
- Sticky bottom actions keep `Next Unanswered` and `Submit EOC` accessible on mobile and desktop.

## Source of Truth
- Blueprint: `plan.md`
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
- Claims provision: `npm run claims:provision`
- Claims verify: `npm run claims:verify`

## Operating Rule
If implementation and docs conflict, update code to match `plan.md` or revise `plan.md` first.
