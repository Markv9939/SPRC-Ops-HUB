# Security Foundation Canary and Rollback Gate

Last updated: 2026-08-31
Status: Exact three-profile cumulative canary complete through Settings; first Lone Mountain account passed two-device/logout checks, real-phone offline shell correction verified locally and awaiting release/retest

## Current completed-canary boundary

- Cohort: exactly `test_supervisor`, `test_bht_shift_1`, and `test_bht_shift_2`.
- Cumulative workflows: `identity_users`, `templates_photos`, `eoc`, `debriefs_alerts`, `issues_feedback_audit`, `transports`, `operations_admin`, and `settings`.
- Offline replay: enabled only inside the current mapped-session/workflow boundary.
- Network-reachable protected workflow callables: `authorizeOfflineReplayV5`, `submitProtectedEocV9`, `mutateProtectedIssueV9`, and `createProtectedTransportV6`. Network reachability does not grant access; each Function still requires its application-level current-session, signed-workflow, role/location, owner, and version checks.
- Final coordinated rollback snapshot: `C:\Users\markv\Documents\Codex\SPRC-release-backups\sprc-security-canary-2026-08-30T17-40-46-357Z.json`, SHA-256 `77c264534fab063f5aa6861c8f913b398c2a8f29b09b6ca495a5eb54b70a56da`.
- Every cumulative stage completed a guarded rollback and reactivation. The final reactivation revoked prior canary sessions so the next canary login receives only current claims.
- App Check remains monitoring-only and unenforced. The completed 24-hour aggregate contains all six protected endpoint groups across 63 samples, all with token absence recorded. This is sufficient monitoring evidence but is not approval or proof for enforcement.
- Non-canary staff remain on compatibility login. Global strict authorization, Anonymous Authentication as a shortcut, broad enrollment, and compatibility retirement remain off.

## Real-staff rollout stages

The synthetic canary tool remains fixed to its three test profiles. Do not repurpose it for staff. Real-staff cohorts use the separate `security:staff-rollout` command and always keep `rolloutState: production_canary`, the full tested workflow list, compatibility fallback for non-enrolled profiles, global strict authorization off, and App Check enforcement off.

1. **Choose one exact location and BHT/tech group.** Run the read-only candidate report. It returns only matching staff names/IDs plus readiness reasons; it makes no writes. Start with the smallest operational house cohort and never include more than 12 profiles.
2. **Preview the exact profile list.** Preview rechecks active status, the single-home-location contract, unique server or safely migratable legacy PIN storage, identity mapping integrity, current synthetic-canary configuration, full workflow coverage, strict-auth off, and App Check enforcement off. It writes a privacy-minimized rollback file outside the repository and prints its SHA-256 checksum and exact enrollment phrase.
3. **Review before production mutation.** Confirm the selected staff are available to sign in with their existing PINs, no one is depending on unsynced work on another person's device, the rollback file is retained, and the current configuration/profile hashes have not changed. Do not reset a PIN or log in as staff.
4. **Enroll only the exact approved IDs.** The guarded transaction adds those IDs to both protected allowlists, increments each target security version, and writes immutable rollout evidence. Cleanup then closes every old target device session and revokes mapped Firebase refresh tokens. A failed cleanup leaves the version cutoff active and can be retried with the same backup; it never broadens the cohort on retry.
5. **Prove live behavior.** Staff use the unchanged six-digit PIN. Verify secure login and browser-close/reopen persistence, phone and desktop, two independent devices, one-device logout, offline/reconnect with original-owner work, every BHT workflow used at that location, supervisor location scope, and negative access to Users/admin/global settings. Observe one complete working shift with no unexplained permission, sync, or scope errors.
6. **Exercise cohort rollback and re-enrollment.** The exact backup removes only that cohort from both allowlists, increments target security versions again, closes all target sessions, revokes refresh tokens, records audit evidence, and returns those staff to compatibility PIN login without deleting identity, PIN credential, offline, session, or audit history. Re-preview before re-enrollment; never reuse a stale backup for a different cohort.
7. **Advance one cohort at a time.** Record exact evidence in the Master Plan and Progress Log. Do not begin another location until the current location passes observation and rollback/re-enrollment. Compatibility retirement is still a later separate release after all active staff cohorts are stable.

Read-only candidate discovery:

`npm run security:staff-rollout -- --mode=candidates --project=sprc-tx-l --location=<exact-location-id>`

Exact-cohort preview:

`npm run security:staff-rollout -- --mode=preview --project=sprc-tx-l --location=<exact-location-id> --profile-ids=<comma-separated-profile-ids> --backup-dir=<absolute-path-outside-repo>`

The preview prints the exact `enroll`, `status`, and `rollback` arguments. Never guess a confirmation phrase, hand-edit the protected allowlists, or use a backup for a different location/profile set.

### First real cohort

