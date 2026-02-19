# SPRC Cutover Runbook (Free-Tier v1)

Last updated: 2026-02-17
Owner: Admin/Owner + Supervisor

## Goal

Execute a clean cutover into the current assignment/task model without Cloud Functions.

## Preconditions

1. Local changes are built successfully:
   - `npm run smoke:phase9`
2. Firestore rules are deployed:
   - `firebase deploy --only firestore:rules --project sprc-tx-l`
3. Firebase Auth custom-claims provisioning:
   - Provision/update claims for active users: `npm run claims:provision`
   - Verify claims alignment: `npm run claims:verify`
   - Optional dry run: `npm run claims:provision -- --dry-run`
4. Admin confirms destructive reset window.
5. Strict auth baseline validation:
   - Confirm `npm run claims:verify` passes before cutover login testing.

## Cutover Steps

1. Run clean reset + seed:
   - `npm run reset:uat`
2. Verify seeded logins work:
   - Admin `1111`
   - Supervisor `2222`
   - Tech `3333`, `4444`, `5555`, `6666`
3. Confirm data baseline:
   - `users` seeded
   - `shiftAssignments` seeded
   - `accessGrants` seeded (active + upcoming lifecycle examples)
   - `eocTasks` seeded
   - `eocIssues` + `alerts` seeded
4. Execute UAT walkthrough:
   - `docs/UAT_WALKTHROUGH_PHASE9.md`
5. Record UAT evidence + signoff:
   - `docs/REGRESSION_UAT_PHASE9.md`

## Smoke Verification

1. App build:
   - `npm run smoke:phase9`
2. Optional lint baseline report:
   - `npm run smoke:phase9:full`

## Logical Batch Deploy Workflow (Daily)

Use this sequence after each meaningful change batch, not only final cutover:

1. Run local verification for the batch:
   - `npm run build`
   - `npm run lint`
   - `npm run smoke:phase9:full` (release readiness)
2. Deploy the relevant target:
   - Hosting/UI changes: `firebase deploy --only hosting --project sprc-tx-l`
   - Rules changes: `firebase deploy --only firestore:rules --project sprc-tx-l`
3. Validate on iPhone/iPad critical paths:
   - Login and role landing page
   - Primary action buttons and card readability
   - Sticky action areas (EOC forms)
   - Input behavior (keyboard overlap, tap-target comfort)
4. Record verification evidence:
   - `docs/REGRESSION_UAT_PHASE9.md`
   - `CHANGELOG.md`

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

