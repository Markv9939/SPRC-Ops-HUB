# Project Alignment to Master AGENTS.md

Last updated: 2026-02-17
Owner: Product + Engineering
Status: Active

## Purpose
This document records how SPRC Ops Hub aligns with the master `AGENTS.md` instructions used in Codex sessions.

## Master Rules Adopted
- Explain changes in plain language and prioritize non-developer clarity.
- Call out risks and side effects before significant implementation changes.
- Keep solutions maintainable for a solo non-developer owner.
- Do not commit or push unless explicitly requested.
- Prioritize mobile/tablet usability and validation.
- Keep project memory docs updated as behavior changes.

## Approved Project Exceptions
These exceptions are intentional and approved for this repo.

1. Frontend framework
- Master default: HTML/CSS/vanilla JavaScript.
- Repo exception: React + Vite remains the active frontend stack.

2. Cloud Functions baseline
- Master default: Firebase Cloud Functions when applicable.
- Repo exception: Cloud Functions are optional and not required for current cutover/runtime.

3. PWA implementation timing
- Master default: installable PWA direction.
- Repo exception: PWA implementation is deferred by owner decision for now.

## Delivery Workflow Contract (Required)
For each logical batch of changes:
1. Implement one cohesive batch.
2. Run verification commands appropriate to the change:
   - `npm run build`
   - `npm run lint`
   - `npm run smoke:phase9:full` (when validating release readiness)
3. Deploy for owner testing:
   - Hosting changes: `firebase deploy --only hosting --project sprc-tx-l`
   - Rules changes: `firebase deploy --only firestore:rules --project sprc-tx-l`
4. Validate on iPhone/iPad critical paths.
5. Record outcomes in:
   - `docs/REGRESSION_UAT_PHASE9.md` (test evidence)
   - `CHANGELOG.md` (shipped behavior)

## Source-of-Truth Hierarchy
When instructions conflict, resolve in this order:
1. Master `AGENTS.md` safety/change-control rules.
2. `PROJECT_INSTRUCTIONS.md` for repo operating rules and session-start order.
3. This file (`docs/PROJECT_ALIGNMENT.md`) for approved repo exceptions.
4. `plan.md` for live product blueprint and behavior contract.
5. Implementation in code.
