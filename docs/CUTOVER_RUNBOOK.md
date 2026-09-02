# SPRC Ops Hub Deployment and Reset Runbook

Last updated: 2026-09-01

## Normal Release

1. Run `npm run build`, `npm run lint`, `npm run test:pin`, and `npm run test:rules`.
2. Deploy UI changes with `firebase deploy --only hosting --project sprc-tx-l`.
3. Deploy rule changes with `firebase deploy --only firestore:rules --project sprc-tx-l`.
4. Verify admin, supervisor, and both BHT shift paths on the production URL.
5. Verify offline draft, transport, and replay behavior before broad staff use.

## Core Reset Safety

The pre-secure core-reset tool and npm commands were retired after the custom-token/strict-session security closeout. They created browser-readable PIN hashes and an auth policy that is incompatible with the current security foundation. Do not recover or run them from Git history against production.

Any future reset must be designed as a new, separately reviewed server-credential/session-aware migration with a fresh backup and rollback contract. The steps below are retained only as historical context and are not executable current instructions.

1. Inventory every collection without writing.
2. Create and validate a complete JSON backup outside the repository.
3. Review the exact Auth user count, delete count, preserve count, and unclassified collections.
4. Do not continue if any collection is unclassified or any preserved catalog appears in the delete set.
5. Run the confirmed reset only with the exact project ID, typed confirmation phrase, and approved expected counts.
6. Validate server PIN credentials, identity mappings, sessions, strict rules, and every workflow before browser login.

## Preserved Core

- Properties and houses
- Vans and vehicles
- EOC checklist templates, template library, and template assignments
- Fleet maintenance templates
- App settings, shift timing, and other non-user operational configuration

## Reset Activity

- Firebase Authentication users and Ops users
- Clients and destinations
- Transports, debriefs, drafts, acknowledgments, and assignments
- EOC tasks, submissions, issues, and runtime history
- Alerts, notifications, audits, compliance activity, Cintas activity, and fleet runtime/history

The reset then creates one admin, one supervisor, and two opposing-shift Test House BHT profiles using unique six-digit PINs.

## Rollback

If validation fails, stop new use. Preserve the failed-state evidence, restore from the validated pre-reset JSON backup with reviewed tooling, redeploy the last known-good hosting/rules version, and rerun role plus offline acceptance checks.
