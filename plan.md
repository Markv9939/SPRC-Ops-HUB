# SPRC Operations Hub Blueprint v1 (Scope, Flow, Data Contract)

Last updated: 2026-02-13
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

## User Interaction Contract

### 1. Role and Access Model
#### Admin
- Global read/write across all modules and locations.
- Manages shift/scheduling settings, global templates, backup access grants, and hard deletes.

#### Supervisor
- Location-scoped read/write for operations in authorized location(s).
- Can onboard BHTs only inside authorized location(s).
- Can assign/reassign BHTs/vans/shifts within scope.
- Cannot change user roles.
- Cannot delete/archive issue records.

#### BHT
- Can view and act on assigned location/shift tasks.
- Cannot edit submitted records.
- If no active assignment: login allowed, blocked-action screen (`No Active Assignment`) with contact-supervisor guidance.

### 2. BHT End-to-End Flow
1. Login by PIN with explicit inline errors for wrong PIN/inactive/no-assignment.
2. Home is a single hub with strict ordering:
- `New Transport` pinned at top.
- Overdue items.
- Due today items.
- Active transports.
3. EOC action states are explicit:
- `Not Due` (disabled)
- `Due` (enabled)
- `Overdue` (enabled + urgent styling)
- `Completed` (disabled)
4. Van EOC flow:
- Single assigned van: enter checklist directly.
- Multiple assigned vans: choose van in picker before checklist.
5. Checklist interaction contract:
- Per-item chips: `OK` / `Repair`.
- `Repair` requires note before submit.
- `Mark All OK` fills unanswered items only.
- Sticky submit remains disabled until all items are valid.
6. Submit outcome contract:
- Show success confirmation.
- Return user to Home.
- Task state flips to `Completed` immediately.
7. Transport flow:
- Single active transport only.
- Start transport: single-location users start directly; multi-location users must pick location first.
- `ARRIVE` logs timestamped stop (multi-stop supported).
- Finish validation uses inline section errors and jump-to-first-invalid behavior.
- BHT closed transport access is read-only via short-window `My Recent`.
8. Session/edge behavior:
- Mid-session inactive user -> immediate write lock + re-auth requirement.
- Assignment removed while active transport exists -> close-only path.
- Lock/logout blocked while active transport exists.
- Unlock target with active transport reopens active transport first.
- Offline mode is read-only warning mode with writes blocked.

### 3. Supervisor End-to-End Flow
1. Mobile navigation is single dropdown module menu.
2. Landing page is Dashboard Metrics.
3. KPI order is locked:
- EOC Risk
- Compliance Risk
- Transport Risk
4. KPI click-through opens pre-filtered action queues:
- Authorized scope only.
- Open/actionable only.
- Urgency-first sorting (overdue first).
5. Issue lifecycle is strict:
- `Open -> In Progress -> Resolved`
- Resolution requires a note.
6. Assignment edit workflow requires explicit save with diff summary.
7. Closed transport edit workflow requires mandatory reason modal + audit event.
8. Scope banner remains visible with primary + backup scopes and backup expiry.

### 4. Admin End-to-End Flow
1. Landing page is global risk dashboard.
2. Settings groups are fixed:
- Scheduling
- Templates
- Access
- Thresholds
3. Template publishing flow is fixed:
- Draft -> diff preview -> publish with version note.
4. Backup access management supports:
- Active/upcoming/expired states.
- Early revoke with required reason.
5. Hard delete policy:
- Two-step confirm.
- Required reason.
- Audit log required.
6. Audit center:
- Admin-only.
- Default filters: date, actor, module, location, action type.

### 5. EOC Automation and Lifecycle
- Idempotent in-app sync runs on authenticated app sessions (`syncEocTasksForUserScope`).
- Sync generates due EOC tasks for active assignments per configured due-day rules.
- Sync flips prior-day pending tasks to overdue once app activity occurs after 12:00 AM Phoenix.
- Task states (user-facing): `pending`, `overdue`, `completed`.
- Internal/audit markers may include `archived`, `hard_deleted` (admin only, logged).

