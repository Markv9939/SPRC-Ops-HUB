# SPRC Operations Hub Blueprint v1 (Scope, Flow, Data Contract)

Last updated: 2026-02-12
Status: Active Blueprint
Source of truth: This file is the product blueprint and implementation DNA for SPRC Operations Hub.

## Summary
This plan makes `plan.md` the system blueprint for a full operations app (EOCs + transports + supervisor oversight), with clear role boundaries, deterministic EOC automation, and auditable workflows.

Transport flow remains mostly as-is; overhaul focus is assignment-driven EOC orchestration, supervisor action queues, and location-scoped permissions.

## Scope + Flow (Canonical)
Goal: One app that BHTs and supervisors use for daily operations: EOCs + transports + supervisor oversight. The app is being overhauled to replace cobbled-together behavior with consistent, assignment-driven workflows.

### Roles
- `Admin/Owner`: Full control across all locations; controls system settings and hard deletes.
- `Supervisor`: Can only manage authorized location(s); no cross-location control.
- `BHT`: Completes assigned EOCs, runs transports, and relays issues to supervisors.

### Locations
- Mesquite
- Lone Mountain
- RES

### EOC Rules
- EOC = Environment of Care.
- EOC types: House EOC and Van EOC.
- Due schedule is configurable by Admin (v1 starts with Sunday=1st shift, Wednesday=2nd shift).
- On due cycles, each location must complete House EOC + required Van EOCs.
- Van EOC required for all active vans assigned at that location/shift.
- A BHT may be assigned multiple vans.
- Van EOC UI uses van picker when BHT has multiple assigned vans.
- User-facing status terms: Pending -> Overdue -> Completed.
- Overdue flips at 12:00 AM America/Phoenix on the day after due date.
- Overdue tasks remain open; new cycle tasks are still generated.

### Assignment Rules
- Persistent assignments (not reset each shift).
- Supervisor assigns BHTs to location + shift + van list (immediate effect for future tasks).
- If only one BHT exists for location+shift, House EOC auto-assigns to that BHT.
- If multiple BHTs exist for location+shift, supervisor must designate one primary House EOC assignee.
- Mid-cycle reassignments do not move already-generated tasks; only future tasks follow new assignment.

## Decision-Complete Product Behavior

### 1. Role and Access Model
#### Admin
- Global read/write across all modules and locations.
- Manages shift/scheduling settings, global templates, and hard deletes.

#### Supervisor
- Location-scoped read/write for operations in authorized location(s).
- Can onboard BHTs only inside authorized location(s).
- Can assign/reassign BHTs/vans/shifts within scope.

#### BHT
- Can view and act on assigned location/shift tasks.
- Cannot edit submitted records.
- If no active assignment: login allowed, blocked-action screen (`No Active Assignment`).

### 2. End-User Flow
#### BHT Flow
1. Login by PIN.
2. Home remains close to current layout, but task logic becomes assignment-driven.
3. Due/overdue EOCs displayed first-class with location grouping.
4. Van EOC:
- Single assigned van: enter checklist directly.
- Multiple assigned vans: choose van, then checklist.
5. EOC issue (repair/attention) requires note; submit creates supervisor alert.
6. New transport requires explicit location selection (default last-used).
7. Submitted items are locked for BHT.

#### Supervisor Flow
1. Landing tab: Dashboard Metrics.
2. KPI cards are clickable and open filtered action queues.
3. Supervisor resolves issues/reassigns from queue views.
4. Alerts remain active until formally resolved.

### 3. EOC Automation and Lifecycle
- Idempotent in-app sync runs on authenticated app sessions (`syncEocTasksForUserScope`).
- Sync generates due EOC tasks for active assignments per configured due-day rules.
- Sync flips prior-day pending tasks to overdue once app activity occurs after 12:00 AM Phoenix.
- Task states (user-facing): `pending`, `overdue`, `completed`.
- Internal/audit markers may include `archived`, `hard_deleted` (admin only, logged).

