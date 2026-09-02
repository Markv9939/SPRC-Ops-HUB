# SPRC Ops Hub Master Plan

Last updated: 2026-09-01
Document status: Active living blueprint
Current verified `Main` baseline: PR #22 merged as `647baaf`, with final dead-rule cleanup through PR #24; the server-only PIN/custom-token security retirement is deployed and live
Related evidence log: [`PROGRESS_LOG.md`](PROGRESS_LOG.md)

## Mark's Notes Inbox

This is Mark's manually editable control area. Write thoughts here in normal language. Notes do not need technical wording or a complete solution.

Do not overwrite, rewrite, move, or remove Mark's inbox notes unless Mark explicitly asks for the inbox to be processed. When processing is requested, preserve the original wording, organize any confirmed decision into the plan, mark the note processed, and move it to the Processed Notes Archive. Never silently delete it.

### New notes

- `[NEW]` Add notes here.

### How `update master plan` works

When Mark says **`update master plan`**, the person or agent doing the work must:

1. Read this inbox and the relevant Master Plan sections before making edits.
2. Separate a confirmed decision from a loose idea, question, concern, or possible future feature.
3. Put confirmed decisions into the correct plan section.
4. Preserve each processed inbox note by changing its label to `[PROCESSED YYYY-MM-DD]` and moving it to the Processed Notes Archive near the end of this file. Never silently delete Mark's words.
5. Put unresolved ideas in Future Ideas or Open Questions. Do not describe them as approved work.
6. Update release status only when there is direct evidence such as code, tests, Git history, deployment output, or verified configuration.
7. Add significant implementation or release evidence to `PROGRESS_LOG.md`.
8. Never change app code, Firebase settings, security rules, authentication, production data, or deployments merely because the notes or plan were updated. Implementation still requires separate approval.

## Current State

| Area | Current summary |
|---|---|
| **Active** | Core BHT, EOC, transport, issue handoff, Shift Debrief, supervisor review, and supported offline workflows remain the current operating baseline. |
| **Complete** | Final compatibility retirement is merged and deployed. Browser PIN trust, legacy/Anonymous fallback, direct browser account/PIN mutation, permissive rules branches, obsolete cutover/reset commands, and the obsolete `establishPinSession` endpoint are removed while the staff-facing PIN experience and workflows remain intact. |
| **Released support** | Production uses server-verified six-digit PIN login for all active profiles, stable custom-token identity, persistent absolute 84-hour independent device sessions, strict authorization, workflow-scoped claims, protected server actions, and monitoring-only App Check. The final release is merged through `647baaf`. |
| **Paused** | App Check enforcement remains off by design. No PIN reset, deactivation, session-ending, or production-data mutation is part of the compatibility-retirement release. |
| **Next release sequence** | The security-foundation update is closed. Future work should begin from `Main`, preserve this trust boundary, and use the normal Orient / implement / verify / Close out sequence for the next product update. |

The staged canary and staff rollout are complete. The current closeout preserves the familiar six-digit screen while making the server-verified custom-token identity the only supported login path. Anonymous Authentication is not used, and App Check remains monitoring-only.

Configuration and live release state can drift. Recheck current evidence before using this summary for a production decision.

## Simple Working Flow

### `Orient`

Use `Orient` at the beginning of a new SPRC Ops Hub task.

Before answering, read:

1. Project guidance, especially `PROJECT_INSTRUCTIONS.md`.
2. This Master Plan.
3. Mark's Notes Inbox without changing it.
4. The relevant recent entries in `PROGRESS_LOG.md`.
5. Current code or configuration evidence when the requested topic may have changed since the documents were written.

Return one concise orientation with exactly these five parts:

1. **Current focus** — what the project is trying to accomplish now.
2. **Relevant app flow** — how the requested area works end to end.
3. **Major past decisions** — only the decisions that constrain this task.
4. **What could be affected** — connected screens, services, data, roles, locations, offline behavior, rules, or release layers.
5. **Known risks / unfinished work** — blockers, limitations, open questions, and stale evidence that must be rechecked.

`Orient` is read-only. It does not authorize application edits, Firebase changes, production actions, commits, pushes, or deployments.

### Work normally

After orientation, discussion, planning, approved implementation, testing, and explicitly authorized releases proceed normally. Mark should not need a collection of special documentation commands. Use ordinary requests and preserve the normal approval boundaries for risky or production work.

During work, do not continuously rewrite these documents as a diary. Keep rough ideas in Mark's Notes Inbox or clearly labeled planning discussion. Keep partial implementation labeled in progress.

### `Close out`

Use `Close out` only when the requested work is genuinely finished or when Mark explicitly asks to close out a completed body of work.

1. Confirm the actual outcome and whether the work is local, committed, pushed, deployed, configured, enabled, rolled back, or not released.
2. Summarize tests and direct evidence, including what was not verified.
3. State remaining risks and follow-ups.
4. Update this Master Plan with the new current behavior and a short high-level summary.
5. Append the detailed evidence entry to `PROGRESS_LOG.md`.
6. Recheck both documents for contradictions and clearly supersede older statements when necessary.

Do not use `Close out` to turn brainstorming, an unapproved design, a partial implementation, a failed test run, or an unfinished release into current app truth. If work is blocked or incomplete, report that status plainly and leave it labeled in progress, planned, paused, or unresolved.

### Two-document rule

The two long-term project records are:

- `MASTER_PLAN.md` — quick orientation, current behavior, current state, major decisions, plans, risks, and open questions.
- `PROGRESS_LOG.md` — dated evidence for significant completed, released, rolled-back, or materially blocked work.

