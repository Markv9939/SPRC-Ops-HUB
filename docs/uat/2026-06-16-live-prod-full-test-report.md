# 2026-06-16 Live Production Test Report

Run tag: `TEST-20260616A`
App: `https://sprc-tx-l.web.app`
Environment: Live production app currently used by staff
Tester role used before stop: `test_1` BHT

## Executive Summary

The P0 smoke test was started but not completed. BHT login, BHT home/scope display, transport creation, required-field guardrails, transport close behavior, BHT issue creation, supervisor issue visibility, and supervisor note-required guardrails worked. The core P0 handoff path remains blocked at debrief submission because the app still produces Firestore `permission-denied` errors and does not complete the submit action.

Post-deploy retest note: after the targeted production fix was deployed, Chrome first reused the old cached bundle. A forced fresh load confirmed the new deployed bundle `/assets/index-BLwXExrU.js`. On the new bundle, the app now shows a clear BHT-facing submit failure message, but the underlying debrief submit is still blocked by permissions.

Because this is production, only limited additional tagged testing was run after the P0 blocker. Supervisor workflow testing confirmed that the tagged BHT issue reached the supervisor dashboard. Compliance, Cintas, properties, fleet, EOC templates, and broader database-entry testing remain untested until the permission issues are resolved or a safe staging path is available.

## P0 Smoke Results

| ID | Steps | Expected | Actual | Status | Evidence |
|---|---|---|---|---|---|
| P0-01 | Open production app | Login screen loads at the production URL | App loaded at `https://sprc-tx-l.web.app` and showed Google sign-in | PASS | `001-login-page.png` |
| P0-02 | Sign in as `test_1` | BHT account logs in and lands on BHT home | Login succeeded through Chrome/Google. BHT home showed `Hi, Test-1` and `Test House` | PASS | `002-test1-bht-home.png` |
| P0-03 | Confirm BHT assignment display | BHT should see correct house/shift/van context | Header/menu showed `Test-1`, `Test House - 1st Shift - Test Van` | PASS | Browser snapshot |
| P0-04 | Check EOC availability | If assigned tasks exist, House/Van EOC actions should be available | Both `Van EOC` and `House EOC` showed `No tasks` and were disabled | OBSERVED - NEEDS SETUP/RULE CONFIRMATION | `002-test1-bht-home.png` |
| P0-05 | Start tagged test transport | Transport record should open with required fields incomplete | Transport opened at `/transport/7uywetsSmNfJzXH1I6yo`, showed `0 of 3 required fields`, Finish disabled | PASS | Browser snapshot |
| P0-06 | Fill transport required fields | Finish should enable only after required fields are complete | Client, destination address, and reason were accepted. UI showed `3 of 3 required fields`, `100%`, Finish enabled | PASS | `003-test1-transport-ready.png` |
| P0-07 | Finish transport | App should require any final guardrails, close record, and make it view-only | DC paperwork modal appeared. Selected `N/A`. Transport became `closed - view only` | PASS | `004-test1-transport-finished.png` |
| P0-08 | Create debrief draft | BHT should add client and general handoff notes | Client med/health note and general handoff note were added and autosaved | PASS | `005-test1-debrief-ready.png` |
| P0-09 | Submit debrief | Submitted debrief should lock and become available for next-shift handoff | Initial run on old bundle: submit confirmation appeared, but after confirmation the UI stayed in edit mode. Console showed `FirebaseError: Missing or insufficient permissions.` Post-deploy fresh-bundle retest: app showed `Debrief submit was blocked by app permissions. Please tell a supervisor so this can be checked.` Console showed `Shift debrief submit failed: FirebaseError: Missing or insufficient permissions.` | FAIL - P0 BLOCKER | `006-test1-debrief-submit-stuck.png`; Browser snapshot |
| P0-10 | Next-shift BHT handoff/signoff | `test_2` should see incoming debrief and sign off | Not run because debrief submission failed | BLOCKED | P0-09 |
| P0-11 | Supervisor sees transport/debrief/acknowledgment | Supervisor should see BHT activity and debrief acknowledgment | Supervisor dashboard showed the tagged BHT issue and Test-1 transport count, but debrief acknowledgment could not be tested because debrief submit failed | PARTIAL | `012-supervisor-dashboard-test-issue.png` |

## Additional Sequential Test Results

