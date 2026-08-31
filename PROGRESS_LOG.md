# SPRC Ops Hub Progress Log

Last updated: 2026-08-31
Status: Active evidence log
Quick orientation: [`MASTER_PLAN.md`](MASTER_PLAN.md)

## 2026-08-31 — Android Chrome offline cold-start defect reproduced and stronger correction verified locally

### Live canary evidence

- The first approved Lone Mountain BHT account signed in concurrently on the existing browser and a real phone. Privacy-minimized read-only status confirmed two independent active device sessions for one mapped cohort profile while the other approved profiles still awaited first login.
- Mark logged out on the phone only. Read-only status dropped from two active sessions to one while the original browser remained active, directly passing the approved one-device logout contract. Signing back in on the phone created a fresh second session again.
- With the phone signed in, Mark disabled both network paths, fully closed the browser/app, and reopened Ops Hub. The real phone displayed a blank white screen. No operational form was submitted, no PIN/account/access setting changed, and the remaining online session was not revoked. Broader cohort rollout remains paused.
- PR #16 merged the first complete-bundle cache correction to `Main` as `ad69bec`, and its Hosting-only release reached `sprc-tx-l`. The secure login remained usable online, but a second real Android Chrome full-close/offline reopen still displayed a blank white screen. That direct phone result superseded the earlier page-close-only local pass.

### Root cause and local correction

- The deployed `sprc-ops-shell-v11` installer parsed only asset links present in `index.html`. The security bootstrap intentionally loads the main App as a separate production chunk after the core reset check, so a first visit could install the worker after that chunk had already loaded and never place the complete production module graph in Cache Storage. The prior development offline test manually refetched its module graph and therefore did not prove a real built cold restart.
- A second production-shaped failure showed that even present precache entries can miss a later script/style request when the server response carries a `Vary` header. The cache fallback now matches the immutable same-origin asset by URL after network failure.
- The v12 release added the root-level Vite asset manifest, complete hashed-bundle precache with forced response bodies, development fallback, and same-origin offline `Vary` handling. The real phone result showed that complete cache contents alone were insufficient because service-worker registration still began only after the browser `load` event and the app did not prove installation readiness before staff could close Chrome.
- Local branch `codex/offline-shell-process-restart` starts from verified `origin/Main` `ad69bec`. The v13 correction registers the service worker immediately, waits up to a bounded 20 seconds for the offline shell before rendering the app, records an exact readiness marker, and retains update/reload behavior. The static initial HTML now shows a plain-language reconnect/retry message, so missing offline JavaScript cannot collapse into an unexplained white page.
- The production preview server now runs in an independent process for process-restart evidence. `test:security-offline-shell:browser` still proves the complete manifest, entry, App chunk, stylesheet, and page-close cold start. The separate `test:security-offline-shell:process` starts a fresh persistent Chrome profile, proves the v13 shell is active, completely closes Chrome, starts a second Chrome process with that same profile while offline, and requires a nonblank visible PIN screen.

### Verification and release boundary

- Production-built page-close cold offline restart: 1 passed. Independent full-Chrome-process offline restart: 1 passed with the v13 cache ready before close and the offline PIN screen visible after relaunch. Full secure offline/reconnect owner matrix: 1 passed with all 11 supported queued action types and their owner, Firebase identity, session, security-version, location, and record-version safeguards intact.
- Security foundation: 92 passed. ESLint passed. Security-canary build passed with 1,913 modules, root asset manifest, and `v3-enabled` marker. The readiness verifier now recognizes both offline gates and reports the local implementation ready while correctly retaining the Node-parity and broad-rollout blockers. `git diff --check` passed.
- The full matrix ran on the current Node `24.13.0` host because local Node 22 is unavailable; no fresh Node 22 parity is claimed. Its product test passed before the Firebase CLI emitted the known local updater-cache shutdown error. A temporary dummy emulator-only PIN secret was used because the workstation Firebase login is expired, then removed immediately; no production secret was read, stored, changed, or exposed.
- The v13 correction is local only. It does not change Functions, Firestore/Storage rules, Auth providers, security configuration, production data, sessions, App Check enforcement, strict authorization, or cohort enrollment. Production still requires a reviewed Hosting-only release and a repeat of the real Android Chrome full-close offline/reconnect journey.

## 2026-08-30 — Guarded real-staff cohort rollout preparation started locally

### Approved direction

- Mark approved beginning the remaining broad staff rollout after security-foundation PR #13 merged to `Main` as `eda1ff9`.
- The rollout remains location-by-location and role-group-by-role-group. The first operational group is BHT/tech only at one exact existing home location. The familiar six-digit PIN screen and compatibility fallback remain unchanged for everyone not explicitly enrolled.
- No exact real-staff location or profile list has been selected yet. No production enrollment, profile mutation, session ending, Firebase configuration change, deployment, strict-auth change, App Check enforcement, or compatibility retirement occurred in this preparation step.

### Local implementation and evidence

- Created isolated branch `codex/security-real-staff-rollout` from verified `origin/Main` merge `eda1ff9`.
- Added a separate guarded staff-rollout model and command instead of weakening or repurposing the exact synthetic-canary tool.
- The model caps one cohort at 12 profiles, rejects synthetic accounts, supervisors/admins, inactive/deleted profiles, zero/multiple/wrong home locations, missing or duplicate PIN credentials, conflicting identity mappings, already-enrolled profiles, mismatched allowlists, incomplete workflow coverage, global strict authorization, and App Check enforcement.
- The command supports read-only candidate discovery, exact-cohort preview with an external checksum-protected rollback file, status, enrollment, and rollback. Enrollment and rollback atomically change only the two profile allowlists plus target security versions, then close all target device sessions, revoke mapped Firebase refresh tokens, and preserve retryable audit/cleanup evidence. Rollback removes only that cohort and returns it to compatibility login; it does not delete identity, credential, session, offline, or audit records.
- Focused rollout-model tests: 6 passed. Complete security-foundation unit suite: 92 passed, 0 failed. The dedicated Firestore/Auth emulator lifecycle passed exact enrollment, version cutoff, old-session closure, immutable audit plus cleanup completion, identical-command retry without a second version increment, cohort-only rollback, rollback session closure, and rollback retry. Firebase CLI emitted the known updater-cache warning only after the product test passed. ESLint and the 1,913-module production build passed.
- Read-only live candidate discovery initially surfaced the existing RES/Test House synthetic accounts alongside the true operational candidates. The guard was tightened to exclude the known synthetic IDs and test/canary ID patterns from both discovery and manual selection. The corrected live report shows zero real candidates at Mesquite, RES, or Test House and exactly three approved BHT candidates at Lone Mountain. Exact real-staff identifiers remain only in the protected external rollout evidence.
- All three Lone Mountain profiles are active BHTs with the exact `lone_mountain` home location, unique legacy PIN hashes eligible for normal first-login server migration, security version `1`, no conflicting stable identity, and no current secure enrollment.
- Read-only preview passed and wrote a checksum-protected rollback package outside the repository. The protected package retains the exact cohort and validation digest. It preserves the full eight-workflow list, compatibility fallback, strict authorization off, and App Check enforcement off.

### Pre-enrollment gate (completed below)

