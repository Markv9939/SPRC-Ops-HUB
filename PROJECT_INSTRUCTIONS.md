# SPRC Ops Hub Project Instructions

Last updated: 2026-02-17

## Session Startup Order
1. Apply master `AGENTS.md` instructions first.
2. Apply this file for repo-specific operating rules.
3. Apply `plan.md` for current product/runtime behavior.

## Repo-Specific Operating Rules
- Communicate in plain language suitable for a non-developer owner.
- Provide a short pre-change plan before significant edits.
- Do not commit or push unless explicitly requested.
- Deploy after each logical batch so owner can test quickly on phone/tablet.
- Keep docs synchronized when behavior/workflow changes:
  - `plan.md`
  - `README.md`
  - `docs/PROJECT_ALIGNMENT.md`
  - `CHANGELOG.md`

## Approved Exceptions to Master Defaults
- Frontend stack for this repo is React + Vite.
- Cloud Functions are optional and not required baseline for current runtime.
- PWA implementation is deferred by owner decision for now.
