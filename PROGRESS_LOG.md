# SPRC Ops Hub Progress Log

Last updated: 2026-08-28
Status: Active evidence log
Quick orientation: [`MASTER_PLAN.md`](MASTER_PLAN.md)

## 2026-08-28 — Identity/Users completion implementation, local checkpoint

### Purpose

Resume from merged `origin/Main` commit `44b6e44` without repeating security-foundation Phases 1–9, correct the approved supervisor account-creation contract, enforce the Users page location boundary in Firebase rather than only in React, and prevent another secure-canary Hosting build from omitting its compile-time bootstrap setting.

### Local implementation outcome

- Created isolated branch `codex/security-foundation-completion` from clean `44b6e44`.
- Protected account creation now lets a current mapped supervisor create only a valid BHT/tech whose exact one-home-location configuration belongs to the supervisor's authorized main-location scope. Admin authority remains global; supervisor/admin creation, role elevation, out-of-location creation, malformed homes, and inactive/stale actors remain denied.
- Restored the existing `+ Add New User` experience for supervisors. The supervisor form exposes only BHT and authorized location options while retaining the familiar six-digit PIN, house, shift, van, and active fields.
- Replaced the supervisor's whole-collection Users listener/read with canonical role-plus-location Firestore queries. Admins retain the global list. Secure sessions do not display cached staff results before a server-authorized result, and a failed scoped query clears the list and shows an error instead of silently presenting partial scope.
- Tightened strict `users` list/get rules to require BHT/tech role plus the supervisor's signed current workflow location scope. Added direct rule proof that an OTC supervisor can query OTC BHTs but cannot query RES staff or supervisors; admins retain the global query.
- Removed the unsafe no-scope-to-OTC fallback. A supervisor with no valid staff location receives no Users query and must have the profile corrected.
- Added `npm run build:security-canary` and `npm run verify:security-canary-build`. The canary build forces the secure compile flag and injects a verifiable `sprc-security-bootstrap=v3-enabled` marker; verification refuses a bundle without it.
- Added an out-of-scope RES BHT emulator fixture and a protected browser journey proving the supervisor sees only OTC BHTs, cannot select supervisor/admin or RES, and creates a Test House BHT through `manageStaffSecurityV4`.

### Verification evidence

- Focused pure model tests: 17 passed, 0 failed.
- Full security-foundation pure tests: 60 passed, 0 failed.
- Auth/Firestore security-foundation emulator: 42 passed, 0 failed, including in-scope supervisor creation and elevated/out-of-location denials.
- Firestore rules: 36 passed, 0 failed, including backend-scoped Users queries.
- Storage rules: 4 passed, 0 failed.
- Functions emulator: 10 passed, 0 failed. The final parity run used the checksum-verified official Node.js `22.23.2` binary and reported `Using node@22 from host`.
- Secure phone/tablet/desktop browser matrix: 10 applicable cases passed; 14 intentional duplicate-viewport cases skipped. It covered server PIN login, persistence/reload/tabs, independent devices, one-device logout, self-PIN change, supervisor PIN reset, end-all-sessions, live revocation, scoped Users listing, and supervisor BHT creation. The known Windows web-server wrapper was interrupted only after the final case reported.
- Existing non-emulator regression suites: PIN 4, Shift Debrief 14, debrief-reset 3, EOC/org/batching 29, supervisor EOC 5, Function models 8, issues/photos/feedback 18, reset 4, cutover 2, and protected operational mutations 4 — all passed, 0 failed.
- Normal compatibility build passed. The guarded secure-canary build passed and its output marker was independently verified. Lint and `git diff --check` passed.
- `verify:security-readiness` under Node.js 22.23.2 reported `localDormantImplementationReady: true`, `runtimeParity: true`, and `productionReleaseReady: false` only because production release/configuration authority remains separate.

### External-state and release boundary

- No Firebase production read/write, account creation, PIN reset, deactivation, session ending, configuration change, secret change, Auth-provider change, rules/Functions/Hosting deployment, canary expansion, push, merge, or activation occurred.
- The temporary emulator-only PIN secret file was removed after browser verification. No secret material is tracked.
- Production still requires a coordinated reviewed release of Functions, Firestore rules/indexes as needed, and the guarded secure Hosting build. Before any live account/session/data action, obtain Mark's explicit approval.
- Identity/Users production regression and rollback remain Stage 3. Every later protected workflow and `authorizeOfflineReplayV5`, `createProtectedTransportV6`, `submitProtectedEocV9`, and `mutateProtectedIssueV9` remain disabled/private.

## 2026-08-27 — Release and activate the identity-only Test House security canary

### Purpose

Move the completed security foundation into its first narrowly controlled production proof without changing login behavior for ordinary staff or opening later operational workflows.

### Outcome and exact status

- Pull Requests #3–#6 were merged into case-sensitive `Main`; the current release reference is `e159bf4`.
- Firestore rules/indexes, Storage rules, Hosting, all existing Functions, and the six dormant security Functions were deployed. The identity-only follow-up keeps offline replay, transports, EOC submission, and issue mutation disabled.
- Only `beginStaffPinSessionV2` and `manageStaffSecurityV4` accept network requests. The other four security workflow Functions remain network-private and return infrastructure-level 403 responses.
- Created dedicated runtime identity `sprc-security-runtime@sprc-tx-l.iam.gserviceaccount.com` for the two reachable services. It has Firestore data access, Firebase Authentication administration, PIN-secret access, and self custom-token signing; unrelated Functions did not receive those permissions.
- Activated release `security-foundation-test-house-v1` for only `test_supervisor`, `test_bht_shift_1`, and `test_bht_shift_2`, with only `identity_users` enabled and offline replay disabled.
- The first rollback correctly restored both protected settings to their absent baseline and exposed a fixed-name immutable-audit collision during reactivation. The script was corrected to create a new immutable audit document per event, merged through Pull Request #6, and a complete rollback plus reactivation drill then passed. The canary is active again.
- Live Hosting loads the normal PIN screen without browser errors. A valid Test Supervisor/Test BHT browser journey remains pending because no PIN was bypassed, retrieved, or transmitted by the release process.

### Verification and rollback evidence

- Security foundation tests: 57 passed, 0 failed; lint, Node syntax check, and `git diff --check` passed for the follow-up changes.
- Both reachable services run as the dedicated runtime identity and return application-level validation errors for malformed requests, proving the network request reached the guarded code.
- `authorizeOfflineReplayV5`, `createProtectedTransportV6`, `submitProtectedEocV9`, and `mutateProtectedIssueV9` each remain hard 403.
- Fresh rollback backup: `C:\Users\markv\Documents\Codex\SPRC-release-backups\sprc-security-canary-2026-08-28T00-15-39-841Z.json`; SHA-256 `3adeaa3d6b447f2f90037965b14577ef4a3bae16939c6657dad448a5024b0f35`.
- The final live readback shows `schemaVersion: 2`, `rolloutState: production_canary`, the exact three-profile allowlist, secure PIN/client/account gates enabled, offline replay disabled, and `identity_users` as the only enabled workflow.

### Files and external state

- Source follow-ups: `functions/src/index.js`, `scripts/manageSecurityFoundationCanary.js`, `MASTER_PLAN.md`, and `PROGRESS_LOG.md`.
- External changes: Firebase/Cloud Run deployment, dedicated runtime identity and least-privilege IAM bindings, existing PIN secret access for that identity, guarded canary configuration, and immutable canary audit events.
- No Anonymous Authentication, global strict-auth switch, broader profile cohort, operational workflow canary, production record rewrite, or real staff PIN change was performed.

### Remaining gate

Complete the live Test Supervisor and Test BHT identity/users journeys, including reload persistence, scoped user management, logout, revocation, and confirmation that a non-enrolled valid profile stays on the compatibility path. Do not broaden the cohort or enable a second workflow until that evidence passes.