- The required sequence was to commit/review/merge the guarded tool, confirm the live configuration/profile hashes still matched a fresh preview, and obtain Mark's explicit authorization for the production profile-version/session mutation. The exact generated confirmation remained in the protected external preview evidence.
- The remaining post-enrollment gate is existing-PIN login, reload persistence, phone and desktop, two-device independence, one-device logout, offline/reconnect, relevant BHT workflows, supervisor scope, negative access, and rollback/re-enrollment evidence before adding another cohort.

### Guard merge and authorized production enrollment

- Committed the reviewed guard as `8659018`, opened PR #14 with 11 expected code/test/documentation files, confirmed it was mergeable with no pending/failed GitHub status checks, and merged it to case-sensitive `Main` as `0fe3be2`. A fresh fetch verified the guard commit is contained in `origin/Main` before any production mutation.
- Re-ran the read-only Lone Mountain preview after the merge. The same three approved profiles passed with no drift and produced a fresh checksum-protected rollback package outside the repository. The exact cohort, file path, digest, and audit identifiers remain in protected external evidence.
- With Mark's explicit authorization, enrolled exactly the three approved Lone Mountain BHT profiles. The guarded transaction changed only that cohort, preserved all eight workflow claims and compatibility fallback, kept global strict authorization/App Check enforcement off, and recorded immutable rollout evidence. Exact version, allowlist, and audit details remain in protected external evidence.
- Cleanup completed without a refresh-token cleanup failure. Immediate read-only status confirmed the intended cohort-only boundary and no secure identity/session artifacts before each person's first normal server-verified PIN login. Exact counts and session evidence remain outside the repository.
- No PIN was changed or exposed, no account was deactivated, no source or Firebase deployment was needed, no global strict-auth/App Check setting changed, no non-Lone-Mountain profile was enrolled, and no compatibility path was retired.

### First live Lone Mountain account

- Mark entered the existing PIN directly in the visible browser without sharing it. Read-only backend status then confirmed the first approved account created its stable Firebase identity/current device session; the remaining two cohort profiles still await their first normal login. Exact mapping, version, and session records remain in protected external evidence.
- The secure Home screen restored the exact existing assignment: Lone Mountain, 2nd Shift, Van 2. The BHT menu exposed only Home plus the ordinary self-service PIN/session actions; it did not expose supervisor/admin navigation.
- A full browser reload returned directly to the same Lone Mountain Home without a PIN prompt. The same page remained usable at a temporary 390×844 phone viewport, which was then reset to the normal browser size.
- Read-only live workflow navigation loaded the existing 35-item Lone Mountain House EOC, the existing active transport, the issue-report form, and the existing debrief editor. No answer, note, issue, transport, PIN, or other operational record was changed or submitted.
- Direct navigation to `/dashboard/users` redirected the BHT back to `/home`, proving the negative Users-page boundary. No new console warning or permission error appeared during reload or any correct-account workflow/negative-access check.
- The browser initially restored a different prior account before Mark selected the intended profile; its older console entries were already present and did not grow during the actual Lone Mountain secure-session checks. Protected backend mapping/session evidence distinguishes the successful secure login from that earlier unrelated browser state.
- Remaining cohort gate: first secure login for the remaining two approved profiles, a real second device/phone journey, one-device logout with another device preserved, offline/reconnect observation, one complete working shift without scope/sync errors, and the controlled rollback/re-enrollment proof. Do not expand to another location yet.

## 2026-08-30 — Complete three-profile security canary closed out through Settings

### Final production boundary

- The production canary still contains exactly `test_supervisor`, `test_bht_shift_1`, and `test_bht_shift_2`. The cumulative signed workflow list now contains the approved full order: `identity_users`, `templates_photos`, `eoc`, `debriefs_alerts`, `issues_feedback_audit`, `transports`, `operations_admin`, and `settings`.
- Secure owner-bound offline replay is enabled only inside that exact canary boundary. Ordinary non-enrolled staff still use the familiar compatibility PIN path. Global strict authorization, the Anonymous Authentication shortcut, App Check enforcement, broad staff enrollment, and compatibility retirement remain off.
- The four workflow callables needed after Identity/Users are now network-reachable only where their stage required it: `authorizeOfflineReplayV5`, `submitProtectedEocV9`, `mutateProtectedIssueV9`, and `createProtectedTransportV6`. Each still rejects requests unless the application-level Firebase identity, current device session, signed workflow claim, role/location scope, ownership, and record-version contract passes.
- The final guarded Settings reactivation used external rollback snapshot `C:\Users\markv\Documents\Codex\SPRC-release-backups\sprc-security-canary-2026-08-30T17-40-46-357Z.json`, SHA-256 `77c264534fab063f5aa6861c8f913b398c2a8f29b09b6ca495a5eb54b70a56da`. Protected workflow configuration read back with update time `2026-08-30T17:41:00.853Z`. The final rollback/re-advance ended existing canary device sessions, so the next canary use starts with a fresh PIN login and current claims.

### Production workflow evidence

- EOC: Test Supervisor loaded the live EOC page without a permission error and retained OTC/Test House scope. Protected EOC submission and offline replay passed the signed-session/location/idempotency gate. Both EOC endpoints were proven network-private during rollback, then restored to the app-layer-protected boundary during reactivation.
- Debriefs/Alerts: the live Test Supervisor loaded the scoped Test House/OTC debrief and alert listeners without RES exposure. The complete emulator/browser journey separately passed outgoing corrections, wrong-owner denial, incoming acknowledgment, matching-alert handling, eligible reassignment, late-handoff evidence, stale offline confirmation review, and backend-scoped listeners.
- Issues/Feedback/Audit: Test BHT Shift 2 submitted a clearly synthetic issue resolution and Test Supervisor approved it. The local role/location matrix also passed deterministic replay, wrong-location denial, staff-owned feedback, and admin-only sanitized audit/feedback review. `mutateProtectedIssueV9` became HTTP 403 during rollback and was restored afterward.
- Transports: Test BHT Shift 2 created and completed a clearly synthetic transport; Test Supervisor saw it in the OTC-scoped list without RES exposure. The emulator contract and browser matrix proved that two independent devices racing the same BHT create exactly one active transport and one safe conflict. `createProtectedTransportV6` became HTTP 403 during rollback and was restored afterward.
- Operations Administration: Properties, Fleet, Compliance, and Cintas loaded for Test Supervisor through backend OTC/Test House scope with no RES records. The guarded production preflight initially blocked one `eocVehicles` record and its matching `fleetVehicleRuntime` record because each lacked `mainLocation`. With Mark's explicit approval, backup `C:\Users\markv\Documents\Codex\SPRC-release-backups\sprc-operations-metadata-2026-08-30T17-29-04-848Z.json` (SHA-256 `c7f90a8dd611041fbb86afce86bfa0f36577790d412f8e08eb374bf7631e7274`) was captured and only `mainLocation: OTC` was added atomically to those two already-OTC fleet records. The nine-collection preflight then passed with 3 records scanned and 0 invalid.
- Settings: Test BHT Shift 1 completed secure login, Home loading, and reload under the cumulative Settings claim. The local gate proved BHT/supervisor runtime-setting reads, denial of their writes, admin ordinary-setting writes, and denial of browser writes to `securityFoundation`, `securityWorkflows`, and `appCheckMonitoring`.
- Every stage from EOC through Settings completed its guarded rollback and fresh reactivation. Rollback ended canary sessions, restored the prior cumulative workflow/configuration boundary, and made any newly required endpoint private where applicable before reactivation restored the reviewed state.