Do not create a third permanent decision log, task diary, or competing master blueprint. Major decisions belong in this Master Plan. Supporting README files, project guidance, runbooks, and test reports may still exist for their specific purposes, but they are not a third long-term planning record.

## Major Decisions

This section is only for large choices that are difficult to reverse or that constrain many future features. Add an entry only after Mark clearly confirms the decision. Each entry must state the decision, why it exists, what it affects, and whether it is current, planned, paused, or superseded.

### Keep the familiar PIN experience while replacing the backend trust boundary

- **Decision:** Staff should continue using the simple six-digit PIN screen. The planned security foundation will validate the PIN on the server and issue a stable Firebase identity tied to the existing Ops profile.
- **Reason:** Staff need a simple login, while protected records, photos, roles, and locations need consistent server proof.
- **Effect:** Do not enable Anonymous Authentication or strict global enforcement as a shortcut. Build and prove the replacement in staged workflow groups.
- **Status:** Current production behavior. All active profiles use the server PIN/custom-token path; the compatibility fallback and obsolete compatibility endpoint are removed.

### Use persistent 84-hour per-device sessions with automatic all-device revocation

- **Decision:** A successful PIN session may persist across browser close/reopen on the same device for an absolute, non-sliding maximum of 84 hours. The same staff member may have independent sessions on multiple devices. Ordinary logout ends only that device's session.
- **Reason:** Staff need uninterrupted access through a 3.5-day shift while still requiring a bounded session and reliable emergency cutoff.
- **Effect:** Deactivation, PIN change, role reduction, home-location removal, temporary/issue-access change, and admin end-all-sessions must automatically invalidate every device with audit evidence. A role/location/access change signs the person out everywhere; the next login receives only current access. A temporary grant expiration may end that scoped session before the otherwise absolute 84-hour maximum so expired access cannot linger.
- **Status:** Current contract. Live persistence, independent two-device use, one-device logout, supervisor end-all-sessions, and real Android Chrome offline full-close/reopen passed. The retirement candidate additionally passes emulator/browser expiry, revocation, stale-tab, offline-network timing, and reconnect gates.

### Preserve scoped supervisor BHT account creation and management

- **Decision:** Preserve the existing practical supervisor/admin user-management experience. A supervisor may create a BHT/tech account and may reset a PIN, deactivate/reactivate, end sessions, and manage operational assignment/access for a BHT/tech whose single home location is within that supervisor's authorized main-location scope.
- **Reason:** Location supervisors must manage day-to-day staffing without sending every account action to an administrator.
- **Effect:** Supervisors cannot create or manage supervisor/admin accounts, elevate a BHT to supervisor/admin, grant a location outside their own scope, or change global security settings. Each active BHT/tech must resolve to exactly one home location; zero or multiple homes are invalid configuration for admin correction.
- **Status:** Confirmed operating contract. The corrected protected server, UI, scoped query, strict-rule behavior, secure-session PIN generator, and compatibility-reload fix are merged through `1028347` and deployed to the existing three-profile Identity/Users canary. Live Test Supervisor scope, OTC BHT creation, both enrolled BHT journeys, persistence, independent-device behavior, supervisor all-device revocation, non-enrolled compatibility login/reload, and admin-created RES BHT scope/login passed. The RES BHT was also denied Users-page access as required.

### Enforce role and location boundaries through the full workflow

- **Decision:** Role and location protection must exist in the UI, service transactions, offline replay, Firebase rules, and protected Functions where applicable.
- **Reason:** Hiding a tab does not prevent an unauthorized database or Storage request.
- **Effect:** Every sensitive workflow test must prove the correct role can do normal work and the wrong role/location cannot.
- **Status:** Confirmed operating contract. All eight named workflow groups are protected under strict current-session authorization; the final local matrix passed every group across the required role/device views.

### Preserve useful offline work and stop unsafe replay for review

- **Decision:** Supported drafts, photos, and outbox work remain available during weak/no signal. Stale, conflicting, revoked, wrong-user, or unauthorized replay must stop as `needsReview` rather than syncing silently or retrying forever.
- **Reason:** Staff work in real shifts with unreliable connectivity, but reconnecting must not bypass current ownership or authorization.
- **Effect:** Online and offline paths must be designed and tested together; security hardening cannot discard valid local work. Unsynced work stays with its original owner. Normally that staff member signs back in and syncs it. If the owner is deactivated, hold it safely; do not change another person's PIN or sign in as them. A specialized recovery screen is deferred unless real evidence shows recurring need.
- **Status:** Confirmed current contract. Owner/session/security/location binding and safe hold/review behavior are implemented and verified for all 11 supported queued-action types. Offline replay is bound to the current secure session for all staff.

### Pin each EOC to a published template version

- **Decision:** Existing or in-progress EOCs keep the template version they started with. A newly assigned default begins with the next applicable EOC cycle.
- **Reason:** A checklist must not change under staff while they are completing it, and issue history must retain the exact question/version context.
- **Effect:** Published versions remain immutable, tracking IDs preserve recurrence identity, and assignment changes do not rewrite active EOCs.
- **Status:** Confirmed current template contract. Template/photo and protected EOC behavior passed the synthetic canary; broader operational assignment remains tied to staged staff enrollment rather than a remaining canary blocker.

### Keep BHT completion separate from supervisor-verified issue closure

- **Decision:** A BHT may document completed work and submit it for review, but a supervisor/admin approves final resolution or returns it with an explanation.
- **Reason:** Staff need a practical completion step while supervisors retain accountability for verified closeout.
- **Effect:** `pending_supervisor_review` remains active and visible until supervisor action.
- **Status:** Confirmed, released, and enabled at the verified 2026-08-17 release state.