## 2026-08-27 — Add a true profile-specific production canary boundary

### Purpose

Prevent the first approved security-foundation canary from changing login behavior for staff outside the three synthetic Test House profiles.

### Outcome

- Added an exact `enabledProfileIds` production-canary allowlist to the server PIN endpoint and client configuration gate.
- A valid non-enrolled PIN returns to the unchanged compatibility login without creating a Firebase Auth user, staff credential, UID mapping, or secure device session. Invalid PINs still fail through the protected server path and never downgrade.
- Added a guarded `security:canary` preview/activate/rollback command. It requires the exact project, release ID, confirmation phrase, unchanged configuration baseline, verified rollback backup outside the repository, and ready synthetic profiles.
- First cohort is fixed to `test_supervisor`, `test_bht_shift_1`, and `test_bht_shift_2`; first workflow is `identity_users` only. Broad activation and global strict auth remain prohibited.

### Evidence

- Focused security unit tests: 57 passed, 0 failed.
- Security Auth/Firestore emulator tests: 41 passed, 0 failed, including proof that a valid non-enrolled canary PIN creates no secure artifacts.
- Lint and production build passed.
- No merge, Firebase secret/configuration write, deployment, canary activation, or production data change had occurred when this entry was written.

## How to Use This Log

This file is the detailed evidence trail for significant feature, security, migration, release, and documentation work. The Master Plan explains the operating model quickly; this log preserves the forensic detail needed to understand what happened and what was actually proven.

This is not a task diary, transcript, scratchpad, or decision log. Do not add routine status updates, brainstorming, or unsupported claims. Major decisions belong in `MASTER_PLAN.md`; rough thoughts remain in Mark's Notes Inbox or clearly labeled planning discussion.

Each new significant entry should include:

- Date and plain-language purpose.
- Outcome and exact status: local only, verified, committed, pushed, deployed, configured, enabled, rolled back, or blocked.
- Exact files changed.
- Tests and direct evidence.
- Deployment/configuration/data status.
- Risks and follow-up work.
- The related Master Plan section.

Create or finalize an entry during `Close out`, after checking the real outcome. If work is materially blocked and needs a durable warning, an evidence entry may be added with status `blocked`, but it must not describe the intended behavior as current.

Do not copy credentials, PINs, client names, real workplace photos, or other sensitive information into this file.

---

## 2026-08-26 — Security foundation Phase 9 protected EOC and issue mutations

**Purpose**

Finish the remaining local security-foundation gap caused by Firestore's hard expression limit, while keeping production and the default six-digit PIN runtime unchanged.

**Outcome and exact status**

- Added dormant protected server transactions for EOC completion and the operational issue lifecycle. The server now enforces current device session, role, location, owner/eligibility, current state, expected record version, idempotent operation ID, immutable activity/audit, recurrence, and alert behavior before committing a strict-mode mutation.
- Added exact client routing so only a matching secure EOC or issues workflow claim uses the protected callable; the absent/default gate retains the existing compatibility path.
- Strict workflow rules allow scoped reads and drafts but deny direct browser EOC/issue mutations. Non-admin issue listeners use exact location queries; admins retain the intended global issue view.
- Added idempotent notification recovery for an interrupted EOC request and record-level stale/two-device conflict protection.
- Corrected the browser fixture to isolate emulator data by viewport and use the same canonical cycle task IDs as the real task synchronizer.
- Status is **implemented, verified, committed, and pushed to the isolated security branch for review; dormant and not released**. Production remains unchanged.

**Exact files added or changed**

- Server mutation model/service/tests: `functions/src/operationalMutationSecurityModel.js`, `functions/src/operationalMutationSecurityService.js`, `functions/src/index.js`, `functions/tests/operationalMutationSecurityModel.test.js`, `functions/tests/operationalMutationSecurity.contract.emulator.js`.
- Client routing/model/tests: `src/services/protectedOperationalMutationModel.js`, `src/services/protectedOperationalMutationService.js`, `src/services/offlineSyncService.js`, `src/services/bhtIssueReportService.js`, `src/services/issueStatusService.js`, `src/services/issueRelationshipService.js`, `src/components/IssueDetail.jsx`, `tests/protectedOperationalMutationService.test.js`.
- Scoped reads/rules/tests: `firestore.rules`, `src/hooks/useScopedIssues.js`, `src/hooks/useUserScope.js`, `src/components/SupervisorDashboard.jsx`, `tests/firestore.rules.test.js`.
- Browser and command harness: `scripts/seedIssuePhase3E2e.js`, `tests/e2e/eocIssues.spec.js`, `playwright.config.js`, `package.json`.
- Documentation/readiness: `docs/security/PHASE_9_PROTECTED_OPERATIONAL_MUTATIONS.md`, `scripts/verifySecurityFoundationReadiness.js`, `MASTER_PLAN.md`, `PROGRESS_LOG.md`, `README.md`, `docs/security/PHASE_4_TO_8_LOCAL_SECURITY_READINESS.md`.

**Tests and direct evidence**

- `npm run smoke:phase9:full`: focused mutation model/client 4 passed; mutation emulator 4 passed; Firestore rules 35 passed; build passed with 1,910 modules; final lint passed with zero errors or warnings.
- Full non-emulator regression: 140 passed, 0 failed, including 56 security contracts plus PIN, Shift Debrief, EOC, supervisor EOC, Function models, issues/photos/feedback, and reset/cutover suites.
- Full security Auth/Firestore emulator: 40 passed, 0 failed. Storage rules: 4 passed. Shift Debrief emulator: 1 passed. Core reset emulator: 1 passed. Synthetic EOC upgrade seed/write/verify: passed.
- Functions emulator under temporary official Node.js 22.23.2: 10 passed, 0 failed; all dormant Functions, including both Phase 9 callables, loaded under the declared runtime.
- Secure browser matrix: 7 isolated mobile/tablet/desktop workflows passed, 0 failed. Disabled/default compatibility matrix: the same 7 isolated workflows passed, 0 failed.
- Readiness under Node.js 22.23.2: `localDormantImplementationReady: true`, `runtimeParity: true`, `productionReleaseReady: false`.
- Final Markdown links, heading/fence structure, `git diff --check`, clean branch state, and remote synchronization are checked after this entry is finalized.

**Deployment/configuration/data status**

- No production read/write, deploy, merge, Auth provider change, Anonymous Authentication enablement, secret creation, workflow activation, App Check enforcement, migration, reset, or canary occurred.
- The existing production release and compatibility runtime remain the rollback baseline.

**Risks and follow-up**

- The next step is a separately approved production release operation: branch/PR review, secret/config preparation, coordinated rollback capture, dormant deployment, Test House/synthetic canary activation, observation, and go/no-go between each workflow.
- Do not enable the old global strict-auth switch or Anonymous Authentication as a shortcut.
- Compatibility retirement remains last and requires every named workflow and rollback path to pass live canary evidence.

**Related evidence and Master Plan sections**

- `docs/security/PHASE_9_PROTECTED_OPERATIONAL_MUTATIONS.md`
- `docs/security/SECURITY_CANARY_AND_ROLLBACK.md`
- 6. Offline Behavior
- 8. Current Security Foundation Assessment
- 9. Feature and Work Status
- 11. High-Level Release Status

---

## 2026-08-26 — Security foundation Phases 4–8 local dormant completion

**Purpose**

Complete the remaining authorized local security foundation without changing the familiar PIN experience or activating, deploying, pushing, merging, committing, or modifying production.

**Outcome and exact status**