### 6. Transports and Compliance (v1 Refinement)
- Transport UX and flow stay mostly unchanged except for locked flow and safety constraints above.
- Add stricter location-scoped access and immutable submit behavior.
- Compliance module remains Supervisor/Admin only.
- In-app alerts only (no email/SMS in v1).

## Important Changes To Public Interfaces / Types

### Important API / Interface / Type Changes (Must Be Locked)
- `ensureDueEocTasksForScope(scope, nowPhoenix): void`
- `applyOverdueTransitions(scope, nowPhoenix): void`
- `submitEocTask(taskId, payload, expectedVersion): void`
- `setIssueInProgress(issueId, expectedVersion): void`
- `resolveIssue(issueId, resolutionNote, expectedVersion): void`
- `createTransport(payload): void`
- `closeTransport(transportId, payload, expectedVersion): void`
- `editClosedTransport(transportId, patch, reason, expectedVersion): void`
- `saveShiftAssignment(assignmentPatch, expectedVersion): void`
- `grantBackupAccess(payload): void`
- `revokeBackupAccess(grantId, reason): void`

### Canonical Collection Contract (Source Of Truth)
- `users`
- `shiftAssignments`
- `eocTasks`
- `eocSubmissions`
- `eocIssues`
- `transports`
- `alerts`
- `accessGrants`
- `auditLogs`
- `*/{recordId}/activity/*`

### Deterministic EOC Task ID Contract
- House: `house_{locationId}_{shiftId}_{dueDate}`
- Van: `van_{locationId}_{shiftId}_{vanId}_{dueDate}`

### Existing Modules Updated
- `transports`: add strict location scope, BHT submit-lock enforcement.
- `compliance*`: keep current model; enforce role/location scope.

### Service Interfaces (Free-Tier App Workflows)
- `syncEocTasksForUserScope(user)` (idempotent task generation + overdue flip on app session entry)
- Assignment save workflow (supervisor-scoped writes; future-task effect)
- EOC issue resolution workflow (queue action + linked alert lifecycle update)
- Admin hard-delete workflow (reason required + audit log write in same mutation batch)

## Data Model and Interfaces (Canonical v1)
- Canonical assignment model: `shiftAssignments`.
- Canonical generated task model: `eocTasks` with deterministic IDs and cycle keys.
- Canonical alert model: `alerts`.
- Canonical temporary scope model: `accessGrants`.
- Current implementation migration notes:
- `bhtAssignments` -> `shiftAssignments`
- `supervisorAlerts` -> `alerts`
- Legacy `eocAssignments` remains read-only during migration; active writes belong to assignment/task workflows.
- User credential contract: `pinHash` (`v1_sha256`) for active authentication storage; legacy plaintext PIN fallback is retired.

## Write Integrity and Concurrency
- Write batches are used for multi-document integrity flows (submission + task completion + issue/alert creation).
- Deterministic task keys prevent duplicate due-cycle task creation.
- Concurrency/version token contract is still pending for mutable records (`version`/`expectedVersion` backlog item).

## Authorization and Rules Contract
- Firestore rules enforce schema-level constraints and key lifecycle invariants (submission immutability, required resolution notes).
- Full auth-backed role/location enforcement remains backlog until Firebase Auth + trusted claim path is adopted.
- Client scope checks currently enforce most location restrictions in UI workflows.

## Free-Tier Automation Model
- No Cloud Functions scheduler in v1.
- EOC generation + overdue flipping occurs through idempotent in-app sync (`syncEocTasksForUserScope`) on authenticated sessions.
- Behavior remains deterministic through cycle-key identity and status-transition rules.

## One-Time Reset and Cutover Runbook
- Runbook reference: `docs/CUTOVER_RUNBOOK.md`.
- UAT execution references:
- `docs/UAT_WALKTHROUGH_PHASE9.md`
- `docs/REGRESSION_UAT_PHASE9.md`

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
- Introduce `shiftAssignments`.
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
- Resolved blocker: deployed local `firestore.rules` to `sprc-tx-l` and confirmed full `reset:uat` completion including `shiftAssignments` and `eocTasks`.
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
- Export default format is `.xlsx`.
- Export scope default is current filters.
- Full audit center access is admin-only.
- Canonical naming for v1 contract is `shiftAssignments`, `alerts`, and `accessGrants` (with migration mapping from current collection names).

