# Phase 9 Regression + UAT Checklist

Last updated: 2026-05-18
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
| `npm run reset:uat` | PARTIAL | Users + issue/alert seeded, but `shiftAssignments` and `eocTasks` writes are denied by currently deployed Firestore rules |
| `firebase deploy --only firestore:rules --project sprc-tx-l` | PASS | Local `firestore.rules` deployed successfully on 2026-02-12 |
| `npm run reset:uat` (post-rules deploy) | PASS | Full reset complete; users/assignments/tasks seeded without permission errors |
| `npm.cmd run lint` | PASS (warning baseline) | 2026-03-01: one pre-existing warning in `src/hooks/useEocTasks.js` |
| `npm.cmd run build` | BLOCKED | 2026-03-01: `esbuild` `spawn EPERM` while loading Vite config in this environment |
| `npm.cmd run smoke:phase9:full` | BLOCKED | 2026-03-01: blocked by the same build `spawn EPERM` issue |
| `npm.cmd run lint` | PASS | 2026-05-18: clean lint after notification/dashboard/onboarding cleanup |
| `npm.cmd run build` | PASS | 2026-05-18: Vite production build completed successfully outside sandbox after prior `spawn EPERM` tooling restriction |

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
| RS-4 | Role/Scope | Backup access grant create/revoke lifecycle | Scope banner reflects grant; revoke requires reason; state transitions to revoked | PENDING | Admin walkthrough in Users tab |
| RS-5 | Role/Scope | Custom-claim provisioning verification | `claims:verify` reports all targeted users aligned with Firestore role/location scope | PENDING | `npm run claims:verify` output |
| RS-6 | Role/Scope | Strict auth mode toggle | Strict mode blocks non-claim sessions; claim-enabled admin session can toggle policy with reason | PENDING | Users tab auth policy control |
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
| DI-5 | Data Integrity | Offline mode write attempt | Writes are blocked with explicit offline feedback | PENDING | Network-off scenario |
| SC-1 | Scheduler | Sync run with configured due rules | Correct tasks created for assignment scope | PENDING | Requires seeded scenario |
| SC-2 | Scheduler | Re-run same cycle | No duplicate cycle task creation | PENDING | Determinism check |
| SC-3 | Scheduler | Van-scoped eligibility (same location+shift, different van assignments) | BHT only sees Van EOC tasks for assigned `vanIds`; unassigned vans do not appear | PENDING | Validate with two BHT users in same shift with different van assignments |
| SC-4 | Scheduler | Stale van task cleanup after reassignment | Pending/overdue van tasks no longer in desired scope are deactivated (`ignored`) | PENDING | Reassign van mid-cycle and verify old task no longer shows in BHT Hub |
| AU-1 | Auth/Login | Degraded connectivity/backend request hang during PIN submit | Login exits `Checking...` with clear timeout error and allows retry | PENDING | iPhone + iPad retry test |
| FL-1 | Fleet Persistence | Oil overdue persists after alert is marked read | Fleet overdue row remains in queue until oil service record is logged | PENDING | Create overdue oil condition, mark `fleet_*` alert read, verify queue row remains |
| FL-2 | Fleet Persistence | Insurance/registration overdue persistence | Overdue renewal rows remain until renewal service records update due dates | PENDING | Set past due dates and verify persistence |
| FL-3 | Fleet Persistence | Mileage milestone overdue persistence | Milestone overdue row remains until matching milestone service record is logged | PENDING | Cross due mileage, then log milestone service |
| FL-4 | Queue Blend | Overdue/upcoming aggregate includes EOC + Compliance + Fleet | Dashboard KPI counts and queue lists reflect blended sources | PENDING | Supervisor dashboard validation |
| FL-5 | Fleet Security | Supervisor scope + BHT restrictions | Supervisor writes remain scoped; BHT cannot write fleet configs/service records | PENDING | Rules validation with scoped/non-scoped users |
| FL-6 | Fleet Runtime | Van EOC mileage source strictness | `fleetVehicleRuntime` updates from van EOC submit path only | PENDING | Submit van EOC and verify runtime update |
| IA-4 | Information Architecture | EOC tab scope | EOC tab shows only `Template` and `Issues` surfaces; no vehicle CRUD in EOC tab | PENDING | Supervisor/admin dashboard walkthrough |
| IA-5 | Information Architecture | Properties tab scope | Properties tab supports property profile management and house EOC status visibility | PENDING | Validate `eocProperties` CRUD + house task cards |
| IA-6 | Information Architecture | Fleet ownership continuity | Vehicle profile/maintenance workflows remain in Fleet tab and continue to drive fleet queue status | PENDING | Fleet tab walkthrough + queue verification |

## Mobile/Tablet Validation Checklist (Required Per Deploy Batch)

Status legend: `PASS`, `FAIL`, `PENDING`

| ID | Device | Scenario | Expected Result | Status | Evidence |
|---|---|---|---|---|---|
| MT-1 | iPhone (portrait) | PIN login and role landing | No clipping/overlap; controls remain readable | PENDING | |
| MT-2 | iPhone (portrait) | BHT primary actions | Main action buttons are visible and easy to tap | PENDING | |
| MT-3 | iPhone (portrait) | EOC sticky actions | `Next Unanswered` and `Submit EOC` remain reachable | PENDING | |
| MT-4 | iPad (portrait) | Card/list spacing | Cards keep clear hierarchy and spacing | PENDING | |
| MT-5 | iPad (landscape) | Dashboard and queue layout | No horizontal overflow or hidden controls | PENDING | |
| MT-6 | iPhone/iPad | Input focus + keyboard | Focus is clear; keyboard does not block required fields/actions | PENDING | |
| MT-7 | iPhone/iPad | Status chips/badges | Status colors are visually distinct and understandable | PENDING | |
| MT-8 | iPhone/iPad | PIN login timeout handling | `Checking...` does not freeze indefinitely; timeout message appears and button recovers | PENDING | |
| MT-9 | iPhone/iPad | Transport ARRIVE reminder modal readability | `Cancel` and `OK` are clearly readable with high contrast on modal background | PENDING | Deployed 2026-02-19 to `sprc-tx-l`; awaiting owner device validation |
| MT-10 | iPhone/iPad | Compliance warning card action readability | `Open Compliance Tab` and `Quick Update` buttons remain readable on overdue/upcoming tinted cards | PENDING | Deployed 2026-02-19 to `sprc-tx-l`; awaiting owner device validation |
| MT-11 | iPhone/iPad | Compliance quick update from warning card | User can update `Next Due Date` inline; item status updates without opening Compliance tab | PENDING | Deployed 2026-02-19 to `sprc-tx-l`; awaiting owner workflow validation |
| MT-12 | iPhone/iPad | Fleet queue row actions | Fleet overdue/upcoming rows remain readable and `Open Fleet Tab` action is usable | PENDING | Requires Fleet seed data and device validation |

## Signoff

| Role | Name | Date | Result | Notes |
|---|---|---|---|---|
| Admin/Owner |  |  | PENDING | Final product signoff required for Phase 9 completion |
| Supervisor |  |  | PENDING | Queue/assignment behavior signoff required |