- Added protected server PIN/account/session actions for self PIN change, scoped reset, secure administrator account creation, profile edits, deactivation/reactivation, soft deletion, one-device logout, and end-all-sessions.
- PIN change/reset, deactivation, role reduction, location removal, reactivation, and end-all-sessions atomically advance `securityVersion`, close all device sessions, write immutable audit/cleanup evidence, and revoke Firebase refresh tokens with idempotent retry handling. Ordinary logout closes only one device.
- Closed the older temporary backup/issue-access bypass: secure-session grant, revoke, and issue-scope changes now run through protected administrator-only server actions, advance `securityVersion`, revoke every device, and record one server audit. The next login receives active current scope; a temporary grant's earliest expiry also ends the scoped session so access cannot remain cached for the balance of the 84-hour maximum.
- Preserved the existing supervisor/admin and staff PIN screens. At this earlier checkpoint, supervisors were limited to existing BHT/tech profiles and only admins could create login-capable accounts. **Superseded on 2026-08-28:** the approved/current contract preserves supervisor creation and management of BHT/tech accounts at the supervisor's authorized existing single home location, while supervisor/admin creation and elevation remain admin-only.
- Bound new offline work to original profile, stable Firebase UID, device session, security version, location, action, and expected record version. Wrong-owner/deactivated/stale/revoked/conflicting work is safely held or moved to review rather than reassigned or forced through.
- Added exact dormant workflow gates for identity/users, templates/photos, EOC, debriefs/alerts, issues/feedback/audit, transports, operations administration, and settings. Server-issued tokens include only non-secret role/location scope and rules accept it only with a current matching server device session.
- Added protected transport creation with deterministic operation IDs, a per-profile active-transport lock, exact-version replay, and a server transaction that permits only one active transport when two devices race.
- Added monitoring-ready App Check initialization and audit presence signals while explicitly keeping enforcement off and adding no production key or setting.
- Added local readiness, canary, compatibility-retirement, and coordinated rollback checks. Status is **locally committed on the isolated security branch, dormant, disabled by default, and not released**.

**Exact files added or changed for Phases 4–8**

- Account/session server: `functions/src/staffAccountSecurityModel.js`, `functions/src/staffAccountSecurityService.js`, `functions/src/accessScopeSecurityService.js`, `functions/src/index.js`, `functions/tests/staffAccountSecurityModel.test.js`, `functions/tests/staffAccountSecurity.contract.emulator.js`.
- Offline security: `functions/src/offlineReplaySecurityModel.js`, `functions/src/offlineReplaySecurityService.js`, `functions/tests/offlineReplaySecurityModel.test.js`, `src/services/offlineSecurityModel.js`, `src/services/offlineReplayAuthorization.js`, `src/services/offlineStore.js`, `src/services/offlineSyncService.js`, `tests/offlineSecurityModel.test.js`.
- Workflow/session boundaries: `functions/src/workflowSecurityModel.js`, `functions/src/staffPinLoginService.js`, `functions/tests/workflowSecurityModel.test.js`, `firestore.rules`, `storage.rules`, `tests/firestore.rules.test.js`, `tests/storage.rules.test.js`.
- Two-device transport protection: `functions/src/transportSecurityModel.js`, `functions/src/transportSecurityService.js`, `functions/tests/transportSecurityModel.test.js`, `src/services/protectedTransportModel.js`, `src/services/protectedTransportService.js`, `tests/protectedTransportService.test.js`, `firestore.indexes.json`, `src/App.jsx`.
- Protected client actions/UI: `src/services/securityAccountActionsModel.js`, `src/services/securityAccountActions.js`, `src/services/accessGrantService.js`, `tests/securityAccountActions.test.js`, `src/components/SupervisorDashboard.jsx`, `src/components/AccessGrantPanel.jsx`, `src/services/userPinService.js`, `tests/e2e/securityAccountActionsPhase4.spec.js`, `scripts/seedSecurityPhase3E2e.js`, `playwright.security.config.js`, `playwright.config.js`.
- Workflow/offline integrations: `src/services/appFeedbackService.js`, `src/services/bhtIssueReportService.js`, `src/services/shiftDebriefService.js`.
- App Check monitoring readiness: `src/services/appCheckMonitoringModel.js`, `tests/appCheckMonitoringModel.test.js`, `src/firebase.js`.
- Readiness and documentation: `scripts/verifySecurityFoundationReadiness.js`, `docs/security/PHASE_4_TO_8_LOCAL_SECURITY_READINESS.md`, `docs/security/SECURITY_CANARY_AND_ROLLBACK.md`, `MASTER_PLAN.md`, `PROGRESS_LOG.md`, `README.md`, `PROJECT_INSTRUCTIONS.md`, `docs/PROJECT_ALIGNMENT.md`, `package.json`.

**Tests and direct evidence**

- `npm run build`: passed; 1,908 Vite modules transformed.
- `npm run lint`: passed.
- `npm run test:security-foundation`: 52 passed, 0 failed.
- Existing non-emulator suites for PIN, Shift Debrief/reset, EOC/supervisor EOC, Function models, issues/photos/feedback, production-reset model, and cutover: 84 passed, 0 failed.
- `npm run test:security-foundation:emulator`: product script reported 36 passed, 0 failed, including secure account creation, scoped supervisor controls, self PIN change, all revocation triggers, temporary/issue-access revocation, expiring scope claims, original-owner replay, and concurrent two-device transport creation.
- `npm run test:rules`: product script reported 34 passed, 0 failed. The strict claim test exercises all eight named workflow gates, current/revoked/scope-expired session behavior, denial of direct strict-mode access-grant and issue-access writes, role/location/ownership negatives, and a valid pre-signoff Shift Debrief correction.
- `npm run test:storage-rules`: product script reported 4 passed, 0 failed.
- `npm run test:functions:emulator`: product script reported 10 passed, 0 failed, and loaded every dormant callable. The final parity run used a temporary official Node.js 22.23.2 runtime and the emulator confirmed `Using node@22 from host`.
- `npm run test:debrief:emulator`: 1 passed, 0 failed. `npm run test:reset:emulator`: 1 passed, 0 failed. `npm run test:eoc-upgrade:emulator`: synthetic seed/write/verify passed.
- Security Playwright matrix: 9 applicable phone/tablet/desktop cases passed and 12 intentional viewport duplicates skipped. It covered the familiar PIN/self-change/reset screens, valid/invalid login, persistence/reload/tabs, independent devices, one-device logout, live all-device revocation, and a strict identity/users login carrying active temporary and issue scope only through server-signed claims.
- Existing EOC/issues Playwright matrix: 7 passed and 2 intentional tablet duplicates skipped, covering issue/photo/EOC/offline retry, supervisor approval, and responsive layouts.
- The focused self-PIN browser failure exposed a reversed server credential-verification argument; it was corrected and the focused phone case plus the full matrix passed.
- `npm run verify:security-readiness`: run under Node.js 22.23.2, every local artifact/boundary/runtime check passed, including `runtimeParity: true`; production readiness correctly remained false because production approval, configuration, secrets, canary, activation, deployment, and rollback authority remain separate.
- Firebase emulator wrappers can exit nonzero after their product scripts report success because the CLI cannot write its local update-check file. Playwright's Windows web server can also remain open after every case reports; it was interrupted only after final results were recorded.

**Deployment/configuration/data status**

- A local checkpoint commit was created only after verification. No deployment, push, merge, production read/write, provider change, Anonymous Authentication enablement, strict-auth activation, App Check enforcement, secret creation, feature configuration, migration, reset, or canary action occurred.
- The normal build still uses the existing PIN login and compatibility rules because every new path requires exact absent/false versioned gates.

**Risks and follow-up**

