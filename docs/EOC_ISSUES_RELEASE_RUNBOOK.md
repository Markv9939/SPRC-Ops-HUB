# EOC and Issues Release Runbook

## Current Security Mode

- The staff-facing identity remains the selected PIN profile. Do not add a second Google sign-in to this app during this release.
- Firebase Anonymous Auth is used only to satisfy authenticated Storage access. It does not prove which PIN profile is using the browser.
- In compatibility mode, the interface filters issues and photos by the selected profile's assigned location. That location boundary is not yet enforced by Firebase Authentication claims.
- `strictAuthentication` must remain `false` until the Hub supplies a verified app profile or this app receives its own verified profile authentication.
- Strict-ready Firestore fields, Storage paths, and rule tests are included so later authentication does not require moving issue records or photos.

## Production Stop Points

Do not perform any of these actions without separate approval:

1. Enable Blaze billing or create a production Storage bucket.
2. Deploy Firestore rules, Storage rules, indexes, Functions, or Hosting.
3. Run a production migration with `--confirm`.
4. Enable recurrence, photos, offline photos, supervisor tools, or retention outside the approved canary location.
5. Enable `strictAuthentication` anywhere.

No real client information or real workplace photos may be used for smoke testing.

## Required Preflight

1. Confirm the production Firebase project ID and take the approved Firestore backup.
2. Run each migration in preview mode and record document counts and proposed writes.
3. Confirm Blaze status, Storage bucket region, budget alerts, Scheduler API, Functions API, and expected photo volume.
4. Review the unresolved `xlsx` dependency advisory. The app only writes app-generated workbooks and does not parse uploaded spreadsheets.
5. Refactor and rerun the complete Firestore rule suite before strict authentication is enabled. Current compatibility tests pass, but denied legacy writes can still produce emulator expression-limit warnings.
6. Confirm all feature flags are false and `enabledLocationIds` contains only the synthetic or approved canary location.

## Local Verification

Run these from the repository root. All emulator scripts use synthetic data.

```powershell
npm.cmd run test:issues
npm.cmd run test:eoc
npm.cmd run test:eoc:supervisor
npm.cmd run test:function-models
npm.cmd run test:debrief
npm.cmd run test:debrief-reset
npm.cmd run test:pin
npm.cmd run test:reset
npm.cmd run test:reset-cutover
npm.cmd run test:rules
npm.cmd run test:storage-rules
npm.cmd run test:functions:emulator
npm.cmd run test:debrief:emulator
npm.cmd run test:reset:emulator
npm.cmd run test:eoc-upgrade:emulator
npm.cmd run test:eoc-issues:browser
npm.cmd run lint
npm.cmd run build
git diff --check
```

## Production Migration Previews

These commands are preview-only unless `--confirm` is deliberately added after approval:

```powershell
node scripts/initializeEocIssueFeatures.js
node scripts/seedStandardEocFallbackTemplates.js
node scripts/backfillEocIssueUpgrade.js
node scripts/migrateEocTemplateFoundation.js
```

Verify that previews do not rewrite descriptions, tracking IDs, submissions, activity, or historical template snapshots.

## Approved Deployment Order

1. Complete backups and approve exact migration counts.
2. Deploy required indexes and wait until every index is ready.
3. Deploy compatibility Firestore rules with strict authentication off.
4. Create the approved Storage bucket and deploy Storage rules.
5. Deploy backend Functions, including emergency privacy removal and daily retention cleanup.
6. Deploy Hosting with every new feature flag disabled.
7. Run a synthetic production smoke test using designated test profiles and a non-client image.
8. Enable the approved Test House canary flags.
9. Observe errors, pending uploads, retention failures, and staff workflow results before enabling another location.

## Canary Checks

- BHTs can see only interface-filtered issues for their selected house profile.
- Same-house BHTs can view visible report photos and receive issue-change alerts.
- Other-house profiles do not show those issues or queued photos.
- Supervisors can resolve, link, classify, hide photos, add missed notes, search, and export only their scoped locations.
- Admin emergency removal requires PIN re-entry and a reason, deletes the object, and leaves immutable history and audit records.
- Failed uploads leave the issue valid, stay owned by the current PIN profile, and retry without duplicate records or objects.
- Reopening before cleanup clears the deletion due date. Missing Storage objects count as successful idempotent cleanup.

## Rollback

1. Disable the affected feature flags first.
2. Restore the previous Hosting release if needed.
3. Do not delete new issue fields, attachment metadata, relationship activity, audit records, or retention obligations.
4. Keep backend cleanup available for any photos already accepted.
5. Investigate with synthetic records before re-enabling the canary.

Rollback does not revert or destroy records created by the new workflow.
