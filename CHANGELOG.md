# Changelog

All notable changes to SPRC Ops Hub are tracked here in chronological order.

## [Unreleased]
### Added
- EOC checklist autosave drafts in Firestore (`eocSubmissionDrafts`) with automatic restore on task reopen.
- EOC draft access controls in Firestore rules, including auth UID ownership checks for draft read/write/delete paths.

### Changed
- EOC checklist completer identity is now read-only and always sourced from the authenticated user.
- EOC checklist interaction flow optimized for faster completion on mobile and desktop:
  - sticky bottom actions
  - improved keyboard progression (`1`/`2` answer shortcuts and `Enter` next navigation)
  - clearer repair-note flow and focus behavior
- EOC categories no longer auto-collapse and no longer expose manual hide/show toggles.
- Removed top checklist progress summary strip (`Answered / Repair Items / Remaining / Next required`) on both House and Van EOC forms.

### Fixed
- Resolved EOC submit permission failures caused by draft cleanup edge cases when draft ownership metadata does not match active auth UID.

### Verification
- `npm run lint` passed.
- `npm run build` passed.

### Documentation
- Rebuilt `plan.md` as a clean V2 Core operating blueprint aligned to current runtime state.
- Added continuous-truth sections for current behavior, delivered work, and upcoming updates.

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
