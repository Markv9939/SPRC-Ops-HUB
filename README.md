# SPRC Ops Hub

SPRC Ops Hub centralizes daily operations across three levels:
- BHT task execution: transports, EOCs, documentation
- Supervisor oversight: queues, assignments, issue resolution
- Admin governance: scope control, templates, audit, access

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
