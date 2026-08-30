# Security Foundation Phases 4–8 — Local Dormant Readiness

Last updated: 2026-08-30
Status: Local foundation complete; released only to the exact three-profile production canary; broad rollout disabled

## Outcome

The remaining foundation is implemented behind exact versioned boundaries. Its local contract matrix is complete, and the exact synthetic Test House cohort (`test_supervisor`, `test_bht_shift_1`, `test_bht_shift_2`) has completed the cumulative production canary through `settings`. The familiar six-digit PIN screen is preserved. Non-canary staff remain on compatibility behavior; global strict authorization, Anonymous Authentication as a shortcut, App Check enforcement, broad enrollment, and compatibility retirement remain disabled.

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
- The client and server now expose matching 11-action catalogs. A table-driven contract covers every supported action, and a secure browser/emulator journey proves the complete queue survives an offline reload in IndexedDB with its original owner, Firebase UID, device session, security version, location, and expected-version binding intact.

## Phase 6 — workflow-by-workflow security

- Exact workflow names: identity/users; templates/photos; EOC; debriefs/alerts; issues/feedback/audit; transports; properties/fleet/compliance/Cintas; settings.
- A server-read rollout document can place only named workflows into an exact version-6 custom-token claim. The exact canary receives the approved cumulative claims through `settings`; non-canary sessions retain compatibility behavior.
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
- Login, account/access, replay, transport, protected EOC, and protected issue audit evidence records whether an App Check token was present without exposing it.
- The guarded `app-check-observe` mode reads only recent protected audit collections and returns aggregate present/missing/malformed counts for all six endpoint groups. It refuses to run as a monitoring-only gate if enforcement is active and never returns profile IDs or document contents.
- No site key, production setting, enforcement, or registration was added.

## Phase 8 — compatibility retirement readiness

- `npm run verify:security-readiness` performs a local, read-only boundary and artifact check.
- Retirement is not automatic. Every workflow must first pass live canary queries/listeners, role/location negatives, device/browser coverage, offline replay, and rollback practice.
- Rollback requires disabling the selected workflow, ending canary sessions so old workflow claims cannot persist, restoring the coordinated rules/Functions/Hosting baseline, and verifying legacy staff behavior before wider action.

## Verified evidence

