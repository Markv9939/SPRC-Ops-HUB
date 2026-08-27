# Phase 1 Security Foundation Baseline and Rollback Record

Recorded: 2026-08-25 (America/Phoenix)

## Scope and safety boundary

Phase 1 adds a dormant, executable security contract and emulator coverage. It does not change the staff login screen, session storage, Firebase Authentication providers, Firestore or Storage rules, production data, deployed Functions, Hosting, or any feature flag. Nothing in this phase is wired into runtime application code.

The new contract model is intentionally not exported by `functions/src/index.js`. A later approved phase must implement and independently review the actual server endpoints, custom-token exchange, rules, offline integration, and staff-facing cutover.

## Exact source baseline

- Repository branch created for this work: `codex/security-foundation-phase-1`
- Authoritative remote branch: `origin/Main`
- Baseline commit: `c6b0ec15cf35840025859a312b4857052559ea0b`
- Baseline commit date and subject: `2026-08-25 — Release guided EOC template builder`
- Worktree was clean before Phase 1 changes.

The baseline commit is the source rollback anchor. Relevant baseline Git object IDs are:

| Artifact | Baseline Git blob |
| --- | --- |
| `firebase.json` | `6f2704bac535f35bc64eb99ce76666e8bd1e2784` |
| `firestore.rules` | `d5b79cf90b95888156acc2128ea1536319b931df` |
| `storage.rules` | `92746d891f7f459b014da09492f855a9f89530ea` |
| `firestore.indexes.json` | `db38ee39381d35058afeb987188e0ecc4ac3ec77` |
| `functions/src/index.js` | `c67dd9bcabecfea080f7b1a0a3a99331f874a502` |
| `functions/package.json` | `a247bcf0cc0b57f6d25e6411c103251fb2b42aa2` |
| `functions/package-lock.json` | `f12dace5584b08524569aca025aa817d31b27da1` |
| root `package.json` | `ea7f6a3bf9de331cc4b6aaa08b5bc0e3a962ab27` |
| root `package-lock.json` | `0d2b7fd3eace887244df8beed1d62fad6788dc9b` |

SHA-256 checksums captured before Phase 1 edits for deployable configuration/code were:

| Artifact | SHA-256 |
| --- | --- |
| `firebase.json` | `3D0471383BACEF43C73871F784AF3F765363A542FABF9FF26986FAEBDEE053A8` |
| `firestore.rules` | `6E560526D36EA1F80C2BCC3F0B16ED53AFF25E2CCA0737F523597A8D74FF3201` |
| `storage.rules` | `7FE38D938EFE84FCE9C2E8F1AD300B1D1008DA4BD581727A78D0280ADAB0B204` |
| `firestore.indexes.json` | `A619961DC03D8578E1AE9187CF6CAA781F8B29F2CBADDE48D5A6ED1D2F51ECF4` |
| `functions/src/index.js` | `B525ADC9E20F92559B8312F3F63A67F5FDC551141D20207D1584C6BB22165502` |

## Read-only production release inventory

The following was checked with Firebase CLI `15.8.0`; no write or deploy command was run.

- Firebase project: `sprc-tx-l`
- Configured Hosting site: `sprc-tx-l`
- Live Hosting channel last release: `2026-08-25 17:12:36` as reported by Firebase CLI
- Live URL check: HTTP `200`; response `Last-Modified` was `Wed, 26 Aug 2026 00:12:36 GMT`
- Live HTML ETag at capture: `"f5d9edbdb738fa985431d882f0f2613a6816b6b77e10ac7d47ff4fffde5d7340-br"`
- Deployed Node.js 22 Functions in `us-central1`: `archiveEocTemplate`, `assignEocTemplate`, `cleanupIssuePhotos`, `emergencyPrivacyRemove`, `establishPinSession`, `previewEocTemplatePurge`, `publishEocTemplate`, `purgeEocTemplate`, `rejectEocTemplateArchiveRequest`, `requestEocTemplateArchive`, and `saveEocSection`.

Firebase CLI does not expose an authenticated read-only checksum that proves the deployed Hosting, Functions, rules, and indexes all came from the same Git commit. The coordinated rollback anchor is therefore the exact source commit above plus Firebase's retained release history. Production Authentication provider state and the live `appSettings/authPolicy` document were deliberately not changed and were not read by this phase.

## Current behavior preserved by Phase 1

This is source-derived current behavior, not the new contract:

- `src/components/PinLogin.jsx` still verifies a client-computed PIN hash against an active `users` profile, attempts Firebase anonymous sign-in when needed, and calls the existing `establishPinSession` compatibility mapping.
- `src/App.jsx` still stores `bhtUser` in `sessionStorage` and applies a 60-minute inactivity lock.
- `firestore.rules` still uses the existing `appSettings/authPolicy.authScopeEnforced` compatibility switch.
- `src/services/offlineSyncService.js` still processes the existing offline outbox. The Phase 1 replay contract is not connected to it.

