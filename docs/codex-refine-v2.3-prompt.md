# Codex prompt — refine the plan and update it to v2.3

Paste the block below into Codex. It refines/tightens the plan and writes it back as
v2.3. Codex may modify ONLY `docs/bht-home-implementation-plan.md` — not app code.

---

ROLE
You are a senior React/Firebase engineer. Refine and tighten an existing, already
heavily-reviewed implementation plan so it is fully implementation-ready, then UPDATE
the plan file in place as v2.3. You may modify ONLY the plan document — do NOT change
app code, rules, or any other file.

CONTEXT
The plan has already been through Codex verification + multiple Claude audits. Major
decisions are LOCKED — do not relitigate them; if you strongly disagree, flag it in a
"Decisions to reconsider" note rather than silently changing:
- Exact-location privacy (Lone Mountain ≠ Mesquite) via a separate `issueLocations`
  claim + Firestore rules + server-constrained queries.
- W0.0 (authenticated per-user sessions: token-mint → signInWithCustomToken →
  authScopeEnforced) is a hard prerequisite sequenced first.
- Location-wide per-user notification fan-out via `shiftAssignments`.
- Supervisor post-update + void; void shown under Resolved with a VOIDED badge + reason.
- Central transactional `issueStatusService`; per-issue activity subcollection +
  denormalized `latestActivity`; `userHomeState` reviewed-debrief ref; `issueAccess`
  effective-access doc for backup grants; deterministic offline IDs.

READ FIRST
1. docs/bht-home-implementation-plan.md   (the plan to refine — current v2.2)
2. docs/mockups/bht-home-final.html        (visual source of truth)

VERIFY EVERY CLAIM AGAINST CODE (cite file:line for anything you change)
src/App.jsx, src/components/BhtHub.jsx, src/components/PinLogin.jsx,
src/components/DashboardSummaryPanel.jsx, src/components/SupervisorEocPanel.jsx,
src/services/issueStatusService.js (to be created), src/services/bhtIssueReportService.js,
src/services/offlineSyncService.js, src/services/notificationService.js,
src/services/shiftDebriefService.js, src/services/authPolicyService.js,
src/hooks/useScopedIssues.js, src/hooks/useScopedAlerts.js, src/hooks/useUserScope.js,
src/utils/orgModel.js, scripts/provisionAuthClaims.js, firestore.rules,
firestore.indexes.json, firebase.json.

DIAL IN THESE AREAS (make them concrete and correct)
1. W0.0: specify the token-mint contract end-to-end — endpoint shape, server-side PIN/
   identity verification (no client-asserted userId), custom-token claims, the exact
   PinLogin change, and the rollout order for flipping authScopeEnforced without lockout.
   If no `functions/` exists, define exactly how this backend is stood up.
2. Firestore rules: provide concrete rule snippets for eocIssues + activity (incl. the
   BHT `reported`-only create), the tightened `alerts` read (per-user targetUserId OR
   broad supervisor via authRoleAndLocationAllowed — NOT the exact helper), `issueAccess`,
   `userHomeState`, and exact-location `shiftDebriefs get`. Ensure the new exact rules
   carry NO `|| hasLegacyAuthSession()` bypass and fail closed.
3. Prove out the rules-`get()`-in-list pattern for the board (backup-grant access in a
   list query); state the exact client query constraints required and confirm the
   30-disjunction math (location × status). List the precise firestore.indexes.json
   entries to add (JSON).
4. Fan-out: specify recipient enumeration (`shiftAssignments` by locationId + active,
   dedupe bhtUserId), reporter dedupe, atomicity boundary (status txn vs the alert
   batch), batch limits, and the useScopedAlerts changes (unread count + respect read).
5. Activity/`latestActivity`: exact write points in both status call sites + the create
   and offline-create paths; preserve expectedVersion/version, writeAuditLog, actor
   fields, related-alert read-marking; define void fields + shared closedAt.
6. Tighten any remaining vague acceptance criteria into emulator-testable assertions;
   mark which require W0.0. Fix any inaccurate file:line citations you find.
7. Sanity-check the build sequence and the cutover runbook steps for ordering hazards.

OUTPUT
- Edit docs/bht-home-implementation-plan.md in place; bump the title/status to v2.3.
- Add a short "v2.3 changelog" section listing exactly what you changed and why.
- Add/refresh a "Residual risks" section (execution risks that remain).
- Keep it decision-complete and implementation-ready. Do not modify app code.
- End your chat reply (not the file) with a go/no-go and any blockers found.