### Defects found and corrected before closeout

- Secure supervisors were starting Fleet listeners before `operations_admin` appeared in the signed workflow claims, producing a permission error on earlier stages. The client now carries the server-issued workflow version/list in its minimal session state and starts secure Fleet listeners only when `operations_admin` is signed; compatibility behavior is unchanged.
- Two devices performing the first secure login at the same time could race while creating the stable Firebase UID. The server now converges on the deterministic existing UID after `auth/uid-already-exists`. A new emulator contract proves both devices receive the same stable identity and independent sessions.
- The final offline Playwright check exposed a Vite-development-only cache timing problem. The harness now waits for service-worker control, caches the already-loaded development module graph, and verifies IndexedDB records directly after offline reload without allowing an online reload to replay them.

### Final verification evidence

- Security pure/unit contracts: 86 passed, 0 failed.
- Firestore/Auth security emulator contracts: 43 passed, 0 failed, including simultaneous first login, all-device revocation, supervisor BHT limits, offline replay, and same-user two-device transport conflict protection.
- Firestore rules: 40 passed, 0 failed. Storage rules: 4 passed, 0 failed. Firebase CLI then emitted its known local updater-cache error after each successful product-test summary; the wrapper exit code is recorded separately from the green tests.
- Complete offline/reconnect browser matrix: 1 passed, covering all 11 supported queued actions through offline reload plus allow, reauthorize, hold-for-owner, and removed-scope-review results. Non-enrolled compatibility browser matrix: 1 passed and created no secure artifacts.
- Workflow regressions: Shift Debrief 14, EOC/org/batching 29, issues/photos/feedback 18, debrief reset 3 — all passed. ESLint passed. Guarded security-canary build passed with 1,913 modules and the `v3-enabled` marker.
- Readiness verifier reports every required security artifact/boundary present and `localDormantImplementationReady: true`. On this workstation it correctly reports `runtimeParity: false` because the host is Node `24.13.0` while Functions declare Node 22. The relevant production Functions were deployed on their declared Node 22 runtime; this closeout does not misstate the current local emulator run as Node 22 parity.
- App Check 24-hour aggregate observation covered 63 protected callable samples across all required groups: login 37, account/access 21, offline replay 1, transport 1, EOC 1, issues 2. All 63 correctly recorded token absence; no sample was malformed, enforcement remained false, and no production key/setting was enabled. This completes monitoring evidence but does not authorize or prove enforcement readiness.

### Release and remaining boundary

- Hosting, the reviewed Firestore rules/indexes, and the required Node 22 Functions were released only as explicitly authorized during the staged canary. No production PIN is documented here, no real staff account was reset/deactivated, and no real staff cohort was enrolled.
- The completed canary implementation and this closeout were captured in source commit `79553ef` and submitted as security-foundation completion PR #13. The `Main` baseline immediately before that integration was `1028347`; Git history is authoritative for the resulting merge commit.
- The synthetic all-workflow canary is complete. The next distinct production project is broad staff enrollment in small role/location cohorts. It requires separate approval and must preserve compatibility fallback until those cohorts are observed and rollback-ready. Compatibility retirement is a later separate approval.

## 2026-08-30 — Templates/photos production canary activated for live verification (historical stage; superseded above)

### Approved guarded advance

- After Mark explicitly approved the `templates_photos` stage, a fresh `stage-preview` confirmed current stage `identity_users`, target cumulative workflows `identity_users` plus `templates_photos`, the same three valid Test House profiles, no foundation changes, and no protected endpoint to open.
- Saved fresh rollback backup `C:\Users\markv\Documents\Codex\SPRC-release-backups\sprc-security-canary-2026-08-30T07-01-47-440Z.json`; SHA-256 `61e50e4b1b9367aa2d12ed339eccf60e89c731710a3828a34c0463b65782d10e`.
- The guarded stage advance completed and read back exactly the two cumulative workflows. Offline replay remained disabled. The exact three-profile allowlist and release ID were unchanged.
- The immutable `security_canary_stage_advanced` audit records previous stage `identity_users`, target stage `templates_photos`, the two exact workflows, three profiles, and zero revoked sessions because no secure canary session was active at the transition.

### Immediate boundary checks

- Direct network probes confirmed `authorizeOfflineReplayV5`, `createProtectedTransportV6`, `submitProtectedEocV9`, and `mutateProtectedIssueV9` all still return infrastructure-level `403`.
- The non-enrolled RES BHT remained on its correctly scoped RES Home after reload, confirming the workflow advance did not pull it into secure enrollment or break compatibility behavior.
- The Test Supervisor opened the live EOC template library without a permission error and saw four shared templates. Its assignment controls offered only Mesquite, Lone Mountain, and Test House; RES did not appear. No assignment was changed.
- Test BHT Shift 2 completed the existing synthetic Test House House EOC through the normal staff UI. The stored submission contains the expected Test House/Shift 2 ownership, `standard_fallback_house` template, all 35 answers, and no issue answer.
- The same BHT used the normal `Report issue` flow to attach and upload the approved synthetic JPEG. Readback confirmed one uploaded attachment in the matching Test House Storage path with JPEG content type and location metadata; no real workplace photo or client data was used.
- A full browser reload restored the same secure Test BHT Shift 2 session, Test House scope, completed House EOC, and one open synthetic issue without another PIN prompt.
- A read-only canary status check after these journeys confirmed the exact three-profile cohort, cumulative `identity_users` plus `templates_photos` stage, and exactly one active browser session. Two initial helper-token approaches failed before any upload request because the local credential cannot sign Firebase custom tokens; neither changed configuration, sessions, accounts, or Storage.
- With Mark's explicit permission, a controlled live client probe used the normal server PIN-login path for Test BHT Shift 2, attempted an EOC response-photo upload to Mesquite, received `storage/unauthorized`, and verified that no Storage object was created. The first probe exposed a test-harness field-name error and left its temporary device session active; the corrected retry used the protected one-device closure action to close both that earlier temporary session and the retry session. Final readback showed seven historical Test BHT Shift 2 session records, six inactive and only Mark's original browser session active. The browser remained on the correctly scoped Test House Home screen.
- The live `templates_photos` positive, negative, compatibility, and reload gates passed. The rollback/reactivation evidence immediately below completes the stage. No `eoc` or later stage is active.

### Completed rollback/reactivation gate

- With Mark's standing authorization to continue the approved rollout without repeated pauses, the guarded `templates_photos` rollback restored exactly `identity_users`, kept the same three-profile cohort, left offline replay disabled, recorded immutable rollback evidence, revoked the one active Test BHT session, and returned the browser to the familiar PIN screen after reload.
- A new `stage-preview` then revalidated all three synthetic profiles and produced rollback snapshot `C:\Users\markv\Documents\Codex\SPRC-release-backups\sprc-security-canary-2026-08-30T07-26-44-776Z.json` with SHA-256 `0e69b0558861e941669fa8f3aa9f18fc29ca4e04f00252ef7ac5c33fabec9206`.
- The guarded reactivation restored exactly `identity_users` plus `templates_photos`, changed no foundation flag, and ended no additional session. Test BHT Shift 2 immediately signed in through the normal PIN screen, returned to the same Test House Home state, and survived a full reload.
- `templates_photos` is complete. Production remains at this cumulative stage; offline replay remains off and the EOC, issue, and transport protected endpoints remain infrastructure-private.