### Lock Shift Debrief corrections and reassignment after first valid incoming signoff

- **Decision:** Only assigned incoming staff can confirm; the outgoing submitter cannot confirm their own handoff. The first valid incoming signoff locks further outgoing corrections and supervisor reassignment.
- **Reason:** Incoming acknowledgment must be genuine, and signed-off information must not change afterward without visibility.
- **Effect:** Later assigned incoming staff may still acknowledge, but the original outgoing submitter, correction-count protection, and reassignment rules remain enforced across UI, transactions, offline replay, and Firestore rules.
- **Status:** Confirmed and released in `8339827`.

## Current Direction

These are the current high-level priorities. They guide planning but do not authorize implementation or deployment.

1. Preserve the daily workflows that already work for BHTs, supervisors, and admins.
2. Keep staff-facing work simple, phone-friendly, and practical during busy shifts.
3. Preserve the familiar six-digit PIN experience while keeping server verification, custom-token identity, current device sessions, and backend authorization as the only supported trust boundary.
4. Do not enable Firebase Anonymous Authentication and do not turn on strict global authorization as a shortcut.
5. Keep custom EOC template access, task generation, checklist loading, photo upload, and fallback protection under the same verified staff session and scoped query boundary.
6. Protect offline work while strengthening replay checks so stale, revoked, wrong-user, and conflicting actions stop for review instead of syncing quietly.
7. Release security work in small workflow groups with role, location, phone, desktop, online, offline, and rollback evidence at every stage.

## Security Foundation Completion Stages

This is the approved sequence for finishing the secure PIN/custom-token update without repeating completed Phases 1–9 or breaking ordinary staff work:

1. **Complete:** Lock the `44b6e44` source/deployment/rollback checkpoint and correct stale documentation.
2. **Complete:** Complete Identity/Users locally: scoped supervisor BHT creation/management, backend-constrained Users queries, matching rules, and a guarded secure Hosting build.
3. **Complete:** Release and finish the three-profile Identity/Users canary, including the Test Supervisor, both Test BHTs, compatibility fallback, EOC regression, real query scope, device/session behavior, RES account scope, and rollback. The corrected release is merged through `1028347`. Every named live journey passed. Production audit readback confirms the same release completed rollback/reactivation drills before the live staff journeys; current readback still matches the verified rollback anchor. The drill was not repeated after live verification because that would unnecessarily interrupt the working canary and duplicate completed evidence.
4. **Complete:** Enable and prove `templates_photos` for the same cohort, including scoped supervisor/BHT access, authorized photo upload, wrong-location denial, reload, rollback, and reactivation.
5. **Complete:** Enable and prove `eoc`, including protected EOC submission, scoped offline replay, app-layer endpoint rejection, reload, rollback, and reactivation.
6. **Complete:** Enable and prove `debriefs_alerts`, including the full local send/receive/correction/reassignment/timing/offline matrix plus live Test House supervisor scope without RES exposure, rollback, and reactivation.
7. **Complete:** Enable and prove `issues_feedback_audit`, including the full local role/location matrix and a live synthetic BHT resolution submission plus scoped supervisor approval, rollback, and reactivation.
8. **Complete:** Enable and prove `transports`, including the two-device active-transport conflict contract and a live synthetic create/complete/scoped-supervisor journey, rollback, and reactivation.
9. **Complete:** Enable and prove `operations_admin`, then `settings`. Live supervisor Properties, Fleet, Compliance, and Cintas reads stayed OTC/Test House scoped; BHT Settings startup/reload passed. One approved, backed-up two-record fleet metadata correction supplied the exact existing OTC scope required by strict queries. Both stages passed rollback and reactivation.
10. **Complete for this canary:** The 11-action offline/reconnect browser matrix passed. A 24-hour aggregate App Check observation contained all six protected endpoint groups across 63 samples; every sample correctly recorded App Check as absent, enforcement remained false, and no token/key was enabled. This is monitoring evidence, not enforcement readiness.
11. **Complete:** The three-profile Lone Mountain cohort, normal existing-PIN first logins, independent-device/logout checks, Android Chrome offline close/reopen correction, and broad-account identity readiness were completed before all-active activation.
12. **Complete historical cutover support:** PR #19 merged as `e54322b`; its compatibility-session guard and checksum-backed rollout/cutover tooling supported the controlled transition. The final retirement candidate removes those now-obsolete commands so they cannot reopen compatibility mode.
13. **Complete:** Secure login was changed to all-active-profile mode while strict authorization remained off for observation.
14. **Complete:** Every active profile passed the valid-profile, unique server-credential, stable-identity, and normal-login readiness boundary.
15. **Complete:** Strict authorization was enabled, rolled back when scoped background queries exposed defects, corrected workflow-by-workflow, re-enabled, and verified. The last scoped Supervisor query correction is merged through `123dbec`.
16. **Complete:** Browser/server/rules compatibility trust paths and obsolete downgrade/reset commands are removed. The retirement gate, 102 unit contracts, 44 security emulator contracts, strict Firestore/Storage suites, full workflow browser matrix, offline owner/replay matrix, and cold offline shell/process gates passed. App Check remains monitoring-only.
17. **Complete:** PR #22 merged the final candidate as `647baaf`. Functions, Firestore rules, Storage rules, and Hosting deployed together; production runs 16 current Node 22 functions, the obsolete `establishPinSession` endpoint is absent, exact new Hosting assets returned HTTP 200, and the already-signed-in scoped Test House session survived a live reload with normal Home data. PRs #23–24 then removed only rule helpers made unreachable by retirement, with the strict suite still green and the final Firestore rules-only release compiling without warnings.