- Exact location: `lone_mountain`.
- Exact profiles: the three approved Lone Mountain BHT profiles. Their identifiers remain only in the protected external rollback/audit evidence.
- Corrected read-only production preflight: all three are active BHTs, each has one Lone Mountain home location, each has a unique legacy PIN hash ready for normal first secure-login migration, none has a conflicting identity mapping, and none is already enrolled. Mesquite, RES, and Test House currently contain no eligible real BHT cohort; known synthetic/test profiles are explicitly blocked from staff rollout selection.
- Released guard: PR #14, merge `0fe3be2`.
- Fresh external preview/rollback file: retained outside the repository with its checksum and exact cohort identifiers in protected evidence.
- Enrollment confirmation and audit: retained with exact version, session, cleanup, and cohort details in protected external evidence.
- Immediate post-enrollment boundary: guarded readback confirmed only the approved cohort changed. Global strict authorization and App Check enforcement remained off, and no PIN was changed.
- First live account: the first approved Lone Mountain BHT established its mapped secure session. Existing-PIN login, current assignment scope, reload persistence, desktop and 390×844 layout, existing House EOC, existing transport, issue form, debrief editor, and direct Users-page denial passed with no new correct-session permission error and no operational submission. A real phone then established an independent second session; phone-only logout closed only that session while the browser remained active, and phone re-login established a fresh independent session. Exact identity/session records remain in protected external evidence.
- Real-phone offline gate: a cold close/reopen with both phone network paths disabled produced a blank white screen. Local `sprc-ops-shell-v12` now precaches the complete built module graph through a root asset manifest and uses a URL-only cache fallback after network failure. The actual production bundle passed the matching phone cold-start test, and the existing 11-action secure offline matrix remained green. The correction is not deployed; broader rollout stays paused.
- Still required before cohort closeout: review/merge and Hosting-only release of the offline-shell correction, a passing real-phone offline/reconnect retest, first secure login for the remaining two approved profiles, one complete working shift observation, and the controlled rollback/re-enrollment proof.

## Historical Identity/Users re-release checkpoint

The original Test House canary has already been activated for exactly `test_supervisor`, `test_bht_shift_1`, and `test_bht_shift_2`, with only `identity_users` enabled. The corrected release is merged through `1028347`; it remains an **Identity/Users code re-release**, not a first activation:

**Superseded checkpoint:** At this point in the rollout, the guarded `templates_photos` rollback/reactivation had completed and EOC network reachability was the next gate. The current completed-canary boundary above supersedes this historical stage state.

1. Use merged production source `1028347`; `e3f5577` contains the coordinated Identity/Users correction, `f067ccc` adds the secure supervisor PIN-generator fix, and `1028347` reconciles the compatibility-reload correction.
2. Read back and back up the current deployed Functions, Firestore rules/indexes, Hosting release, Auth/provider state, and both protected configuration documents before changing anything.
3. Confirm the protected configuration still names only the same three profiles and only `identity_users`. Do not rewrite or broaden it as part of the code release.
4. Deploy the reviewed Functions, Firestore rules, and Hosting bundle as one coordinated set. Build Hosting only with `npm run build:security-canary`, then require `npm run verify:security-canary-build` to pass before deployment.
5. Keep `authorizeOfflineReplayV5`, `createProtectedTransportV6`, `submitProtectedEocV9`, and `mutateProtectedIssueV9` network-private and disabled.
6. Test Supervisor secure login, reload, EOC loading, OTC-only Users scope, approved OTC BHT creation, both Test BHT secure-login/reload/scope journeys, independent two-device use, one-device logout, supervisor all-device revocation, and admin-created RES BHT scope/login/negative-access behavior have passed. The revocation advanced the target BHT's security version, left both stored sessions inactive, returned both devices to the PIN screen, and recorded a completed audit/cleanup trail. The RES BHT remained outside secure enrollment, retained only RES/Day/Van 3 scope across reload, and was redirected away from Users. Obtain Mark's explicit approval immediately before any remaining live PIN reset, account creation/deactivation, session ending, or other production-data mutation.
7. The valid non-enrolled synthetic BHT correctly stayed outside secure identity/session enrollment, but the prior client returned to the PIN screen on reload. The narrow versioned compatibility marker/restore correction passed the Node 22 production-shaped emulator/browser gate, was deployed Hosting-only from an isolated `f067ccc` release worktree, passed the live login/reload check, and was merged through `1028347`. Read-only production evidence confirmed no secure identity mapping and zero secure sessions for that profile.
8. The existing release evidence records two completed rollback/reactivation drills for this exact release and cohort. A later privacy-minimized production audit readback directly confirmed the immutable activation/rollback/activation/rollback/activation sequence. Current configuration still exactly matches the verified rollback anchor, and the separate two-device cutoff test proves live revocation. Identity/Users is therefore complete; do not repeat the disruptive production rollback merely to duplicate this evidence.

