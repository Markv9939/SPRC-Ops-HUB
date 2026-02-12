# SPRC Cutover Runbook (Free-Tier v1)

Last updated: 2026-02-12
Owner: Admin/Owner + Supervisor

## Goal

Execute a clean cutover into the current assignment/task model without Cloud Functions.

## Preconditions

1. Local changes are built successfully:
   - `npm run smoke:phase9`
2. Firestore rules are deployed:
   - `firebase deploy --only firestore:rules --project sprc-tx-l`
3. Admin confirms destructive reset window.

## Cutover Steps

1. Run clean reset + seed:
   - `npm run reset:uat`
2. Verify seeded logins work:
   - Admin `1111`
   - Supervisor `2222`
   - Tech `3333`, `4444`, `5555`, `6666`
3. Confirm data baseline:
   - `users` seeded
   - `bhtAssignments` seeded
   - `eocTasks` seeded
   - `eocIssues` + `supervisorAlerts` seeded
4. Execute UAT walkthrough:
   - `docs/UAT_WALKTHROUGH_PHASE9.md`
5. Record UAT evidence + signoff:
   - `docs/REGRESSION_UAT_PHASE9.md`

## Smoke Verification

1. App build:
   - `npm run smoke:phase9`
2. Optional lint baseline report:
   - `npm run smoke:phase9:full`

## Rollback Approach

1. If cutover data is invalid, run reset again to restore known-good seed baseline:
   - `npm run reset:uat`
2. If rule behavior regresses, redeploy last known good `firestore.rules`.
3. Re-run smoke + UAT checks after rollback.

## Signoff

| Role | Name | Date | Result | Notes |
|---|---|---|---|---|
| Admin/Owner |  |  | PENDING | |
| Supervisor |  |  | PENDING | |
