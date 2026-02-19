# SPRC Ops Hub Blueprint (V2 Core)

Last updated: 2026-02-17
Status: Active
Primary owner: Product + Engineering

## 1. Project Overview
SPRC Ops Hub centralizes daily operations across three levels:
- BHT execution: transports, EOC checklists, documentation.
- Supervisor operations: queue triage, assignments, issue lifecycle.
- Admin governance: user/role/scope control, templates, audit, access grants.

This file is the running blueprint for what is live now, what is required behavior, and what is next.

## 2. Product Intent (Non-Negotiable)
- Keep PIN login simple for operators while enforcing role- and scope-based access server-side.
- Keep workflows fast: no extra screens unless they prevent real data errors.
- Keep guardrails strict for data integrity: immutable submissions, scoped writes, auditable privileged actions.
- Keep `plan.md` and `CHANGELOG.md` synchronized with shipped behavior.

## 3. Runtime and Architecture
- Frontend: React + Vite (`src/`)
- Backend: Firebase Firestore + Firebase Auth claims
- App entry: `src/App.jsx`
- Main role surfaces:
  - BHT: `src/components/BhtHub.jsx`, `src/components/TransportCard.jsx`, `src/components/EocChecklist.jsx`
  - Supervisor/Admin: `src/components/SupervisorDashboard.jsx`
- Core services:
  - EOC automation: `src/services/eocTaskEngine.js`
  - Assignment sync: `src/services/assignmentService.js`
  - Scope and grants: `src/services/accessGrantService.js`
  - Auth policy: `src/services/authPolicyService.js`

### 3.1 Instruction Alignment and Approved Exceptions
Master instruction alignment and project exceptions are documented in `docs/PROJECT_ALIGNMENT.md`.
Project session-start and repo operating rules are documented in `PROJECT_INSTRUCTIONS.md`.

Approved exceptions for this repo:
- Frontend remains React + Vite (intentional exception to vanilla-JS default guidance).
- Cloud Functions are optional and not required for current runtime/cutover.
- PWA implementation is deferred by owner decision for now.

### 3.2 Delivery Workflow Contract
Each logical batch should follow this operational order:
1. Implement one cohesive batch.
2. Run relevant verification:
   - `npm run build`
   - `npm run lint`
   - `npm run smoke:phase9:full` (release-readiness path)
3. Deploy for owner validation:
   - Hosting changes: `firebase deploy --only hosting --project sprc-tx-l`
   - Rules changes: `firebase deploy --only firestore:rules --project sprc-tx-l`
4. Validate key paths on iPhone/iPad.
5. Record evidence in `docs/REGRESSION_UAT_PHASE9.md` and shipped behavior in `CHANGELOG.md`.

## 4. Canonical Role and Scope Model
Roles in runtime:
- `bht`
- `supervisor`
- `admin`

Compatibility note:
- `tech` is normalized to `bht` where legacy records still exist.

Scope semantics:
- Admin is global (`OTC`, `RES`).
- Supervisor is scoped to authorized locations only.
- BHT is scoped to assignment/user profile + active grants.
- Location aliases must resolve consistently (example: house-level IDs map to `OTC`/`RES` main scope).

Auth claim contract (enforced by rules/policy):
- `role` claim required for scoped access.
- `locations` claim required for location-scoped reads/writes.

## 5. Current Operational Contract
### 5.1 PIN Login
- PIN is 4 digits.
- PIN storage is hashed (`pinHash`), no plaintext authority.
- Lockout after repeated failed attempts.
- Login session validates claim/role/scope compatibility.

### 5.2 BHT
- One active transport max per BHT (`open|arrived`).
- New transport requires valid scoped site.
- Active transport blocks lock/logout until closed.
- EOC tasks sync on session start.
- EOC checklist UX is optimized for rapid completion:
  - read-only completer identity sourced from active user
  - sticky bottom actions for next-item navigation and submit
  - keyboard progression for fast desktop input
  - repair-note focus guidance when `Repair` is selected
- EOC draft autosave persists in-progress checklists and restores on reopen for the same user/task.
- Multi-van BHT support is canonical:
  - User profile supports `vanIds[]`.
  - Assignment sync preserves `vanIds[]` and primary `vanId` compatibility.
  - Van EOC picker supports selecting targeted van tasks.
- Self-service PIN rotation is available from Header (`Change PIN`) for eligible roles.
  - Requires current PIN + new PIN + confirm PIN.
  - New PIN must be exactly 4 digits and different from current PIN.