The production-shaped emulator rehearsals are now executable as `npm run test:security-client:emulator` and `npm run test:security-compatibility:emulator` inside the Node 22 Firebase emulator wrapper. They prove the secure RES admin-create/BHT-login path and that a valid non-enrolled staff member retains only the existing compatibility session, not a stable secure identity/session/workflow claim. These local results do not replace the live canary.

Before resuming the live browser journey, run the read-only status check with the current verified rollback snapshot and its exact SHA-256:

`npm run security:canary -- --mode=identity-status --project=sprc-tx-l --backup=<absolute verified backup path> --backup-sha256=<exact SHA-256>`

This mode performs no writes. It fails closed if the exact three-profile cohort is missing, and it reports only synthetic profile role/validity/mapping state plus session counts. A missing Test BHT mapping is expected before that BHT's first secure login; it identifies the next live journey and must not be repaired through a script.

The guarded `security:canary` **activate** mode was designed for the original absent-configuration baseline and must not be reused for this already-active re-release. Its preview output may be used only as read-only evidence plus a verified backup; no activation or rollback command may run without confirming that its assumptions match current production state.

## Before any canary

1. Review the isolated branch and the exact baseline/rollback commits.
2. Run the complete local test matrix with the declared Node.js 22 runtime.
3. Back up the current Firebase rules, Functions, Hosting release, indexes, Auth/provider settings, and the protected configuration documents without changing them.
4. Select synthetic or explicitly approved canary staff and locations. Never silently enroll real staff.
   The first approved cohort is exactly `test_supervisor`, `test_bht_shift_1`, and `test_bht_shift_2`. Production configuration must use `rolloutState: production_canary` plus this exact `enabledProfileIds` allowlist. A valid non-enrolled PIN stays on the unchanged compatibility login and creates no secure identity/session artifacts.
5. Start with the identity/users workflow and protected account actions for every canary staff member and manager. Do not let a legacy profile edit bypass the required session revocation while another workflow trusts the secure session.
   Only `beginStaffPinSessionV2` and `manageStaffSecurityV4` are reachable for this first canary. Protected offline replay, transport creation, EOC submission, and issue mutation remain private and disabled until their own workflow canaries.
6. Include temporary backup-access creation/revocation/expiry and issue-access changes. Confirm each scope change signs out every affected device and the next PIN login receives only the exact current scope.
7. Enable only one named workflow for the canary. Do not flip global strict auth.
8. End the canary users' existing sessions so their next PIN login receives the exact current workflow claims.

For the original first activation, `npm run security:canary -- --mode=preview --project=sprc-tx-l --backup-dir=<absolute path outside the repo>` captured the protected settings. For any re-release, capture a fresh coordinated rollback package and compare it with live readback, but do not use the original absent-baseline activation mode. The guarded mutation and rollback modes require the verified backup, exact release ID, and exact confirmation phrase; verify their current-state assumptions before use.

## Advancing later workflow stages

The local canary tool now supports later stages without reusing the original absent-baseline activation mode:

1. Run `stage-preview` for exactly the next approved stage. It validates the exact three-profile cohort, confirms the current workflow list is the approved cumulative prefix, names any protected endpoint that must be opened for that stage, and writes a verified rollback backup outside the repository.
2. Review the preview and finish the stage's coordinated Functions/rules/Storage/Hosting preparation. Do not advance the configuration until the prior stage has passed and Mark has approved the production action.
3. Run `stage-advance` with the exact preview backup path and SHA-256 checksum, release ID, target stage, and confirmation phrase. The command refuses skipped or repeated stages, ends every active canary device session, records immutable audit evidence, and revokes Firebase refresh tokens so the next PIN login receives only the new cumulative claims.
4. If the stage fails, run `stage-rollback` with the same exact backup path/checksum and target stage. It restores both protected configuration documents, ends active canary sessions again, records immutable rollback evidence, and revokes refresh tokens.
5. Any refresh-token cleanup failure is recorded without secret data and causes the command to fail closed for investigation.

The only valid order is `identity_users`, `templates_photos`, `eoc`, `debriefs_alerts`, `issues_feedback_audit`, `transports`, `operations_admin`, then `settings`. `eoc` requires `authorizeOfflineReplayV5` and `submitProtectedEocV9`; `issues_feedback_audit` requires `mutateProtectedIssueV9`; `transports` requires `createProtectedTransportV6`. Advancing to `eoc` also enables the versioned owner-bound offline-replay gate. Required endpoint access must already be part of that stage's reviewed coordinated release, and rollback must restore the prior endpoint access boundary. App Check remains monitoring-only and is not activated by this command.