## Continuous Update Instructions (Mandatory)
1. Update this file after every meaningful merged change.
2. Update `Last updated` date each time.
3. Update progress statuses in Progress Snapshot.
4. Add one entry to Change Log for every implementation change.
5. If behavior or schema changes, update Decision Log with reason.
6. If interface changes, update interface sections first, then implementation.
7. If implementation diverges from blueprint, log as Deviation with owner and resolution date.
8. Never remove historical Change Log entries.

## Prompt Library
1. Blueprint Sync Prompt
- Read `plan.md` and current repo state. Update `plan.md` to reflect what is already implemented vs pending. Refresh Last updated, Progress Snapshot, Decision Log, and Change Log.
2. Post-Feature Update Prompt
- I finished `[feature]`. Update `plan.md` so it reflects exact shipped behavior, interface changes, schema changes, and verification results.
3. Drift Detection Prompt
- Compare implementation to `plan.md`. List all drift items, then patch `plan.md` to align with shipped behavior or flag explicit deviations.
4. Interface Lock Prompt
- Update `plan.md` Interfaces section as canonical contract for `[module]`. Include signatures, collection fields, validation rules, and concurrency expectations.
5. Cutover Runbook Prompt
- Update `plan.md` Cutover Runbook with exact current commands, verification checklist, rollback path, and signoff criteria.
6. Milestone Review Prompt
- Produce a milestone review from `plan.md`: done, blocked, next 7 tasks, and missing decisions.
7. Quality Gate Prompt
- Before coding, review `plan.md` and produce acceptance tests for `[feature]`. After coding, update `plan.md` with pass/fail evidence.
8. Release Readiness Prompt
- Audit `plan.md` for release readiness: unresolved decisions, missing tests, missing rule coverage, and missing rollback steps.