- Lint: passed.
- Production build: passed.
- Security pure/unit contracts: 86 passed.
- Security Firestore/Auth emulator contracts: 43 passed, including protected EOC/issue mutations, secure administrator account creation, temporary/issue-access revocation, expiring scope, stable multi-device identity, simultaneous first-login UID convergence, and concurrent two-device protected transport creation.
- Firestore rules: 40 passed, including representative checks for every named workflow, strict current/revoked/scope-expired sessions, denial of strict direct access-scope writes, location-constrained Users/assignment/debrief/BHT-alert/transport/operations queries, settings write boundaries, and role/owner/location negatives.
- Functions emulator: all required callables loaded and the 43 combined contracts passed on the current workstation's Node.js 24 host. The current readiness run correctly reports that this is not local Node 22 parity. The production Functions remain declared and deployed on Node 22; earlier Node 22.23.2 evidence is historical and is not substituted for the current host result.
- Storage rules: 4 passed, including strict current/revoked device-session photo access.
- Combined dormant security browser suite: 9 applicable phone/tablet/desktop cases passed; 12 duplicate viewport cases were intentionally skipped. The mobile login includes active temporary and issue scope under the strict identity/users claim and proves the BHT client no longer depends on a forbidden direct grant read.
- Focused cumulative `identity_users` + `templates_photos` browser/emulator gate: 2 applicable secure-client journeys passed and 4 duplicate viewport journeys were intentionally skipped. A secure supervisor loaded the shared template library without gaining RES account visibility; a secure BHT uploaded an authorized Test House EOC response photo while the same client was denied a wrong-location upload. The browser asserts the secure client compile gate before PIN entry, and Functions loaded under Node.js 22.23.2. Earlier project-ID and missing-compile-gate harness runs were invalidated and are not counted.
- Focused cumulative `eoc` + owner-bound offline replay browser/emulator gate: 1 applicable phone journey passed and 2 duplicate viewports were intentionally skipped. It proved current secure identity/session/location authorization, wrong-owner denial, protected EOC submission, idempotent retry, task completion, original-owner attribution, and retained replay-authorization evidence.
- Focused cumulative `debriefs_alerts` browser/emulator gate: 7 applicable secure-client journeys passed and 14 duplicate viewport journeys were intentionally skipped. It proved outgoing-owner correction, same-house wrong-owner denial, assigned-receiver signoff with only the matching alert acknowledged, eligible incoming-shift reassignment with required reason/version/reset behavior, visible late-handoff state plus scoped late alert, stale owner-bound offline confirmation held as `needsReview`, and an OTC supervisor's Test House debrief/alert visibility without RES exposure. The supervisor debrief, alert, incoming-assignment, and old-alert queries now use backend location constraints rather than broad client filtering.
- Focused cumulative `issues_feedback_audit` browser/emulator gate: 4 applicable secure-client journeys passed and 8 duplicate viewport journeys were intentionally skipped. It proved protected BHT issue reporting with deterministic replay, original-reporter resolution submission, wrong-location denial, scoped supervisor approval with wrong-location denial, staff-owned app feedback, and admin-only audit/feedback visibility with no PIN/hash/secret fields rendered. Calls ran through `mutateProtectedIssueV9` with valid Firebase custom-token authentication and non-enforcing App Check monitoring.
- Focused cumulative `transports` browser/emulator gate: 4 applicable secure-client journeys passed and 8 duplicate viewport journeys were intentionally skipped. Two independent devices signed in as the same BHT and raced to create a transport; the server transaction created exactly one active record and returned one safe conflict. A wrong-site create was denied, the OTC supervisor listener showed Test House/OTC data without RES exposure or permission errors, and the secure admin retained the approved all-site view. The supervisor listener now constrains its Firestore queries by `site` instead of requesting all transports and filtering in React.
- Focused cumulative `operations_admin` browser/emulator gate: 3 applicable secure-client journeys passed and 6 duplicate viewport journeys were intentionally skipped. The OTC supervisor loaded Properties, Fleet, Compliance, and Cintas through backend `mainLocation`/`site` queries, saw no RES records or listener errors, could create an OTC property, and was denied an RES property write. A BHT was denied the supervisor property collection, while admin retained both locations across all four operational screens. Strict mode treats missing or ambiguous operational location fields as admin-review data instead of exposing them to a scoped supervisor.
- The guarded `operations_admin` and `settings` previews now perform a read-only nine-collection data-shape audit and refuse activation if older/malformed records lack exact current location metadata. The pure readiness model passed 2 positive/negative contracts and exposes only aggregate collection counts.
- Focused cumulative `settings` browser/emulator gate: 3 applicable secure-client journeys passed and 6 duplicate viewport journeys were intentionally skipped. BHT and supervisor sessions read the ordinary runtime settings required by existing workflows but were denied writes. Admin updated an ordinary setting and was denied browser writes to `securityFoundation`, `securityWorkflows`, and `appCheckMonitoring`.
- Complete cross-workflow offline browser/emulator matrix: 1 applicable mobile journey passed. All 11 supported actions survived offline reload and retained correct allow, reauthorize, hold-for-owner, and removed-scope-review behavior. The final harness waits for service-worker control and inspects the persisted IndexedDB records while offline so an online Vite reload cannot replay them before assertion.
- Existing EOC/issues browser regression: 7 passed; 2 intentional tablet duplicates skipped.

Firebase CLI updater-permission warnings can make the wrapper exit nonzero after the product test process reports all tests passed. Record the test summary separately from that shutdown warning.

## Production canary closeout and remaining release gates

- All eight named workflow groups passed their guarded synthetic production stage, rollback, and reactivation. Live evidence is detailed in [`../../PROGRESS_LOG.md`](../../PROGRESS_LOG.md).
- The 24-hour App Check aggregate covered all six protected endpoint groups across 63 samples, all of which recorded a missing token. Enforcement remained false. This proves monitoring coverage, not enforcement readiness; no key or enforcement change is authorized.
- Broad staff enrollment is a separate production release. Preview active profiles first, enroll one role/location cohort at a time, retain compatibility fallback, observe normal work and negative boundaries, and preserve a coordinated rollback before expanding.
- Compatibility retirement remains separately gated until broad enrollment is stable. The current isolated canary branch is also not yet merged into `Main`.
- Current local Node is `24.13.0` while Functions declare Node 22, so the readiness verifier correctly reports `runtimeParity: false`. Deployed Functions use Node 22, but a future release should rerun the complete emulator wrapper on an actual Node 22 host before claiming fresh local parity.