### EOC coordinated release readiness

- Added the already-approved dedicated security runtime identity to only `authorizeOfflineReplayV5` and `submitProtectedEocV9`; the issue and transport endpoints remain unchanged/private.
- Node.js `22.23.2` verification passed 42 Auth/Firestore security-emulator contracts and all 37 applicable pure Functions tests. The separate retention emulator module was initially invoked without its required bucket and was correctly excluded from that pure-test claim.
- The cumulative EOC browser/emulator journey passed on its one applicable phone project with two intentional duplicate viewport skips. It proved original-owner/Firebase/session/location replay authorization, wrong-owner denial, protected EOC submission, idempotent retry, completed task state, sanitized attribution, and retained authorization evidence. An initial run used the contract-test emulator project instead of the browser-test project and correctly failed login against the empty database; the matching-project rerun passed.
- ESLint, the guarded secure Hosting build, its `v3-enabled` marker verification, and `git diff --check` passed. No Hosting or rule deployment is needed for this boundary.
- After Mark explicitly approved the selective production deployment, `authorizeOfflineReplayV5` and `submitProtectedEocV9` updated successfully on Node.js 22 under `sprc-security-runtime@sprc-tx-l.iam.gserviceaccount.com`, both with deployed hash prefix `9be439bc...`. No other Function or Firebase product was deployed.
- Post-deploy probes showed Firebase preserved the existing infrastructure-private IAM rule: both updated EOC endpoints still return `403`, as do the untouched issue and transport endpoints. Production workflow configuration therefore remains at `templates_photos`. Source now declares an explicit public invoker only for the two EOC callable entry points, but the external safety gate blocked that persistent IAM change before execution pending separate explicit approval.

## 2026-08-29 — Identity/Users live canary completed without repeating its rollback drill

### Rollback evidence reconciliation

- The existing 2026-08-27 release entry records that the exact `security-foundation-test-house-v1` canary was rolled back to its absent protected-configuration baseline, exposed and corrected an immutable-audit document-name collision, then completed a second rollback plus reactivation drill successfully.
- A new privacy-minimized production readback directly confirmed five immutable audit events for the exact release: activation, rollback, activation, rollback, and final activation. Both rollback events covered the same three approved profiles and both successful activations restored only `identity_users`.
- The latest guarded `identity-status` readback still confirms the exact three-profile cohort, valid `identity_users`-only foundation/workflow boundary, and an exact current match to the verified rollback anchor. Today's separate all-device test proves active sessions are cut off through security-version enforcement and preserved inactive-session/audit evidence.
- Repeating the production rollback would temporarily disable the now-working secure canary and sign out its users while duplicating completed evidence. Consistent with Mark's instruction not to repeat finished work, no new rollback/configuration mutation was performed.

### Stage 3 outcome

- Identity/Users is complete. Live evidence now covers Test Supervisor login/reload, EOC regression, OTC-only Users listing, scoped OTC BHT creation, both Test BHT login/reload/scope journeys, two active devices, one-device logout, supervisor all-device revocation, non-enrolled compatibility login/reload/no-secure-artifact behavior, admin-created RES BHT scope/login/reload, BHT denial from Users, immutable audit, cleanup, and rollback/reactivation.
- Production remains unchanged at exactly the three approved profiles and only `identity_users`. `templates_photos`, every later workflow, offline replay, and the four private protected endpoints remain disabled/unactivated.
- The next production decision is whether to run the guarded `templates_photos` stage advance for the same three profiles. That change requires Mark's explicit approval and will end any active canary sessions so new workflow claims are issued on the next PIN login.

## 2026-08-29 — RES account scope and compatibility login passed live

### Approved production account and direct behavior

- With Mark's explicit approval, Mark created one synthetic active BHT through the normal administrator Users flow: internal ID `test_rtc_shift_1`, RES, `res_shift_1_day`, and `van_3`. The display name retains Mark's `Test RTC Shift 1` wording; the authoritative operational location is RES.
- Using the PIN Mark supplied for this test, the account reached the familiar BHT Home screen with exactly `RES - 1st Shift - Day - Van 3`. A normal navigation reload remained on the correctly scoped RES Home screen.
- Direct navigation to `/dashboard/users` redirected the BHT back to `/home`, proving the BHT cannot open staff-account administration.

### Read-only boundary evidence

- A privacy-minimized profile readback confirmed the account exists, is active, has role `bht`, location `res`, shift `res_shift_1_day`, and only `van_3`. It has no `staffAuthIdentities` mapping, zero secure session records, and zero active secure sessions, as required for a profile outside the secure canary allowlist.
- The guarded `identity-status` readback still confirmed the exact original cohort (`test_supervisor`, `test_bht_shift_1`, and `test_bht_shift_2`), only `identity_users`, valid foundation/workflow boundaries, and an exact match to the verified rollback anchor. The RES account creation did not broaden secure activation or open any later workflow/endpoint.
- No PIN was reset, no account was deactivated, and no Firebase/Auth setting, protected configuration, rule, deployment, secure cohort, workflow, or private endpoint changed during verification. The test PIN is intentionally omitted from project documentation.

### Identity/Users gate status

- **Superseded by the newer Identity/Users closeout entry above:** RES-side production behavior passed, and the already-completed rollback/reactivation drill was directly confirmed from immutable production audit evidence. Identity/Users is complete.

## 2026-08-29 — Supervisor all-device revocation passed live

### Approved live action

- With Mark's explicit approval immediately before the action, `test_bht_shift_2` was signed in concurrently on this computer and Mark's phone. The pre-action privacy-minimized status readback confirmed two stored sessions and two active sessions for that synthetic BHT at security version `1`.
- A separately signed-in Test Supervisor used the normal Users-page **End All Sessions** control for that Test House BHT. No PIN was changed or reset, no profile was activated/deactivated or created, and no protected configuration, workflow, endpoint, Auth provider, rule, deployment, or unrelated production record was changed.

### Direct evidence

- This computer returned immediately to the familiar PIN screen. After Mark refreshed the original non-private phone tab, the phone also returned to the PIN screen.
- The post-action read-only canary status confirmed the exact three-profile cohort and `identity_users`-only boundary still matched the verified rollback anchor. The four later protected endpoints remained outside the active workflow boundary.
- `test_bht_shift_2` advanced from security version `1` to `2`; both of its stored sessions remained preserved as evidence but zero were active. The only active canary session after the test was the separate Test Supervisor session.
- A privacy-minimized read-only audit check found the supervisor `end_all_sessions` action with `allDevicesRevoked: true`, result security version `2`, and a completed cleanup record after one attempt with no recorded cleanup error. App Check was observed as absent, consistent with the current monitoring-only, non-enforced boundary.

### Remaining Identity/Users gates

