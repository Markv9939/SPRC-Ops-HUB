# Security Foundation Canary and Rollback Gate

Last updated: 2026-08-28
Status: Corrected Identity/Users release deployed; signed-in three-profile verification in progress

## Current Identity/Users re-release checkpoint

The original Test House canary has already been activated for exactly `test_supervisor`, `test_bht_shift_1`, and `test_bht_shift_2`, with only `identity_users` enabled. The 2026-08-28 correction is therefore a **code re-release**, not a first activation:

1. Start from merged production baseline `44b6e44`; release candidate `4662776` contains the local Identity/Users corrections.
2. Read back and back up the current deployed Functions, Firestore rules/indexes, Hosting release, Auth/provider state, and both protected configuration documents before changing anything.
3. Confirm the protected configuration still names only the same three profiles and only `identity_users`. Do not rewrite or broaden it as part of the code release.
4. Deploy the reviewed Functions, Firestore rules, and Hosting bundle as one coordinated set. Build Hosting only with `npm run build:security-canary`, then require `npm run verify:security-canary-build` to pass before deployment.
5. Keep `authorizeOfflineReplayV5`, `createProtectedTransportV6`, `submitProtectedEocV9`, and `mutateProtectedIssueV9` network-private and disabled.
6. Run non-mutating Test Supervisor EOC and Users location-scope checks first. Obtain Mark's explicit approval immediately before any live PIN reset, account creation/deactivation, session ending, or other production-data mutation.
7. Finish Test Supervisor and both Test BHT identity/users journeys plus a non-enrolled compatibility login. If any required query, listener, login, reload, role/location boundary, or rollback check fails, restore the coordinated `44b6e44` release set before proceeding.

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