### 4. Transports and Compliance (v1 Refinement)
- Transport UX and flow stay mostly unchanged.
- Add stricter location-scoped access and immutable submit behavior.
- Compliance module remains Supervisor/Admin only.
- In-app alerts only (no email/SMS in v1).

## Important Changes To Public Interfaces / Types

### Firestore Collections (authoritative)
- `appSettings`
- `scheduling`: shift definitions, due-day config, timezone (`America/Phoenix`).
- `users`
- role, active, auth scope, location authorizations.
- `bhtAssignments` (new canonical assignment model)
- `bhtUserId`, `locationId`, `shiftId`, `vanIds[]`, `isHousePrimary`, `active`, `effectiveFrom`, `effectiveTo`.
- `eocTasks` (generated work items)
- `taskType` (`house|van`), `locationId`, `shiftId`, `vanId?`, `assigneeUserId`, `dueDate`, `status`, `generatedAt`.
- `eocSubmissions`
- immutable submission payload + timestamps.
- `eocIssues`
- created from repair/attention checklist items; resolution fields.
- `alerts`
- in-app notification records tied to location and module.
- `auditLogs`
- required for supervisor/admin corrections and all admin hard deletes.

### Existing Modules Updated
- `transports`: add strict location scope, BHT submit-lock enforcement.
- `compliance*`: keep current model; enforce role/location scope.

### Service Interfaces (Free-Tier App Workflows)
- `syncEocTasksForUserScope(user)` (idempotent task generation + overdue flip on app session entry)
- Assignment save workflow (supervisor-scoped writes; future-task effect)
- EOC issue resolution workflow (queue action + linked alert lifecycle update)
- Admin hard-delete workflow (reason required + audit log write in same mutation batch)

## Security Rules and Permission Contract
- Move from client-trust to auth-backed role/location checks.
- All writes validate:
- role eligibility
- location scope
- immutable submission constraints
- Supervisor cannot write records outside authorized locations.
- BHT cannot modify completed/submitted records.
- Admin hard delete only, with mandatory reason and audit log linkage.

## Testing and Acceptance Scenarios

### Role/Scope
1. Supervisor cannot create/assign BHT outside authorized location.
2. BHT cannot view records from non-assigned locations.
3. Admin can access all locations.

### Assignment/EOC Generation
1. Single BHT at location+shift auto-gets House EOC owner status.
2. Multiple BHTs at same location+shift requires primary before save.
3. Multi-van BHT sees picker; each van requires independent completion.
4. Reassignment affects future tasks only; old tasks stay with original assignee.

### Overdue Rules
1. Pending due task flips to overdue at 12:00 AM next day (Phoenix).
2. Overdue task stays open while next due-cycle task is still generated.

### Issue + Alert Workflow
1. Repair/attention submission fails without note.
2. Submission creates supervisor alert in correct location queue.
3. Alert remains open until supervisor resolves with optional resolution note.

### Data Integrity
1. BHT cannot edit after submit.
2. Supervisor/admin correction writes audit trail.
3. Soft delete hides record from default views.
4. Admin hard delete succeeds only with reason and audit log entry.

### Scheduler
1. Daily run creates correct tasks by assignment/due config.
2. Daily run idempotency: duplicate tasks are not created for same cycle key.

## Implementation Plan (Phased)

### 1. Blueprint Lock (Completed 2026-02-12)
- Insert canonical Scope + Flow section at top of `plan.md`.
- Align rest of `plan.md` headings to this contract.

### 2. Auth + Rules Foundation (Completed 2026-02-12)
- Add auth-backed role/location claims.
- Implement Firestore rules by role/scope/action.

### 3. Assignment Engine (Completed 2026-02-12)
- Introduce `bhtAssignments`.
- Build supervisor assignment UI and validations.

### 4. EOC Task Engine (In Progress 2026-02-12)
- Add `eocTasks` and in-app sync generation.
- Migrate current EOC assignment flow to task-based model.