### 5.3 Supervisor
- Queue-first operations for issues, overdue tasks, and alerts.
- Issue lifecycle: `open -> in_progress -> resolved`.
- Transition notes required on lifecycle actions.
- Assignment/user management is scope-limited.
- Supervisors can self-rotate their own PIN from Header.
- Supervisors retain managed-user PIN reset authority for BHT users in their allowed facility scope.

### 5.4 Admin
- Full user lifecycle management.
- Scope/role management and access grants lifecycle.
- Template governance and publish workflows.
- Audit visibility and privileged-action traceability.

## 6. Canonical Data Collections (Live)
- `users`
- `shiftAssignments`
- `eocTasks`
- `eocSubmissions`
- `eocSubmissionDrafts`
- `eocIssues`
- `alerts`
- `transports`
- `accessGrants`
- `auditLogs`
- `complianceItems`
- `complianceCertificates`
- `complianceSettings`
- `authPolicy`

## 7. Guardrails (Must Hold)
### Auth/Policy
- Claim-enabled role/scope enforcement for protected writes.
- Unauthorized scope writes must fail server-side.
- Self-service PIN writes require strict identity match to target user (`users.authUid` vs `request.auth.uid`).
- Self-service PIN writes are restricted to PIN/version/timestamp fields; profile/role/scope fields are immutable via this path.

### Transports
- BHT cannot start second active transport.
- Transport write operations must respect role/scope.
- Close flows must satisfy required data rules and version checks.

### EOC
- Submission blocked unless checklist is complete and valid.
- Repair/attention paths require notes.
- Submission creates/updates downstream issue and alert records when required.
- Draft autosave writes must remain scoped to the authenticated user and allowed location.

### Supervisor/Admin Writes
- Out-of-scope mutations blocked.
- Privileged writes must produce audit entries.
- Version conflicts return deterministic retry guidance.

## 8. Verification Baseline (Current)
Required pre-release commands:
- `npm run build`
- `npm run lint`
- `npm run smoke:phase9:full`

Operational commands:
- `npm run reset:uat`
- `npm run claims:provision`
- `npm run claims:verify`

Latest local verification (2026-02-14):
- `npm run build`: PASS
- `npm run lint`: PASS
- `npm run smoke:phase9:full`: PASS

Latest local verification (2026-02-16, self-service PIN update):
- `npm run lint`: PASS
- `npm run build`: BLOCKED in this environment (`esbuild` `spawn EPERM` during Vite config bundling).

## 9. Delivery Status
Completed:
- Role/scope model in app + Firestore rules.
- PIN hash login and lockout behavior.
- Assignment-derived EOC task model.
- BHT active transport guardrails.
- Supervisor issue lifecycle and queue actions.
- Access grant lifecycle wiring.
- Multi-van create/edit/save support in supervisor user management.
- Self-service PIN rotation for BHT/Supervisor with current PIN verification.
- Firestore strict self-PIN rule path (identity + field-level restrictions) while preserving supervisor/admin managed PIN updates.
- Master-instruction alignment baseline added (`docs/PROJECT_ALIGNMENT.md`) with explicit project exceptions and workflow contract.
- Project-local session/startup instruction contract added (`PROJECT_INSTRUCTIONS.md`).
- UI token layer aligned to healthcare palette direction in `src/index.css` while preserving existing workflow behavior.

In progress:
- Final UAT signoff capture in `docs/REGRESSION_UAT_PHASE9.md`.
- Tightening consistency between runbooks and live UI text.

Next planned updates:
1. Close remaining UAT matrix rows with evidence.
2. Add targeted automated tests for assignment + auth-policy edge cases.
3. Trim residual legacy paths once all production data is migrated.

## 10. Source of Truth Policy
- `plan.md` = current operating blueprint.
- `docs/PROJECT_ALIGNMENT.md` = instruction alignment + approved project exceptions.
- `PROJECT_INSTRUCTIONS.md` = session startup order + repo operating rules.
- `CHANGELOG.md` = chronological implementation truth.
- If implementation conflicts with this blueprint:
  1. Update code to match blueprint, or
  2. Revise blueprint first, then implement.

Instruction precedence for conflicting guidance:
1. Master `AGENTS.md` safety/change-control rules.
2. `PROJECT_INSTRUCTIONS.md` repo operating rules.
3. `docs/PROJECT_ALIGNMENT.md` for approved repo exceptions.
4. `plan.md` product behavior contract.
5. Implementation in code.

## 11. Linked Docs
- `docs/CUTOVER_RUNBOOK.md`
- `docs/UAT_WALKTHROUGH_PHASE9.md`
- `docs/REGRESSION_UAT_PHASE9.md`
- `CHANGELOG.md`