- Node.js 22 runtime parity is verified locally with a temporary official Node.js 22.23.2 runtime; the workstation's installed Node.js 24 runtime was not changed.
- Already-large EOC/issue browser transactions reach Firestore's hard 1,000-expression limit. Their final strict mutation cutover must use the protected server transaction path and pass the real canary; do not add another complex browser-rule branch.
- Before any other workflow canary, identity/account mutations for canary profiles must already use the protected server actions so role/location reduction cannot bypass session revocation.
- Temporary backup-access activation, removal, expiry, and issue-access changes must be included in the identity/users canary. The secure path deliberately signs the affected person out on any scope change so the next PIN login receives one exact current scope.
- No live production listeners, real staff accounts, production App Check telemetry, canary, rollback exercise, or compatibility retirement was authorized or performed.

**Related evidence and Master Plan sections**

- `docs/security/PHASE_4_TO_8_LOCAL_SECURITY_READINESS.md`
- `docs/security/SECURITY_CANARY_AND_ROLLBACK.md`
- Major Decisions
- 4.1 Shift start and access
- 5. Role and Location Boundaries
- 6. Offline Behavior
- 8. Current Security Foundation Assessment
- 9. Feature and Work Status
- 11. High-Level Release Status

---

## 2026-08-25 — Phase 3 dormant client authentication/session bootstrap

**Purpose**

Implement the approved disabled-by-default browser bootstrap for the Phase 2 server PIN/custom-token foundation while preserving the current six-digit PIN screen and every production workflow.

**Outcome and exact status**

- Added an exact versioned client boundary. The new path requires both a build-time Phase 3 flag and matching server schema/client-enable configuration; the normal build retains the existing PIN flow.
- Added custom-token sign-in with Firebase browser-local persistence, Auth/session readiness validation before protected rendering, minimum per-device metadata, absolute 84-hour expiry, reload/multi-tab/offline-cache restoration, reconnect retry, live profile/security monitoring, and current-device logout.
- Rebuilt secure user state from sanitized live profile and scoped-access reads rather than the editable legacy `bhtUser` browser record.
- Added focused unit, Auth/Firestore emulator, and phone/tablet/desktop browser coverage, and explicitly separated the normal disabled-path browser suite from the opt-in Phase 3 suite.
- Status is **local, uncommitted, dormant, and not released**. Nothing was deployed, pushed, merged, configured, enabled, or written to production.

**Exact files added or changed for Phase 3**

- `src/services/securityClientSessionModel.js`
- `src/services/securityClientBootstrap.js`
- `src/services/securityClientRuntime.js`
- `src/App.jsx`
- `src/components/PinLogin.jsx`
- `functions/src/staffPinCredentialModel.js`
- `functions/tests/staffPinCredentialModel.test.js`
- `tests/securityClientSessionModel.test.js`
- `tests/securityClientBootstrap.test.js`
- `tests/securityClientSession.emulator.test.js`
- `tests/e2e/securityBootstrapPhase3.spec.js`
- `scripts/seedSecurityPhase3E2e.js`
- `playwright.security.config.js`
- `playwright.config.js`
- `package.json`
- `docs/security/PHASE_3_DORMANT_CLIENT_BOOTSTRAP.md`
- `MASTER_PLAN.md`
- `PROGRESS_LOG.md`
- `README.md`

**Tests and direct evidence**

- `npm run build`: passed; 1,899 Vite modules transformed.
- `npm run lint`: passed.
- Exact non-emulator set: 111 passed, 0 failed. This includes 27 combined Phase 1–3 security contracts plus 84 existing PIN, debrief, reset, EOC, supervisor-EOC, Function-model, issue/photo/feedback, and cutover assertions.
- `npm run test:security-foundation:emulator`: product script reported 21 passed, 0 failed.
- `npm run test:rules`: product script reported 33 passed, 0 failed.
- `npm run test:storage-rules`: product script reported 3 passed, 0 failed.
- `npm run test:functions:emulator`: product script reported 10 passed, 0 failed.
- `npm run test:debrief:emulator`: product script reported 1 passed, 0 failed.
- `npm run test:reset:emulator`: product script reported 1 passed, 0 failed.
- `npm run test:eoc-upgrade:emulator`: synthetic emulator seed/write/verify sequence passed.
- Phase 3 enabled-path Playwright suite: 6 applicable cases passed and 6 duplicate viewport cases were intentionally skipped. It proved the unchanged PIN screen, valid/invalid server login, no legacy downgrade, minimum persistent metadata, 84-hour absolute window, reload, offline startup/reconnect, same-device tabs, independent browser devices, one-device logout, live all-device security-version response, and responsive layouts at 390x844, 768x1024, and 1280x720.
- Existing disabled-path EOC/issues Playwright suite: all 9 cases reported their final state, with 7 passed and 2 intentional tablet duplicates skipped. On Windows its web-server wrapper remained open after the final result and was interrupted only after all cases completed.
- In-app browser inspection at 390x844 showed the familiar `SPRC Ops Hub` / `Enter PIN to access` screen with no horizontal overflow.
- The Firebase CLI's known local updater-permission warning appeared after each emulator script had already reported success, causing wrapper exit code 1 during shutdown. Product test counts above are taken from the successful script summaries.
- Functions loaded under workstation Node.js 24 although the project declares Node.js 22; Node.js 22 parity was not verified.

**Deployment/configuration/data status**

- No deployment, push, merge, commit, production read/write, migration, reset, secret creation, Auth-provider change, Anonymous Authentication enablement, App Check enforcement, strict-auth change, or feature activation.
- No `.env` file or production `appSettings/securityFoundation` document was created or changed.
- Current staff still use the existing PIN verification, 60-minute inactivity lock, session storage, and compatibility rules in the normal build.

**Risks and follow-up**

- Account/security actions still need coordinated backend transactions that rotate credentials or increment `securityVersion`, revoke all device sessions, and write audit evidence. The Phase 3 client reacts when the version/profile changes but does not make existing PIN reset, deactivation, role/location, or access-grant actions emit that event.
- Current-device logout clears local Firebase Auth/metadata but does not yet revoke the Phase 2 server session record or create the final logout audit.
- Offline outbox replay still needs authenticated profile/session/security-version binding while preserving original-owner unsynced work and routing unsafe replay to `needsReview`.
- Firestore/Storage compatibility rules remain broad; a stable client identity is not sufficient authorization until each real workflow query/listener/rule/offline path passes.
- Phase 4 protected template/Storage proof, canary selection, production configuration/secrets, App Check, strict enforcement, compatibility retirement, and release remain unauthorized.

**Related evidence and Master Plan sections**

- `docs/security/PHASE_3_DORMANT_CLIENT_BOOTSTRAP.md`
- Major Decisions
- 4.1 Shift start and access
- 6. Offline Behavior
- 8. Current Security Foundation Assessment
- 9. Feature and Work Status
- 11. High-Level Release Status

---

## 2026-08-25 — Phase 2 dormant server PIN/session foundation

**Purpose**

Implement the approved server-side authentication/session foundation without changing the familiar PIN screen, activating the new path, or touching production.

**Outcome and exact status**

- Implemented server-only salted PIN credentials, server-side legacy credential migration, device/network rate limiting, active-profile validation, stable Firebase UID mapping, per-device session records, absolute 84-hour expiry, security-version binding, audit evidence, and custom-token issuance.
- Exported the callable only behind a fail-closed versioned configuration check. At the Phase 2 closeout no client called it; the later dormant Phase 3 caller is documented above.
- Added explicit browser denial for the server-only credential, identity, session, rate-limit, and login-audit collections and for the activation document.
- Restored the authoritative Master Plan/Progress Log drafts and their approved README/project-guidance hierarchy, then reconciled them with Phases 1–2 and the confirmed session, revocation, supervisor-management, BHT-location, and offline-ownership decisions.
- Status is **local, uncommitted, dormant, and not released**. Nothing was deployed, pushed, merged, configured, enabled, or written to production.

**Exact files added or changed**