### 5. BHT UX Update (Completed 2026-02-12)
- Keep current visual feel.
- Add assignment-aware queue + van picker + no-assignment blocked screen.

### 6. Supervisor Action Queues (Completed 2026-02-12)
- KPI click-through queues.
- Resolve/reassign workflows and alert lifecycle.

### 7. Audit + Delete Controls (Completed 2026-02-12)
- Soft-delete standardization.
- Admin-only hard-delete path with `auditLogs`.

### 8. Transport/Compliance Scope Hardening (Completed 2026-02-12)
- Preserve transport behavior.
- Enforce location scope and submit-lock constraints.

### 9. Regression + UAT (In Progress 2026-02-12)
- Added executable Phase 9 checklist/matrix: `docs/REGRESSION_UAT_PHASE9.md`.
- Added guided signoff runbook: `docs/UAT_WALKTHROUGH_PHASE9.md`.
- Added smoke commands: `npm run smoke:phase9` (build gate) and `npm run smoke:phase9:full` (build + lint baseline report).
- Added clean-state UAT reset seed flow to remove stale legacy records before walkthrough runs: `npm run seed -- --confirm` (or `npm run reset:uat`).
- Resolved blocker: deployed local `firestore.rules` to `sprc-tx-l` and confirmed full `reset:uat` completion including `bhtAssignments` and `eocTasks`.
- Current evidence:
- `smoke:phase9`: pass (`vite build` successful).
- `smoke:phase9:full`: fails on existing lint baseline (40 errors / 8 warnings) tracked separately from Phase 9 walkthrough signoff.
- Remaining for phase completion: admin + supervisor walkthrough and signoff on UAT matrix scenarios.

## Assumptions and Defaults Chosen
- `America/Phoenix` is canonical timezone.
- EOC automation is lazy in-app idempotent sync in v1 (no Cloud Functions).
- Alerts are in-app only in v1.
- Transport workflow remains mostly unchanged.
- Compliance is supervisor/admin-only, not self-service for BHTs.
- Supervisors are location-scoped; admin is global.
- Soft delete default; admin hard delete allowed only with audit reason.

## Continuous Update Instructions (Mandatory)
1. Update this file after every meaningful merged change.
2. Update `Last updated` date each time.
3. Update progress statuses in Progress Snapshot.
4. Add one entry to Change Log for every implementation change.
5. If behavior or schema changes, update Decision Log with reason.
6. If interface changes, update interface sections first, then implementation.
7. If implementation diverges from blueprint, log as Deviation with owner and resolution date.
8. Never remove historical Change Log entries.

## Progress Snapshot
| Area | Status | Owner | Target Date | Notes |
|---|---|---|---|---|
| Blueprint Lock | Completed | Claude Code | 2026-02-12 | Canonical Scope + Flow blueprint adopted and aligned as system source of truth |
| Auth + Role Scope | Completed | Claude Code | 2026-02-12 | Phase 2 auth/rules foundation implemented (`firestore.rules`, `src/App.jsx`, `src/components/PinLogin.jsx`, `src/components/SupervisorDashboard.jsx`) |
| Assignment Engine | Completed | Claude Code | 2026-02-12 | Persistent `bhtAssignments` model and assignment UI/logic implemented (`src/hooks/useEocAssignments.js`, `src/components/SupervisorDashboard.jsx`, `src/components/BhtHub.jsx`) |
| EOC Task Engine | In Progress | Claude Code | 2026-02-12 | Added `eocTasks` sync engine, overdue flip logic, and task-based checklist submit flow using free-tier in-app lazy sync (no Cloud Functions) |
| BHT UX Update | Completed | Claude Code | 2026-02-12 | Assignment-aware due/overdue queue is live with no-assignment blocked screen and multi-van picker flow for van EOC task selection |
| Transport Hardening | Completed | Claude Code | 2026-02-12 | Enforced transport site scope for supervisor views and added submit-lock behavior to prevent post-submit edits in transport workflow |
| Supervisor Queues | Completed | Claude Code | 2026-02-12 | Clickable KPI cards now drive queue views (issues/overdue/alerts), with resolve and reassign actions plus alert close/read lifecycle behavior |
| Admin Controls + Audit | Completed | Claude Code | 2026-02-12 | Soft delete standardized for users/assignments; admin-only hard delete requires reason and writes immutable audit log entry; admin audit center view added |
| Regression + UAT | In Progress | Claude Code + Admin/Supervisor | 2026-02-12 | Added Phase 9 checklist/matrix and smoke scripts; build smoke passes; final walkthrough signoff still required |

