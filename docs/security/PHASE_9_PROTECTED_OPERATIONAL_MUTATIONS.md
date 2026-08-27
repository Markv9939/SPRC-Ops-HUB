# Security Foundation Phase 9 — Protected EOC and Issue Mutations

Last updated: 2026-08-26
Status: Locally complete on the isolated security branch; dormant and not released

## Outcome

Phase 9 closes the Firestore expression-limit gap identified in Phases 4–8. When the exact versioned EOC or issues workflow claim is active, high-consequence EOC submission and issue lifecycle changes use protected Cloud Function transactions instead of large browser transactions. When that claim is absent, the current production-compatible path remains unchanged.

No production configuration, secret, data, Auth provider, workflow gate, rule, Function, Hosting build, canary, or App Check setting was changed.

## Protected operations

- EOC completion validates the current mapped device session, exact task eligibility, location scope, task status, expected version, and operation ID.
- One server transaction creates the submission, completes the task, removes the owner draft, creates checklist issues and immutable activity, updates recurrence history, and writes immutable operation audit evidence.
- Deterministic issue and alert IDs make retries idempotent. A replay can restore a missing alert after an interrupted request without duplicating the EOC submission or issue.
- Issue reporting, notes, BHT follow-up, reopen requests, resolution submission/review, status changes, and relationship actions validate role, owner, location, current state, and expected version on the server.
- Submitted, resolved, voided, and relationship-protected states cannot be silently overwritten by a stale second device.
- Strict browser writes for these mutations are denied only when the matching workflow is enabled; normal reads and EOC draft work remain available through scoped rules.
- Supervisor issue listeners now use exact per-location queries. Admins retain their intended broad issue overview, while malformed or out-of-scope issue records remain unavailable to non-admin staff.

## Client routing and offline behavior

- The client calls the protected EOC or issue Function only when the secure session contains the exact versioned workflow claim.
- Offline EOC replay retains its original owner/session authorization and operation ID before entering the protected server transaction.
- The disabled/default build continues using the existing browser path.
- Mobile, tablet, and desktop browser fixtures now use the same canonical cycle task IDs as the real task synchronizer and reseed emulator data between viewport projects.

## Verification evidence

- Production build: passed; 1,910 modules transformed.
- Lint: passed with zero errors or warnings.
- Non-emulator regression: 140 passed, 0 failed, including 56 security-foundation contracts.
- Security Auth/Firestore emulator: 40 passed, 0 failed.
- Phase 9 focused mutation emulator: 4 passed, 0 failed, including idempotent alert recovery.
- Firestore rules: 35 passed, 0 failed.
- Storage rules: 4 passed, 0 failed.
- Functions emulator: 10 passed, 0 failed under Node.js 22.23.2; all dormant callables, including `submitProtectedEocV9` and `mutateProtectedIssueV9`, loaded.
- Shift Debrief emulator: 1 passed. Core reset emulator: 1 passed. Synthetic EOC upgrade seed/write/verify: passed.
- Secure EOC/issues browser matrix: 7 isolated mobile/tablet/desktop workflows passed, 0 failed.
- Disabled/default legacy EOC/issues browser matrix: the same 7 isolated workflows passed, 0 failed.
- Readiness verifier under Node.js 22.23.2: `localDormantImplementationReady: true`, `runtimeParity: true`, and `productionReleaseReady: false`.
- `git diff --check` and Markdown/link checks are required again after documentation closeout.

## Remaining release boundary

Local implementation is complete, but production release is a separate security operation. Before release, review the branch/PR, prepare the production secret and versioned configuration without exposing credentials, select synthetic/Test House canary profiles, capture the coordinated rollback bundle, deploy dormant layers, and obtain a separate go/no-go approval before activating even one workflow. Do not enable Anonymous Authentication or the old global strict-auth switch.
