# Codex prompt — verification pass (do not implement)

Paste the block below into Codex. This is the FIRST pass: verify the plan against the
codebase and report. No code changes.

---

ROLE
You are a senior React/Firebase engineer doing a VERIFICATION pass on an
implementation plan. DO NOT write or modify any code. DO NOT implement. Your only job
is to check the plan against the actual codebase and report back.

REPO
SPRC Ops Hub — a Vite + React + Firebase app used by behavioral-health technicians
(BHTs) on shift. Mobile-first.

READ FIRST
1. docs/bht-home-implementation-plan.md   (the plan to verify)
2. docs/mockups/bht-home-final.html        (the visual source of truth — 3 screens)

KEY CODE TO INSPECT
- src/components/BhtHub.jsx          (the BHT Home being redesigned)
- src/App.jsx                        (routing: parseAppRoute, renderShell, navigate;
                                      handlers: handleNavigateToIssue ~L967,
                                      handleAddDebriefNote, handleEditDebrief,
                                      handleNavigateToDebrief)
- src/hooks/useScopedIssues.js       (eocIssues query, inEocScope)
- src/services/bhtIssueReportService.js
- src/services/offlineSyncService.js
- src/services/notificationService.js (eoc_issue, eoc_issue_update)
- src/components/SupervisorEocPanel.jsx (resolve/status path)
- src/services/shiftDebriefService.js (/debrief/quick, /debrief/full)
- src/components/NotificationCenter.jsx
- firestore.rules
- src/index.css

WHAT TO VERIFY
A. Accuracy of the plan's "Current-state findings" (§1) — do the named files,
   handlers, routes, hooks, collections, and fields actually exist and behave as
   described? Note anything wrong or out of date.
B. The non-regression mapping (§5) — confirm every listed handler/route exists and
   that the redesign can reuse it without breaking transport, EOC, debrief
   (especially onEditDebrief -> /debrief/full submit path), or the
   onDebriefAssignmentChange context wiring.
C. The two wiring fixes (§11) — is adding /issues and /issues/:id via parseAppRoute +
   renderShell feasible exactly as written? Does the eoc_issue_update alert carry the
   issueId that Fix B's deep-link needs?
D. The activity-log data model (§10) — assess subcollection vs array, and whether
   bhtIssueReportService, offlineSyncService, SupervisorEocPanel, and
   notificationService are the correct/complete write points. Flag any missed path.
E. Counts + Resolved queries (§10) — can useScopedIssues supply open/in_progress
   counts as described? Confirm the exact resolved-timestamp field name for the
   Resolved-30-day query.
F. Permissions (§12) — what do firestore.rules currently allow BHTs for eocIssues?
   What rule changes are required for read-scoping + the activity subcollection +
   restricting writes?
G. Resolve every item in "Open assumptions to verify" (§19) with a concrete answer
   from the code.
H. Acceptance tests (§18) — are any untestable or missing a needed hook/data point?

OUTPUT (report only, no code)
1. Confirmed — items in the plan that match the code.
2. Corrections — anything inaccurate, with the correct detail + file/line.
3. Risks / gaps — regressions or missing steps the plan doesn't cover.
4. Answers to §19 assumptions (one line each).
5. Suggested plan edits — precise wording changes, if any.
6. Go / no-go for implementation, with blockers listed.