## Progress Snapshot
| Area | Status | Owner | Target Date | Notes |
|---|---|---|---|---|
| Auth + Role Scope | Completed | Claude Code | 2026-02-13 | Claims provisioning/verification scripts are implemented (`claims:provision`, `claims:verify`) and plaintext PIN fallback is removed in login; runbook now captures provisioning + strict enforcement execution steps |
| Shift Assignments | Completed | Claude Code | 2026-02-13 | Canonical naming cutover is implemented in app/rules/seed paths (`shiftAssignments`) |
| EOC Tasks + Lifecycle | In Progress | Claude Code | 2026-02-12 | Task sync/checklist flow exists with optimistic `version` checks on submit + issue lifecycle; canonical service-interface wrapper consolidation still pending |
| Transport Hardening | In Progress | Claude Code | 2026-02-12 | Single-active and lock guards are in place; full close-only and validation contract alignment still pending |
| Supervisor Queues | In Progress | Claude Code | 2026-02-12 | KPI queues exist and scope banner now shows primary + backup scopes; queue lifecycle still needs full canonical service-layer alignment |
| Admin Controls + Audit | Completed | Claude Code | 2026-02-13 | Audit center/deletes/access-grant lifecycle are implemented and template management now enforces Draft -> Diff -> Publish with required version note |
| Regression + UAT | In Progress | Claude Code + Admin/Supervisor | 2026-02-12 | Matrix and walkthrough docs exist; full signoff evidence and go/no-go checklist still pending |

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
| 2026-02-12 | Backlog Closure | Implemented hashed PIN storage (`pinHash`) with staged legacy-login migration; removed plaintext seed dependency | `src/utils/pinHash.js`, `src/components/PinLogin.jsx`, `src/components/SupervisorDashboard.jsx`, `scripts/seedUsers.js`, `firestore.rules`, `plan.md` | `npm run build`, `npm run reset:uat` |
| 2026-02-12 | Backlog Closure | Implemented transport lifecycle hardening: single-active guard, multi-site picker flow, and active-transport lock/logout guard | `src/App.jsx`, `plan.md` | `npm run build` |
| 2026-02-12 | Backlog Closure | Implemented explicit BHT EOC state indicators and `Mark All OK` workflow support in hub/checklist | `src/components/BhtHub.jsx`, `src/components/EocChecklist.jsx`, `plan.md` | `npm run build` |
| 2026-02-12 | Backlog Closure | Implemented full issue queue lifecycle (`open -> in_progress -> resolved`) with required resolution notes | `src/components/SupervisorDashboard.jsx`, `firestore.rules`, `plan.md` | `npm run build` |
| 2026-02-12 | Backlog Closure | Added canonical blueprint contract sections and linked cutover runbook artifacts | `plan.md`, `docs/CUTOVER_RUNBOOK.md` | Manual blueprint contract review |
| 2026-02-12 | Backlog Closure | Marked legacy `eocAssignments` controls read-only in Supervisor EOC panel with migration guidance | `src/components/SupervisorEocPanel.jsx`, `plan.md` | `npm run build` |
| 2026-02-12 | Backlog Closure | Expanded audit logging coverage for assignment mutations, issue lifecycle actions, and transport close workflow | `src/components/SupervisorDashboard.jsx`, `src/components/CloseChecklist.jsx`, `src/App.jsx`, `plan.md` | `npm run build` |
| 2026-02-12 | Blueprint Recovery | Applied recovery plan updates: added missing canonical headings/contracts, inserted interface signatures and deterministic IDs, normalized progress rows, and replaced backlog with table-based Implementation Task Pack | `plan.md` | Manual contract parity review against requested recovery plan |
| 2026-02-12 | Backlog Closure | Implemented `accessGrants` lifecycle: scoped session merge, live scope refresh, admin grant/revoke panel with required revoke reason, scope banner expiry display, and UAT seed/rules coverage | `src/services/accessGrantService.js`, `src/components/PinLogin.jsx`, `src/App.jsx`, `src/components/SupervisorDashboard.jsx`, `src/components/AccessGrantPanel.jsx`, `firestore.rules`, `scripts/seedUsers.js`, `plan.md` | `npm run build` |
| 2026-02-12 | Backlog Closure | Implemented optimistic concurrency contract (`version`/`expectedVersion`) across critical mutable flows: shift assignment save/delete, issue state transitions, EOC task submit completion, and close-transport mutation | `src/services/versioning.js`, `src/components/SupervisorDashboard.jsx`, `src/components/EocChecklist.jsx`, `src/components/CloseChecklist.jsx`, `src/services/eocTaskEngine.js`, `src/components/TransportCard.jsx`, `src/App.jsx`, `scripts/seedUsers.js`, `plan.md` | `npm run build` |
| 2026-02-12 | Backlog Closure | Implemented offline read-only/write-block hardening and staged auth-backed scope migration: offline action guards across BHT/supervisor/admin writes, offline UI signaling, anonymous auth bootstrap on PIN login, and claim-aware hybrid Firestore role/location rules | `src/utils/networkGuard.js`, `src/App.jsx`, `src/components/Header.jsx`, `src/components/TransportCard.jsx`, `src/components/EocChecklist.jsx`, `src/components/CloseChecklist.jsx`, `src/components/SupervisorDashboard.jsx`, `src/components/AccessGrantPanel.jsx`, `src/components/PinLogin.jsx`, `src/firebase.js`, `firestore.rules`, `plan.md` | `npm run build` |
| 2026-02-12 | Backlog Closure | Added strict auth cutover controls and enforcement toggle: login blocks when strict mode is enabled without claims, app session refresh enforces policy changes, admin UI can enable/disable strict mode with audit reason, and rules enforce claim presence when toggle is enabled | `src/services/authPolicyService.js`, `src/components/PinLogin.jsx`, `src/App.jsx`, `src/components/SupervisorDashboard.jsx`, `firestore.rules`, `plan.md` | `npm run build` |
| 2026-02-13 | Backlog Closure | Added production auth-claims rollout tooling: custom-claim provision/verification scripts, package commands, and updated runbook references for strict-scope cutover execution | `scripts/provisionAuthClaims.js`, `scripts/verifyAuthClaims.js`, `package.json`, `docs/CUTOVER_RUNBOOK.md`, `plan.md` | `npm run build` |
| 2026-02-13 | Backlog Closure | Completed canonical naming cutover from legacy collections to canonical contract names (`shiftAssignments`, `alerts`) across UI/services/rules/seeding/docs | `src/App.jsx`, `src/components/SupervisorDashboard.jsx`, `src/components/EocChecklist.jsx`, `src/hooks/useEocAssignments.js`, `src/services/eocTaskEngine.js`, `scripts/seedUsers.js`, `firestore.rules`, `docs/*`, `plan.md` | `npm run build` |
| 2026-02-13 | Backlog Closure | Implemented template publish workflow contract in Admin EOC panel: Draft -> Diff -> Publish with required version note and version-history records | `src/components/SupervisorEocPanel.jsx`, `src/components/SupervisorDashboard.jsx`, `firestore.rules`, `scripts/seedUsers.js`, `plan.md` | `npm run build` |