- **Superseded by the newer RES entry above:** all-device revocation and the RES-side live admin-creation plus non-enrolled compatibility-login check have passed. The exact three-profile secure allowlist was not broadened; secure RES custom-token scope remains locally proven and receives live proof only in a later approved enrollment cohort.
- The rollback exercise remains a production-changing action that requires Mark's explicit approval immediately before it runs.

## 2026-08-29 — Non-enrolled compatibility reload regression corrected and passed live

### Live evidence and blocker

- With Mark's explicit approval, the valid synthetic non-enrolled OTC BHT completed the familiar compatibility PIN login and reached the correctly scoped BHT Home screen.
- Read-only production evidence confirmed the profile was not in the three-profile secure allowlist and had no stable secure identity mapping, secure device-session record, or active secure session.
- A normal same-tab reload returned that staff member to the PIN screen. This is a real compatibility regression, so the Identity/Users canary stopped and every later workflow plus the four private protected endpoints remained disabled.

### Local correction

- The secure bootstrap had treated every browser with no saved secure session as signed out. That incorrectly discarded a valid non-enrolled compatibility session after reload.
- Added an exact versioned compatibility-session marker only after a successful compatibility login. The bootstrap may restore the legacy session on reload only when that marker, a valid profile ID, and a recognized role are present; a secure-session user or malformed/unmarked browser record still fails closed.
- Preserved the marker when the existing compatibility scope refreshes. No PIN, token, secret, credential, or server security decision is stored in the marker.
- Extended the production-shaped compatibility browser gate to reload the page, remain on BHT Home, and recheck that no secure local session was created.

### Verification, Hosting release, and live evidence

- Focused compatibility model: 9 passed, 0 failed. Complete security-foundation pure suite: 86 passed, 0 failed.
- Node.js 22.23.2 Firestore/Auth/Functions emulator plus browser gate: 1 passed, 0 failed; Functions reported `Using node@22 from host`. The valid non-enrolled BHT survived reload with only the compatibility session and no secure local session.
- ESLint, normal production build, guarded `v3-enabled` canary build and independent marker verification, readiness artifact checks, `git diff --check`, and temporary-secret absence passed. Firebase CLI emitted its known updater-cache warning only after the browser test exited successfully.
- After explicit approval, created a temporary detached release worktree from freshly fetched `origin/Main` at `f067ccc` and applied only the three production source files plus the focused unit test. This prevented the broader unfinished security branch from entering the release.
- The clean release repeated 61 security tests, lint, guarded `v3-enabled` build, production-project-ID inspection, and the Node.js 22.23.2 compatibility login/reload browser gate. The deployed `dist/index.html` SHA-256 was `CC0C3D801B7453BD1041EDE7CBB5F6DE9948B89039488060AEE64A10FD52BE5B`; the live app loaded the matching `App-BH_gTpSZ.js` asset.
- Firebase Hosting-only deployment to `sprc-tx-l` completed successfully. No Function, Firestore/Storage rule, index, protected configuration, Auth-provider, workflow, endpoint, cohort, account, PIN, or production record update was included in the deployment.
- With Mark's explicit approval, the synthetic non-enrolled BHT logged in through the live compatibility path, reached the correctly scoped BHT Home, and remained on Home after a normal reload. A read-only backend check then confirmed the active profile still had no `staffAuthIdentities` mapping, zero `staffSessions` records, and zero active secure sessions.
- The compatibility gate is passed. With Mark's approval, focused commit `97139ef` was pushed, verified as one commit and 13 expected code/test/documentation files over `f067ccc`, opened as PR #12, and merged to case-sensitive `Main` as `1028347`. `origin/Main` now matches the deployed compatibility source.

## 2026-08-29 — Cross-workflow offline and App Check observation gates completed locally

### Purpose

Close the remaining local Stage 10 evidence gaps without changing production, broadening the live Identity/Users canary, opening the four protected endpoints, or enabling App Check enforcement.

### Local implementation outcome

- Replaced three duplicated offline-action allowlists with an auditable client catalog and an exported server catalog covering the same 11 supported actions: EOC submission; four debrief actions; issue report, feedback, and attachment upload; and transport create, update, and close.
- Added an exhaustive client/server contract matrix for every action. Each action proves its original profile owner, stable Firebase UID, device session, security version, location, expected record version, current-owner allowance, new-session reauthorization, wrong-owner/wrong-UID hold, and removed-location review behavior.
- Added a real secure-client browser/emulator persistence gate. It signs in through the custom-token path, queues all 11 actions, reloads while offline, reads them back from IndexedDB, proves their bindings and reconnect dispositions, and removes only the synthetic test records before reconnecting.
- Added a read-only App Check observation model and guarded `app-check-observe` canary-manager mode. It reports aggregate present/missing/malformed counts only for login, account/access, offline replay, transport, EOC, and issue protected callables; it exposes no staff/profile/document contents, refuses monitoring-only use if enforcement is active, and does not claim readiness when any endpoint group lacks a valid boolean sample.
- Made the EOC and issue callable test dependency injection match the other four security callables so App Check presence can be proved consistently in emulator tests. Runtime enforcement remains `false`.
- Extended the readiness verifier to require the offline matrix artifacts/commands and App Check observation gate.

### Verification evidence

- Declared Functions runtime: Node.js `22.23.2` used directly; Functions emulator reported `Using node@22 from host`.
- Full security-foundation pure suite: 83 passed, 0 failed.
- Firestore/Auth security emulator suite: 42 passed, 0 failed under Node.js `22.23.2`.
- Complete offline browser/emulator matrix: 1 applicable mobile journey passed. All 11 actions survived offline reload with the approved owner/session/location safeguards.
- Production build: passed; 1,913 Vite modules transformed.
- ESLint, syntax checks, all 21 tracked Markdown-file links, `git diff --check`, and temporary-secret absence: passed.
- Readiness verifier: `localDormantImplementationReady: true`, `runtimeParity: true`, `completeOfflineReconnectMatrixPresent: true`, and `appCheckReadOnlyObservationGatePresent: true`; `productionReleaseReady: false` remains intentional.
- The Firebase emulator product test exited successfully. Firebase CLI then emitted its known local updater-cache permission warning; that post-test warning does not change the passing browser result.
- The first browser harness iteration revealed a test-only missing `house` override in the removed-scope fixture; that assertion was corrected. A separate Windows web-server teardown hang was eliminated by running Vite through Playwright global setup/teardown. The final counted run exited Playwright successfully before emulator shutdown.
- No production read/write, account/session/PIN action, deployment, protected endpoint opening, workflow/cohort activation, App Check key/enforcement change, commit, push, or merge occurred. The temporary emulator-only secret was removed.

### Remaining gate

- Actual App Check production observation requires a separately approved monitoring-ready client build/key and real samples from each protected endpoint group. The new command is prepared but was not run against production.
- Live work remains at the incomplete Identity/Users canary: Test BHT/compatibility/RES/device-session/rollback evidence must pass before any later workflow is activated.

### Additional Identity/Users live-canary rehearsal

