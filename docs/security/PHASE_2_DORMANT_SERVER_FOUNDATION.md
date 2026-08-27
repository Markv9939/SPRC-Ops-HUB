# Phase 2 Dormant Server Security Foundation

Recorded: 2026-08-25 (America/Phoenix)

## Outcome and safety boundary

Phase 2 implements the server side of the approved future PIN/session design in the isolated branch. It is deliberately dormant:

- The current six-digit PIN screen and all current application workflows are unchanged.
- Phase 3 now contains an opt-in emulator-tested client caller, but the normal build does not reach it and production remains disabled/unconfigured.
- The callable fails closed unless `appSettings/securityFoundation` exists with `schemaVersion: 2` and `serverPinLoginEnabled: true`.
- Browser rules deny reads and writes to the new credential, identity, session, rate-limit, and login-audit collections. Browser writes to the activation document are also denied.
- No activation document, server secret, production credential, Auth provider, production data, or deployed Function was created or changed.
- No deployment, push, merge, or commit occurred.

The current runtime therefore remains on the same compatibility PIN behavior and 60-minute inactivity lock described in the Master Plan. The approved persistent 84-hour session is not staff-facing yet.

## Exact implementation

### Server credential model

`functions/src/staffPinCredentialModel.js` provides:

- Six-digit input validation.
- Per-profile salted scrypt credentials using cost 16,384, block size 8, parallelization 1, and a 32-byte derived key.
- A server-secret HMAC lookup key so the six-digit PIN is not stored or indexed directly.
- Purpose-separated HMAC derivation for lookup, stable Firebase UID, device/rate identifiers, sessions, and operation replay.
- Compatibility with the existing `sprc-pin-v2-6digit` hash only as a server-side migration input.
- Constant-time credential comparison.
- A minimum sanitized staff-profile response, including the non-secret `securityVersion` required for session binding, that excludes credential and internal fields.

The secret is declared as `STAFF_PIN_AUTH_SECRET` through the Firebase Functions secret interface. This branch does not create, populate, or deploy that secret.

### Dormant login service

`functions/src/staffPinLoginService.js` provides:

1. Fail-closed versioned configuration check.
2. Strict PIN, device ID, and idempotency-operation ID validation.
3. Server-enforced device and network rate buckets. The device contract allows at most five failed attempts in a 15-minute window and then locks for 15 minutes; the network safety bucket allows 100 reserved attempts in the same window.
4. Preferred lookup in `staffPinCredentials`, with legacy `users.pinHash` lookup only when no preferred credential is indexed.
5. Transaction-time re-verification of the current active credential so a concurrent PIN rotation/credential disable cannot issue a stale session.
6. One indistinguishable public failure for invalid, ambiguous, inactive, deleted, and malformed-location profiles.
7. A stable Firebase Auth UID derived from the permanent Ops profile ID and server secret.
8. Coordinated identity records in `staffAuthIdentities`, `usersByAuthUid`, and the staff profile.
9. One deterministic session record per staff profile/device, with independent devices, an absolute non-sliding 84-hour expiry, and profile security-version binding.
10. Idempotent operation replay that reuses a still-valid session without extending its expiry.
11. A signed Firebase custom token containing only profile ID, role, security version, session ID, and session schema version.
12. Login audit evidence, including token-issue failure evidence and safe retry recovery.

When a legacy credential succeeds, the transaction creates the new server-only scrypt credential but deliberately retains the legacy `pinHash`. Removing browser PIN lookup is a later coordinated migration step after the dormant path and every affected workflow have passed rollout gates.

### Callable boundary

`functions/src/index.js` exports `beginStaffPinSessionV2` so the Functions emulator and a future coordinated deployment can load the implementation. The handler:

- Binds the server secret.
- Passes only request data and a rate-limiting source address into the service.
- Converts known service failures into controlled callable errors.
- Avoids logging the PIN, token, credential, or full request.

The export alone does not activate the path. Phase 3 adds a client reference behind an exact build flag plus versioned Firestore gate, but the normal build does not set that flag and the required production configuration is not added by this branch.

### Firestore boundary

`firestore.rules` adds explicit browser denial for:

- `staffPinCredentials`
- `staffAuthIdentities`
- `staffSessions`
- `securityRateLimits`
- `securityLoginAudit`

It also denies browser writes to `appSettings/securityFoundation`, including for mapped admins. These rule edits are local only and are not deployed.

## Security and failure contracts proven

- Disabled configuration produces no Auth user, credential, mapping, identity, or session write.
- Valid legacy and preferred credentials work through the server service.
- Invalid, ambiguous, inactive, deleted, and invalid BHT-location states do not disclose which account condition exists.
- Legacy migration keeps compatibility data in place while creating the preferred server-only credential.
- Stable identity is preserved for the same profile, while separate devices receive independent sessions.
- Session expiry is exactly 84 hours from issue time and is not extended by retry.
- Security-version mismatch and revoked session/operation replay fail closed.
- The fifth failed attempt locks the device; a correct PIN is rejected during the lock window.
- Auth provisioning failure leaves no migrated credential, profile mapping, identity, or session.
- Custom-token failure records evidence; the same operation can retry without extending expiry.
- Credential/hash/salt/secret material is absent from the callable result and token claims.
- Mapped admins and anonymous browsers cannot read or write server-only security records or activate the boundary.