Therefore Phase 1 does not claim that the approved 84-hour server-verified session or automatic revocation is live. It only makes those requirements executable and reviewable before implementation.

## Coordinated rollback contract for later phases

If a later authentication phase fails a rollout gate, rollback must restore one coordinated release set rather than mixing versions:

1. Restore Hosting/application code from the recorded known-good release source.
2. Restore Cloud Functions from the same source state.
3. Restore Firestore rules, Storage rules, and indexes from that state.
4. Restore the matching `appSettings/authPolicy` mode and any authentication cutover flag only after the compatible code and rules are in place.
5. Keep session/audit records for investigation; do not delete staff work or force queued offline work through another identity.
6. Verify PIN login, all three roles, live listeners, protected writes, and offline queue behavior before ending rollback.

For Phase 1 itself, rollback is only removal of the new model, tests, test scripts, and this document. Since none of those files are deployed or imported by runtime code, removing them cannot alter production behavior.

## Executable contract established

The dormant model and tests define these requirements:

- Valid and invalid PIN results use a server-side decision contract; five failed attempts in 15 minutes produces a 15-minute lock, including rejection of a correct PIN while locked.
- Active BHT/legacy tech profiles must resolve to exactly one existing home location. Zero, multiple, or conflicting locations are invalid configuration and do not disclose account details at login.
- Each device has an independent stable Firebase identity/session record.
- A session persists across browser close/reopen on the same device but has an absolute, non-sliding 84-hour expiry.
- Ordinary logout revokes only one device.
- Deactivation, PIN change, role reduction, location removal, and admin end-all-sessions revoke every device, increment a security version, and create audit evidence.
- Supervisors can perform the existing approved BHT/tech account controls within their authorized main location. They cannot manage supervisors/admins, elevate roles, assign an out-of-scope location, or change global security.
- Offline replay requires the original owner, a current unrevoked session/security version, a unique operation ID, an expected record version, and a still-mutable target. Wrong-owner or revoked work is held safely; stale/final work requires review; duplicate operations are idempotent.

## Verification evidence

Final local verification:

- `npm run test:security-foundation`: 8 passed, 0 failed.
- `npm run test:security-foundation:emulator`: 6 passed, 0 failed against isolated Firestore and Authentication emulators; command exit code 0.
- `npm run test:rules`: 32 passed, 0 failed; command exit code 0.
- `npm run test:storage-rules`: 3 passed, 0 failed; command exit code 0.
- `npm run test:functions:emulator`: 10 passed, 0 failed; command exit code 0.
- `npm run test:debrief:emulator`: 1 passed, 0 failed; command exit code 0.
- Existing non-emulator unit suites for PIN policy, Functions models, Shift Debrief, EOC runtime/builder/supervisor behavior, issues/photos/feedback, core reset classification, and browser reset cutover: 81 passed, 0 failed.
- Total automated assertions recorded across the commands above: 141 passed, 0 failed.
- `npm run build`: passed; Vite transformed 1,896 modules and produced the production bundle.
- `npm run lint`: passed with no ESLint errors.
- `git diff --check`: passed; only the repository's existing Windows line-ending warning was printed for `package.json`.

Firebase emulator shutdown prints an expected `SIGINT` notice when `emulators:exec` stops Firestore. It did not change the successful exit codes above.

## Known gaps intentionally left for later phases

- No server PIN-login endpoint or custom-token minting exists yet.
- No production Firebase Authentication provider was enabled or changed.
- No persistent browser credential storage was implemented.
- No real session collection, security-version field migration, revocation transaction, or audit schema was added to production code.
- Existing Firestore/Storage rules were not changed to enforce the new session contract.
- Existing offline replay code was not changed to call the new guard.
- Emulator identities stand in for future issued custom-token identities; token issuance itself cannot be tested until its dormant backend implementation exists.
- Cross-workflow verification for EOC/templates/photos, Shift Debriefs, issues/handoff/feedback, transports, alerts, properties/fleet/compliance, user management, mobile, and desktop remains a mandatory gate before any workflow is enforced.
- The Functions emulator used the workstation's Node.js 24 even though the deployed Functions runtime is Node.js 22. The tests passed, but a later implementation phase must also validate under Node.js 22 before deployment.
- Production release-to-Git provenance cannot be proven solely from current Firebase CLI read-only output; future deployments should record release IDs and source commit metadata as part of close-out.

At the time Phase 1 first closed, `MASTER_PLAN.md` and `PROGRESS_LOG.md` were not present in this worktree. They were subsequently recovered from the authoritative documentation draft during Phase 2 closeout and updated with both phases' evidence. That later documentation restoration does not change the historical Phase 1 implementation boundary.