- Added a secure admin browser journey for the exact RES gap Mark identified. In the emulator, the admin created one active RES BHT through the normal Users form without a house assignment, selected a valid RES shift and van, and the new staff member then signed in through the server PIN/custom-token path with only `RES`/`res` profile and token scope.
- The cumulative secure client/account browser suite now exits cleanly through shared Playwright/Vite setup and reported 11 applicable journeys passed with 16 intentional duplicate-viewport skips. This includes familiar self-PIN change, supervisor reset/end-all-sessions, scoped supervisor creation, secure RES admin creation/login, reload/offline/tabs, independent devices, invalid PIN, and live revocation response.
- Added a separate production-canary-shaped browser gate with only one enrolled profile. A valid non-enrolled RES BHT successfully used the unchanged compatibility path, retained its legacy session, created no `sprc_staff_session_v3` record, and received no stable `profileId`, device `sessionId`, or version-6 workflow claims. The emulator's existing Anonymous Auth support supplied only the temporary compatibility identity; it was not used as the secure foundation.
- The compatibility gate reported 1 passed, 0 failed. The complete 11-action offline gate was rerun after consolidating all focused browser servers into one clean global setup/teardown helper and again reported 1 passed, 0 failed.
- Added a privacy-minimized, read-only `identity-status` mode. It requires an exact external rollback path and SHA-256 before reading the protected cohort, and returns only the approved synthetic profile IDs, roles, validity/security-version state, mapping booleans, and aggregate session counts. It cannot create backups or write Firebase.
- Verified all three existing rollback files directly. Their calculated SHA-256 values match the recorded pre-release, post-release, and `templates_photos` stage-preview evidence: `f6c8b730d2a79f85ad0129700c878cc56dc331909f0e64c605d58150b119f0ff`, `1fe1665e4809cd231845aee8dfd7e2c712ac9d941c50bc0d06cd8d970e6d7718`, and `bce10d208cfba8aa68a9c8a347cbee63cb8a1f1618f61ab8a691c3b7612f5b42`.
- Ran `identity-status` against production with the verified post-release snapshot. It confirmed the exact three-profile cohort, only `identity_users`, valid versioned foundation/workflow boundaries, offline replay disabled, and an exact current-configuration match to the rollback anchor. All three synthetic profiles are valid. `test_supervisor` is mapped with one active session; `test_bht_shift_1` and `test_bht_shift_2` remain unmapped with zero sessions and security version `0`, proving their first secure PIN logins are the next live action rather than a data/configuration repair.
- Full security-foundation pure suite after the status gate: 85 passed, 0 failed. ESLint and Node 22 readiness passed; `identityReadOnlyStatusGatePresent: true`, `localDormantImplementationReady: true`, and `productionReleaseReady: false`.
- No production account was created and no live PIN, profile, session, provider, configuration, endpoint, workflow, deployment, or data changed. Temporary emulator secret material was removed.

## 2026-08-29 — Guarded later-workflow canary transitions prepared locally

### Purpose

Prepare the remaining production workflow stages while the live Identity/Users canary awaits Test BHT, compatibility, RES, session, and rollback checks. Do not activate or broaden production.

### Local implementation outcome

- Added a pure stage model with the approved cumulative order: `identity_users`, `templates_photos`, `eoc`, `debriefs_alerts`, `issues_feedback_audit`, `transports`, `operations_admin`, and `settings`.
- Extended the existing guarded canary manager with separate `stage-preview`, `stage-advance`, and `stage-rollback` modes. The original first-activation mode remains restricted to an absent configuration and is not reused.
- A stage preview requires the exact active release and three-profile cohort, refuses malformed configuration, refuses skipped/repeated stages, and creates a verified rollback backup outside the repository.
- Each preview now names the exact currently private protected endpoint(s) required by its target stage: offline replay plus protected EOC submission for `eoc`, protected issue mutation for `issues_feedback_audit`, and protected transport creation for `transports`. Stages with no new private endpoint report an empty list.
- Stage advance and rollback require the exact stage backup path and SHA-256 checksum, release ID, and confirmation phrase. Both end active canary device sessions, write immutable audit evidence, and revoke mapped Firebase refresh tokens so old workflow claims cannot persist. Refresh-token cleanup retries three times; remaining sanitized failures are audited and fail closed.
- The transition to `eoc` is the first stage that also enables the existing versioned owner-bound offline-replay flag. The tool does not change network access, deploy code, enable App Check enforcement, expand staff enrollment, or retire compatibility behavior.
- Updated the security canary runbook and README so the documented release sequence matches the implemented guardrails.

### Verification evidence

