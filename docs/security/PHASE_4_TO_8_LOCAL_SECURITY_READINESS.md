# Security Foundation Phases 4–8 — Local Dormant Readiness

Last updated: 2026-08-26
Status: Local checkpoint committed on the isolated branch, disabled by default, not released

## Outcome

The remaining local foundation is implemented behind exact versioned boundaries. The familiar six-digit PIN screen and all normal production paths remain unchanged because no production setting, secret, provider, rule, Function, Hosting build, or App Check enforcement was changed.

## Phase 4 — protected account and session actions

- Server actions now cover self PIN change, supervisor/admin PIN reset, secure administrator profile creation, profile edits, deactivation/reactivation, soft deletion, one-device logout, and end-all-sessions.
- PIN change/reset, deactivation, role reduction, location removal, reactivation, and end-all-sessions increment `securityVersion`, close every device session, revoke Firebase refresh tokens, and write immutable audit plus retryable cleanup evidence.
- Ordinary logout closes only the selected device session.
- Temporary backup-access grants, revocations, and issue-access changes now use administrator-only protected actions for secure sessions. Every scope change increments `securityVersion`, signs the affected person out on all devices, revokes refresh tokens, and records one server audit; the preserved legacy screen still uses its unchanged direct path while the foundation is disabled.
- Active temporary and issue scope is added to the next server-issued login profile/token. A temporary grant's earliest expiry is stored on the device session and checked by both server code and Firestore rules, preventing expired scope from lingering for the remainder of the 84-hour limit.
- Supervisors are limited to BHT/tech profiles at the existing single home location in their own scope. Supervisor/admin targets, role elevation, out-of-scope locations, malformed BHT profiles, stale actors, and credential disclosure are rejected.
- The existing supervisor/admin screens and staff self-change-PIN screen are preserved. The secure path is used only by a Phase 3 secure session; legacy runtime behavior remains unchanged while dormant.

## Phase 5 — offline owner and replay protection

- New offline work records original profile owner, stable Firebase UID, device session, security version, location, action, and expected record version.
- Wrong-owner work is held for the original owner. Removed scope, revoked/stale sessions, finalized records, and version conflicts stop as `needsReview`.
- The same original owner may sign in again and reauthorize work when current access still permits it. Deactivated-owner work stays safely held.
- Transport replay uses deterministic IDs for idempotency and exact-version checks for update/close. It no longer silently overwrites a newer record.

## Phase 6 — workflow-by-workflow security

- Exact workflow names: identity/users; templates/photos; EOC; debriefs/alerts; issues/feedback/audit; transports; properties/fleet/compliance/Cintas; settings.
- A server-read rollout document can place only named workflows into an exact version-6 custom-token claim. Current tokens have no claim, so current rules retain compatibility behavior.
- Strict workflow claims include only non-secret role/location scope from the sanitized effective profile. Rules accept that scope only while the matching server device session, Firebase UID, profile ID, `securityVersion`, absolute expiry, temporary-scope expiry, and revocation state remain current.
- Direct browser writes to temporary backup-access and issue-access documents are denied whenever the strict identity/users workflow is selected; the protected server action is then authoritative.
- Storage photo paths apply the same current-session and location checks under strict workflow claims.
- Existing protected EOC template Functions now require a current mapped device session when the template/photo workflow is selected.
- The EOC and issue atomic browser transactions are already at Firestore's hard 1,000-expression limit. Their compatibility rules therefore remain low-overhead; final strict rollout must use the protected server transaction path for those mutations instead of adding another browser-rule branch.

## Two-device conflict protection

- Existing online transport edits retain exact-version transactions and field-conflict review.
- Offline transport replay now requires exact versions.
- Protected transport creation uses one server transaction, one per-profile active-transport lock, an active-record query, stable operation IDs, and immutable audit evidence. Concurrent create attempts from two devices produce one transport and reject the other.

## Phase 7 — App Check monitoring readiness

- Client initialization requires an exact build flag, version 7, a site key, non-emulator runtime, and `enforcementEnabled != true`.
- Security and template callables explicitly use `enforceAppCheck: false`.
- Login, account, replay, and protected transport audit evidence records whether an App Check token was present without exposing it.
- No site key, production setting, enforcement, or registration was added.

## Phase 8 — compatibility retirement readiness

- `npm run verify:security-readiness` performs a local, read-only boundary and artifact check.
- Retirement is not automatic. Every workflow must first pass live canary queries/listeners, role/location negatives, device/browser coverage, offline replay, and rollback practice.
- Rollback requires disabling the selected workflow, ending canary sessions so old workflow claims cannot persist, restoring the coordinated rules/Functions/Hosting baseline, and verifying legacy staff behavior before wider action.

## Verified evidence

- Lint: passed.
- Production build: passed.
- Security pure/unit contracts: 52 passed.
- Security Firestore/Auth emulator contracts: 36 passed, including secure administrator account creation, temporary/issue-access revocation, expiring scope, and concurrent two-device protected transport creation.
- Firestore rules: 34 passed, including representative checks for every named workflow, strict current/revoked/scope-expired sessions, denial of strict direct access-scope writes, a valid pre-signoff debrief correction, and role/owner/location negatives.
- Functions emulator: 10 passed and all dormant callables loaded under the declared Node.js 22 runtime. A temporary official Node.js 22.23.2 runtime was used without changing the workstation's installed Node.js 24 runtime.
- Storage rules: 4 passed, including strict current/revoked device-session photo access.
- Combined dormant security browser suite: 9 applicable phone/tablet/desktop cases passed; 12 duplicate viewport cases were intentionally skipped. The mobile login includes active temporary and issue scope under the strict identity/users claim and proves the BHT client no longer depends on a forbidden direct grant read.
- Existing EOC/issues browser regression: 7 passed; 2 intentional tablet duplicates skipped.

Firebase CLI updater-permission warnings can make the wrapper exit nonzero after the product test process reports all tests passed. Record the test summary separately from that shutdown warning.

## Remaining release gates

Node.js 22 runtime parity is verified locally: the readiness verifier reported `runtimeParity: true`, all 52 focused security contracts passed at this checkpoint, and the Functions emulator loaded every then-current dormant callable and passed 10 tests under Node.js 22.23.2. The protected server transactions required for the already-large EOC/issue mutations were completed and separately verified in [`PHASE_9_PROTECTED_OPERATIONAL_MUTATIONS.md`](PHASE_9_PROTECTED_OPERATIONAL_MUTATIONS.md). Production release approval and all production configuration, secret, deployment, activation, and canary actions remain separate and unperformed.