## Implementation Task Pack — Feature + UX Flow Execution

### Summary
This task pack translates locked decisions (features, UI behavior, and end-user flow) into implementation-ready work items with priorities, dependencies, and acceptance criteria.
Use this as the executable backlog section in `plan.md` under implementation.

### Task Backlog

#### P0 — Blueprint and Contract Lock
| ID | Task | Dependency | Done When |
|---|---|---|---|
| P0-01 | Add missing required `plan.md` headings: `User Interaction Contract`, `Data Model and Interfaces (Canonical v1)`, `Write Integrity and Concurrency`, `Authorization and Rules Contract`, `Free-Tier Automation Model`, `One-Time Reset and Cutover Runbook`, `Prompt Library` | None | All required headings exist exactly once |
| P0-02 | Move current content under canonical headings without losing behavior details | P0-01 | No behavior text orphaned under wrong sections |
| P0-03 | Insert all required interface signatures verbatim | P0-01 | Signatures present exactly as contract text |
| P0-04 | Insert canonical collections including `accessGrants` and `*/{recordId}/activity/*` | P0-01 | All canonical collections appear in one authoritative list |
| P0-05 | Add deterministic task ID contract (`house_...`, `van_...`) | P0-01 | ID formulas documented in interface/data section |
| P0-06 | Resolve naming decisions in plan text (`bhtAssignments` vs `shiftAssignments`, `supervisorAlerts` vs `alerts`) | P0-03, P0-04 | One canonical name per concept with migration note |
| P0-07 | Remove/resolve automation contradictions in plan text (Cloud Functions vs lazy sync) | P0-01 | Single canonical automation model across all sections |
| P0-08 | Normalize Progress Snapshot rows to target implementation areas | P0-01 | Rows include: Auth+Role Scope, Shift Assignments, EOC Tasks+Lifecycle, Transport Hardening, Supervisor Queues, Admin Controls+Audit, Regression+UAT |

