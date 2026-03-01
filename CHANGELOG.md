# Changelog

All notable changes to SPRC Ops Hub are tracked here in chronological order.

## [Unreleased]
### Added
- EOC checklist autosave drafts in Firestore (`eocSubmissionDrafts`) with automatic restore on task reopen.
- EOC draft access controls in Firestore rules, including auth UID ownership checks for draft read/write/delete paths.
- Self-service PIN rotation UI for BHT and Supervisor users via Header action (`Change PIN`).
- Dedicated PIN rotation modal and service flow with current-PIN verification before update.
- Shared modal foundation for app dialogs (`AppModal`, `modalStyles`) to keep overlay/card/button contrast consistent.
- Dashboard compliance queue `Quick Update` action for inline due-date resolution directly from warning cards (overdue + due soon), including audit logging.
- Bulk compliance employee import script (`scripts/addComplianceEmployees.js`) and npm command (`npm run compliance:employees:add`) to upsert employee records by `name + site`.
- Location-aware shift catalog with RES day/night variants and shared helper APIs (`getShiftOptionsForMainLocation`, `isShiftAllowedForMainLocation`, `getShiftById`, `getTemplateScopeForShift`).
- New `templateScope` support across EOC task generation, checklist draft/submission payloads, and template governance flows.
- One-time RES rollout migration script (`scripts/migrateResShiftModel.js`) plus npm command (`npm run migrate:res-shift-model`).
- New EOC template library + assignment manager flow:
  - centralized library with search and owner-aware grouping (`My Templates`, `Shared Templates`)
  - cloning path so supervisors can copy shared templates and edit their own versions safely
  - location+shift default assignment workflow with immediate propagation to incomplete EOCs
- Fleet maintenance MVP collections and services:
  - `fleetMaintenanceTemplates` (global mileage templates by main location)
  - `fleetVehicleRuntime` (strict latest-mileage runtime sourced from van EOC submission path)
  - `fleetTasks` (persistent upcoming/overdue/resolved queue source)
  - `vehicleServiceRecords` (service logging with optional external `documentUrl`)
- New fleet runtime + task engine services:
  - `src/services/fleetRuntimeService.js`
  - `src/services/fleetTaskEngine.js`
- New shared fleet status utility (`src/utils/fleetStatus.js`) for due-state evaluation and type formatting.
- New top-level fleet supervisor/admin surface (`src/components/FleetPanel.jsx`) for:
  - vehicle maintenance profile management
  - mileage template management
  - service record logging and task resolution workflows
- New top-level supervisor/admin properties surface (`src/components/PropertiesPanel.jsx`) for:
  - property profile CRUD in `eocProperties`
  - house EOC status visibility from `eocTasks`

### Changed
- Compliance mobile item workflow refactored for low-friction editing:
  - mobile employee detail now uses sticky bottom action bar (`Back`, `+ Add Item`, `Deactivate/Reactivate`)
  - mobile add/edit actions now open focused bottom sheets with sticky save controls
  - mobile item rows stay compact while editing (no in-list expansion that creates long page growth)
  - mobile list includes bottom safe-area spacing so actions and final items remain reachable
- Admin/Supervisor compliance workflow redesigned to an employee-centric model:
  - `Compliance` now focuses on searchable employee list + in-context employee detail management.
  - Employee compliance item CRUD now happens directly inside the selected employee detail view (desktop side panel, mobile full-screen detail sheet).
  - Legacy `Items` sub-tab removed to reduce tab switching and friction.
- `Cintas` moved out of Compliance sub-tabs into a dedicated top-level dashboard tab.
- New top-level `Cintas` tab now includes scoped location-compliance management (including Fire Safety location items) for admin and supervisors.
- `Cintas` and location-compliance records now use explicit location fields (`mainLocation`/`locationId`) in UI writes to support supervisor scope filtering.
- Firestore rules tightened for compliance collections:
  - removed broad authenticated-user fallback writes for `complianceEmployees`, `complianceItems`, and `cintasServices`
  - added role+location scoped checks for compliance and Cintas writes
  - added admin-only legacy read path for Cintas records missing location fields
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
- EOC task engine now scopes Van EOC eligibility per van assignment (house remains location+shift scoped), preventing cross-van task visibility for BHTs.
- PIN login now applies bounded timeout guards to critical auth/data fetch steps so the login button does not remain indefinitely on `Checking...` when backend requests hang.
- Transport reminder popup (`REMIND THE CLIENT ABOUT DC PAPERWORK`) now uses the same high-contrast modal pattern as other updated dialogs.
- Compliance warning queue action buttons now use high-contrast neutral styling for readable text on tinted warning cards.
- Supervisor dashboard status queue now blends EOC + compliance + fleet:
  - heading updated to `EOC + Compliance + Fleet Status`
  - `Overdue Tasks` includes persistent `fleetTasks.status == 'overdue'`
  - `Upcoming Tasks` includes compliance due soon + fleet `status == 'upcoming'`
  - queue rows include fleet-specific due/current mileage/date details and `Open Fleet Tab` actions
- Alert handling now includes unread `fleet_*` alerts in supervisor/admin counts while keeping overdue fleet visibility task-driven.
- EOC submit path now records numeric odometer mileage (`odometerMileage`), updates `fleetVehicleRuntime`, and attempts vehicle fleet-task re-evaluation.
- Firestore rules now include fleet write scopes:
  - supervisor/admin scoped writes for `eocVehicles`, `fleetMaintenanceTemplates`, `fleetTasks`, `vehicleServiceRecords`
  - restricted runtime-write path for BHT/tech via `fleetVehicleRuntime`