- Canary stage model: 6 passed, 0 failed.
- Full security-foundation unit suite after integration: 66 passed, 0 failed.
- `node --check scripts/manageSecurityFoundationCanary.js`: passed.
- The stage-transition tests and readiness verifier also passed under the declared Node.js `22.23.2` runtime; `runtimeParity: true` and `guardedStageTransitionPresent: true`.
- ESLint: passed.
- Ran the new `templates_photos` stage preview against production as a read-only configuration/profile check. It confirmed the current stage is exactly `identity_users`, all three approved Test House profiles are still valid, the next cumulative workflow list would be `identity_users` plus `templates_photos`, and no foundation flag changes are part of that transition.
- Saved and independently verified rollback snapshot `C:\Users\markv\Documents\Codex\SPRC-release-backups\sprc-security-canary-2026-08-29T21-54-56-845Z.json`; SHA-256 `bce10d208cfba8aa68a9c8a347cbee63cb8a1f1618f61ab8a691c3b7612f5b42`. Its metadata records previous stage `identity_users`, target stage `templates_photos`, one current workflow, and three enabled profiles.
- Added a cumulative `templates_photos` browser/emulator seed and focused Playwright gate. It uses the same stable secure PIN/custom-token login, a synthetic shared template, and a synthetic Test House EOC submission.
- The first focused run used a mismatched emulator project ID and correctly rejected both PINs against the empty project. The next aligned run exposed a second harness flaw: the new browser configs had not compiled the secure client boundary and therefore exercised compatibility login. That result was invalidated and is not counted as secure evidence.
- Added one shared security E2E server launcher that always compiles `VITE_ENABLE_SECURITY_BOOTSTRAP_V3=true`, updated all security browser configs to use it, and added an explicit browser assertion that the secure client is compiled before entering a PIN. The corrected `templates_photos` rerun invoked `beginStaffPinSessionV2`; two applicable secure journeys passed and four duplicate viewports were skipped. The secure supervisor loaded the shared template library while still seeing no out-of-scope RES BHT, and the secure BHT uploaded an authorized Test House EOC response photo while a wrong-location upload failed with permission denied.
- Added the cumulative `eoc` browser/emulator gate. One applicable phone journey passed and two duplicate viewports were skipped. It proved owner/Firebase/session/location-bound offline replay authorization, wrong-owner denial, protected EOC submission through `submitProtectedEocV9`, idempotent retry, completed task state, sanitized original-owner submission identity, and retained offline authorization evidence.
- Added the cumulative `debriefs_alerts` browser/emulator gate. It revealed and corrected two strict-mode query gaps before any production activation: the supervisor alert listener requested every location and filtered in React, and the supervisor Debriefs panel did the same. Both now issue exact backend-scoped location queries while admins retain the approved global view.
- Tightened strict Firestore debrief listing so a supervisor list is authorized only for documents in the signed current location scope. Optimized the strict alert read path to validate the current server device session once and then apply signed role/profile/location claims, avoiding Firestore's expression ceiling without weakening legacy compatibility behavior.
- The corrected Stage 6 browser run invoked `beginStaffPinSessionV2` for every applicable role and reported 4 applicable journeys passed with 8 intentional duplicate-viewport skips: outgoing correction, same-house wrong-owner denial, assigned incoming signoff plus targeted-alert acknowledgment, and OTC supervisor Test House visibility with no RES exposure or listener permission errors.
- A completion audit found that the first Stage 6 gate had not yet directly exercised the already-approved reassignment, late-handoff, and stale offline-confirmation paths. Added separate synthetic records and expanded the same cumulative gate without changing the staff-facing debrief flow.
- The expanded Stage 6 gate exposed two strict-mode defects before production activation: the incoming-shift assignment list exceeded Firestore's expression budget, and supervisor reassignment could not read the old location-scoped BHT alert it needed to retire. The assignment rule now evaluates one current secure-session claim path, and the old-alert query includes the exact debrief location. Supervisors may read targeted BHT alerts only inside their signed location scope for this operational correction; admins retain global review and BHTs retain only their own targeted alerts.
- The final expanded Stage 6 browser run reported 7 applicable journeys passed with 14 intentional duplicate-viewport skips across phone, tablet, and desktop. It proved eligible reassignment with reason/version/reset behavior, late status plus scoped late alert, and a stale owner-bound offline confirmation becoming `needsReview`, in addition to the original four journeys. The 40-case Firestore rules suite passed with new location-scoped supervisor assignment/BHT-alert query positives and wrong-location/broad-query negatives; 68 security contracts, 14 debrief models, ESLint, and the production build also passed.
- Added the cumulative `issues_feedback_audit` seed/config/browser gate. The corrected run reported 4 applicable secure-client journeys passed with 8 intentional duplicate-viewport skips. It invoked `mutateProtectedIssueV9` for deterministic/idempotent BHT reporting, original-reporter resolution submission, scoped supervisor approval, and wrong-location denials; it separately proved BHT-owned app feedback and admin-only feedback/audit visibility without rendering PIN/hash/secret fields.
- Added the cumulative `transports` seed/config/browser gate. It found and corrected a strict-mode read gap before production activation: supervisors requested all transport sites and filtered in React, while the strict rule allowed every signed workflow role to read every transport. The listener now queries each authorized backend site, and strict rules limit BHT/tech reads to their own records, supervisors to signed authorized sites, and admins to the approved global view.
- The corrected transport run reported 4 applicable secure-client journeys passed with 8 intentional duplicate-viewport skips: two independent devices signed in as the same BHT produced exactly one active transport plus one safe conflict; wrong-site creation was denied; the OTC supervisor loaded only Test House/OTC transports with no RES exposure or listener error; and admin retained the all-site view.
- Added the cumulative `operations_admin` gate after finding broad client-side filtering in Properties, Fleet, Compliance, Cintas, the dashboard compliance summary, and fleet summary listeners. All strict supervisor listeners now issue backend `mainLocation`, `site`, or exact location queries. Strict rules use the signed current session scope, not an editable browser profile or a separate database-profile fallback.
- The corrected operations run reported 3 applicable secure-client journeys passed with 6 intentional duplicate-viewport skips. The OTC supervisor loaded all four operations screens without RES exposure or listener errors, created an authorized OTC property, and was denied an RES write; a BHT was denied the supervisor collection; admin retained both sites. The first browser probe used an unresolved bare package import and was invalidated; the corrected test-only Vite probe rerun is the counted evidence.
- Added and passed the cumulative `settings` gate: 3 applicable secure-client journeys passed with 6 intentional duplicate-viewport skips. BHT and supervisor read the existing runtime settings and could not write them; admin could update an ordinary setting but could not write the protected foundation, workflow-rollout, or App Check boundary documents.
- Added a read-only operations-data preflight to both `operations_admin` preview/advance and the following `settings` preview/advance. It audits nine collections for exact OTC/RES location metadata and valid employee/location compliance types, reports only aggregate counts, and fails closed before activation. Corrections are deliberately outside the tool and require a separately approved backup/migration. Two new pure contracts passed for valid and malformed/legacy data.
- The corrected Functions emulator loaded all current callables under Node.js `22.23.2`. App Check verification reported `MISSING` as expected because monitoring remains non-enforcing. The Windows Playwright/Firebase wrappers were interrupted only after every applicable case reported `ok`; the temporary emulator-only secret was then removed.
- Current Storage rules: 4 passed, 0 failed, including the live-session-bound `templates_photos` file path. Current Firestore rules: 40 passed, 0 failed, including published-template read/browser-write denial, private supervisor drafts, EOC photo metadata scope, current-session workflow claims, strict protected-mutation boundaries, scoped debrief/alert/transport/operations queries, and settings read/write negatives.
- Final local closeout reran the complete 68-test security-foundation unit suite, 42-test Firestore/Auth security emulator, 40-test Firestore rules suite, 10-test Functions emulator, 4-test Storage rules suite, ESLint, and production build successfully. Functions loaded under Node.js `22.23.2`. The readiness verifier reported `localDormantImplementationReady: true`, `runtimeParity: true`, every focused browser-command/artifact check true, and `productionReleaseReady: false` because production approval and activation remain intentionally absent. The later Stage 6 completion audit reran its changed 40-rule, 68-security, 14-debrief, lint, and build gates successfully. JSON parsing, script syntax, Markdown links, `git diff --check`, and temporary-secret absence also passed.
- Firebase CLI emitted its local update-check permissions warning after each emulator test process had already exited successfully. This is a workstation CLI-cache nuisance, not a failed rule assertion; the exact passing test counts above were preserved.
- No Firebase configuration, session, PIN, account, Auth provider, IAM, deployment, or workflow gate changed. The preview only read current protected state and wrote the external rollback snapshot.

## 2026-08-29 — Corrected Identity/Users release deployed; live canary verification in progress

### Release outcome

- Pushed `codex/security-foundation-completion`, opened PR #9, verified its base `44b6e44`, head `696e3ae`, exact 17-file change set, and mergeability, then merged it to case-sensitive `Main` as `e3f5577`.
- Captured a verified pre-release configuration backup at `C:\Users\markv\Documents\Codex\SPRC-release-backups\sprc-security-canary-2026-08-29T20-09-45-087Z.json`; SHA-256 `f6c8b730d2a79f85ad0129700c878cc56dc331909f0e64c605d58150b119f0ff`.
- Rebuilt Hosting with `npm run build:security-canary`, independently verified the `v3-enabled` marker, and verified the compiled assets target production project `sprc-tx-l`.
- Deployed only `manageStaffSecurityV4`, Firestore rules, and Hosting as one Firebase CLI release. Rules compiled successfully; the reported warnings were existing unused-helper/name warnings, not rule errors. The Function update, rules release, Hosting finalization, and Hosting release all completed successfully.

### Post-release evidence

