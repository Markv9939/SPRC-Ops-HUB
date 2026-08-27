# Phase 3 Dormant Client Authentication and Session Bootstrap

Date: 2026-08-25
Status: Local, uncommitted, disabled by default, emulator-tested, not released

## Purpose

Phase 3 connects the dormant Phase 2 server contract to a browser client without changing the current production login. It preserves the familiar six-digit PIN screen while adding an opt-in client path that can establish a stable Firebase custom-token identity, restore one independent device session after browser close/reopen, and rebuild the working user from current sanitized Firebase data.

This phase is a foundation only. It does not activate the new login or tighten workflow authorization.

## Safety boundary

The Phase 3 path runs only when both boundaries match exactly:

1. The application is built with `VITE_ENABLE_SECURITY_BOOTSTRAP_V3=true`.
2. `appSettings/securityFoundation` has server schema version `2`, server PIN login enabled, client bootstrap version `3`, and client bootstrap enabled.

The normal build does not set the compile flag, so the existing PIN flow, browser session storage, and 60-minute inactivity lock remain unchanged. If the compile flag is present but the server configuration is absent, disabled, or version-mismatched, the client falls through to the existing login. If the new path is fully enabled and its server/Auth verification fails, it fails closed and does not silently downgrade to browser PIN verification.

No environment file or activation document was added. No production configuration, provider, rule enforcement, data, or deployment was changed.

## Implemented client contract

- Calls `beginStaffPinSessionV2` only after the exact double gate is satisfied.
- Requests Firebase browser-local persistence, signs in with the returned custom token, waits for Firebase Auth readiness, and checks UID, profile, session, version, and expiry claims before rendering protected work.
- Stores only versioned per-device session metadata in local storage: session/profile/Auth/device IDs, issued and expiry timestamps, security version, and an authorization signature. It does not store the PIN, custom token, credential hash/salt/key, or full staff profile.
- Keeps one stable device ID in local storage. Separate browser profiles/devices receive independent session IDs. Tabs on the same browser profile share the same device session.
- Uses an absolute, non-sliding 84-hour window. Reload or activity never extends the expiry.
- Rebuilds name, role, location, shift, van, and workflow scope from the live sanitized `users/{profileId}` profile and current scoped-access reads rather than trusting editable `bhtUser` browser storage.
- Waits for restore completion before protected routes render when the dormant build flag is present.
- Restores an existing session from Firebase Auth and cached Firestore profile/scope while offline. If required cache data is unavailable, it safely holds at login and retries restoration when connectivity returns instead of trusting stale browser profile data.
- Listens for Firebase Auth loss and live profile deletion, deactivation, security-version change, role/location authorization change, exact expiry, and same-device logout. Invalid sessions are cleared and returned to the PIN screen; ordinary name, shift, and van assignment changes refresh the in-memory user without an unnecessary PIN prompt.
- Ordinary logout clears Firebase Auth and saved metadata on the current browser device. Other independently signed-in devices remain active under the Phase 3 client contract.
- Adds `securityVersion` to the Phase 2 sanitized profile response because it is required to bind the browser record to the server session. Credential and internal fields remain excluded.

## Files added or changed for Phase 3

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
- `MASTER_PLAN.md`
- `PROGRESS_LOG.md`
- `README.md`

## Verification evidence

Final recorded checks must be read together with the dated Phase 3 entry in `PROGRESS_LOG.md`.

- Production build: passed.
- Lint: passed.
- Exact non-emulator unit/model set: 111 passed, 0 failed; 27 are the combined Phase 1–3 security-foundation contracts.
- Security/Auth/Firestore emulator set: 21 passed, 0 failed.
- Firestore rules: 33 passed, 0 failed.
- Storage rules: 3 passed, 0 failed.
- Existing Functions emulator workflows: 10 passed, 0 failed.
- Shift Debrief transaction emulator: 1 passed, 0 failed.
- Core reset emulator: 1 passed, 0 failed.
- Synthetic EOC upgrade emulator verification: passed.
- Phase 3 enabled-path browser suite: 6 applicable cases passed across 390x844 phone, 768x1024 tablet, and 1280x720 desktop; 6 duplicate viewport cases were intentionally skipped.
- Existing disabled-path EOC/issues browser suite: 7 applicable cases passed across phone, tablet, and desktop; 2 intentional tablet duplicates were skipped. On Windows, Playwright completed every case but its web-server wrapper did not exit automatically and was stopped after the ninth reported result.
- A separate in-app browser visual check at 390x844 confirmed the unchanged PIN screen and no horizontal overflow.

The Firebase CLI reported its known local update-check permission warning after successful emulator script completion. Product test totals above come from the successful script summaries. The Functions emulator used workstation Node.js 24 while `functions/package.json` declares Node.js 22.

## What remains deliberately unfinished

- The build/config gates remain off and absent in production. The current staff login is still the legacy compatibility path.
- PIN change/reset, deactivation/reactivation, role/location edits, access-grant removal, and admin end-all-sessions are not yet routed through coordinated backend security-version/session-revocation transactions. Until that later work exists, the Phase 3 listener can react to a version/profile change but cannot guarantee that every existing management action emits it.
- Ordinary logout clears the current device locally but does not yet mark the Phase 2 server session record revoked or write the final server audit event.
- Current offline outbox replay is not yet bound to Firebase token/session/security version. Original-owner work preservation and `needsReview` behavior remain the next workflow-hardening responsibility.
- Existing Firestore/Storage compatibility rules remain broad. The new client identity is not authorization enforcement by itself.
- App Check enforcement, strict authorization, production secret/configuration, canary accounts, production migration, compatibility retirement, deployment, push, and merge remain unauthorized.
- Node.js 22 Functions runtime parity remains unverified locally.

## Rollback

Before activation, rollback is simply to build without `VITE_ENABLE_SECURITY_BOOTSTRAP_V3=true`; the existing login remains the only reachable path. After any future coordinated activation, rollback must disable the versioned client gate first and follow the Phase 1 multi-layer rollback contract. Do not roll back Hosting, Functions, rules, configuration, or data independently when they depend on one another.
