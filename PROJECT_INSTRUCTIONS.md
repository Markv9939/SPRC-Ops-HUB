# SPRC Ops Hub Project Instructions

Last updated: 2026-08-26

## Session Startup Order
1. Apply master `AGENTS.md` instructions first.
2. Apply this file for repo-specific operating rules.
3. Read `MASTER_PLAN.md` for current product/runtime direction and `PROGRESS_LOG.md` for detailed evidence.
4. Use `plan.md` only as an older blueprint that may require reconciliation with current code and the Master Plan.

## Repo-Specific Operating Rules
- Communicate in plain language suitable for a non-developer owner.
- Provide a short pre-change plan before significant edits.
- Do not commit or push unless explicitly requested.
- Deploy only after explicit owner approval. Once approved, keep the release to one logical batch so the owner can test it quickly on phone/tablet.
- Keep docs synchronized when behavior/workflow changes:
  - `MASTER_PLAN.md`
  - `PROGRESS_LOG.md`
  - `README.md`
  - `docs/PROJECT_ALIGNMENT.md`
  - `CHANGELOG.md`
- When Mark says `update master plan`, read Mark's Notes Inbox and the relevant plan sections first. Organize confirmed decisions, preserve processed notes, keep loose ideas labeled as ideas/questions, and do not change code or production merely because the plan was updated.

## Approved Exceptions to Master Defaults
- Frontend stack for this repo is React + Vite.
- Cloud Functions are feature-dependent. Do not add them automatically to simple work, but preserve and verify the deployed Functions required by protected template, retention, and privacy workflows.
- PWA implementation is deferred by owner decision for now.
- Security-foundation local work remains dormant until a separately approved coordinated release. Do not enable Anonymous Auth, global strict auth, App Check enforcement, versioned workflow gates, production secrets/configuration, or canary enrollment as a shortcut.