Every stage follows one gate: implement and test locally, capture rollback, deploy dormant, enable only the named cohort/workflow, test positive and negative live behavior, exercise rollback, record evidence, and only then continue. PIN resets, deactivation, session ending, production-data changes, deployments, activation, and compatibility retirement retain their explicit approval boundaries.

## 1. Purpose of This Plan

This is the readable, living operational blueprint for SPRC Ops Hub. It explains how the parts are intended to work together from the beginning of a shift through the next shift's handoff and supervisor follow-up.

Use this file for quick orientation, current behavior, current direction, major decisions, active risks, and future planning. Use `PROGRESS_LOG.md` for exact files, commands, tests, release evidence, and detailed session history. These are the only two long-term project records.

### Status labels used in this file

- **Current:** Confirmed in the checked-out code, recent release history, or verified configuration.
- **Released with limitation:** Shipped, but a known dependency or blocker prevents safe full use.
- **In progress:** Work has started or a verified design exists, but it is not complete or broadly ready.
- **Planned:** Agreed direction, but not implemented.
- **Future idea:** Worth preserving, but not approved as implementation.
- **Open question:** Requires Mark's decision or more evidence.
- **Superseded:** Kept for history but no longer the current direction.

## 2. What the App Is For

SPRC Ops Hub is a React and Firebase operations tool for behavioral-health support and facilities work. Its purpose is to help staff complete daily work, pass important information between shifts, and give supervisors a reliable review trail without making frontline workflows unnecessarily complicated.

The app connects three operating levels:

- **BHT / tech:** Complete transports, EOCs, issue follow-up, shift notes, and shift handoff work.
- **Supervisor:** Oversee assigned locations, staff assignments, EOC status, issues, debriefs, transports, properties, fleet, compliance, and Cintas work.
- **Admin:** Govern users, access, templates, app feedback, audits, organization-wide settings, and sensitive actions.

### Operating principles

- Use the minimum information needed for safe operations and accountability.
- Make required fields strict at submit, close, approve, or other high-risk points.
- Keep submitted records reviewable; prefer status changes and audit history over silent deletion.
- Preserve staff ownership, version checks, and location boundaries across the screen, service logic, offline replay, and database rules.
- Keep important problems visible until a responsible person completes the correct closeout step.
- Preserve the app's permanent profile IDs when security is strengthened; do not rewrite operational history without a proven need.

## 3. How Work Moves Through the App

The simplified information flow is:

```text
PIN-selected staff profile
        |
        +--> role and location/shift/van scope
        |
        +--> assignments --> EOC tasks --> submissions --> issues/photos/alerts
        |
        +--> transports -------------------------------> alerts/audit/review
        |
        +--> shift notes --> outgoing debrief --> incoming confirmation
                                   |                    |
                                   +--> corrections <--+
                                   +--> supervisor review/reassignment

Offline drafts/outbox preserve supported work on the device and replay it when online.
Version, ownership, role, location, and current-state checks decide whether replay succeeds
or stops as "needs review."
```

The screen, stored record, alert, audit entry, and supervisor view should describe the same event. A workflow is not complete merely because one screen looks correct.

## 4. End-to-End Operational Blueprint

### 4.1 Shift start and access

**Current**

1. Staff enter a unique six-digit PIN.
2. A protected server Function verifies the server-only PIN credential, rate limit, active profile, and valid single-home BHT configuration without exposing PIN/hash material.
3. The server issues a stable Firebase custom-token identity and an independent per-device session bound to the profile security version and current role/location/workflow scope.
4. The client waits for Firebase identity/session readiness, loads a sanitized live profile, and only then routes BHT/tech staff to Home or supervisors/admins to the management dashboard.
5. The same-device session persists across browser close/reopen for an absolute maximum of 84 hours. Ordinary logout closes only that device. Approved security/access changes revoke every device.
6. Supported already-loaded work can continue offline. The saved secure session is preserved through transient offline startup failures and reverified on reconnect; locally expired sessions still end immediately.
7. Browser storage never becomes the authority for role, location, PIN, profile state, or workflow authorization.

### 4.2 BHT / tech home and daily work

**Current**

The BHT home is an action-first shift workspace. It shows assignment context and direct paths to:

- Start or continue one active transport.
- Review current issues and unseen updates.
- Report a new operational issue, with optional photos.
- Add quick Shift Debrief notes or open the full debrief.
- Complete assigned Van and House EOCs.
- Review transports completed today.
- See offline/pending-photo or pending-sync information when applicable.

If no active assignment exists, the BHT should not be allowed to guess a location, shift, or van. The screen should clearly state that an assignment is missing and direct the user to a supervisor.

### 4.3 EOC assignments, tasks, and completion

**Current core flow**

1. Supervisor/admin assignment information identifies the location, shift, eligible BHTs, and assigned vans.
2. While online, supervisor/admin sessions run the EOC task engine at session start and about every five minutes.
3. The task engine creates or updates House and Van tasks, calculates pending/overdue state, and marks no-longer-applicable tasks missed or ignored according to lifecycle rules.
4. House EOCs are shared by location and shift. Van EOCs are limited to vans assigned to the BHT.
5. Opening a task verifies that it is still pending or overdue.
6. The checklist loads the task's fixed template/version when available. It supports section navigation, required/optional questions, rapid Pass/Issue answering, repair notes, supported question types, and photos.
7. Draft answers autosave and restore for the same staff profile and task.
8. Submission validates required answers. Repair/attention responses require the information needed for follow-up.
9. A successful submission records the EOC, completes the task, and creates or updates downstream issues and alerts when attention is required. Van mileage can also update fleet runtime.
10. Version checks prevent a stale task or draft from silently overwriting newer work.