## Verification evidence

Final local checks from the isolated branch:

- `npm run build`: passed; Vite transformed 1,896 modules and produced the application bundle.
- `npm run lint`: passed with no ESLint errors.
- Exact non-emulator unit set: 96 passed, 0 failed.
- `npm run test:security-foundation`: 12 passed, 0 failed; this focused total is included in the 96-unit total above.
- `npm run test:security-foundation:emulator`: 18 passed, 0 failed against isolated Firestore and Authentication emulators, including disabled preferred credentials and distributed attempts across many device IDs behind one shared network source.
- `npm run test:rules`: 33 passed, 0 failed, including server-only collection and activation-boundary denial.
- `npm run test:storage-rules`: 3 passed, 0 failed.
- `npm run test:functions:emulator`: 10 passed, 0 failed; the Functions emulator loaded `beginStaffPinSessionV2` while the existing retention, privacy, PIN-mapping, and template workflows remained green.
- `npm run test:debrief:emulator`: 1 passed, 0 failed.
- `npm run test:reset:emulator`: 1 passed, 0 failed.
- Total distinct automated assertions across the exact unit and emulator/rules commands above: 162 passed, 0 failed.

The broad commands `node --test tests/*.test.js` and `npm --prefix functions test` were also tried, but those existing globs include emulator-only files without starting their required services. Their resulting missing-emulator/bucket errors are invocation limitations, not failed workflow assertions. All files were rerun through the correct scripts above and passed.

Firebase CLI printed its known local update-check permission warning after successful emulator shutdown. Each emulator script itself reported `Script exited successfully (code 0)`. The Functions emulator also warned that the workstation supplied Node.js 24 while `functions/package.json` requests Node.js 22.

## Exact files added or changed for Phases 1–2

Security implementation and evidence:

- `functions/src/securityFoundationModel.js`
- `functions/src/staffPinCredentialModel.js`
- `functions/src/staffPinLoginService.js`
- `functions/src/index.js`
- `functions/tests/securityFoundationModel.test.js`
- `functions/tests/securityFoundation.contract.emulator.js`
- `functions/tests/staffPinCredentialModel.test.js`
- `functions/tests/staffPinLogin.contract.emulator.js`
- `firestore.rules`
- `tests/firestore.rules.test.js`
- `package.json`
- `docs/security/PHASE_1_SECURITY_FOUNDATION_BASELINE.md`
- `docs/security/PHASE_2_DORMANT_SERVER_FOUNDATION.md`

Restored documentation foundation and hierarchy:

- `MASTER_PLAN.md`
- `PROGRESS_LOG.md`
- `PROJECT_INSTRUCTIONS.md`
- `README.md`
- `docs/PROJECT_ALIGNMENT.md`

## Known gaps before any production use

- The current PIN screen does not call the new endpoint or persist the future Firebase session.
- No automatic watcher/transaction yet rotates server credentials and increments the security version when the current user-management or self-service PIN paths change a PIN, deactivate a profile, reduce a role, or remove a location. Those browser write paths must move behind coordinated server validation before activation; otherwise an already-migrated server credential could become stale.
- Ordinary one-device logout and admin end-all-sessions are contract-tested but are not connected to the current UI/runtime.
- Existing offline replay does not yet consult the new session record/security version. The safely-held original-owner behavior remains a later client/service integration.
- The stable UID depends on the server secret. A secret-rotation procedure with dual-read or explicit identity preservation must be designed before any future secret rotation.
- Server-created Auth users are not automatically disabled/deleted by this phase. Session/security-version enforcement must remain authoritative even after Auth token issuance, and later revocation work must be proven against live listeners.
- Custom-token claims are only bootstrap context. Firestore/Storage rules must rebuild authority from current server-mapped profile/session state rather than trusting stale role/location claims.
- The current compatibility rules and browser-readable legacy PIN lookup remain in place. They must be retired only workflow-by-workflow after real listeners, queries, rules, photos, offline replay, mobile, desktop, and rollback pass.
- Node.js 22 parity, browser integration, mobile/desktop behavior, canary identity selection, App Check monitoring, production configuration, and deployment remain unverified and unauthorized.

## Rollback

Because this phase is local, dormant, and uncommitted, rollback is removal of the Phase 2 source/tests plus restoration of the Phase 1 baseline versions of `functions/src/index.js`, `firestore.rules`, and `package.json`. No production rollback is needed because nothing was deployed or activated.

Any later release must use the coordinated rollback contract in the Phase 1 baseline record. It must restore Hosting, Functions, Firestore rules/indexes, Storage rules, and versioned configuration as one compatible set while retaining session/audit evidence and safely held offline work.