- `functions/src/staffPinCredentialModel.js`
- `functions/src/staffPinLoginService.js`
- `functions/src/index.js`
- `functions/src/securityFoundationModel.js`
- `functions/tests/staffPinCredentialModel.test.js`
- `functions/tests/staffPinLogin.contract.emulator.js`
- `firestore.rules`
- `tests/firestore.rules.test.js`
- `package.json`
- `docs/security/PHASE_2_DORMANT_SERVER_FOUNDATION.md`
- `docs/security/PHASE_1_SECURITY_FOUNDATION_BASELINE.md`
- `MASTER_PLAN.md`
- `PROGRESS_LOG.md`
- `PROJECT_INSTRUCTIONS.md`
- `README.md`
- `docs/PROJECT_ALIGNMENT.md`

**Tests and direct evidence**

- `npm run build`: passed; 1,896 Vite modules transformed.
- `npm run lint`: passed.
- Exact non-emulator unit set: 96 passed, 0 failed.
- `npm run test:security-foundation`: 12 passed, 0 failed; included within the 96-unit total.
- `npm run test:security-foundation:emulator`: 18 passed, 0 failed, including disabled preferred credentials, transaction-time current-credential checks, and the shared-network ceiling across distributed device IDs.
- `npm run test:rules`: 33 passed, 0 failed.
- `npm run test:storage-rules`: 3 passed, 0 failed.
- `npm run test:functions:emulator`: 10 passed, 0 failed; the dormant callable loaded and all existing tested Functions workflows remained green.
- `npm run test:debrief:emulator`: 1 passed, 0 failed.
- `npm run test:reset:emulator`: 1 passed, 0 failed.
- Total distinct assertions across the exact unit and emulator/rules commands: 162 passed, 0 failed.
- Disabled-boundary tests prove no Auth user, credential, mapping, identity, or session writes occur while the configuration is absent/off.
- Negative tests cover invalid, ambiguous, inactive, deleted, malformed BHT-location, locked, stale-version, revoked/replayed, wrong-owner, out-of-scope supervisor, and browser-access cases.
- Response/token inspection found no PIN, hash, salt, lookup key, secret, or other credential material.
- The Firebase CLI's local update-check permission warning appeared after successful emulator shutdown; each correct emulator command reported successful script exit.
- The Functions emulator used the workstation's Node.js 24 despite the declared Node.js 22 runtime; Node.js 22 parity remains unverified.

**Documentation recovery evidence**

- Recovered the refined authoritative drafts from available Git objects: `MASTER_PLAN.md` blob `2bf1c612bf98ef01f4b245782b7bf3ce28025a94` and `PROGRESS_LOG.md` blob `33a275301b46c21cb5af9e45cb9a7c3631d94146` before adding this closeout.
- Restored the approved supporting hierarchy from the same documentation foundation: `PROJECT_INSTRUCTIONS.md`, `README.md`, and `docs/PROJECT_ALIGNMENT.md`.
- No uncertain live-state claim was promoted. The prior read-only production audit remains date-labeled and must be refreshed before a future release decision.

**Deployment/configuration/data status**

- No deployment, push, merge, commit, production read/write, migration, reset, secret creation, Auth-provider change, App Check change, strict-auth change, or feature activation.
- No production `appSettings/securityFoundation` document was created or changed.
- Anonymous Authentication was not enabled.
- The current PIN screen, 60-minute inactivity lock, session storage, and existing offline runtime remain unchanged.

**Risks/follow-up**

- Before activation, PIN reset/change, deactivation, role reduction, and location removal must use coordinated server transactions that rotate credentials or increment security version and revoke all device sessions. Existing browser management writes are intentionally not connected in this phase.
- Current offline replay does not inspect the new session/security version and must be integrated without losing original-owner work.
- Stable UID derivation needs a safe secret-rotation design.
- Claims must not become the lasting authorization source; later rules/Functions must check current mapped profile/session state.
- Browser integration, Node.js 22 parity, live listeners/queries, mobile/desktop, canary rollout, App Check, compatibility retirement, and production release remain later gated work.

**Related evidence and Master Plan sections**

- `docs/security/PHASE_2_DORMANT_SERVER_FOUNDATION.md`
- Major Decisions
- 4.1 Shift start and access
- 5. Role and Location Boundaries
- 6. Offline Behavior
- 8. Current Security Foundation Assessment
- 11. High-Level Release Status

---

## 2026-08-25 — Phase 1 security baseline and executable contracts

**Purpose**

Freeze the exact source/release rollback anchor and make the approved authentication, session, revocation, supervisor-scope, BHT-home-location, and offline-replay requirements executable before changing login behavior.

**Outcome and exact status**

- Recorded `origin/Main` baseline commit `c6b0ec15cf35840025859a312b4857052559ea0b`, relevant Git blobs/checksums, read-only release inventory, and a coordinated multi-layer rollback contract.
- Added pure and emulator-only security contracts covering valid/invalid/rate-limited PIN behavior, persistent absolute 84-hour device sessions, multi-device behavior, one-device versus all-device revocation, supervisor scope, invalid BHT home configuration, and offline replay ownership/version/state.
- Phase 1 did not import its model into the current client or deployed Functions and did not change Firestore/Storage rules, providers, configuration, data, or runtime behavior.
- Status is **locally complete and preserved in this uncommitted isolated branch**.

**Exact Phase 1 files**

- `functions/src/securityFoundationModel.js`
- `functions/tests/securityFoundationModel.test.js`
- `functions/tests/securityFoundation.contract.emulator.js`
- `docs/security/PHASE_1_SECURITY_FOUNDATION_BASELINE.md`
- `package.json`

**Phase 1 verification recorded at its closeout**

- Focused Phase 1 pure tests: 8 passed, 0 failed.
- Focused Phase 1 emulator tests: 6 passed, 0 failed.
- Full Phase 1 recorded check set: 141 automated assertions passed, 0 failed, plus build and lint passed.
- The exact baseline, read-only release evidence, current compatibility behavior, rollback sequence, test matrix, and known gaps are preserved in `docs/security/PHASE_1_SECURITY_FOUNDATION_BASELINE.md`.

**Deployment/configuration/data status**

- Local contract/evidence work only.
- No deployment, push, merge, production change, Firebase provider/configuration change, strict-auth change, or Anonymous Authentication change.

**Related Master Plan sections**

- Major Decisions
- 7. Safety and Technical Guardrails
- 8. Current Security Foundation Assessment
- 11. High-Level Release Status

---

## 2026-08-25 — Refine the `Orient` and `Close out` documentation workflow

**Purpose**

Make the two-document foundation directly support a simple daily working rhythm: orient at the start, work normally, and close out only after the work is genuinely finished.

**Outcome**

- Added a compact Current State table near the top of the Master Plan covering active work, in-progress work, paused work, and the next major decision.
- Defined the read-only `Orient` process and its required five-part response: current focus, relevant app flow, major past decisions, what could be affected, and known risks/unfinished work.
- Defined normal work as the default middle phase without requiring extra documentation commands.
- Defined `Close out` as a genuine-completion step that updates current behavior in the Master Plan and appends detailed evidence here.
- Strengthened Mark's Notes Inbox as an owner-controlled area that cannot be overwritten without explicit instruction.
- Added Major Decisions inside the Master Plan and prohibited a third permanent decision or planning document.
- Clarified that this Progress Log is evidence, not a diary.

**Exact files changed**

- `MASTER_PLAN.md`
- `PROGRESS_LOG.md`

**Tests/evidence**