**Template behavior**

- The intended model is a versioned template library with private drafts, reusable sections, immutable published versions, and one default assignment per location + shift + EOC type.
- Supervisors work only within allowed locations. They copy shared templates rather than altering another owner's published template.
- Admins retain broader archive, replacement, and permanent-removal controls.
- Existing/in-progress EOCs keep the template version they started with; a newly assigned default applies to the next applicable cycle.
- Permanent question tracking IDs preserve issue recurrence history when wording or order changes.

**Current security status**

The Guided Canvas builder, protected template Functions, template reads, response-photo Storage path, EOC submission, and scoped EOC queries now operate behind the same mapped current-session boundary. The final local workflow matrix passed supervisor library loading, BHT in-scope photo upload, wrong-location denial, owner-bound offline replay, and idempotent protected EOC submission.

### 4.4 Transport work

**Current**

1. A BHT can have only one active transport (`open` or `arrived`) at a time.
2. Starting a transport requires the correct staff identity and scoped site. The guided form collects the operationally required client, destination, and reason information; optional notes stay secondary.
3. The transport stays available from the BHT home until it is closed.
4. Staff can record progress, arrival/return details, required discharge-paperwork confirmation when applicable, and final closeout information.
5. BHTs can correct their own active or completed start/finish times within the guarded transport workflow. Corrections preserve the record rather than replacing it with an unrelated transport.
6. Closing validates required information and writes alert/audit follow-up where configured.
7. Supervisors/admins can review transport history within their scope; they do not use the BHT's live editing workflow as a substitute for staff attribution.

**Offline**

Supported transport creation, updates, and closeout can be saved locally and replayed. Local records remain clearly marked until the server creates or updates the real record. Duplicate-active-transport and stale/version checks still matter when replay occurs.

### 4.5 Issues, photos, alerts, and app feedback

**Current issue flow**

1. An issue can begin from a BHT report, an EOC repair/attention answer, or authorized supervisor/admin work.
2. The issue stores location, reporter, source, status, version, activity history, and recurrence/tracking information needed for follow-up.
3. Active statuses include `open`, `in_progress`, and `pending_supervisor_review`.
4. A BHT can document completion with a required resolution note and optional photos, then submit the issue for supervisor review.
5. The issue remains active as `pending_supervisor_review`; it is not treated as finally resolved merely because the BHT completed the work.
6. A supervisor/admin can approve it to `resolved` or return it to `in_progress` with an explanation.
7. `voided` and other terminal handling preserve reviewable history; they are not silent deletion.
8. Version checks and immutable activity entries protect against two people acting on an outdated issue.

**Handoff communication**

- Shift Debrief shows live current and recently resolved issues when available.
- Incoming confirmation records the issue versions/activity markers reviewed during signoff.
- Original snapshots remain available for audit/fallback, but the app does not rely on an indefinitely frozen duplicate list as the daily view.

**Photos**

- Staff may take a photo or choose one from the device.
- Photos are processed before upload and can wait in the offline attachment queue.
- Issue records remain valid even if an optional photo upload fails; the app should show the pending failure and allow retry.
- Photo access, retention, privacy removal, and known-path protection remain sensitive security work. Current Storage rules require the mapped current session and exact workflow/location scope; retention/privacy removal remains server-controlled.

**Alerts**

- Issue creation and status changes create scoped supervisor or targeted BHT alerts.
- EOC, fleet, transport, and debrief timing can also create alerts.
- Header counts and notification views must use the same role/location/audience rules as the underlying records.
- Alerts help direct attention; they do not replace the authoritative issue, task, transport, or debrief record.

**App feedback**

- “The app is not working correctly” feedback is intentionally separate from operational/facility issues.
- Staff can submit app feedback, including supported offline submission.
- Admins review app feedback without mixing it into location issue closeout or Shift Debrief.

### 4.6 Shift end and outgoing Shift Debrief

**Current**

1. Staff can capture quick notes throughout the shift and open the full debrief editor later.
2. The editor organizes client and general handoff notes into a readable document rather than one large text box.
3. Online collaboration and draft autosave preserve work. Conflicts must be resolved before submission.
4. Submission requires at least one complete note and a final confirmation that the original notes will lock.
5. The submitted record stores the outgoing staff identity, location, shift, receiving shift, assigned incoming staff, timing information, issue snapshot/markers, version, and submitted notes.
6. The original submitted notes become locked. Missing information is added as a dated correction rather than silently editing the submitted handoff.
7. Only the original outgoing submitter may add corrections, and only until the first valid incoming signoff closes corrections.

### 4.7 Incoming Shift Debrief confirmation

**Current**

1. Only staff specifically assigned to the incoming shift may confirm the handoff.
2. The outgoing submitter cannot confirm their own handoff.
3. Incoming staff review the submitted notes, current/recent issue information, required confirmation items, and any corrections.
4. If a correction is added while someone is reading, confirmation is blocked until the reader explicitly reviews the newest correction.
5. Offline confirmation records the expected correction count. If the debrief changed before replay, the queued confirmation becomes `needsReview` instead of signing off against stale information.
6. The first valid incoming signoff locks further outgoing corrections and supervisor reassignment. Other assigned incoming staff may still record their own acknowledgments.
7. Late/missing incoming confirmation remains visible to supervisor oversight and timing alerts.

### 4.8 Supervisor debrief review and reassignment

**Current**