#### P0 — BHT Flow (Feature + UI)
| ID | Task | Dependency | Done When |
|---|---|---|---|
| BHT-01 | Home queue order lock: `New Transport` pinned, then overdue, due today, active transports | P0-02 | Home order is deterministic across sessions |
| BHT-02 | Stateful EOC actions: `Not Due`, `Due`, `Overdue`, `Completed` | BHT-01 | Each task renders correct state and actionability |
| BHT-03 | Multi-van Van EOC picker flow | BHT-01 | Multi-van users must select van before checklist |
| BHT-04 | Checklist chip UX: `OK` / `Repair` with repair-note required | BHT-02 | Repair submit blocked without note |
| BHT-05 | Add `Mark All OK` (fills unanswered only) | BHT-04 | Pre-answered items unchanged after action |
| BHT-06 | Sticky submit with full-answer gating | BHT-04 | Submit disabled until all items valid |
| BHT-07 | Submit outcome behavior: success confirmation + return home + immediate `Completed` state | BHT-06 | UI reflects completion without manual refresh |
| BHT-08 | Transport start flow: single-location direct start, multi-location picker | BHT-01 | Start flow follows scope-aware branching |
| BHT-09 | Enforce single active transport per BHT | BHT-08 | Second active transport creation blocked |
| BHT-10 | Finish validation UX: inline section errors + jump to first invalid | BHT-09 | Finish cannot proceed with hidden validation failures |
| BHT-11 | Closed transport access: read-only `My Recent` window | BHT-09 | Closed items are view-only for BHT |
| BHT-12 | Session rules: lock/logout blocked when active transport exists | BHT-09 | User cannot exit active transport path improperly |
| BHT-13 | Mid-session deactivation handling: write lock + forced re-auth | BHT-12 | Writes fail immediately after deactivation |
| BHT-14 | Assignment-removed with active transport: close-only path | BHT-12 | User can only close existing active transport |
| BHT-15 | Offline mode: read-only warning state, writes blocked | BHT-12 | Offline writes are blocked with explicit feedback |

#### P1 — Supervisor Flow (Feature + UI)
| ID | Task | Dependency | Done When |
|---|---|---|---|
| SUP-01 | Mobile navigation lock to single dropdown module menu | P0-02 | Mobile nav has one authoritative module selector |
| SUP-02 | Dashboard KPI order lock: EOC Risk, Compliance Risk, Transport Risk | SUP-01 | KPI cards render in locked order |
| SUP-03 | KPI click-through queues with defaults: scoped, open/actionable, urgency sort | SUP-02 | Queue opens pre-filtered with overdue first |
| SUP-04 | Issue lifecycle implementation: `Open -> In Progress -> Resolved` | SUP-03 | State transitions enforced in UI/data |
| SUP-05 | Resolve requires resolution note | SUP-04 | Resolve action blocked without note |
| SUP-06 | Supervisor role restrictions: no role changes, no out-of-scope actions, no issue delete/archive | SUP-03 | Restricted actions blocked in UI + backend |
| SUP-07 | Assignment edit workflow: explicit save + diff summary | SUP-03 | Save preview shows before/after fields |
| SUP-08 | Closed transport edit workflow: mandatory reason modal + audit event | SUP-03 | No edit commit without reason + audit entry |
| SUP-09 | Scope banner with primary + backup scopes and backup expiry | SUP-01 | Scope indicator always visible in supervisor context |

#### P1 — Admin Flow (Feature + UI)
| ID | Task | Dependency | Done When |
|---|---|---|---|
| ADM-01 | Global risk dashboard landing | P0-02 | Admin lands on global risk view |
| ADM-02 | Settings IA lock: Scheduling, Templates, Access, Thresholds | ADM-01 | Settings grouped exactly as contract |
| ADM-03 | Template publish workflow: Draft -> Diff -> Publish + version note | ADM-02 | Publish requires diff preview and version note |
| ADM-04 | Backup access management panel with active/upcoming/expired states | ADM-02 | Grant lifecycle states visible and accurate |
| ADM-05 | Early revoke flow requires reason | ADM-04 | Revoke blocked without reason |
| ADM-06 | Hard delete two-step confirmation + required reason + audit | ADM-01 | Hard delete impossible without both confirmations and reason |
| ADM-07 | Audit center admin-only with default filters | ADM-01 | Non-admin cannot access; defaults applied on load |