- `git diff --check`: passed for the tracked documentation changes.
- Trailing-whitespace scan of `MASTER_PLAN.md` and `PROGRESS_LOG.md`: passed.
- Heading-level sequence and balanced code-fence check: passed.
- Local Markdown-link resolution check in both long-term documents: passed.
- Required-content scan found Current State, the five exact `Orient` parts, `Close out`, the two-document rule, Major Decisions, and every required evidence field: passed.
- Full isolated-worktree path review remains documentation-only: five Markdown files in the complete foundation change set; this refinement pass changed only `MASTER_PLAN.md` and `PROGRESS_LOG.md`.
- Application build, lint, unit, emulator, browser, and Firebase checks were not run because this pass changed no application code, rules, configuration, or runtime behavior.

**Deployment/configuration/data status**

- Documentation only.
- No app, Firebase, authentication, rules, production data, deployment, commit, or push change.

**Risks/follow-up**

- Future tasks must keep Current State brief and avoid copying Progress Log detail into the Master Plan.
- Add a Major Decision only after clear user confirmation; do not promote a recommendation or rough idea.
- Use `Close out` only after verifying the actual implementation/release state.

**Relevant Master Plan sections**

- Mark's Notes Inbox
- Current State
- Simple Working Flow
- Major Decisions
- 12. Documentation and Release Discipline

---

## 2026-08-25 — Initial Master Plan and Progress Log foundation

**Purpose**

Create the first durable documentation foundation that explains SPRC Ops Hub end to end and separates quick operational orientation from detailed release evidence.

**Status**

Documentation-only first draft in an isolated Codex worktree. No application behavior, Firebase configuration, security rules, authentication, production data, or deployment was changed.

**What changed**

- Added `MASTER_PLAN.md` with Mark's Notes Inbox, the documented `update master plan` workflow, current direction, role/location boundaries, end-to-end operational flows, offline behavior, security assessment, guardrails, feature status, future ideas, open questions, and high-level release status.
- Added `PROGRESS_LOG.md` with a repeatable evidence-entry contract and historical foundation entries grounded in code, Git history, and prior verified release records.
- Updated project guidance so future `update master plan` requests preserve processed notes and do not imply implementation approval.
- Updated README/document hierarchy links to make the new files easy to find and distinguish the older `plan.md` blueprint.

**Exact files changed**

- `MASTER_PLAN.md`
- `PROGRESS_LOG.md`
- `PROJECT_INSTRUCTIONS.md`
- `README.md`
- `docs/PROJECT_ALIGNMENT.md`

**Decisions**

- `MASTER_PLAN.md` is the readable living blueprint.
- `PROGRESS_LOG.md` is the deep evidence trail.
- `plan.md` remains in the repository for historical comparison until useful content is deliberately reconciled; it is not silently deleted.
- Mark's inbox notes are preserved and marked processed rather than removed.
- Updating documentation never authorizes app or production changes.

**Inspection/evidence used**

- Current worktree and Git history through `c6b0ec1`.
- `README.md`, `plan.md`, `CHANGELOG.md`, `PROJECT_INSTRUCTIONS.md`, project alignment/context docs, and release runbooks.
- Current React components/services for login, BHT home, EOC, transport, issues, alerts, Shift Debrief, supervisor/admin navigation, offline store/replay, and authorization rules.
- Read-only authorization audit and recent verified release summaries.

**Verification**

- `git diff --check`: passed; no whitespace errors.
- Local Markdown-link resolution check across all five changed files: passed.
- Heading-level sequence and balanced code-fence checks: passed.
- Required-section scan for Notes Inbox, `update master plan`, end-to-end workflow, security assessment, exact-file evidence, and deployment status: passed.
- Changed-path review: passed; only Markdown documentation/guidance files are modified or added.
- A local Markdown linter/formatter is not installed in this worktree. No dependency was installed for this documentation-only task.
- Application build, lint, unit, emulator, browser, and Firebase checks were not run because no app code, rules, configuration, or runtime behavior changed.

**Deployment/configuration/data status**

- No deploy, Firebase command, configuration write, data read/write, migration, reset, authentication change, or production action.

**Risks/follow-up**

- Recheck any live configuration claim before using it for a new production decision.
- Continue refining the plan as Mark adds notes or confirms open decisions.
- Do not let older `plan.md` statements override current code/evidence without review.

**Related Master Plan sections**

- Mark's Notes Inbox
- Sections 1–13 (initial foundation)

---

## 2026-08-25 — Guided EOC template builder release and authorization foundation audit

**Purpose**

Release the Guided Canvas EOC template builder, then investigate why normal PIN supervisors could not load protected template data and determine the safe long-term authorization direction.

**Status**

- Commit `c6b0ec1` is the checked-out release reference and `origin/Main` reference visible in this worktree.
- Release work reported successful deployment of Hosting, Firestore rules/indexes, Storage rules, and 11 Functions.
- The builder is released with a blocker; no template or assignment was changed in production verification.
- The follow-up architecture audit was read-only. Production was deliberately left unchanged.

**What changed in `c6b0ec1`**

- Added the full Guided Canvas library/editor/preview/publish/assignment flow.
- Added version/ownership/section-library/archive/purge models and protected template administration Functions.
- Added a PIN-to-Firebase UID mapping attempt during PIN login.
- Protected template library/assignment/version reads and template Functions behind Firebase authentication/mapping checks.
- Added EOC response-photo upload and offline retry handling.
- Added safer Firestore write chunking and expanded tests.

**Exact files changed in `c6b0ec1`**

- `firestore.rules`
- `functions/src/eocTemplateAdminModel.js`
- `functions/src/index.js`
- `functions/tests/eocTemplateAdminModel.test.js`
- `functions/tests/retention.emulator.test.js`
- `package.json`
- `src/components/EocChecklist.jsx`
- `src/components/EocTemplateEditorDrawer.jsx`
- `src/components/EocTemplateManager.jsx`
- `src/components/PinLogin.jsx`
- `src/components/SupervisorEocPanel.jsx`
- `src/hooks/useEocTemplateBuilderAccess.js`
- `src/index.css`
- `src/services/eocSubmissionAttachmentService.js`
- `src/services/eocTaskEngine.js`
- `src/services/eocTemplateDraftService.js`
- `src/services/eocTemplateService.js`
- `src/services/offlineSyncService.js`
- `src/services/pinSessionService.js`
- `src/utils/eocGuidedFlow.js`
- `src/utils/eocTaskLifecycle.js`
- `src/utils/eocTemplateModel.js`
- `src/utils/firestoreBatching.js`
- `src/utils/photoModel.js`
- `storage.rules`
- `tests/e2e/eocIssues.spec.js`
- `tests/eocGuidedFlow.test.js`
- `tests/eocTaskLifecycle.test.js`
- `tests/eocTemplateModel.test.js`
- `tests/firestore.rules.test.js`
- `tests/firestoreBatching.test.js`
- `tests/photoModel.test.js`
- `tests/storage.rules.test.js`

**Important findings and decisions**

- The release did not replace the app's normal profile-ID role routing or the existing Shift Debrief, transport, issue, notification, compliance, property, or fleet screen contracts.
- Ordinary PIN login continues in compatibility mode when UID mapping fails.
- Protected template reads/Functions and EOC response-photo uploads require a Firebase UID/session that normal PIN login is not currently establishing.
- EOC task generation reads template assignments, so the failure can affect periodic task sync.
- A BHT custom-template task can silently fall back to an older checklist if its assigned version cannot be read. Operational assignment is therefore unsafe until fallback protection and verified identity are complete.
- The broader weakness predates the builder: compatibility rules trust legacy access too broadly, several collections have explicit public read/write paths, and PIN hash lookup runs in browser code.
- The audit found rule exposure but no evidence of accessed or misused data.
- Decision: do not enable Anonymous Authentication and do not flip strict global authorization. Build a stable server-verified PIN/custom-token foundation and harden one workflow group at a time.

**Tests/evidence**