- Supervisors/admins can filter and inspect submitted debriefs, notes, corrections, incoming assignments, acknowledgment state, and late status within their allowed scope.
- Before any valid incoming signoff, a supervisor/admin may correct the assigned incoming staff by choosing active staff from the correct incoming shift and entering a required reason.
- Reassignment resets affected confirmation state, retires old alerts, creates the correct new alerts, increments the record version, and creates audit history.
- Reassignment does not allow a supervisor to sign on behalf of incoming staff.
- After the first valid incoming signoff, reassignment and corrections remain locked.

### 4.9 Supervisor and admin operations beyond the handoff

**Current**

Supervisor/admin navigation includes Dashboard, Transports, Debriefs, Users, EOC, Compliance, Properties, Fleet, and Cintas. Admin-only areas include App Feedback and Audit.

- **Dashboard:** Operational queues, overdue/upcoming work, alerts, and summary counts.
- **Users:** Role, location, shift, van, active/deleted state, and managed PIN/access controls. Supervisor management remains scope-limited.
- **EOC:** Issue oversight plus template/library/assignment management, subject to the current template-auth limitation.
- **Transports:** Scoped history and record review.
- **Debriefs:** Handoff review, confirmation status, and guarded reassignment.
- **Properties:** Property profiles and House EOC status.
- **Fleet:** Vehicle maintenance profiles, milestones, service records, and persistent fleet tasks.
- **Compliance:** Employee-centered compliance records and due-date work.
- **Cintas:** Location-based service/compliance items.
- **App Feedback:** Admin review of application problems reported by staff.
- **Audit:** Admin review of privileged and operational action history.

## 5. Role and Location Boundaries

### Current intended boundaries

| Role | Normal scope | Can create/change | Cannot do by design |
|---|---|---|---|
| BHT / tech | Own active profile, assigned location/shift/vans, own transports, eligible EOCs, location issue handoff | Daily records, assigned EOCs, issue reports/follow-up, debrief notes/submission/assigned incoming signoff, own transport work | Manage users, approve final issue resolution, reassign debrief receivers, manage global settings |
| Supervisor | Authorized main locations and BHT/tech staff whose one home location belongs to that scope | Create scoped BHT/tech accounts; reset scoped BHT PINs; deactivate/reactivate and end sessions; manage scoped assignments/access; review/return/approve issues; review debriefs/transports; correct debrief receiver assignment; manage scoped operations/templates | Create or manage supervisors/admins, elevate roles, grant out-of-scope locations, change global security, use global admin-only audit/feedback controls, perform permanent destructive template actions |
| Admin | Authorized global operations | User/access governance, global review, sensitive template/privacy/settings actions, audit and feedback review | Bypass required reasons, version checks, audit history, or explicit production change approval |

`tech` is a compatibility role normalized to the BHT operating model where older records still use it.

### Security reality today

The UI, custom-token claims, live profile/security version, server device-session records, protected Functions, and strict Firestore/Storage rules now enforce these boundaries together. Hiding a tab is still never treated as authorization proof; every list query and mutation must continue to pass its backend role/location/owner/version contract.

## 6. Offline Behavior

### Current supported pattern

- IndexedDB stores supported drafts, outbox actions, and photo attachments on the device.
- Outbox records carry an `ownerProfileId` so one staff member's queued work is not intentionally replayed as another person's work.
- Supported queued actions include EOC submission, Shift Debrief quick notes/submission/corrections/confirmation, issue reports and attachments, app feedback, and transport create/update/close.
- When connection returns, the app replays pending/failed work for the active profile.
- Successful replay removes or marks the appropriate local work as synced.
- Permission, stale-version, changed-correction-count, wrong-state, and similar safety failures become `needsReview` when recognized.

### Current secure offline contract

Before replaying sensitive work, the app proves that Firebase Auth is ready and the server-mapped staff profile matches the outbox owner. Disabled users, changed access, changed PIN/session, wrong-user work, stale actions, and permission failures stop for review instead of retrying forever. Original-owner work is held safely until that person can sign in; deactivated-owner work is not forced through under another identity. A specialized recovery tool remains later-only unless recurring operational evidence justifies it.

Offline capability must not be “fixed” by discarding drafts or forcing staff to remain online during normal shift work.

## 7. Safety and Technical Guardrails

These rules apply to current and future work:

- No authentication, rule, Storage, production-data, or deployment change without explicit approval.
- Do not enable Anonymous Authentication or strict global enforcement as a shortcut.
- Do not claim a workflow is secure because the correct tab is hidden.
- Do not use real client information or real workplace photos in tests.
- Protect submitted records with immutable originals, corrections/activity history, version checks, and reasons for sensitive changes.
- Preserve permanent profile IDs and existing operational history unless a previewed migration proves a change is necessary.
- Keep BHT work within assignment/location/shift/van scope and supervisors within authorized locations.
- Keep admin-only actions separate and auditable.
- Treat Firestore rules as query constraints, not filters. Real listeners must include the fields required by strict rules before enforcement.
- Test online and offline paths together. A direct online success does not prove queued replay is safe.
- Coordinate Hosting, Functions, Firestore rules/indexes, Storage rules, and configuration when a release spans them. Never roll back only one layer if the layers depend on each other.
- Keep backups, exact prior versions, feature/config versions, and a go/no-go decision for each sensitive release stage.

## 8. Current Security Foundation Assessment

### Current production and release-candidate state

