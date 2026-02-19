# Changelog

All notable changes to SPRC Ops Hub are tracked here in chronological order.

## [Unreleased]
### Added
- EOC checklist autosave drafts in Firestore (`eocSubmissionDrafts`) with automatic restore on task reopen.
- EOC draft access controls in Firestore rules, including auth UID ownership checks for draft read/write/delete paths.
- Self-service PIN rotation UI for BHT and Supervisor users via Header action (`Change PIN`).
- Dedicated PIN rotation modal and service flow with current-PIN verification before update.

### Changed
- EOC checklist completer identity is now read-only and always sourced from the authenticated user.
- EOC checklist interaction flow optimized for faster completion on mobile and desktop:
  - sticky bottom actions
  - improved keyboard progression (`1`/`2` answer shortcuts and `Enter` next navigation)
  - clearer repair-note flow and focus behavior
- EOC categories no longer auto-collapse and no longer expose manual hide/show toggles.
- Removed top checklist progress summary strip (`Answered / Repair Items / Remaining / Next required`) on both House and Van EOC forms.
- Firestore `users` update rules now include a strict self-PIN update path:
  - requires authenticated identity match (`request.auth.uid == users.authUid`)
  - limits self-updates to PIN/version/timestamp fields only
  - keeps existing supervisor/admin managed-user PIN update permissions intact
- Global UI token/theme layer in `src/index.css` aligned to healthcare-focused brand direction (deep navy, terracotta, warm neutral backgrounds) while preserving existing layout and workflows.
- Restored warm-neutral app background direction and replaced legacy hardcoded inline dark-theme color literals across major components with readable semantic contrast values.

### Fixed
- Resolved EOC submit permission failures caused by draft cleanup edge cases when draft ownership metadata does not match active auth UID.
- Prevented cross-user PIN change risk on self-service flow by enforcing field-level and identity-level rule checks.

### Verification
- `npm run lint` passed.
- `npm run build` passed.

### Documentation
- Rebuilt `plan.md` as a clean V2 Core operating blueprint aligned to current runtime state.
- Added continuous-truth sections for current behavior, delivered work, and upcoming updates.
- Added `docs/PROJECT_ALIGNMENT.md` to lock master-instruction alignment, approved exceptions, and workflow contract.
- Added `PROJECT_INSTRUCTIONS.md` for session startup order and repo-specific operating rules.
- Updated `README.md` with daily logical-batch deploy/testing workflow and hosting standard.
- Updated `docs/CUTOVER_RUNBOOK.md` with repeatable per-batch deploy + mobile validation steps.
- Updated `docs/REGRESSION_UAT_PHASE9.md` with explicit iPhone/iPad validation checklist rows.

## [2026-02-13]
### Added
- Compliance workflow improvements and Firestore write support for compliance modules.
- Auth claims provisioning and verification scripts (`claims:provision`, `claims:verify`) operationalized in runbook.

### Changed
- Assignment model refactor to user-derived `shiftAssignments` + shared `eocTasks` lifecycle.
- BHT dashboard CTA behavior aligned to active transport state.
- Org model and dialog behavior unified across app surfaces.
- Supervisor dashboard enhanced with queue and compliance visibility updates.

### Fixed
- Admin save permissions and global access semantics.
- Hosting deployment/site binding workflow issues.
- Multiple auth, assignment, and BHT workflow stability issues in V2 branch.

### Removed
- Legacy compliance import/upload UI path that was not part of target operational flow.

## [2026-02-14]
### Changed
- User create/edit now supports canonical multi-van assignment (`vanIds`) with primary `vanId` compatibility.
- Session and assignment sync paths now carry `vanIds` to prevent assignment drift.

### Fixed
- Scope/assignment mismatches that caused BHT no-assignment false negatives in active workflows.
- Permission and auth-claim edge handling around BHT transport/EOC startup paths.

### Verification
- `npm run build` passed.
- `npm run lint` passed.
- `npm run smoke:phase9:full` passed.
- Firebase deploy completed to `sprc-tx-l` (Firestore + Hosting).

## [History Note]
- Older pre-2026-02-13 changes remain available in Git history.
- This file is now the maintained chronological source of truth going forward.
