# Security Foundation Canary and Rollback Gate

Last updated: 2026-08-27
Status: Test House canary authorized; guarded release preparation in progress

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

Use `npm run security:canary -- --mode=preview --project=sprc-tx-l --backup-dir=<absolute path outside the repo>` before activation. The guarded apply and rollback modes require the verified backup, exact release ID, and exact confirmation phrase; they refuse a changed configuration baseline.

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
