# Phase 9 UAT Walkthrough Script

Last updated: 2026-02-13
Goal: Execute a single guided walkthrough and capture signoff evidence for Phase 9.

## Preconditions

1. Run latest app build smoke:
   - `npm run smoke:phase9`
2. Reset stale legacy data and seed clean UAT dataset:
   - `npm run seed -- --confirm`
   - Optional (also clears `clients` + `destinations`): `npm run seed -- --confirm --clear-autocomplete`
3. Have three active test users:
   - `Admin/Owner`
   - `Supervisor` (scoped to one location)
   - `BHT`
4. Seed or prepare at least:
   - 1 location with a single BHT assignment
   - 1 location/shift with multiple BHT assignments
   - 1 multi-van BHT assignment
   - 1 pending EOC task due today
   - 1 overdue EOC task from prior day
5. Start app:
   - `npm run dev`
6. Validate claims provisioning:
   - `npm run claims:verify`

## Environment Note (2026-02-12)

- Firestore rules were redeployed to `sprc-tx-l`, and `npm run reset:uat` now completes full assignment/task seeding.

## Evidence Capture Rule

For each test case below, capture:
- timestamp
- tester role
- PASS/FAIL
- short note (or screenshot reference)

## Test Sequence

### A. Role and Scope

1. RS-1 Supervisor assignment out of scope
   - Login as Supervisor.
   - Attempt to assign/create user outside authorized location.
   - Expected: blocked.
2. RS-2 BHT scope visibility
   - Login as BHT.
   - Attempt to access records outside assigned location/scope.
   - Expected: not visible or blocked.
3. RS-3 Admin global scope
   - Login as Admin.
   - Verify access across all configured locations.
   - Expected: full visibility.
4. RS-4 Backup access grant lifecycle
   - As Admin, create backup grant in Users tab for a scoped Supervisor (start now, near-term expiry).
   - Verify scope banner shows backup scope + expiry; then revoke with required reason.
   - Expected: grant status transitions active/upcoming/expired/revoked correctly and revoke is blocked without reason.
5. RS-5 Custom-claim provisioning verification
   - Run `npm run claims:verify`.
   - Expected: all active rollout users pass with no claim mismatches.
6. RS-6 Strict auth enforcement validation
   - Attempt login with a session lacking custom claims.
   - Attempt login with a matching claim-enabled account for the same PIN user.
   - Expected: missing-claim login is blocked and claim-enabled login succeeds.

### B. Assignment + EOC Generation

1. AE-1 Single-BHT auto house owner
   - In location+shift with one BHT, verify House EOC owner auto behavior.
2. AE-2 Multi-BHT primary required
   - In location+shift with multiple BHTs, attempt save without primary.
   - Expected: validation block.
3. AE-3 Multi-van BHT picker flow
   - Login as BHT with multiple assigned vans.
   - Verify van picker and independent van completion behavior.
4. AE-4 Reassignment future-only behavior
   - Reassign mid-cycle and verify existing tasks stay with original assignee.
   - Verify future generated tasks follow new assignment.

### C. Overdue Behavior

1. OR-1 Pending flips overdue after Phoenix midnight
   - Validate task status flip for prior-day pending item.
2. OR-2 New due-cycle generation while overdue exists
   - Validate next cycle task still appears.

### D. Issue + Alert Lifecycle

1. IA-1 Repair/attention without note
   - Attempt submit.
   - Expected: blocked.
2. IA-2 Issue submit creates supervisor alert
   - Submit with note.
   - Expected: alert in correct queue/location.
3. IA-3 Alert remains until resolved/read flow
   - Resolve/read from supervisor queue.
   - Expected: lifecycle behavior consistent with queue actions.

### E. Data Integrity

1. DI-1 BHT submit-lock
   - Submit transport/EOC then attempt edit.
   - Expected: edit blocked.
2. DI-2 Correction audit
   - Perform supervisor/admin correction and verify audit entry.
3. DI-3 Soft delete visibility
   - Soft-delete user/assignment and verify hidden in default views.
4. DI-4 Hard delete reason requirement
   - Attempt admin hard delete without reason.
   - Expected: blocked.
5. DI-5 Offline write protection
   - Disable network and attempt transport/EOC/supervisor write actions.
   - Expected: explicit offline warning and write blocked until reconnect.

### F. Scheduler/Idempotency

1. SC-1 Task creation by due config
   - Trigger/observe sync behavior and verify expected tasks.
2. SC-2 Idempotent re-run
   - Re-run for same cycle key and verify no duplicates.

## Signoff Block

| Role | Name | Date | Result | Notes |
|---|---|---|---|---|
| Admin/Owner |  |  | PENDING | |
| Supervisor |  |  | PENDING | |

## Completion Rule

Phase 9 can be marked `Completed` when:
1. All required scenarios are `PASS` or have approved exception notes.
2. Admin + Supervisor signoff block is filled.
3. `plan.md` Phase 9 status is updated from `In Progress` to `Completed`.