| ID | Steps | Expected | Actual | Status | Evidence |
|---|---|---|---|---|---|
| BHT-ISS-01 | Open `Report issue` as `test_2` | Modal opens with issue type and description field | Modal opened. Default issue type was `House/property`; description field and Submit button were visible | PASS | `007-test2-report-issue-modal.png` |
| BHT-ISS-02 | Submit blank issue form | App blocks submit and explains what is missing | App showed `Describe the issue before submitting.` | PASS | Browser snapshot |
| BHT-ISS-03 | Submit tagged house/property issue | Tagged issue is created and visible in Location Issues | Issue was created and visible under `Location Issues`, status `OPEN`, severity `MEDIUM` | PASS | `009-test2-location-issues-board.png` |
| BHT-ISS-04 | Open issue detail as BHT | BHT can read issue, activity, and should not see supervisor controls | Detail page showed issue/activity. It stated BHT view is read-only and supervisor controls were not shown | PASS | `010-test2-issue-detail.png` |
| BHT-ISS-05 | Return home after issue creation | Home should show active issue count | After direct home reload, home showed `Location issues 1` and `1 open - 0 in progress` | PASS AFTER RELOAD | `011-test2-home-after-issue.png` |
| SUP-01 | Login as supervisor | Supervisor lands on dashboard with OTC scope | Login succeeded. Dashboard showed `test-supervisor`, `Primary: OTC`, and supervisor nav tabs | PASS | `012-supervisor-dashboard-test-issue.png` |
| SUP-02 | Supervisor sees tagged BHT issue | Tagged BHT issue appears in dashboard queue | Dashboard showed the `TEST-20260616A` house/property issue, `Open Issues 1`, and `Unread Alerts 1` | PASS | `012-supervisor-dashboard-test-issue.png` |
| SUP-03 | Supervisor tries status change with no note | App should block status change and require note | App showed `Note is required before moving an issue to in progress.` | PASS | `013-supervisor-issue-note-required.png` |
| SUP-04 | Supervisor resolves tagged issue | Supervisor should enter note and resolve tagged test issue | Not completed because Chrome text-entry automation failed for the note field. Test issue remains open for manual cleanup | BLOCKED - TOOL INPUT LIMITATION | SUP-03 |

## Bugs And Risks Found

### P0 Blocker: Debrief Submit Fails With Permission Denied

Steps:
1. Login as `test_1`.
2. Open `Edit shift debrief`.
3. Add a client med/health note.
4. Add a general handoff note.
5. Click `Submit Debrief`.
6. Confirm the submit modal.

Expected:
The debrief submits, locks, and becomes available to the next-shift BHT for acknowledgment.

Actual:
The original run stayed in edit mode and the browser console showed:

```text
FirebaseError: Missing or insufficient permissions.
```

Post-deploy retest on fresh bundle `/assets/index-BLwXExrU.js` still failed. The app showed:

```text
Debrief submit was blocked by app permissions. Please tell a supervisor so this can be checked.
```

The console showed:

```text
Shift debrief submit failed: FirebaseError: Missing or insufficient permissions.
```

Impact:
This blocks the core cross-shift handoff workflow. It also means the next-shift BHT signoff and supervisor acknowledgment tracking cannot be trusted until fixed.

### Fixed/Improved: Debrief Submit Failure Is Now Clearly Shown To The User

Expected:
If submit fails, the BHT should see a clear error message and know the debrief did not submit.

Original actual:
The visible screen remained in edit mode. The failure was visible in the browser console, not clearly surfaced in the UI during the test.

Post-deploy retest:
The app displayed a clear notice: `Debrief submit was blocked by app permissions. Please tell a supervisor so this can be checked.`

Impact:
This part is improved. A BHT should now know the debrief did not submit, but the underlying workflow is still blocked.

### P1: Background EOC/Assignment Sync Permission Errors

Observed console errors included attempts to write/update `shiftAssignments/asg_test_1`, followed by:

```text
EOC task engine sync failed: FirebaseError: Missing or insufficient permissions.
```

Impact:
This may explain why `House EOC` and `Van EOC` showed `No tasks` for `test_1`, but this needs owner/rules confirmation before marking it as the only cause.

### P2: Transport Close Follow-Up Alert/Audit Write Failed

After the test transport was closed, the console showed:

```text
Transport closed, but follow-up alert/audit write failed: FirebaseError: Missing or insufficient permissions.
```

Impact:
The transport itself closed correctly, but supervisor alert/audit behavior may be incomplete.

### P2 Usability: Handoff Note Add Button Is Disabled Without Explaining Why

In the debrief General tab, the `Add note` button stayed disabled after typing a note until a handoff label was selected.

Expected:
Either a default label should be selected or the UI should explain that a label is required.