#### P1 — Data Integrity, Security, and Automation
| ID | Task | Dependency | Done When |
|---|---|---|---|
| CORE-01 | Implement service-layer wrappers for all canonical interfaces | P0-03 | UI calls canonical service layer only |
| CORE-02 | Add `version` + `expectedVersion` optimistic concurrency on mutable critical records | CORE-01 | Stale writes produce conflict flow, not overwrite |
| CORE-03 | Enforce transaction/batch for critical multi-doc operations | CORE-01 | Critical writes are atomic |
| CORE-04 | Firestore rules move from client-trust to role/location enforcement | P0-04 | Unauthorized cross-scope access denied server-side |
| CORE-05 | PIN hardening migration (`pinHash`, algo fields, forced change) | CORE-04 | Plain PIN no longer authoritative storage |
| CORE-06 | Implement `accessGrants` lifecycle + scope evaluation | CORE-04 | Backup access expires/revokes correctly |
| CORE-07 | Lazy idempotent automation entry points (BHT Home, Supervisor Dashboard, Admin Dashboard) | CORE-01 | Missing due tasks self-heal; overdue transitions applied idempotently |
| CORE-08 | Central audit + per-record activity writes for critical actions | CORE-03 | Every critical action has audit and activity evidence |

#### P2 — Cutover, UAT, and Release Readiness
| ID | Task | Dependency | Done When |
|---|---|---|---|
| REL-01 | Finalize one-time reset and cutover runbook in `plan.md` with exact commands | P0-01 | Runbook is executable end-to-end |
| REL-02 | Align `docs/UAT_WALKTHROUGH_PHASE9.md` and regression matrix to final flow contract | REL-01 | UAT docs match canonical behavior text |
| REL-03 | Execute full UAT walkthrough with Admin + Supervisor signoff | REL-02 | Signoff table completed with pass/fail notes |
| REL-04 | Record release readiness gaps: unresolved decisions, missing tests, missing rule coverage, rollback risk | REL-03 | Explicit go/no-go checklist exists |
| REL-05 | Update `plan.md` Progress Snapshot + Decision Log + Change Log after each merged bundle | All | Living blueprint remains current and historically complete |

### Gap-to-Task Mapping (What Is Still Missing Right Now)
1. Blueprint contract recovery in this update:
- Added `User Interaction Contract` heading and detailed role/BHT/supervisor/admin behavior rules.
- Added `Prompt Library`.
- Added verbatim canonical signature list.
- Added explicit `accessGrants` and `*/{recordId}/activity/*`.
- Added deterministic `house_...` / `van_...` formulas.
2. Remaining gaps are operational execution gaps:
- Run `npm run claims:provision` + `npm run claims:verify` against production/staging user set, then enable strict enforcement in Users tab once verification is complete.
3. Backlog format status:
- Backlog is now aligned to table-based Implementation Task Pack sections (`P0`, `BHT`, `SUP`, `ADM`, `CORE`, `REL`).

### Test Cases and Scenarios
1. Role scope enforcement (BHT/Supervisor/Admin by location).
2. Deterministic `eocTasks` generation and duplicate prevention.
3. Overdue transition timing at Phoenix midnight.
4. Issue lifecycle including `In Progress` and mandatory resolution note.
5. Single-active transport enforcement.
6. Closed transport supervisor edit requires reason + audit.
7. Concurrency conflict on stale `expectedVersion`.
8. Backup access expiry/revoke behavior during active session.
9. Offline read-only behavior and write block.
10. Hard-delete policy with audit compliance.

### Assumptions and Defaults (Locked for This Plan)
1. Timezone: `America/Phoenix`.
2. v1 automation: no Cloud Functions critical path; lazy idempotent app-entry sync.
3. Alerts are in-app only for v1.
4. Export default: `.xlsx`, scoped to current filters.
5. Audit center is admin-only.
6. Canonical naming for final contract: `shiftAssignments`, `alerts`, `accessGrants`.

## Open Questions / Future Decisions
| Date | Question | Options | Default if Unanswered | Owner |
|---|---|---|---|---|
| 2026-02-12 | PIN model forced-change rollout | Immediate force on next login vs staged by role/location | Staged rollout with admin first, then supervisors, then BHTs | Admin/Owner |
| 2026-02-12 | Auth-backed role/location enforcement migration path | Big-bang Firebase Auth cutover vs staged hybrid path | Staged hybrid path with dual-read validation period | Admin/Owner |
| 2026-02-12 | `version`/`expectedVersion` conflict UX standard | Modal reload+retry vs silent retry vs hard-block-only | Modal reload+retry with clear diff summary | Admin/Owner |