Before proposing the `debriefs_alerts` production stage, run the cumulative Node 22 emulator/seed wrapper around `npm run test:security-debriefs-alerts:browser`. The gate must prove outgoing corrections, wrong-owner denial, assigned incoming acknowledgment, only-the-matching targeted alert acknowledgment, eligible incoming-shift reassignment with a required reason, visible late-handoff status/alert, stale offline confirmation held for review, supervisor location-scoped debrief/alert/assignment queries, and the matching Firestore query negatives. A client-side location filter is not sufficient evidence.

Before proposing `issues_feedback_audit`, run the cumulative Node 22 emulator/seed wrapper around `npm run test:security-issues-feedback-audit:browser` plus the protected operational-mutation emulator contracts. Require protected issue reporting/replay, BHT resolution submission, supervisor approve/return authority, wrong-location denials, staff-owned feedback, admin-only audit/feedback review, sanitized evidence, and rollback of `mutateProtectedIssueV9` network access with the workflow stage.

Before proposing `transports`, run the cumulative Node 22 emulator/seed wrapper around `npm run test:security-transports:browser` plus the transport security contracts. Require a two-device same-BHT creation race with exactly one active transport, wrong-site denial, BHT owner-only reads, supervisor backend site-scoped listeners, admin all-site visibility, exact-version correction/replay behavior, and coordinated rollback of `createProtectedTransportV6` network access with the workflow stage.

Before proposing `operations_admin`, run the cumulative Node 22 emulator/seed wrapper around `npm run test:security-operations-admin:browser`. Require backend-scoped supervisor queries and wrong-location denials across Properties, Fleet, Compliance, and Cintas; a BHT negative; admin global visibility; and indexes for every field-plus-sort query. The guarded `stage-preview` and `stage-advance` commands read all nine relevant collections and fail closed if `mainLocation`, employee `site`, or compliance `targetType`/location metadata is missing or ambiguous. They report only collection counts, not record contents. Any correction is a separate backed-up production-data change requiring Mark's approval.

Before proposing `settings`, run the cumulative Node 22 emulator/seed wrapper around `npm run test:security-settings:browser`. Require BHT/supervisor read access only to the runtime settings existing workflows need, admin-only ordinary setting writes, and denial of every browser write to `securityFoundation`, `securityWorkflows`, and `appCheckMonitoring`. App Check enforcement remains off.

Before broad staff enrollment or compatibility retirement, run the complete offline gate under the Node 22 Firebase emulator wrapper with `npm run test:security-offline-matrix:emulator`. It must prove all 11 supported actions persist across an offline browser reload and retain original-owner, Firebase UID, device-session, security-version, location, and expected-version bindings. Current-owner work may continue, a new session must reauthorize it, wrong-owner/wrong-UID work stays held, and removed-scope work goes to review.

Use the read-only aggregate report for future observation windows: `npm run security:canary -- --mode=app-check-observe --project=sprc-tx-l --hours=24`. The command makes no writes, returns only counts, refuses monitoring-only use if enforcement is active, and requires login, account/access, offline replay, transport, EOC, and issue groups to contain a valid recorded presence/absence boolean. The completed canary recorded all six groups, with tokens absent in every sample. A successful observation does not authorize enforcement.

The preview form is:

`npm run security:canary -- --mode=stage-preview --project=sprc-tx-l --stage=<next-stage> --backup-dir=<absolute path outside the repo>`

The mutation modes deliberately require additional exact arguments printed by the preview/runbook, including `--backup-sha256`. Never paste a guessed confirmation phrase or reuse a backup from another stage.

## Per-workflow go/no-go gate

Prove the normal BHT/tech, supervisor, and admin paths plus wrong-role, wrong-location, inactive, deleted, malformed-profile, expired, revoked, and stale-session negatives. Verify all live queries/listeners, Functions, Firestore rules, Storage/photo paths, offline queue/reconnect, mobile, tablet, desktop, and two-device behavior.

No next workflow may start until the current workflow has a clean canary result and an exercised rollback.

## Rollback

1. Stop new secure logins for the selected workflow by restoring the prior versioned rollout configuration.
2. End every canary session so cached custom-token claims cannot continue for the 84-hour absolute window.
3. Restore the coordinated prior Functions, Firestore rules, Storage rules, indexes, and Hosting release as one reviewed rollback set.
4. Keep local unsynced work with its original owner. Do not force revoked or deactivated-owner work through.
5. Verify the familiar PIN login, BHT home, supervisor dashboard, EOC/photos, debriefs, issues, transports, and offline reconnect on phone and desktop.
6. Preserve audit, failure, and rollback evidence. Do not delete it to make the canary look clean.

## Compatibility retirement

Retire the old browser-trusted PIN/profile path only after every named workflow has passed canary and rollback, App Check monitoring has been observed without enforcement problems, Node 22 parity is proven, and Mark separately approves the production release. Retirement must remain reversible until the post-release observation window is complete.