- Release report: unit/emulator checks passed and seven applicable phone/tablet/desktop browser cases passed.
- Release report: Hosting, rules, indexes, Storage, and all 11 Functions deployed successfully.
- Live test: normal PIN supervisor could not load protected template data; EOC task sync was also affected.
- Read-only readiness report: `authScopeEnforced:false`, seven active profiles, and zero `usersByAuthUid` mappings.
- Git inspection confirmed the release commit and exact file set above.

**Deployment/configuration/data status**

- Release layers were deployed before the audit.
- No Anonymous Auth enablement, strict-mode change, rollback, template write, assignment write, migration, or follow-up deploy was authorized or performed during the audit.

**Risks/follow-up**

- Keep custom templates unassigned operationally.
- Freeze and document exact live versions/settings before any auth work.
- Build dormant server-backed PIN login, then prove mapped template/Storage access with synthetic accounts.
- Refactor broad queries before tightening workflow rules.
- Protect offline replay with authenticated profile-to-owner matching.

**Related Master Plan sections**

- 4.1 Shift start and access
- 4.3 EOC assignments, tasks, and completion
- 7 Safety and Technical Guardrails
- 8 Current Security Foundation Assessment
- 11 High-Level Release Status

---

## 2026-08-17 — Issue handoff review and separate app feedback release

**Purpose**

Reduce duplicated/permanent issue display in shift handoff, let BHTs document completed work, require supervisor verification for final resolution, and separate app problems from operational issues.

**Status**

Implemented, tested, committed as `3c11306`, pushed to case-sensitive `Main`, deployed, and enabled through feature configuration version 3 for `test_house`, `mesquite`, `lone_mountain`, and `res` at release time.

**What changed**

- Added `pending_supervisor_review` as an active issue status.
- BHT resolution submission requires a completion note and supports optional photos.
- Supervisor/admin review can approve to `resolved` or return to `in_progress` with an explanation.
- Shift handoff now uses live current/recent issue information and exact reviewed version/activity markers; original snapshots remain for audit/fallback.
- Added compact new/unseen behavior, shared issue reporting, offline support, separate app feedback submission, and admin feedback review.
- Preserved issue activity history, recurrence inputs, photo handling, and role/location/version safeguards.

**Exact files changed**

- `firestore.indexes.json`
- `firestore.rules`
- `package.json`
- `scripts/initializeEocIssueFeatures.js`
- `scripts/seedIssuePhase3E2e.js`
- `src/App.jsx`
- `src/components/AppFeedbackPanel.jsx`
- `src/components/BhtHub.jsx`
- `src/components/Header.jsx`
- `src/components/IssueDetail.jsx`
- `src/components/LocationIssuesBoard.jsx`
- `src/components/ReportIssueModal.jsx`
- `src/components/ShiftDebriefPage.jsx`
- `src/components/SupervisorDashboard.jsx`
- `src/components/SupervisorEocPanel.jsx`
- `src/hooks/useAppFeedback.js`
- `src/hooks/useHandoffIssues.js`
- `src/hooks/useScopedAlerts.js`
- `src/hooks/useScopedIssues.js`
- `src/index.css`
- `src/services/appFeedbackService.js`
- `src/services/issueRecurrenceService.js`
- `src/services/issueStatusService.js`
- `src/services/notificationService.js`
- `src/services/offlineSyncService.js`
- `src/services/shiftDebriefModel.js`
- `src/services/shiftDebriefService.js`
- `src/utils/appFeedbackModel.js`
- `src/utils/featureFlags.js`
- `src/utils/issueModel.js`
- `tests/appFeedbackModel.test.js`
- `tests/e2e/eocIssues.spec.js`
- `tests/firestore.rules.test.js`
- `tests/issueModel.test.js`
- `tests/shiftDebriefModel.test.js`

**Decisions**

- Staff completion and supervisor-verified closure remain different steps.
- `pending_supervisor_review` stays active and visible until supervisor action.
- App feedback does not create a facility/location issue or become permanent Shift Debrief content.
- Live handoff information replaced the indefinitely duplicated frozen display, while original snapshot evidence was preserved.

**Tests/evidence**

- Lint and production build passed.
- 17 issue tests, 14 debrief tests, 16 EOC tests, 5 supervisor-EOC tests, 29 Firestore permission tests, and 1 debrief transaction test passed.
- Four phone/desktop browser workflows passed.
- Live Hosting returned HTTP 200 and contained the new workflow labels.
- Guarded configuration preview/write changed only `issueWorkflowV2`; version advanced from 2 to 3 and retained the four approved locations.

**Deployment/configuration/data status**

- Pushed to `Main` and deployed Hosting, Firestore rules, and indexes to `sprc-tx-l`.
- Feature enabled after separate owner authorization.
- No operational-record migration, deletion, or reset was performed.

**Risks/follow-up**

- Recheck current feature configuration before future changes.
- Keep issue closeout enforcement aligned across UI, service transactions, offline replay, alerts, and rules.
- Treat Firebase CLI update-check cleanup noise separately from actual emulator test counts.

**Related Master Plan sections**

- 4.5 Issues, photos, alerts, and app feedback
- 4.6 Shift end and outgoing Shift Debrief
- 9 Feature and Work Status

---

## 2026-08-15 — Shift Debrief incoming signoff, correction lock, and reassignment safeguards

**Purpose**

Prevent outgoing staff from completing incoming confirmation, prevent missed late corrections, lock corrections after valid signoff, and give supervisors a simple safe reassignment tool.

**Status**

Implemented, verified, committed as `8339827`, pushed to `origin/Main`, and deployed to Hosting and Firestore rules.

**What changed**

- Restricted confirmation to assigned incoming staff and excluded the outgoing submitter.
- Tracked correction count while incoming staff review and blocked signoff until the latest correction is acknowledged.
- Locked outgoing corrections and supervisor reassignment after the first valid incoming signoff.
- Allowed later assigned incoming staff to record their own acknowledgments without reopening corrections.
- Limited corrections to the original outgoing submitter.
- Added offline expected-correction-count validation so stale queued signoff becomes `needsReview`.
- Added supervisor/admin reassignment with active incoming-shift validation, required reason, confirmation reset, alert retirement/reissue, audit history, and version safeguards.
- Separated correction, confirmation, and reassignment authorization in Firestore rules.

**Exact files changed**

- `firestore.rules`
- `src/components/ShiftDebriefPage.jsx`
- `src/components/SupervisorDashboard.jsx`
- `src/components/SupervisorDebriefsPanel.jsx`
- `src/index.css`
- `src/services/offlineSyncService.js`
- `src/services/shiftDebriefModel.js`
- `src/services/shiftDebriefService.js`
- `tests/firestore.rules.test.js`
- `tests/shiftDebriefModel.test.js`

**Decisions**

- Safeguards must exist in UI, service transactions, offline replay, and Firestore rules.
- Supervisor reassignment is a correction tool, not a broad workflow redesign or sign-on-behalf feature.
- The first valid incoming signoff is the lock point even when multiple incoming staff are assigned.

**Tests/evidence**

- 13/13 focused debrief tests passed.
- 1/1 concurrency emulator test passed.
- 27/27 Firestore permission tests passed.
- Lint and production build passed.
- Hosting HTTP 200 was verified.

**Deployment/configuration/data status**

- Pushed commit `8339827` to `origin/Main`.
- Deployed Hosting and Firestore rules to `sprc-tx-l`.
- No reset or destructive data migration.

**Risks/follow-up**

- Firestore rule complexity previously reached the 1,000-expression limit; keep branching simple and maintain legacy fixtures.
- Do not treat Firebase CLI post-emulator update-check errors as failed product tests when the test summary passed.

**Related Master Plan sections**

- 4.6 Shift end and outgoing Shift Debrief
- 4.7 Incoming Shift Debrief confirmation
- 4.8 Supervisor debrief review and reassignment
- 6 Offline Behavior

---