## Decision Log
| Date | Decision | Why | Impact |
|---|---|---|---|
| 2026-02-12 | Scope + Flow First blueprint adopted as source of truth | Align product behavior before deep build changes | Reduces rework and inconsistent implementations |
| 2026-02-12 | Assignment-driven EOC orchestration is canonical | Replace ad hoc/manual coupling | Enables deterministic task generation and accountability |
| 2026-02-12 | Location-scoped permissions are mandatory | Prevent cross-location data/control leakage | Drives rules and role model across modules |
| 2026-02-12 | Free-tier automation model selected: lazy in-app task sync (no Cloud Functions) | Keep v1 on free Firebase while preserving deterministic task generation behavior | Scheduler behavior is implemented from app sessions rather than backend cron |

## Change Log
| Date | Module | Change | Files/Collections | Verification |
|---|---|---|---|---|
| 2026-02-12 | Blueprint | Replaced plan with Scope + Flow First Blueprint v1 content and living update rules | `plan.md` | Manual section-by-section verification |
| 2026-02-12 | Phase 1 | Marked Blueprint Lock as completed in implementation tracking | `plan.md` | Reviewed plan status against current blueprint sections |
| 2026-02-12 | Phase 2 | Marked Auth + Rules Foundation as completed in implementation tracking | `plan.md`, `firestore.rules`, `src/App.jsx`, `src/components/PinLogin.jsx`, `src/components/SupervisorDashboard.jsx` | Reviewed implementation references from recent history (`c56e5f3`) |
| 2026-02-12 | Phase 3 | Marked Assignment Engine as completed in implementation tracking | `plan.md`, `src/hooks/useEocAssignments.js`, `src/components/SupervisorDashboard.jsx`, `src/components/BhtHub.jsx` | Reviewed implementation references from recent history (`a7de4ae`) |
| 2026-02-12 | Phase 4 | Started EOC Task Engine migration to task-based workflow and sync generation | `src/services/eocTaskEngine.js`, `src/App.jsx`, `src/components/EocChecklist.jsx`, `src/components/SupervisorDashboard.jsx`, `src/hooks/useEocTasks.js` | `npm run build` |
| 2026-02-12 | Phase 5 | Started BHT UX update with assignment-aware task queue and task launch flow | `src/components/BhtHub.jsx`, `src/hooks/useEocTasks.js`, `src/App.jsx` | `npm run build` |
| 2026-02-12 | Phase 5 | Completed BHT UX update with multi-van picker, assignment-driven queue, and blocked no-assignment state | `src/components/BhtHub.jsx`, `src/hooks/useEocTasks.js`, `src/App.jsx`, `plan.md` | `npm run build` |
| 2026-02-12 | Blueprint | Added detailed gap-closure backlog and open decision tracker from full conversation-to-repo parity audit | `plan.md` | Manual parity audit against `plan.md`, `firestore.rules`, and `src/` modules |
| 2026-02-12 | Phase 6 | Completed supervisor action queues with clickable KPI routing and queue lifecycle actions | `src/components/SupervisorDashboard.jsx`, `plan.md` | `npm run build` |
| 2026-02-12 | Phase 7 | Completed audit + delete controls with soft-delete defaults, admin hard-delete path, and audit center UI | `src/components/SupervisorDashboard.jsx`, `plan.md` | `npm run build` |
| 2026-02-12 | Phase 8 | Completed transport/compliance scope hardening with scoped supervisor reads and transport submit-lock constraints | `src/App.jsx`, `src/components/TransportCard.jsx`, `src/components/CloseChecklist.jsx`, `src/components/SupervisorDashboard.jsx`, `src/components/CompliancePanel.jsx`, `plan.md` | `npm run build` |
| 2026-02-12 | Phase 9 | Added regression/UAT checklist artifact and executable smoke commands; recorded current smoke evidence and signoff dependencies | `docs/REGRESSION_UAT_PHASE9.md`, `package.json`, `plan.md` | `npm run smoke:phase9` (pass), `npm run smoke:phase9:full` (lint baseline fail: 40 errors / 8 warnings) |
| 2026-02-12 | Phase 9 | Added guided UAT walkthrough script mapped to the regression matrix for admin/supervisor signoff execution | `docs/UAT_WALKTHROUGH_PHASE9.md`, `docs/REGRESSION_UAT_PHASE9.md`, `plan.md` | Manual doc review |
| 2026-02-12 | Blueprint | Removed Cloud Functions/scheduler wording and made free-tier lazy in-app sync canonical across automation/interface sections | `plan.md` | Manual blueprint consistency review against `src/App.jsx` and `src/services/eocTaskEngine.js` |
| 2026-02-12 | Phase 9 | Replaced legacy user seed script with destructive clean-state UAT reset/seed flow and linked it into walkthrough prerequisites to prevent stale-data regressions | `scripts/seedUsers.js`, `package.json`, `docs/UAT_WALKTHROUGH_PHASE9.md`, `docs/REGRESSION_UAT_PHASE9.md`, `plan.md` | `npm run seed` (guard verified), `npm run smoke:phase9` |
| 2026-02-12 | Phase 9 | Hardened reset script to continue on permission-denied collections, executed reset, and documented active Firestore-rule blocker for `bhtAssignments`/`eocTasks` | `scripts/seedUsers.js`, `docs/REGRESSION_UAT_PHASE9.md`, `docs/UAT_WALKTHROUGH_PHASE9.md`, `plan.md` | `npm run reset:uat` (partial due rules), `npm run smoke:phase9` |
| 2026-02-12 | Phase 9 | Deployed Firestore rules to `sprc-tx-l`, reran reset, and verified full clean-state seeding including assignments/tasks | `firestore.rules`, `scripts/seedUsers.js`, `docs/REGRESSION_UAT_PHASE9.md`, `docs/UAT_WALKTHROUGH_PHASE9.md`, `plan.md` | `firebase deploy --only firestore:rules --project sprc-tx-l`, `npm run reset:uat` |