- Firestore indexes now include fleet query coverage for `fleetTasks`, `vehicleServiceRecords`, and `fleetMaintenanceTemplates`.
- Supervisor/admin information architecture refined:
  - top-level `Properties` tab added
  - `EOC` tab now focuses on `Template` + `Issues` only
  - vehicle management responsibility remains in top-level `Fleet` tab
- Firestore rules and index coverage extended for property profiles (`eocProperties`).
- Supervisor BHT create/edit flow now enforces location-specific shift options:
  - OTC users can only be assigned OTC shifts (`shift_1`, `shift_2`)
  - RES users can only be assigned RES shifts (`res_shift_1_day`, `res_shift_1_night`, `res_shift_2_day`, `res_shift_2_night`)
- EOC template management now supports required scope selection (`OTC Shared`, `RES Day`, `RES Night`) for both House and Van templates.
- Supervisor template governance now follows copy-first ownership:
  - supervisors can edit templates they own
  - shared templates are cloned before edits to prevent accidental cross-team template changes
- EOC checklist runtime now resolves templates by scope in priority order:
  - exact `templateScope`
  - fallback `otc_shared`
  - fallback legacy unscope/default template constants
- Due-date configuration now supports RES Thursday cadence for `2nd` day/night shifts while keeping OTC Wednesday behavior unchanged.
- Firestore rules now enforce:
  - strict shift/location compatibility for users, assignments, and EOC write paths
  - valid `templateScope` values on scoped EOC records
- Firestore indexes now include template-scope query coverage for:
  - `eocChecklistTemplate`
  - `eocTemplateDrafts`
  - `eocTemplateVersions`
- Seed data now includes both RES Day and RES Night BHT examples and scoped task/template metadata.

### Fixed
- Resolved EOC submit permission failures caused by draft cleanup edge cases when draft ownership metadata does not match active auth UID.
- Prevented cross-user PIN change risk on self-service flow by enforcing field-level and identity-level rule checks.
- Fixed BHT Hub showing unassigned van EOCs (example: Van 4 appearing for a Van 2-only assignment) by aligning task generation and client filtering with canonical `vanIds`.
- Fixed stuck login UX where PIN submit could appear frozen on `Checking...` under degraded connectivity/backend request hangs.
- Fixed low-contrast text on transport reminder modal cancel action.
- Fixed low-contrast `Open Compliance Tab` button text on compliance warning cards.

### Verification
- `npm run lint` passed.
- `npm run build` passed.
- `npm run smoke:phase9:full` passed (build + lint) after compliance/cintas restructure.
- `npm run build` passed after van-scope + login-timeout updates (2026-02-19).
- `npm run build` passed after modal consistency + compliance warning quick-update changes (2026-02-19).
- Firebase Hosting deploy passed to `sprc-tx-l` after compliance/cintas UX restructure (2026-02-19).
- Firebase Firestore rules deploy passed to `sprc-tx-l` after scope updates for compliance/cintas (2026-02-19).
- Firebase Hosting deploy passed to `sprc-tx-l` after dashboard warning workflow updates (2026-02-19).
- `npm run lint` passed with one pre-existing baseline warning in `src/hooks/useEocTasks.js` (2026-02-28).
- `npm run build` passed after RES shift model + template-scope changes (2026-02-28).
- `npm.cmd run lint` passed with one pre-existing warning in `src/hooks/useEocTasks.js` (2026-03-01).
- `npm.cmd run build` blocked in this environment (`esbuild` `spawn EPERM` while loading Vite config) (2026-03-01).
- `npm.cmd run smoke:phase9:full` blocked by the same build environment `spawn EPERM` issue (2026-03-01).

### Documentation
- Rebuilt `plan.md` as a clean V2 Core operating blueprint aligned to current runtime state.
- Added continuous-truth sections for current behavior, delivered work, and upcoming updates.
- Added `docs/PROJECT_ALIGNMENT.md` to lock master-instruction alignment, approved exceptions, and workflow contract.
- Added `PROJECT_INSTRUCTIONS.md` for session startup order and repo-specific operating rules.
- Updated `README.md` with daily logical-batch deploy/testing workflow and hosting standard.
- Updated `docs/CUTOVER_RUNBOOK.md` with repeatable per-batch deploy + mobile validation steps.
- Updated `docs/REGRESSION_UAT_PHASE9.md` with explicit iPhone/iPad validation checklist rows.
- Updated `README.md`, `plan.md`, and `docs/REGRESSION_UAT_PHASE9.md` to document warning-card quick resolution flow and visibility/contrast fixes.
- Updated `README.md`, `docs/UAT_WALKTHROUGH_PHASE9.md`, `docs/REGRESSION_UAT_PHASE9.md`, `docs/CUTOVER_RUNBOOK.md`, and `plan.md` for RES day/night shift rollout and scoped template behavior.
- Updated `README.md`, `plan.md`, and `docs/REGRESSION_UAT_PHASE9.md` for Fleet Maintenance MVP and persistent overdue queue behavior.
- Updated `docs/UAT_WALKTHROUGH_PHASE9.md` and `docs/CUTOVER_RUNBOOK.md` for new supervisor/admin IA:
  - EOC tab narrowed to template/issues workflows
  - Properties tab coverage added for house/property workflows
  - Fleet tab retained as the vehicle maintenance owner

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