- Live Hosting at `https://sprc-tx-l.web.app` reports `sprc-security-bootstrap=v3-enabled`; a fresh reload displayed the familiar six-digit PIN screen with no browser console errors.
- `manageStaffSecurityV4` runs on Node.js 22 under `sprc-security-runtime@sprc-tx-l.iam.gserviceaccount.com` with new deployed hash `386f1d122c3e3a6c0583842a47...`. `beginStaffPinSessionV2` retains the same dedicated runtime identity.
- Unauthenticated probes reached `beginStaffPinSessionV2` and `manageStaffSecurityV4` and returned application-level HTTP 400. `authorizeOfflineReplayV5`, `createProtectedTransportV6`, `submitProtectedEocV9`, and `mutateProtectedIssueV9` each remained network-private with HTTP 403.
- Live configuration readback remained unchanged: exactly `test_supervisor`, `test_bht_shift_1`, and `test_bht_shift_2`; only `identity_users`; offline replay disabled; release `security-foundation-test-house-v1`.
- Captured a verified post-release configuration backup at `C:\Users\markv\Documents\Codex\SPRC-release-backups\sprc-security-canary-2026-08-29T20-15-06-151Z.json`; SHA-256 `1fe1665e4809cd231845aee8dfd7e2c712ac9d941c50bc0d06cd8d970e6d7718`.
- The separate Google Cloud CLI session could not refresh non-interactively, so a fresh Authentication-provider readback was not obtained. Firebase CLI deployment authority remained valid, and no Auth provider/configuration change was requested or performed.

### Live Test Supervisor canary evidence

- Merged the deployment-evidence documentation through PR #10, then signed in through the familiar six-digit PIN screen as `test_supervisor`. The secure session survived a full page reload and a second same-device tab.
- The live EOC page loaded its shared templates without a permission error. The live Users page loaded only the supervisor's OTC scope: five OTC BHT/tech profiles before the synthetic account check, with no supervisor, admin, or RES profile exposed.
- The supervisor Add User form exposed only the BHT role and OTC location, matching the approved existing supervisor workflow. It did not offer supervisor/admin roles or RES.
- The first live Generate secure PIN attempt correctly exposed a release defect: secure supervisors were still making a browser-side duplicate-PIN query that strict rules denied. No account was created by that failed attempt.
- Corrected `SupervisorDashboard` so a secure-session supervisor generates the candidate PIN locally and lets the protected server action remain authoritative for uniqueness; the legacy compatibility path keeps its existing duplicate check. Updated the protected browser test to use the real Generate secure PIN control.
- Verified the correction with lint, 60 passing security-foundation tests, a guarded secure build/marker check, diff checks, and the focused Firestore/Auth/Functions emulator browser journey for in-location supervisor BHT creation. The temporary emulator-only secret was removed afterward.
- Merged the fix through PR #11 as `f067ccc`, deployed Hosting only, and reverified the live `v3-enabled` marker and persistent Test Supervisor session. No Function, rule, configuration, provider, workflow, or cohort change accompanied this Hosting correction.
- With Mark's explicit approval, the live OTC supervisor created synthetic profile `security_canary_otc_bht` as an active OTC BHT assigned to Test House, 1st Shift, and Test Van. The Users page increased from five to six OTC BHTs. A read-only edit review showed only BHT and OTC remained available to this supervisor.
- The new OTC profile is intentionally outside the three-profile secure allowlist. Its future login is therefore the required non-enrolled compatibility check, not a secure BHT canary login.
- A later read-only recheck in Mark's still-authenticated Test Supervisor browser session reconfirmed the live boundary: the Users page showed exactly six OTC BHT profiles, including both Test House BHTs and the synthetic compatibility profile, with no RES/supervisor/admin profile exposed; the supervisor-facing `+ Add New User` control remained available. Direct navigation to the live EOC page loaded four shared templates and produced no captured browser-console permission error. No button that mutates data was used during this recheck.

### Live Test BHT canary evidence

- With Mark's explicit approval, the current Test Supervisor device session was ended and each existing Test House BHT signed in through the familiar six-digit PIN screen. No PIN was changed, reset, disclosed in documentation, or bypassed.
- `test_bht_shift_1` completed its intended first-login migration: the protected status readback showed one stable identity mapping, security version `1`, and one active device-session record. The browser's first handoff returned the generic retry message after the server had completed that migration; one controlled retry reused the same profile/device session path and succeeded. This did not repeat for Shift 2 and is retained as canary evidence rather than treated as a proven code defect.
- Shift 1 displayed only the BHT Home navigation and the exact `Test House - 1st Shift - Test Van` assignment. A full page reload restored the same secure session and assignment without another login prompt.
- `test_bht_shift_2` signed in successfully on its first submitted PIN. It displayed only the BHT Home navigation and the exact `Test House - 2nd Shift - Test Van` assignment, including its current Test House EOC task cards. A full page reload restored the same secure session and assignment without another login prompt or new console warning.
- Ordinary logout ended only the active browser device session before switching canary identities. Firestore briefly logged stale-listener permission warnings during two logout/login handoffs, then the intended session and assignment loaded; neither warning repeated after reload. This cleanup noise remains observable evidence and must not be represented as a failed role/location boundary.
- The post-journey read-only production status check retained the exact three-profile cohort, `identity_users` as the only enabled workflow, the matching rollback anchor, and no missing profiles or mappings. It reported exactly three per-profile device-session records: Shift 2 active in the current browser, with Shift 1 and Test Supervisor inactive after their approved ordinary logouts.
- Mark then signed Shift 2 into a separate physical phone while the computer browser remained signed in. Read-only backend evidence showed four total canary session records and exactly two active Shift 2 device sessions, proving one stable staff identity can hold independent simultaneous sessions.
- With Mark's immediate approval, the computer used the ordinary Sign Out control. The computer returned to the PIN screen; the next read-only backend check showed the same four total records but only one active Shift 2 session. The computer record closed and the phone record remained active, proving ordinary logout is device-specific rather than an all-device revocation.
- Mark refreshed the phone after the computer logout and confirmed it returned directly to the Shift 2 Home screen without another PIN prompt. This is the staff-facing proof that the surviving device remains usable, not only a backend session-count observation.
- Node.js 22.23.2 verification after the live observation passed all 42 Auth/Firestore security-emulator contracts, all 85 focused security contracts, all 10 Functions emulator contracts, ESLint, and the guarded `v3-enabled` Hosting build. Firebase CLI again emitted only its known updater-cache warning after each emulator product script had exited successfully.

### Remaining Stage 3 gate

- **Superseded by the newer 2026-08-29 entry above:** the non-enrolled synthetic OTC compatibility login/reload gate is now complete. Source reconciliation, all-device revocation, approved synthetic RES account actions, and final rollback proof remain required. Both enrolled Test BHT secure-login/reload/scope journeys and independent two-device/one-device-logout behavior are complete.
- A synthetic RES BHT should be created through the same normal scoped UI flow, but the current session is an OTC supervisor and is correctly unable to create RES users. That check is deferred until Mark can provide an admin or RES-authorized supervisor session; do not bypass this boundary through a production script.
- At this checkpoint, no PIN reset, deactivation, session ending, protected configuration change, broader profile enrollment, later workflow activation, or RES production-data change had occurred. The only production profile created was the explicitly approved synthetic OTC BHT described above. The newer entry records the later Hosting-only compatibility correction and read-only live proof.

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