## Upcoming Tasks (Gap Closure Backlog)

### P0 Critical (Must Land Before Broader Rollout)
1. **Fix blueprint section contract drift**
- Add missing required sections from the agreed replacement format:
- `Data Model and Interfaces (Canonical v1)`
- `Write Integrity and Concurrency`
- `Authorization and Rules Contract`
- `Free-Tier Automation Model`
- `One-Time Reset and Cutover Runbook`
- `Open Questions / Future Decisions`
- Done when: `plan.md` structure fully matches the agreed canonical outline.

2. **Replace client-trust security model with auth-backed enforcement**
- Current rules explicitly state client-side trust and allow broad reads/writes (`firestore.rules`).
- Done when: Firestore rules enforce role/location scope server-side and deny unauthorized paths.

3. **Harden PIN auth model**
- Current login queries plaintext PIN, and `users` schema still includes raw `pin`.
- Done when: hashed PIN contract is implemented (`pinHash`, algo params), forced change flow exists, plaintext pins retired.

4. **Enforce location scope on all data reads/writes**
- Supervisor/admin dashboards currently query global collections without scope filters.
- Done when: every query/mutation is constrained by authorized locations and validated by rules.

5. **Correct overstated implementation status in blueprint**
- `plan.md` marks Auth + Role Scope completed while rules remain client-trust/open.
- Done when: Progress Snapshot and Change Log are reconciled with actual repo state.