- The verified production source baseline is `Main` `647baaf`, with all-active server PIN/custom-token login, strict authorization, and final compatibility retirement operating.
- The released system removes browser-trusted PIN lookup/hash code, compatibility session markers, Anonymous/legacy fallback, direct browser PIN/account mutation, server migration/private legacy endpoint code, and Firestore/Storage compatibility branches.
- Server-only salted credentials, rate limiting, stable UID mappings, current per-device session records, security-version revocation, workflow claims, protected account actions, and protected operational Functions remain.
- The familiar six-digit screen, absolute 84-hour same-device persistence, independent multi-device sessions, one-device logout, all-device security revocation, scoped Users management, and original-owner offline replay remain required behavior.
- App Check remains monitoring-only and unenforced. Anonymous Authentication is neither needed nor used.
- The former broad-rollout, compatibility-cutover, Anonymous Storage smoke, compatibility-browser, and pre-secure core-reset commands are retired so a maintenance command cannot silently reopen the old trust boundary.

### Historical local phase status before the production canary

This subsection preserves the earlier local-only checkpoint. It is superseded for current release truth by **Current State** and **Security Foundation Completion Stages** above.

1. **Freeze and document baseline — locally complete:** Exact source/release evidence, coordinated rollback contract, executable session/role/offline contracts, and emulator proof are recorded in [`docs/security/PHASE_1_SECURITY_FOUNDATION_BASELINE.md`](docs/security/PHASE_1_SECURITY_FOUNDATION_BASELINE.md). No runtime behavior changed.
2. **Dormant server-backed PIN login — locally complete:** Server-only salted credential storage and legacy migration, server rate limits, active-profile validation, stable UID mapping, per-device 84-hour records, security-version binding, minimum response data, custom-token issuance, and explicit server-only rule boundaries are implemented and tested. The callable is exported only so the Functions emulator and a later coordinated deployment can load it; it remains disabled by missing/false versioned configuration and is not deployed. See [`docs/security/PHASE_2_DORMANT_SERVER_FOUNDATION.md`](docs/security/PHASE_2_DORMANT_SERVER_FOUNDATION.md).
3. **Safe client bootstrap — locally complete and dormant:** The versioned client path establishes Firebase browser-local Auth, validates claims/session/profile state before protected rendering, stores only minimum per-device metadata, restores online or from verified offline cache, rebuilds live scope, and responds to logout, absolute expiry, Auth loss, and profile/security changes. Both compile-time and server configuration gates must match; the normal build keeps the legacy flow. See [`docs/security/PHASE_3_DORMANT_CLIENT_BOOTSTRAP.md`](docs/security/PHASE_3_DORMANT_CLIENT_BOOTSTRAP.md).
4. **Protected account actions — locally complete and dormant:** Server-side PIN/account/session actions, secure administrator profile creation, automatic all-device revocation triggers, one-device logout, immutable audit, and retryable cleanup are implemented and emulator-tested.
5. **Owner-bound offline replay — locally complete and dormant:** Original-owner/session/security/location binding, safe hold/review behavior, deterministic replay, and exact-version transport protection are implemented and tested. One shared client catalog and an exhaustive client/server/browser matrix cover all 11 supported actions across EOC, debriefs, issues/photos/feedback, and transports.
6. **Named workflow and Storage boundaries — locally complete and dormant:** Identity/users, templates/photos, EOC, debriefs/alerts, issues/feedback/audit, transports, operations administration, and settings can be selected only through exact version-6 server-issued workflow claims. The claims carry only non-secret role/location scope and are accepted only while the matching server device session is current; protected account changes revoke that session immediately. Protected template Functions and photo Storage validate current mapped sessions. See [`docs/security/PHASE_4_TO_8_LOCAL_SECURITY_READINESS.md`](docs/security/PHASE_4_TO_8_LOCAL_SECURITY_READINESS.md).
7. **App Check monitoring — production observation complete, not enforced:** The client and Functions record only presence/absence. The 24-hour aggregate covered login, account/access, offline replay, transport, EOC, and issue groups across 63 samples; all 63 recorded a missing token. Enforcement remains explicitly false. This proves the monitoring trail is complete, not that enforcement is safe to enable.
8. **Canary and rollback — complete for the three synthetic profiles:** Every cumulative workflow stage passed guarded advance, live verification, rollback, and reactivation. The exact process and current boundary are in [`docs/security/SECURITY_CANARY_AND_ROLLBACK.md`](docs/security/SECURITY_CANARY_AND_ROLLBACK.md).
9. **Protected EOC and issue mutations — locally complete and dormant:** The expression-limit-sensitive EOC submission and issue lifecycle writes now have versioned server transactions with current-session, role/location/owner, optimistic-version, idempotency, recurrence, alert, and immutable-audit protection. Strict browser writes are denied only for the selected workflow. See [`docs/security/PHASE_9_PROTECTED_OPERATIONAL_MUTATIONS.md`](docs/security/PHASE_9_PROTECTED_OPERATIONAL_MUTATIONS.md).
10. **Retire compatibility mode — complete and released:** The runtime/rules retirement gate is green, obsolete downgrade/reset commands and endpoint are removed, the complete unit/emulator/browser/offline matrix passed, and PR #22 plus the coordinated production deployment and live reload verification completed the closeout.

### Required proof before each security gate

- BHT/tech normal job, wrong-role, wrong-location, disabled-user, old-PIN, logout, reload, two-tab, phone, desktop, and offline-replay cases.
- Supervisor scoped users, EOC generation/history/templates, issues, debriefs/reassignment, transports, properties/fleet/compliance/Cintas, and no admin-only access.
- Admin global authorized work, user/access management, app feedback/audit/settings, protected privacy/archive/purge actions, and reauthentication where required.
- Unauthenticated, unmapped, inactive, deleted, known-photo-path, invalid-file, stale-token, stale-version, and offline-after-reassignment/deactivation cases.
- Real browser listeners and full workflows against emulators, not only isolated unit or direct-document rule tests.