## 2026-08-12 — EOC mobile area rail, transport time corrections, photo choices, and guarded canary tooling

**Purpose**

Improve phone/tablet EOC navigation, support guarded BHT transport timestamp correction, make issue photos easy to take or choose, and prepare recoverable Test House canary activation.

**Status**

The three UI/workflow commits were tested, pushed, and Hosting-deployed according to their release records. Guarded canary tooling was committed; production configuration changes required separate approval.

### A. Responsive EOC area rail — `5b72346`

**Exact files changed**

- `playwright.config.js`
- `scripts/seedIssuePhase3E2e.js`
- `src/components/EocChecklist.jsx`
- `src/index.css`
- `src/utils/eocGuidedFlow.js`
- `tests/e2e/eocIssues.spec.js`
- `tests/eocGuidedFlow.test.js`

**Evidence**

- `npm.cmd run test:eoc`: 16 passed.
- Lint and build passed.
- Focused Playwright coverage passed at phone, tablet, and desktop sizes.
- Commit was pushed and Hosting deployment/live HTTP 200 were verified.

### B. BHT transport time corrections — `b7a685f`

**Exact files changed**

- `src/components/DCCheckModal.jsx`
- `src/components/TransportCard.jsx`
- `src/services/offlineSyncService.js`
- `src/utils/transportRecord.js`
- `tests/firestore.rules.test.js`

**Evidence**

- Build, lint, `git diff --check`, and 27 Firestore rule tests passed.
- Commit was pushed to `Main` and Hosting was deployed.

### C. Camera and device-library choice — `997d2f0`

**Exact files changed**

- `src/components/IssuePhotoPicker.jsx`
- `src/index.css`
- `tests/e2e/eocIssues.spec.js`

**Evidence**

- Lint, build, and phone/desktop synthetic browser checks passed.
- Live bundle verification found `Take photo` and `Choose from device` and removed the older ambiguous camera path.

### D. Guarded Test House canary tooling — `01123a0`

**Exact files changed**

- `.gitignore`
- `scripts/activateEocIssueCanaryProduction.js`
- `scripts/backupEocCanaryProduction.js`

**Decisions and safeguards**

- Preview exact counts/scope first.
- Back up configuration before activation.
- Require explicit owner authorization and exact version/scope confirmation for a production write.
- Preserve rollback evidence rather than deleting records created by a canary workflow.

**Related Master Plan sections**

- 4.3 EOC assignments, tasks, and completion
- 4.4 Transport work
- 4.5 Issues, photos, alerts, and app feedback
- 7 Safety and Technical Guardrails

---

## 2026-08-10 — Shift Debrief V2 rebuild and release

**Purpose**

Replace the earlier debrief flow with a phone-friendly draft, quick-note, grouped read, submission, and incoming handoff workflow while preserving offline and concurrency safeguards.

**Status**

Implemented, committed as `8d6aae9`, pushed to `Main`, Hosting-deployed, and beta reset completed under the approved guarded workflow.

**What changed**

- Added quick notes, grouped client/general sections, document-style editing, autosave, exact-item undo, submitted read view, corrections, incoming confirmation, and offline queue support.
- Added model/timing/reset tests and transaction coverage.
- Added a guarded beta-data reset tool scoped to the disposable debrief data approved for that release.

**Exact files changed**

- `package.json`
- `scripts/resetShiftDebriefBetaData.js`
- `src/App.jsx`
- `src/components/DebriefGroupedReadView.jsx`
- `src/components/ShiftDebriefDocumentEditor.jsx`
- `src/components/ShiftDebriefPage.jsx`
- `src/components/ShiftDebriefQuickNote.jsx`
- `src/index.css`
- `src/services/offlineStore.js`
- `src/services/offlineSyncService.js`
- `src/services/shiftDebriefModel.js`
- `src/services/shiftDebriefService.js`
- `tests/firestore.rules.test.js`
- `tests/resetShiftDebriefBetaData.test.js`
- `tests/shiftDebriefModel.test.js`
- `tests/shiftDebriefTransactions.emulator.test.js`

**Tests/evidence**

- Build and lint passed.
- Focused model/timing/reset tests passed 14/14; reset guards passed 3/3.
- Concurrency and Firestore rules coverage passed, including submitted-note locking.
- Responsive browser checks at 390x844, 768x1024, and 1440x900 found no overflow, clipping, sticky-bar overlap, or console errors.

**Deployment/configuration/data status**

- Hosting deployed to `sprc-tx-l`.
- The approved reset affected scoped disposable beta debrief data; it was not a general production-data reset.

**Risks/follow-up**

- Later `8339827` safeguards supersede the original incoming-confirmation authorization and correction-lock details from this release.
- Continue using transaction, offline, and rules tests for every debrief workflow change.

**Related Master Plan sections**

- 4.6 Shift end and outgoing Shift Debrief
- 4.7 Incoming Shift Debrief confirmation
- 6 Offline Behavior

---

## 2026-08-09 — Core reset and legacy authentication cleanup baseline

**Purpose**

Restore the six-digit PIN operating model, remove abandoned Google-login paths, and provide guarded reset/cutover tooling while preserving operational catalogs/settings.

**Status**

Implemented in `19cfeac`, merged through `b3c3bc4`, locally verified, pushed, and used in the approved cutover/reset workflow documented in release records.

**Exact files changed in `19cfeac`**

- `README.md`
- `docs/CUTOVER_RUNBOOK.md`
- `docs/REGRESSION_UAT_PHASE9.md`
- `docs/UAT_WALKTHROUGH_PHASE9.md`
- `docs/bht-home-implementation-plan.md`
- `docs/codex-refine-v2.3-prompt.md`
- `docs/codex-rewrite-v3-google-auth-prompt.md`
- `docs/codex-verification-prompt.md`
- `netlify.toml`
- `package.json`
- `plan.md`
- `public/sw.js`
- `scripts/preparePinPhase2.js`
- `scripts/provisionAuthClaims.js`
- `scripts/resetProductionCore.js`
- `scripts/seedUsers.js`
- `scripts/verifyAuthClaims.js`
- `src/App.jsx`
- `src/components/CloseChecklist.jsx`
- `src/components/GoogleLogin.jsx`
- `src/components/SupervisorDashboard.jsx`
- `src/components/_orig_sd_check.jsx`
- `src/index.css`
- `src/main.jsx`
- `src/services/authProfileService.js`
- `src/services/eocTaskEngine.js`
- `src/utils/coreResetCutover.js`
- `tests/coreResetCutover.test.js`
- `tests/resetProductionCore.emulator.test.js`
- `tests/resetProductionCore.test.js`

**Decisions**

- Preserve permanent Ops profile IDs and the familiar six-digit PIN workflow.
- Use preview, backup, typed confirmation, expected counts, and verification for destructive reset work.
- Preserve properties, houses, vans/vehicles, EOC templates, fleet templates, and app settings during a core reset.
- Do not use a successful login/build as proof that debrief, EOC, transport, and offline workflows are healthy.

**Tests/evidence**

- Build, lint, PIN, reset, cutover, rules, and emulator reset suites were reported as passed in the validated release record.
- Hosting/login smoke testing and service-worker cache verification were completed.

**Risks/follow-up**

- The current 2026-08-25 authorization audit shows that the standalone PIN architecture still needs a server-verified Firebase identity foundation.
- The safe long-term fix is not to restore the older Google flow or enable Anonymous Auth as a shortcut.

**Related Master Plan sections**

- 4.1 Shift start and access
- 7 Safety and Technical Guardrails
- 8 Current Security Foundation Assessment

---

## Historical coverage note

Older work remains available in `CHANGELOG.md`, `plan.md`, runbooks, and Git history. It should be added here when it becomes relevant to a current decision, investigation, or release. Do not bulk-copy old claims without checking whether later commits superseded them.