### P1 High (Core Product Contract Completion)
1. **Finalize and implement canonical interface contract**
- Add/align service contracts and naming consistency for task generation, issue lifecycle, assignment save, backup access, and transport close/edit flows.
- Done when: `plan.md` interfaces map 1:1 to implementation entry points.

2. **Finalize canonical collection contract and naming**
- Resolve `alerts` vs `supervisorAlerts`, `bhtAssignments` vs `shiftAssignments`, and legacy/target collection coexistence.
- Done when: one authoritative schema set is documented and implemented.

3. **Align deterministic EOC task ID contract**
- Current IDs are `task_*` while prior blueprint text referenced house/van deterministic IDs.
- Done when: deterministic format is finalized and duplicate prevention is verified.

4. **Retire legacy `eocAssignments` paths**
- `SupervisorEocPanel` still uses legacy collection and workflows.
- Done when: legacy reads/writes removed or explicitly marked read-only with migration plan.

5. **Implement full issue lifecycle**
- Required lifecycle is `open -> in_progress -> resolved` with required resolution note; current flow resolves directly.
- Done when: state machine, validation, and queue UX support all states.

6. **Add concurrency/version protection**
- No `version` / `expectedVersion` checks currently.
- Done when: optimistic concurrency is enforced on critical mutable records with conflict UX.

7. **Implement audit trail for critical actions**
- Add audit writes for assignment changes, issue resolution, closed transport edits, and hard deletes.
- Done when: `auditLogs` entries exist for all critical action categories.

8. **Implement soft-delete + admin hard-delete workflow**
- Include mandatory reason and immutable audit linkage.
- Done when: soft-delete fields standardized and admin hard-delete guarded by policy.

9. **Implement backup access grant/revoke contract**
- Add temporary supervisor cross-location grants with start/end + revoke reason path.
- Done when: grant lifecycle enforced in UI + rules + data model.

10. **Enforce reassignment policy exceptions**
- Mid-cycle reassignment should affect future tasks only, except allowed inactive-assignee exception with required reason.
- Done when: policy is encoded in assignment/task services and audited.

### P2 Medium (UX and Operations Hardening)
1. **Complete BHT EOC home state contract**
- Add explicit button states (`Not Due`, `Due`, `Overdue`, `Completed`) and `Mark All OK`.
- Done when: UI behavior matches blueprint verbatim.

2. **Enforce single-active transport per BHT**
- Current flow allows creating new transport without active guard.
- Done when: second active start is blocked at UI and write layer.

3. **Implement location picker logic for New Transport**
- Single-location direct start; multi-location forced picker.
- Done when: start flow behavior is role/scope aware and tested.

4. **Implement active-transport session guards**
- Lock/logout should be blocked until close, with close-only recovery path.
- Done when: session control rules match blueprint behavior.

5. **Add offline read-only mode**
- Writes should block cleanly while showing clear offline status.
- Done when: offline write attempts are prevented and user informed.

6. **Build cutover runbook and verification checklist**
- Add one-time reset, seed, smoke checks, rollback path, and signoff flow.
- Done when: runbook is executable and rehearsal-validated.

7. **Add acceptance and regression test suite**
- Cover scope, EOC lifecycle, transport lifecycle, concurrency, backup expiry, and audit compliance.
- Done when: test matrix in blueprint has executable test coverage and pass/fail evidence.

## Open Questions / Future Decisions
| Date | Question | Options | Default if Unanswered | Owner |
|---|---|---|---|---|
| 2026-02-12 | Canonical assignment collection name | `bhtAssignments` vs `shiftAssignments` | Keep `bhtAssignments` in v1, map in plan | Admin/Owner |
| 2026-02-12 | Canonical alerts collection name | `alerts` vs `supervisorAlerts` | Keep `supervisorAlerts` in v1, plan migration | Admin/Owner |
| 2026-02-12 | PIN model cutover path | Immediate forced migration vs staged migration | Staged migration with forced first-login rotate | Admin/Owner |