## 9. Feature and Work Status

### Current active operational features

- Six-digit PIN profile selection and 60-minute inactivity lock.
- BHT action hub, assignment context, scoped House/Van EOCs, draft restore, transport lifecycle, issue reporting, alerts, and Shift Debrief.
- Shift Debrief V2 outgoing/incoming safeguards, corrections, latest-correction review, supervisor reassignment, and offline stale-confirmation protection.
- Issue handoff V2 with `pending_supervisor_review`, BHT resolution submission, supervisor approve/return, live handoff issues, alerts, photos, offline support, and separate app feedback.
- Supervisor/admin dashboards for users, transports, EOC/issues, debriefs, properties, fleet, compliance, and Cintas; admin feedback/audit views.
- Offline drafts/outbox for the supported action types documented above.

### Released under the secure-session boundary

- Guided EOC template builder and protected template administration (`c6b0ec1` baseline plus later security releases): protected Functions and scoped current-session reads are active.
- EOC response-photo upload: protected by the same mapped session, workflow, and location boundary as the related EOC.
- Existing issue-photo and emergency-removal paths also carry UID/session dependencies that predate the builder release.

### In progress

- Security foundation: Phases 1–9, the complete local contract matrix, and the exact three-profile production canary are complete through `settings`. Remaining work is a separately approved broad staff rollout followed later by compatibility retirement; neither is part of this synthetic-canary closeout.
- Template-builder refinement and activation readiness, including safe responsive behavior, truthful assignment state, draft-close safety, and staff-accurate preview.

### Future ideas — not approved implementation

- App Check enforcement, only after monitoring data and a separately approved release show it is safe.
- Stronger device-specific protection for a true shared kiosk, separate from normal personal phone behavior.
- A supervised recovery tool for deactivated-owner offline work, but only if operational evidence later shows the safely held-work pattern is recurring and burdensome.
- Additional reporting, dashboards, and trends only where they directly improve supervisor oversight, compliance readiness, or recurring-problem prevention.

## 10. Open Questions

1. **Resolved:** The first canary profiles are `test_supervisor`, `test_bht_shift_1`, and `test_bht_shift_2`.
2. What exact production data classes and photo paths require the highest-priority lockdown before broader authorization work?
3. **Resolved:** The internal synthetic canary was allowed after emulator proof and passed Templates/Photos plus protected EOC. Broader custom-template use follows staged staff enrollment.
4. **Resolved:** Identity/Users is first. The Users page must query canonical BHT/tech role plus authorized main location, with Firestore enforcing the same boundary. Other broad queries are corrected within their named workflow stage before activation.
5. What simple supervisor view should show offline items that stopped as `needsReview`?
6. What retention periods are operationally and legally appropriate for EOC details, issue photos, issue history, app feedback, and audit records? This requires policy/privacy review before implementation.

## 11. High-Level Release Status

| Area | Status | Evidence / limitation |
|---|---|---|
| Main application baseline | Released | The security behavior baseline is `Main` `647baaf` from PR #22, with no-behavior-change rule/documentation cleanup completed through PR #24. |
| Shift Debrief safeguards | Released | `8339827`; focused tests, emulator/rules tests, lint/build, push, Hosting and Firestore rules deployment were reported. |
| Issue handoff/app feedback V2 | Released and enabled | `3c11306`; feature flag version 3 was verified for the approved four operational locations at release time. Recheck before future changes because configuration can drift. |
| Guided EOC template builder | Released under secure sessions | The mapped-session Templates/Photos and protected EOC paths now pass scoped supervisor/BHT, wrong-location, photo, offline replay, and idempotent submission gates. |
| Security foundation | Complete and released | All-active server PIN/custom-token login, strict authorization, server-only PIN credentials, 84-hour device sessions, scoped account controls, protected workflows, safe offline work, and final compatibility retirement are live through `647baaf`. App Check enforcement stays off by design. |
| Documentation foundation | Restored and current | `MASTER_PLAN.md`, `PROGRESS_LOG.md`, project guidance, README links, and the approved two-document hierarchy reflect the final released security state. |

Current configuration and live Hosting state can change after this document is written. Recheck before any release or production decision.

## 12. Documentation and Release Discipline

### Two long-term records and supporting documentation

- `MASTER_PLAN.md`: Long-term readable blueprint, decisions, status, risks, future ideas, and open questions.
- `PROGRESS_LOG.md`: Long-term dated evidence trail for significant work and releases.
- `README.md`: Supporting project entry point and quick links.
- `PROJECT_INSTRUCTIONS.md`: Supporting repo-specific working rules for agents and contributors.
- `CHANGELOG.md`: Legacy/supporting chronological release notes. Do not maintain it as a competing evidence log; `PROGRESS_LOG.md` is the detailed long-term record.
- `plan.md`: Legacy V2 blueprint retained for historical comparison, not a parallel Master Plan. When it conflicts with this file, stop and verify code/current evidence rather than silently choosing the older statement.
- Runbooks under `docs/`: Supporting deployment, cutover, migration, and UAT procedures.

### When behavior changes

1. Update the relevant Master Plan section and status.
2. Add a dated Progress Log entry with exact files and evidence.
3. Update supporting README, runbook, or legacy changelog content only when its own instructions or release-facing claims directly changed; do not duplicate the full long-term record.
4. Record whether code was committed, pushed, deployed, configured, or left local.
5. Clearly state what was not tested or not verified.

## 13. Processed Notes Archive

Do not delete processed inbox notes. Move them here with their original wording and a short statement of where they were organized.

- No processed notes yet.
