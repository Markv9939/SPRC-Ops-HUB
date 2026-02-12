# Phase 9 Regression + UAT Checklist

Last updated: 2026-02-12
Owner: Claude Code (engineering run) + Admin/Supervisor (business signoff)

## Automated Smoke Checks

Run:

```bash
npm run smoke:phase9
```

What this validates:
- App builds successfully (`vite build`).

Recommended clean-state step before manual UAT:

```bash
npm run seed -- --confirm
```

Optional extended check:

```bash
npm run smoke:phase9:full
```

This includes ESLint. As of 2026-02-12, lint has existing baseline issues across legacy scripts/components and is tracked separately from Phase 9 UAT signoff.

## Execution Evidence (2026-02-12)

| Command | Result | Notes |
|---|---|---|
| `npm run smoke:phase9` | PASS | `vite build` completed successfully |
| `npm run smoke:phase9:full` | FAIL | Build passed; lint baseline currently reports 40 errors and 8 warnings |
| `npm run reset:uat` | PARTIAL | Users + issue/alert seeded, but `bhtAssignments` and `eocTasks` writes are denied by currently deployed Firestore rules |
| `firebase deploy --only firestore:rules --project sprc-tx-l` | PASS | Local `firestore.rules` deployed successfully on 2026-02-12 |
| `npm run reset:uat` (post-rules deploy) | PASS | Full reset complete; users/assignments/tasks seeded without permission errors |

## Blocker Status

- Resolved on 2026-02-12 by deploying current `firestore.rules` to `sprc-tx-l`.

## Regression + UAT Matrix

Status legend: `PASS`, `FAIL`, `PENDING`, `BLOCKED`

Walkthrough script:
- `docs/UAT_WALKTHROUGH_PHASE9.md`
- `docs/CUTOVER_RUNBOOK.md`

| ID | Area | Scenario | Expected Result | Status | Evidence |
|---|---|---|---|---|---|
| RS-1 | Role/Scope | Supervisor tries to assign outside authorized location | Write is blocked | PENDING | Requires logged-in supervisor/account setup |
| RS-2 | Role/Scope | BHT tries to view non-assigned location records | Records are not visible | PENDING | Requires scoped seed data |
| RS-3 | Role/Scope | Admin views all locations | All locations visible | PENDING | Admin walkthrough |
| AE-1 | Assignment/EOC | Single BHT in location+shift | House EOC auto-owner assigned | PENDING | Supervisor walkthrough |
| AE-2 | Assignment/EOC | Multiple BHTs in location+shift without primary | Save blocked with validation | PENDING | Supervisor walkthrough |
| AE-3 | Assignment/EOC | Multi-van BHT flow | Van picker shown; independent completion per van | PENDING | BHT walkthrough |
| AE-4 | Assignment/EOC | Mid-cycle reassignment | Existing tasks unchanged; future tasks follow new assignment | PENDING | Time-based scenario |
| OR-1 | Overdue | Pending task crosses 12:00 AM Phoenix | Task flips to overdue | PENDING | Date-bound validation |
| OR-2 | Overdue | Overdue task exists on next due cycle | New cycle task is still generated | PENDING | Date-bound validation |
| IA-1 | Issue/Alert | Repair or attention selected without note | Submit blocked | PENDING | BHT walkthrough |
| IA-2 | Issue/Alert | Issue submitted with note | Supervisor alert created in correct queue | PENDING | Supervisor queue check |
| IA-3 | Issue/Alert | Alert lifecycle | Alert stays open until resolved/read action | PENDING | Supervisor queue check |
| DI-1 | Data Integrity | BHT edits after submit attempt | Edit blocked by submit-lock behavior | PENDING | BHT walkthrough |
| DI-2 | Data Integrity | Supervisor/admin correction action | Audit trail written | PENDING | Audit tab verification |
| DI-3 | Data Integrity | Soft delete action | Item hidden from default views | PENDING | Supervisor/admin verification |
| DI-4 | Data Integrity | Admin hard delete without reason | Blocked | PENDING | Admin workflow check |
| SC-1 | Scheduler | Sync run with configured due rules | Correct tasks created for assignment scope | PENDING | Requires seeded scenario |
| SC-2 | Scheduler | Re-run same cycle | No duplicate cycle task creation | PENDING | Determinism check |

## Signoff

| Role | Name | Date | Result | Notes |
|---|---|---|---|---|
| Admin/Owner |  |  | PENDING | Final product signoff required for Phase 9 completion |
| Supervisor |  |  | PENDING | Queue/assignment behavior signoff required |