Actual:
The button was disabled with no visible reason.

Impact:
A BHT may think the app is stuck or broken.

### P2: Home Issue Count Did Not Update Until Reload/Navigate

After `test_2` submitted the tagged house/property issue, the issue modal closed and home still displayed `No active location issues`. Opening Location Issues showed the new issue existed. Returning/reloading home then showed `Location issues 1`.

Impact:
The issue was saved successfully, but the immediate home screen feedback may make a BHT unsure whether the report was submitted.

### Tooling Limitation: Chrome Automation Could Not Type Into Supervisor Issue Note Field

The supervisor note field was visible and the no-note guardrail worked. However, Chrome automation failed to type into the field due to a browser-extension clipboard/text-entry limitation. This blocked automated cleanup by supervisor resolution.

Impact:
This is not confirmed as an app bug. Manual typing in the live browser should be used to resolve or further test the tagged issue.

## Test Records Created

| Record Type | Run Tag | Created By | Screen | Status | Cleanup Action | Remaining Risk |
|---|---|---|---|---|---|---|
| Transport | `TEST-20260616A` | `test_1` | BHT Transport | Closed/view-only | Completed with DC paperwork `N/A` | Low. Remains as a tagged test transport for supervisor review/history. |
| Shift debrief draft | `TEST-20260616A` | `test_1` | Shift Debrief | Draft/autosaved, not submitted after original test and post-deploy retest | No safe cleanup path found during P0 | Medium. Test draft may remain visible to `test_1`; manual admin cleanup may be needed if desired. |
| Shared client/autocomplete label | `TEST-20260616A Client A` | `test_1` | Transport/Debrief | Possibly created/updated by app autocomplete behavior | No safe cleanup path tested | Low/medium. May appear as a test autocomplete suggestion. |
| Location issue | `TEST-20260616A` | `test_2` | BHT Report Issue | Open | Supervisor resolution blocked by automation text-entry limitation | Medium. Needs manual supervisor/admin cleanup or resolution. |

## Screenshots

- `docs/uat/screenshots/2026-06-16-live-prod-test/001-login-page.png`
- `docs/uat/screenshots/2026-06-16-live-prod-test/002-test1-bht-home.png`
- `docs/uat/screenshots/2026-06-16-live-prod-test/003-test1-transport-ready.png`
- `docs/uat/screenshots/2026-06-16-live-prod-test/004-test1-transport-finished.png`
- `docs/uat/screenshots/2026-06-16-live-prod-test/005-test1-debrief-ready.png`
- `docs/uat/screenshots/2026-06-16-live-prod-test/006-test1-debrief-submit-stuck.png`
- `docs/uat/screenshots/2026-06-16-live-prod-test/007-test2-report-issue-modal.png`
- `docs/uat/screenshots/2026-06-16-live-prod-test/008-test2-issue-submitted.png`
- `docs/uat/screenshots/2026-06-16-live-prod-test/009-test2-location-issues-board.png`
- `docs/uat/screenshots/2026-06-16-live-prod-test/010-test2-issue-detail.png`
- `docs/uat/screenshots/2026-06-16-live-prod-test/011-test2-home-after-issue.png`
- `docs/uat/screenshots/2026-06-16-live-prod-test/012-supervisor-dashboard-test-issue.png`
- `docs/uat/screenshots/2026-06-16-live-prod-test/013-supervisor-issue-note-required.png`

## Not Run

The following planned areas were not run because the P0 debrief submit failed in production:

- `test_2` incoming debrief/signoff
- Supervisor review of debrief acknowledgment
- Supervisor transport/debrief dashboard validation
- BHT issue workflow beyond initial house/property issue creation
- EOC completion workflow
- Compliance data entry
- Cintas/fire safety/location compliance data entry
- Properties data entry
- Fleet vehicle/template/service-record data entry
- EOC template management
- User/access grant/audit tests
- Mobile/tablet matrix
- Direct URL permission checks
- Concurrency tests

## Recommended Next Steps

1. Continue fixing Firestore rules or app write paths for BHT debrief submission. The user-facing error is improved, but submit still fails with `permission-denied`.
2. Recheck background assignment/EOC listeners separately. Fresh-bundle reload still produced permission-denied listener errors, even before successful handoff testing.
3. Verify whether BHT test accounts should be allowed to update or create derived `shiftAssignments`; if not, move that write path to a supervisor/admin-safe setup flow.
4. Confirm whether the closed transport should have created alert/audit entries, then fix permissions if needed.
5. After fixes, rerun the P0 smoke path before any wider production testing.
