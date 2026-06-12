# BHT Home + Location Issues - Implementation Plan v3.7

**Status:** Eighth review draft of the Google sign-in, no-Cloud-Functions direction. Codex v3.1 corrections, Claude v3.1 audit notes, Codex v3.2 verification fixes, Codex v3.3 hardening, owner-confirmed cutover inputs, and the final exact-email allowlist policy are incorporated.  
**Scope:** Authentication foundation, exact-location enforcement, BHT Home, Location Issues, activity, notifications, debrief review state, and offline issue creation.  
**Visual source of truth:** `docs/mockups/bht-home-final.html`.

This plan intentionally replaces the v2.3 custom-token/custom-claims design. It is
implementation-oriented, but it must pass an additional code and Firebase-emulator
review before production work starts.

## v3.7 changelog

Changes from v3.6 after owner decision:

- Finalized the Google email policy as an admin-approved exact-email allowlist:
  Google proves email ownership, Ops Hub decides whether that exact email is allowed.
- Company emails under `scottsdaleprovidence.com` remain the default and lowest-friction
  path, but admins may approve a non-company Google email with explicit reason/audit
  fields. Unrestricted "any Google email" sign-in is still denied.
- Supervisors cannot create login-capable accounts, even for company emails. They
  may only edit operational fields on existing BHT profiles or create non-login pending
  staff-access requests if that workflow is added later.
- Updated the auth/rules language from "verified company email only" to "verified Google
  email plus active admin-created email-link."

## v3.6 changelog

Changes from v3.5 after owner follow-up:

- Confirmed the first cutover admin email: `mark@scottsdaleprovidence.com` for
  `users/admin_owner` / `Admin Owner`.
- Added a domain-policy decision note. That decision is finalized in v3.7 as the
  admin-approved exact-email allowlist model.

## v3.5 changelog

Changes from v3.4 after owner confirmation:

- Confirmed the designated first Google cutover admin profile from the current admin UI:
  `users/admin_owner`, name `Admin Owner`, role `Admin`, status `ACTIVE`, location
  `GLOBAL (full access)`.
- Superseded by v3.7: `scottsdaleprovidence.com` is the default company domain, but
  access is controlled by exact admin-created email links; admin-approved external
  Google emails are allowed only with explicit approval metadata.
- Reduced Section 19 from two owner questions to one remaining required input at that
  time: the exact lowercase company Google email for `admin_owner`. That email is now
  confirmed in v3.6.

## v3.4 changelog

Changes from v3.3 after a deeper Codex implementation-readiness pass:

- Tightened alert update rules so mark-read/resolve updates must preserve immutable alert
  fields, move `read` only from false to true, increment `version`, and write timestamp
  metadata. This closes the gap between "affected keys only" and a real state transition
  contract (`src/components/NotificationCenter.jsx:155-184`;
  `src/components/DashboardSummaryPanel.jsx:362-373`).
- Added pre-strict-rule data migration requirements for existing `alerts` and
  `eocIssues`. Strict audience/read rules cannot deploy safely while older alerts lack
  `audience`, and the new issue detail/timeline cannot be complete if existing issues
  lack `closedAt`/activity scaffolding.
- Added explicit `userHomeState` and shift-debrief-draft rule constraints so self-writable
  home state cannot become a loose per-user document and draft/debrief access stays
  exact-location.
- Clarified that the old PIN/auth-policy compatibility path is retired in the Google
  end state; login must not depend on unauthenticated reads of `appSettings/authPolicy`.
- Added Firebase emulator/test harness files and scripts to the expected implementation
  files so the acceptance criteria are executable, not just manual checklist items.

## v3.3 changelog

Changes from the Claude-reviewed v3.2 draft, after a Codex v3.2 verification pass:

- Fixed the BHT targeted-alert query and index so they prove `audience == "bht"` in
  addition to `targetUserId` and `read`. This prevents supervisor-audience alerts that
  happen to contain a subject `targetUserId` from denying or polluting BHT alert queries
  (`src/services/eocTaskEngine.js:301-309`; `src/hooks/useScopedAlerts.js:102-120`).
- Corrected the alert read-rule plan so `shift_debrief_*` supervisor alerts use
  exact-location access, matching the debrief query plan and exact debrief-detail rules,
  instead of falling through to broad management access
  (`src/services/shiftDebriefService.js:489-546`; `src/services/eocTaskEngine.js:286-313`).
- Added the missing strict query requirement for `markCurrentUserHandoffAlertsRead`, which
  currently reads all alerts by `debriefId` before client filtering and would be denied
  under audience-based alert rules (`src/services/shiftDebriefService.js:557-570`).
- Tightened the alert-family validator wording for debrief, fleet, and transport alerts
  so implementation cannot replace those helpers with a permissive generic fallback.
- Cleaned stale v3.1/v3.2 wording and corrected the open-question count.

## v3.2 changelog

Changes from the Codex v3.1 draft, after a Claude v3.1 audit:

- Added an explicit domain-spoof/no-link denial acceptance test (verified emails like
  `attacker@scottsdaleprovidence.com.evil.com` must be denied unless an admin has
  intentionally created that exact external email link).
- Audit confirmed (no change needed): the v3.1 alert source-validation correctly uses
  `get()` (issue/activity exist when alerts are written); the fan-out batch was already
  reduced to 12 with budget margin; and the supervisor alert-family composite index
  (`audience + type + locationId + read + createdAt`) is already present in the index
  list. Standing release gates remain the emulator proofs of `get()`-in-list and the
  alert access-call budget, confirming the final email policy, and answering the owner
  questions.

## v3.1 changelog

Changes from the Claude-reviewed v3.0 draft:

- Corrected the Firestore `matches()` explanation. Rules matching evaluates the entire
  string; anchors remain for clarity and `[^@]+` ensures one email-local-part shape.
- Carried normalized email handling through client and rules. Client code uses
  `trim().toLowerCase()`; rules use `authEmail()`.
- Replaced the single overbroad alert-create rule with alert-family branches. Issue
  alerts validate their source issue/version/activity, recipient, actor, event type,
  location, and immutable metadata. Existing untargeted supervisor alerts remain
  supported through separate source-validated branches.
- Added exact parent-location authorization to issue activity creates.
- Reordered bootstrap so profile helper rules and emulator tests exist before the
  first-admin bootstrap is deployed.
- Made identity administration admin-only while preserving supervisors' ability to edit
  operational assignment fields for existing BHT profiles in their managed location.
- Resolved reporter fan-out: always target the reporter exactly once, even if their
  assignment later becomes inactive, then add all currently active exact-location BHTs.
- Added acceptance tests for forged alerts, supervisor operational-field restrictions,
  reporter fallback, and bootstrap removal.

## v3.0 foundation changelog

Changes from v2.3:

- Replaced anonymous authentication plus client-side PIN selection with Firebase
  Google sign-in for admin-approved exact Google email accounts.
- Removed the proposed `mintPinSession` Cloud Function, the proposed `functions/`
  package, the Blaze/billing requirement, and all runtime dependence on custom claims.
- Replaced claim-based role/location enforcement with Firestore profile lookup through
  `usersByAuthUid/{uid}` -> `users/{appUserId}`.
- Added an admin-created, email-keyed `userEmailLinks/{email}` record and a guarded
  first-login transaction because the admin creates staff profiles before Firebase
  Authentication has assigned the user a UID.
- Preserved existing app user IDs as the canonical staff IDs. This avoids rewriting
  `shiftAssignments`, alerts, debriefs, issue reporter IDs, and historical records.
- Added a staged migration that lets an existing admin assign exact approved Google
  emails before strict Google-profile rules are enabled, preventing first-admin lockout.
- Reworked temporary issue access to a client/admin transaction using
  `issueAccess/{appUserId}` plus `accessGrants` audit records. No server synchronization
  is required.
- Re-anchored exact issue scope to profile field `issueLocationIds`; broad
  `authorizedLocations` remains for non-issue modules and must not grant house-level
  issue access by alias.
- Added concrete profile-based Firestore rule patterns, query limits, index definitions,
  alert batching limits, emulator assertions, and shared-device logout requirements.

## Locked decisions

- Lone Mountain and Mesquite are separate exact issue locations. `OTC`, `PHP`, `RTC`,
  or another broad alias never grants both issue locations.
- The final mockup remains normative for BHT Home, Location Issues, and issue detail.
- Issue status writes go through one transactional `issueStatusService`.
- Every issue has an immutable activity subcollection and denormalized
  `latestActivity`.
- Active staff at the issue's exact location receive individual alerts. Recipients come
  from active `shiftAssignments`.
- The original reporter receives exactly one alert for each issue event even if their
  assignment later becomes inactive.
- Identity creation, email changes, role changes, activation/deactivation, and account
  linking are admin-only. Supervisors may edit only operational assignment fields on
  existing BHT profiles within their managed location.
- Supervisors can mark in progress, post an update, resolve, and void. Voided issues
  remain visible under Resolved with a reason and `VOIDED` badge.
- Reviewed incoming debrief state is stored in `userHomeState`.
- Offline issue creation uses deterministic issue IDs and is idempotent.
- No Cloud Functions are introduced for this work.

## 1. Verified current state

### Authentication and user identity

- Firebase initializes Firestore and Auth but has no Google provider setup or explicit
  persistence configuration (`src/firebase.js:1-23`).
- `PinLogin` imports `signInAnonymously`, queries active users by PIN hash, and then
  builds the app session from the selected Firestore user
  (`src/components/PinLogin.jsx:4`, `src/components/PinLogin.jsx:95`,
  `src/components/PinLogin.jsx:151-189`).
- `PinLogin` also contains the v2.3 claim-policy compatibility path
  (`src/components/PinLogin.jsx:196-228`).
- `App` renders `PinLogin` whenever the in-memory user is null
  (`src/App.jsx:1007-1013`) and stores an app user separately in session storage.
- Logout already calls Firebase `signOut`, but it clears/navigates first and does not
  await sign-out (`src/App.jsx:418-428`). The Google flow must await sign-out before
  completing local logout.
- `authPolicyService` currently exposes only `authScopeEnforced`
  (`src/services/authPolicyService.js:9-22`).
- The claim provisioning scripts are active package commands, and
  `scripts/provisionAuthClaims.js` creates/updates Auth users and stamps `role` and
  `locations` custom claims (`package.json:15-16`,
  `scripts/provisionAuthClaims.js:65-141`).
- There is no Functions deployment section in `firebase.json`; it contains only
  Firestore and Hosting (`firebase.json:1-59`). The v3 design therefore does not remove
  existing Functions infrastructure; it prevents the v2.3 proposal from adding it.

### Staff profiles and assignments

- Existing app user IDs are Firestore document IDs and are used throughout the app.
  The user editor currently collects ID, name, PIN, role, location, house, shift, vans,
  and active state, but not email (`src/components/SupervisorDashboard.jsx:344-355`).
- New users currently require a four-digit PIN, and the save path hashes it
  (`src/components/SupervisorDashboard.jsx:393-419`).
- User writes currently persist broad `authorizedLocations` and, for BHTs, exact
  `locationId` (`src/components/SupervisorDashboard.jsx:493-517`).
- `syncDerivedAssignmentForUser` runs after the user save, so identity migration must
  preserve the app user ID used by the assignment
  (`src/components/SupervisorDashboard.jsx:518-552`).
- Supervisors currently can create and edit BHT users but not supervisor/admin users
  (`src/utils/orgModel.js:166-181`;
  `src/components/SupervisorDashboard.jsx:357-371`,
  `src/components/SupervisorDashboard.jsx:423-447`). Under v3.3, profile/identity
  creation becomes admin-only; supervisors retain operational edits on existing BHTs.
- `shiftAssignments` stores deterministic staff assignment data including
  `bhtUserId`, `locationId`, `shiftId`, and `active`
  (`firestore.rules:499-525`; `src/services/assignmentService.js:7-8`,
  `src/services/assignmentService.js:57-68`).
- Debrief recipient enumeration currently reads all active users and filters them in
  the browser (`src/services/shiftDebriefService.js:460-468`). That query will not be
  compatible with tightened profile privacy and must move to a server-constrained
  `shiftAssignments` query.

### Current security posture

- `users`, `shiftAssignments`, `eocIssues`, and `alerts` currently have public reads
  (`firestore.rules:470-472`, `firestore.rules:499-502`,
  `firestore.rules:721-724`, `firestore.rules:747-750`).
- Existing role/location helpers read custom claims and include
  `hasLegacyAuthSession()` bypasses (`firestore.rules:165-230`).
- Existing location normalization maps Lone Mountain, Mesquite, PHP, and RTC to OTC
  (`firestore.rules:193-226`). That helper is not acceptable for exact issue privacy.
- Current `shiftDebriefs` allows any recognized BHT/tech/supervisor/admin to get a known
  document without checking the document's exact location
  (`firestore.rules:684-718`).
- Existing access grants are append/update audit records. Client scope is assembled by
  querying all grants for a user and merging active locations
  (`src/services/accessGrantService.js:107-154`). Rules do not currently have a
  deterministic effective-access document.

### Issues, alerts, and routes

- BHT Home issue creation already writes an `eocIssues` document and one alert in a
  transaction, but it uses generated IDs and does not create activity
  (`src/services/bhtIssueReportService.js:58-76`).
- EOC checklist submission creates issues and alerts inside its transaction but also
  lacks issue activity (`src/services/offlineSyncService.js:240-269`).
- Status writes are duplicated. `DashboardSummaryPanel` uses version-checked
  transactions, while `SupervisorEocPanel` directly calls `updateDoc`
  (`src/components/DashboardSummaryPanel.jsx:300-375`,
  `src/components/SupervisorEocPanel.jsx:72-97`).
- Status alerts currently target only the original reporter
  (`src/services/notificationService.js:70-101`).
- `useScopedIssues` constrains status but downloads every matching location and filters
  location in memory (`src/hooks/useScopedIssues.js:23-38`).
- `useScopedAlerts` similarly performs broad reads and client filtering. Its BHT issue
  update query does not constrain `targetUserId` or `read`
  (`src/hooks/useScopedAlerts.js:43-120`).
- Existing routes support transport, EOC form, debrief, and dashboard, but not
  `/issues` or `/issues/:id` (`src/App.jsx:68-95`).
- Existing debrief navigation must remain unchanged:
  `onEditDebrief` routes to `/debrief/full`, and the BHT assignment is wired back to
  `App` (`src/App.jsx:955-960`, `src/App.jsx:1146-1163`;
  `src/components/BhtHub.jsx:43-44`, `src/components/BhtHub.jsx:451`).

## 2. Target identity and profile model

### 2.1 Canonical IDs

Keep the existing `users/{appUserId}` document ID as the canonical staff ID. Store this
ID in issue reporter fields, alert targets, debrief submitter/recipient fields,
assignments, audit logs, and access grants.

Firebase Auth UID is an authentication identifier only. Resolve it to the app user ID
through a deterministic document:

```text
usersByAuthUid/{firebaseAuthUid}
  userId: "admin_owner" for the first cutover admin, or the linked app user ID
  email: lowercase approved Google email
  emailDomain: lowercase email domain
  linkedAt: Timestamp
  linkedBy: "self_first_login" | "admin"
  version: 1
```

The staff profile remains:

```text
users/{appUserId}
  name: string
  email: lowercase approved Google email
  emailDomain: lowercase email domain
  emailType: "company" | "external"
  externalGoogleAllowed: boolean
  externalReason/externalApprovedByUserId/externalApprovedByName/externalApprovedAt:
    required only for external emailType
  role: "bht" | "supervisor" | "admin"
  active: boolean
  site/location/house/shiftId/vanIds: existing operational fields
  authorizedLocations: existing broad module scopes
  issueLocationIds: exact issue locations only
  version/createdAt/updatedAt: existing version metadata
```

`issueLocationIds` examples:

- Lone Mountain BHT: `["lone_mountain"]`
- Mesquite BHT: `["mesquite"]`
- Supervisor who manages both houses: `["lone_mountain", "mesquite"]`
- Admin: an explicit list of all exact issue locations, not `["GLOBAL"]`

Do not calculate issue access by expanding `authorizedLocations`. The current scope
utilities deliberately expand house scope to OTC
(`src/utils/orgModel.js:135-148`; `src/hooks/useUserScope.js:106-115`), so issue code
needs a separate exact helper.

### 2.2 Pre-login email index

The admin does not know a user's Firebase UID before first login. Admin user management
therefore creates this deterministic email record in the same transaction as the
profile:

```text
userEmailLinks/{lowercaseEmail}
  userId: "admin_owner" for the first cutover admin, or the linked app user ID
  email: lowercase approved Google email
  emailDomain: lowercase email domain
  emailType: "company" | "external"
  externalGoogleAllowed: boolean
  externalReason/externalApprovedByUserId/externalApprovedByName/externalApprovedAt:
    required only for external emailType
  active: true
  linkedAuthUid: null
  linkedAt: null
  version: 1
  createdAt/updatedAt: Timestamp
```

Normalized email addresses cannot contain `/`, so the normalized email can be used
directly as a Firestore document ID. Email uniqueness follows from that deterministic
path.

Admin save behavior:

1. Require a lowercase verified Google email for every login-capable active user.
   `scottsdaleprovidence.com` emails are the normal company path:
   `emailType: "company"` and `externalGoogleAllowed: false`.
2. Admins may approve an exact non-company Google email only when the profile and email
   link both include `emailType: "external"`, `externalGoogleAllowed: true`,
   `externalReason`, `externalApprovedByUserId`, `externalApprovedByName`, and
   `externalApprovedAt`.
3. Transactionally create/update `users/{appUserId}` and
   `userEmailLinks/{lowercaseEmail}`.
4. On email change, require an explicit unlink confirmation if `linkedAuthUid` is set.
5. In the same transaction, deactivate the old email link, clear its link fields, and
   create the new link. Admin must also delete the old `usersByAuthUid/{uid}` mapping
   when unlinking.
6. Never change the app user ID as part of an email edit.

### 2.3 Admin-approved exact-email allowlist

The v3.7 implementation is an exact-email allowlist, not an unrestricted "any Google
email" model and not a domain-only model. Every login-capable account must have a
specific admin-created `userEmailLinks/{lowercaseEmail}` document and a matching active
`users/{appUserId}` profile.

Policy:

1. Account/profile creation remains **admin-only**. Supervisors do not create
   access-granting user accounts because creating an email-to-profile link grants system
   access.
2. Company emails use `emailType: "company"`, `emailDomain: "scottsdaleprovidence.com"`,
   and `externalGoogleAllowed: false`.
3. Admins may create a non-company `userEmailLinks/{email}` only with
   `emailType: "external"`, `externalGoogleAllowed: true`, `externalReason`,
   `externalApprovedByUserId`, `externalApprovedByName`, and `externalApprovedAt`.
4. The user still must authenticate with that exact verified Google email.
5. Rules allow login only when a matching active email-link document exists. A random
   Gmail/Google account with no pre-created active link is denied.
6. Supervisors may, at most, create a pending staff-access request. It does not become a
   login-capable account until an admin approves and creates the profile plus identity
   link.

This gives future flexibility without weakening the main control: every login maps to a
specific admin-approved email and app profile.

### 2.4 Safe first-login linking

After Google sign-in, the client knows `request.auth.uid` and computes the normalized,
verified token email with `trim().toLowerCase()`.
It runs a Firestore transaction:

1. Get `usersByAuthUid/{uid}`.
2. If it exists, verify its email equals the normalized token email, then load its profile.
3. If it does not exist, get `userEmailLinks/{normalizedEmail}`.
4. Client-deny if the email-link document is missing, inactive, has another
   `linkedAuthUid`, or does not exactly match the normalized token email.
5. Create `usersByAuthUid/{uid}`.
6. Update only `linkedAuthUid`, `linkedAt`, `updatedAt`, and `version` on the email link.
7. Rules use `get()` to deny the transaction if the referenced profile is missing,
   inactive, or has a different email. The pre-link client does not read the protected
   profile directly.
8. Commit both writes atomically, then get the now-authorized profile.

Rules validate the pair with `getAfter()`. The user cannot select or assert an app user
ID; it must come from the pre-created email link. Only an already-linked admin may
unlink or repair identity mappings.

The first admin is a one-time exception because no linked admin exists yet to create
their email link. The owner-confirmed first admin is `users/admin_owner` with exact
Google email `mark@scottsdaleprovidence.com`. A temporary bootstrap rule may permit only
that verified Google email to link only that existing admin profile ID. The bootstrap
transaction:

1. Updates only the confirmed admin profile's email/email-domain metadata.
2. Creates exactly that admin's `userEmailLinks/{email}` document.
3. Creates `usersByAuthUid/{request.auth.uid}` pointing only to the confirmed app user ID.
4. Uses `getAfter()` to prove all three documents agree.

The app exposes this path only when the normalized signed-in token email equals the
configured bootstrap email and normal linking finds no email record. Remove the bootstrap email,
app user ID, UI branch, and rule exception immediately after the first admin mapping is
verified. Do not leave a generic "first user becomes admin" rule.

This design prevents:

- linking a Google account to an arbitrary app profile;
- two Auth UIDs claiming the same email;
- a verified Google account gaining access before an admin has created its staff profile
  and active email link.

## 3. Google sign-in flow

### 3.1 Firebase console and client setup

Implementation setup:

1. Enable Google as a Firebase Authentication provider.
2. Add every production and test host to Firebase Auth authorized domains.
3. Keep the existing Firebase web SDK. No Admin SDK or Cloud Function is needed at
   runtime.
4. Configure `browserSessionPersistence` before sign-in so closing a browser session on
   a shared device does not create an indefinitely persistent app login.
5. Use `GoogleAuthProvider`.
6. Set provider parameter `prompt: "select_account"`. Do not rely on `hd` as a security
   control. For this allowlist policy, omit `hd` unless UX testing proves the company
   account-picker hint helps; if used, treat it as a hint only because approved external
   Google emails must still be able to sign in.

The client and Firestore rules enforce the exact active email link. Domain alone never
grants access.

### 3.2 `PinLogin` replacement

Replace the PIN form with a Google sign-in screen. Renaming the component to
`GoogleLogin` is preferred; retaining `PinLogin` as a filename would be misleading.

Login sequence:

1. Render `Continue with Google`.
2. Start Google popup sign-in. On mobile popup failure, offer redirect sign-in and
   process `getRedirectResult` on return.
3. Force-refresh the ID token and inspect `user.email` and `user.emailVerified`.
4. Compute `normalizedEmail = String(user.email || '').trim().toLowerCase()`.
5. Client-deny unless the email is verified and has a usable single-email shape.
6. Use only `normalizedEmail` for email-link paths and stored-email comparisons.
7. Resolve or create the UID mapping through the transaction in Section 2.4.
8. Get `users/{appUserId}` and `issueAccess/{appUserId}`.
9. Deny if the profile is missing, inactive, or its normalized email does not equal
   `normalizedEmail`.
10. Deny if no active `userEmailLinks/{normalizedEmail}` exists. For company emails,
    require `emailType: "company"`, `emailDomain: "scottsdaleprovidence.com"`, and
    `externalGoogleAllowed: false`. For non-company emails, require
    `emailType: "external"`, `externalGoogleAllowed: true`, and complete admin approval
    metadata.
11. Build the app session from the profile and current non-expired temporary access.
12. Pass that session to the existing `onLogin`/`App` flow.

Clear denial messages:

- Unapproved Google account:
  `This Google account is not approved for Ops Hub. Contact an administrator.`
- Active Google account with no profile:
  `Your Google account is valid, but it is not registered in Ops Hub. Contact an administrator.`
- Inactive profile: `Your Ops Hub account is inactive. Contact an administrator.`
- Identity already linked elsewhere:
  `This staff profile is linked to another Google sign-in. Contact an administrator.`

On any denial after Google authentication, call Firebase `signOut(auth)`, clear partial
app session data, and remain on the login screen.

### 3.3 Session refresh and logout

- Replace the claim-related fields and checks in `App`'s refresh path
  (`src/App.jsx:555-603`) with live profile and issue-access refresh.
- If the profile is deactivated, email is changed, or UID mapping is removed, sign out
  immediately.
- Remove Change PIN UI and handlers from the header/session because PINs no longer
  authenticate users (`src/App.jsx:1026-1029`).
- Logout must call Firebase `signOut(auth)` before clearing `bhtUser`, last-activity
  state, local app data, and navigation state.
- The logout screen must say: `Signed out of Ops Hub. On a shared device, also sign out
  of the Google account in the browser if another staff member will use it.`
- Do not attempt to sign the user out of their entire Google browser session
  automatically; Firebase sign-out only ends the app session.

### 3.4 Retire PIN auth-policy compatibility

`authPolicyService` currently reads `appSettings/authPolicy` to decide the old
`authScopeEnforced` behavior (`src/services/authPolicyService.js:9-22`). In the Google
end state:

- the login screen must not read `appSettings/authPolicy` before Google authentication;
- the old `VITE_REQUIRE_AUTH_CLAIMS` / `authScopeEnforced` branch is removed from the
  sign-in path rather than preserved as a compatibility fallback;
- any remaining `appSettings` reads are either non-sensitive public config explicitly
  allowed by rules or authenticated profile reads after `hasActiveProfile()`;
- strict rules must not leave `appSettings` broadly writable or use it to bypass
  profile-based authorization.

## 4. Migration without admin lockout

The strict profile rules cannot be deployed before at least one admin has an email link
and Auth UID mapping. Use this order.

### Phase A - narrow first-admin bootstrap

1. Use the owner-confirmed designated admin profile:
   `users/admin_owner` / `Admin Owner` / role `Admin` / `GLOBAL (full access)` /
   `ACTIVE`, with Google email `mark@scottsdaleprovidence.com`.
2. Implement the profile helper rules, identity-link rules, and one-time bootstrap
   branch in the emulator first. The bootstrap branch binds only that email to only that
   existing admin profile.
3. Pass bootstrap success, wrong-email, wrong-profile, duplicate-link, and removal tests.
4. Add Google login and the exact bootstrap transaction to the client.
5. Enable Google provider and deploy only the tested bootstrap-capable auth slice.
6. Have the designated admin sign in.
7. Verify the admin profile, email link, and UID mapping agree.
8. Verify the admin UI loads through the linked Google identity.
9. Remove the bootstrap exception from the app and rules. This removal is a hard gate
   before any other account is linked.

The current anonymous/PIN session is not accepted as a secure bootstrap identity. The
existing rules can fall through `hasLegacyAuthSession()` (`firestore.rules:176-190`), so
using the old session to seed identity mappings would not prove the writer is the admin.

### Phase B - profile preparation through linked Google admin

1. Add email and exact `issueLocationIds` fields to admin user management.
2. Add transactional maintenance of `userEmailLinks`.
3. The linked Google admin enters and verifies the exact approved Google email for every
   login-capable active profile, using company email fields by default and external
   approval fields only when intentionally approved.
4. Block cutover while any active login-capable user lacks a unique active email link,
   required external approval metadata, or reviewed exact issue locations.
5. Export a migration report containing only app user ID, staff display name, email,
   role, active state, and exact issue locations. Resolve duplicates before continuing.
6. Confirm a BHT test account can self-link only to its pre-created email profile.
7. Confirm an unregistered company account and an unapproved external Google account are
   both denied.

### Phase C - enforcement cutover

Deploy in one controlled window:

1. Profile-based helper rules with no custom-claim or legacy bypass.
2. Server-constrained queries required by those rules.
3. Google-only login and Firebase logout.
4. Exact issue rules, indexes, and the issue feature.
5. Remove PIN entry/change UI and stop writing PIN fields.

Keep old `pinHash` data only long enough to verify rollback. Schedule a later migration
to delete `pinHash`, `pinVersion`, and `pinUpdatedAt` after the Google rollout is stable.

Rollback must restore the previous app and rules together. Never roll back only the app
or only the rules because their query and authorization models differ.

## 5. Profile-based Firestore rules

The snippets below define the intended contract. They must be compiled and proven in the
Firestore emulator before deployment.

### 5.1 Authentication/profile helpers

```javascript
function hasVerifiedGoogleEmail() {
  return request.auth != null
    && request.auth.token.email is string
    && request.auth.token.email_verified == true
    // Firestore matches() evaluates the whole string. Keep anchors for clarity,
    // forbid a second '@' with [^@]+, and normalize case before matching.
    && request.auth.token.email.lower().matches('^[^@]+@[^@]+[.][^@]+$');
}

// Use this normalized email everywhere the token email is compared to stored data.
// Stored profile/email-link emails are lowercase, so comparisons must lowercase the
// token email or a mixed-case Google email will lock out a legitimate user.
function authEmail() {
  return request.auth.token.email.lower();
}

function authLinkPath() {
  return /databases/$(database)/documents/usersByAuthUid/$(request.auth.uid);
}

function authLinkExists() {
  return hasVerifiedGoogleEmail() && exists(authLinkPath());
}

function authLinkData() {
  return get(authLinkPath()).data;
}

function authEmailLinkPath() {
  return /databases/$(database)/documents/userEmailLinks/$(authEmail());
}

function authEmailLinkExists() {
  return hasVerifiedGoogleEmail() && exists(authEmailLinkPath());
}

function authEmailLinkData() {
  return get(authEmailLinkPath()).data;
}

function profilePathFor(userId) {
  return /databases/$(database)/documents/users/$(userId);
}

function currentProfileExists() {
  return authLinkExists()
    && authEmailLinkExists()
    && exists(profilePathFor(authLinkData().userId));
}

function currentProfile() {
  return get(profilePathFor(authLinkData().userId)).data;
}

function emailLinkAllowsAuthenticatedEmail(link) {
  return link.email == authEmail()
    && link.active == true
    && (
      (
        link.emailType == 'company'
        && link.emailDomain == 'scottsdaleprovidence.com'
        && link.externalGoogleAllowed == false
      )
      || (
        link.emailType == 'external'
        && link.externalGoogleAllowed == true
        && link.externalReason is string
        && link.externalApprovedByUserId is string
        && link.externalApprovedByName is string
        && link.externalApprovedAt is timestamp
      )
    );
}

function hasActiveProfile() {
  return currentProfileExists()
    && authLinkData().email == authEmail()
    && authEmailLinkData().userId == authLinkData().userId
    && emailLinkAllowsAuthenticatedEmail(authEmailLinkData())
    && currentProfile().email == authEmail()
    && currentProfile().emailType == authEmailLinkData().emailType
    && currentProfile().externalGoogleAllowed == authEmailLinkData().externalGoogleAllowed
    && currentProfile().active == true
    && currentProfile().role in ['bht', 'tech', 'supervisor', 'admin'];
}

function currentUserId() {
  return authLinkData().userId;
}

function currentRole() {
  return currentProfile().role == 'tech' ? 'bht' : currentProfile().role;
}

function roleAllowed(roles) {
  return hasActiveProfile() && currentRole() in roles;
}
```

There is no `|| hasLegacyAuthSession()` and no read of
`request.auth.token.role`, `locations`, or `issueLocations`.

Normal requests use three fixed document reads: UID mapping, exact email link, and
profile. Repeated
`get()`/`exists()` calls to the same paths may be cached by Firestore rules and cached
calls do not count repeatedly. Keep helper paths identical so caching can apply.

### 5.2 Exact issue access and broad management access

Temporary exact issue access:

```text
issueAccess/{appUserId}
  locations:
    lone_mountain:
      startsAt: Timestamp
      expiresAt: Timestamp
      grantId: string
      reason: string
      grantedByUserId: string
      grantedByName: string
  version/updatedAt
```

Rule helpers:

```javascript
function issueAccessPath() {
  return /databases/$(database)/documents/issueAccess/$(currentUserId());
}

function hasBaseIssueLocation(locationId) {
  return hasActiveProfile()
    && currentProfile().issueLocationIds is list
    && locationId in currentProfile().issueLocationIds;
}

function hasTemporaryIssueLocation(locationId) {
  return hasActiveProfile()
    && exists(issueAccessPath())
    && get(issueAccessPath()).data.locations is map
    && locationId in get(issueAccessPath()).data.locations
    && get(issueAccessPath()).data.locations[locationId].startsAt <= request.time
    && get(issueAccessPath()).data.locations[locationId].expiresAt >= request.time;
}

function exactIssueLocationAllowed(locationId) {
  return hasBaseIssueLocation(locationId)
    || hasTemporaryIssueLocation(locationId);
}

function broadManagementLocationAllowed(locationId) {
  return roleAllowed(['supervisor', 'admin'])
    && (
      currentRole() == 'admin'
      || locationId in currentProfile().authorizedLocations
      || (
        locationId in ['mesquite', 'lone_mountain']
        && 'OTC' in currentProfile().authorizedLocations
      )
    );
}
```

`exactIssueLocationAllowed` is the only helper for issue documents, issue activity, and
shift debrief detail. `broadManagementLocationAllowed` is retained only where the
existing product intentionally uses management-area scope, such as untargeted
supervisor notification summaries. It must not authorize `eocIssues`.

The fixed `issueAccess/{appUserId}` path keeps temporary-access lookup to one cacheable
rules read. A separate issue-access document per location would consume a different
`get()` for each location in a multi-location board query and is rejected for this
design.

### 5.3 Identity-link rules

One-time bootstrap constants must default to impossible values in source control and be
replaced only for the controlled first-admin deployment. The real email literal must be
lowercase:

```javascript
function bootstrapEmail() {
  return 'mark@scottsdaleprovidence.com';
}

function bootstrapUserId() {
  return 'admin_owner';
}

function isBootstrapGoogleSubject() {
  return hasVerifiedGoogleEmail()
    && authEmail() == bootstrapEmail();
}

function bootstrapProfileUpdateAllowed(userId) {
  return isBootstrapGoogleSubject()
    && userId == bootstrapUserId()
    && resource.data.role == 'admin'
    && resource.data.active == true
    && request.resource.data.role == resource.data.role
    && request.resource.data.active == resource.data.active
    && request.resource.data.email == bootstrapEmail()
    && request.resource.data.emailDomain == 'scottsdaleprovidence.com'
    && request.resource.data.emailType == 'company'
    && request.resource.data.externalGoogleAllowed == false
    && request.resource.data.diff(resource.data).affectedKeys()
      .hasOnly(['email', 'emailDomain', 'emailType', 'externalGoogleAllowed',
        'updatedAt', 'version']);
}
```

The temporary bootstrap branches are:

```javascript
// Temporary addition inside users/{userId} update:
|| bootstrapProfileUpdateAllowed(userId)

// Temporary addition inside userEmailLinks/{email} create:
|| (
  isBootstrapGoogleSubject()
  && email == bootstrapEmail()
  && request.resource.data.userId == bootstrapUserId()
  && request.resource.data.email == bootstrapEmail()
  && request.resource.data.emailDomain == 'scottsdaleprovidence.com'
  && request.resource.data.emailType == 'company'
  && request.resource.data.externalGoogleAllowed == false
  && request.resource.data.active == true
  && request.resource.data.linkedAuthUid == request.auth.uid
  && getAfter(profilePathFor(bootstrapUserId())).data.email == bootstrapEmail()
  && getAfter(profilePathFor(bootstrapUserId())).data.role == 'admin'
)

// Temporary addition inside usersByAuthUid/{uid} create:
|| (
  isBootstrapGoogleSubject()
  && uid == request.auth.uid
  && request.resource.data.userId == bootstrapUserId()
  && request.resource.data.email == bootstrapEmail()
  && getAfter(
    /databases/$(database)/documents/userEmailLinks/$(bootstrapEmail())
  ).data.linkedAuthUid == request.auth.uid
  && getAfter(profilePathFor(bootstrapUserId())).data.email == bootstrapEmail()
)
```

The client commits the profile update, email-link create, and UID-map create in one
transaction. `bootstrapUserId()` is owner-confirmed as `admin_owner`; `bootstrapEmail()`
is owner-confirmed as `mark@scottsdaleprovidence.com` for the controlled first-admin
deployment. After successful first-admin verification, delete these functions and all
three temporary `||` branches; do not merely change the constants.

Normal identity-link rules after bootstrap removal:

```javascript
match /userEmailLinks/{email} {
  allow get: if (
      hasVerifiedGoogleEmail()
      && email == authEmail()
    ) || roleAllowed(['admin']);
  allow list: if roleAllowed(['admin']);

  allow create, delete: if roleAllowed(['admin']);

  allow update: if roleAllowed(['admin'])
    || (
      hasVerifiedGoogleEmail()
      && email == authEmail()
      && resource.data.active == true
      && emailLinkAllowsAuthenticatedEmail(resource.data)
      && resource.data.linkedAuthUid == null
      && request.resource.data.linkedAuthUid == request.auth.uid
      && request.resource.data.email == resource.data.email
      && request.resource.data.userId == resource.data.userId
      && request.resource.data.emailType == resource.data.emailType
      && request.resource.data.emailDomain == resource.data.emailDomain
      && request.resource.data.externalGoogleAllowed == resource.data.externalGoogleAllowed
      && request.resource.data.diff(resource.data).affectedKeys()
        .hasOnly(['linkedAuthUid', 'linkedAt', 'updatedAt', 'version'])
    );
}

match /usersByAuthUid/{uid} {
  allow get: if (
      hasVerifiedGoogleEmail() && uid == request.auth.uid
    ) || roleAllowed(['admin']);
  allow list: if roleAllowed(['admin']);

  allow create: if hasVerifiedGoogleEmail()
    && uid == request.auth.uid
    && request.resource.data.email == authEmail()
    && request.resource.data.userId
      == get(/databases/$(database)/documents/userEmailLinks/$(authEmail())).data.userId
    && emailLinkAllowsAuthenticatedEmail(
      get(/databases/$(database)/documents/userEmailLinks/$(authEmail())).data
    )
    && getAfter(
      /databases/$(database)/documents/userEmailLinks/$(authEmail())
    ).data.linkedAuthUid == request.auth.uid
    && get(
      profilePathFor(request.resource.data.userId)
    ).data.email == authEmail()
    && get(
      profilePathFor(request.resource.data.userId)
    ).data.emailType == getAfter(
      /databases/$(database)/documents/userEmailLinks/$(authEmail())
    ).data.emailType
    && get(
      profilePathFor(request.resource.data.userId)
    ).data.externalGoogleAllowed == getAfter(
      /databases/$(database)/documents/userEmailLinks/$(authEmail())
    ).data.externalGoogleAllowed
    && get(
      profilePathFor(request.resource.data.userId)
    ).data.active == true;

  allow update, delete: if roleAllowed(['admin']);
}
```

Add full type/key/version validation in implementation. The critical invariant is that
self-linking can only use the pre-created email record and the email-link update plus UID
mapping creation must be one transaction.

The final implementation must make these invariants explicit in rules, not only in
client code:

- `userEmailLinks/{email}` self-claim updates require `resource.data.active == true`,
  `resource.data.linkedAuthUid == null`, `request.resource.data.active == true`,
  `request.resource.data.email == email == authEmail()`, matching `emailDomain`,
  immutable `emailType`, immutable `externalGoogleAllowed`, complete external approval
  metadata when `emailType == "external"`, a `linkedAt` timestamp, and
  `version == resource.data.version + 1`.
- `usersByAuthUid/{uid}` creation requires the `getAfter(userEmailLinks/{authEmail()})`
  document to be active, linked to `request.auth.uid`, and pointing to the same profile
  ID/email/email type/external approval state as the UID mapping and profile. A UID
  mapping must not be creatable from an inactive, missing, mismatched, or already-linked
  email record.
- Admin unlink/relink must update the profile, email link, and UID mapping
  transactionally and must leave an audit entry; never allow a client to directly choose a
  different `userId` during self-link.

### 5.4 Staff profile and effective-access rules

```javascript
function isBhtProfile(data) {
  return data.role in ['bht', 'tech'];
}

function validDerivedBhtScopes(data) {
  let mainLocation = normalizedMainLocation(userLocationValue(data));
  return data.issueLocationIds == [data.locationId]
    && (
      (
        mainLocation == 'OTC'
        && data.authorizedLocations == ['OTC', data.house]
      )
      || (
        mainLocation == 'RES'
        && data.authorizedLocations == ['RES']
      )
    );
}

function supervisorOperationalBhtUpdateAllowed() {
  return roleAllowed(['supervisor'])
    && isBhtProfile(resource.data)
    && isBhtProfile(request.resource.data)
    && broadManagementLocationAllowed(userLocationValue(resource.data))
    && broadManagementLocationAllowed(userLocationValue(request.resource.data))
    && validDerivedBhtScopes(request.resource.data)
    && request.resource.data.diff(resource.data).affectedKeys().hasOnly([
      'name',
      'site', 'location', 'house', 'locationId',
      'shiftId', 'vanId', 'vanIds',
      'authorizedLocations', 'issueLocationIds',
      'updatedAt', 'version'
    ]);
}

match /users/{userId} {
  allow get: if hasActiveProfile()
    && (
      userId == currentUserId()
      || roleAllowed(['admin'])
      || (
        roleAllowed(['supervisor'])
        && isBhtProfile(resource.data)
        && broadManagementLocationAllowed(userLocationValue(resource.data))
      )
    );
  allow list: if roleAllowed(['admin'])
    || (
      roleAllowed(['supervisor'])
      && isBhtProfile(resource.data)
      && broadManagementLocationAllowed(userLocationValue(resource.data))
    );

  allow create, delete: if roleAllowed(['admin']);
  allow update: if roleAllowed(['admin'])
    || supervisorOperationalBhtUpdateAllowed();
}

match /issueAccess/{userId} {
  allow get: if hasActiveProfile()
    && (userId == currentUserId() || roleAllowed(['admin']));
  allow list: if roleAllowed(['admin']);
  allow create, update: if roleAllowed(['admin']);
  allow delete: if false;
}

match /accessGrants/{grantId} {
  allow read: if hasActiveProfile()
    && (resource.data.userId == currentUserId() || roleAllowed(['admin']));
  allow create, update: if roleAllowed(['admin']);
  allow delete: if false;
}

match /shiftAssignments/{assignmentId} {
  allow get, list: if hasActiveProfile()
    && (
      exactIssueLocationAllowed(resource.data.locationId)
      || broadManagementLocationAllowed(resource.data.locationId)
    );

  allow create: if roleAllowed(['supervisor', 'admin'])
    && broadManagementLocationAllowed(request.resource.data.locationId)
    && validShiftAssignmentData(request.resource.data);

  allow update: if roleAllowed(['supervisor', 'admin'])
    && broadManagementLocationAllowed(resource.data.locationId)
    && broadManagementLocationAllowed(request.resource.data.locationId)
    && request.resource.data.bhtUserId == resource.data.bhtUserId
    && validShiftAssignmentData(request.resource.data);

  allow delete: if roleAllowed(['admin']);
}
```

Production rules must retain the current user-data/version validators, update them to
require email fields, remove PIN requirements, and add exact field validators to the
supervisor branch. In particular, a supervisor cannot change `email`, `emailDomain`,
`role`, `active`, identity-link fields, creation metadata, or deletion state.
Admin creates/updates must also validate that BHT `authorizedLocations` and
`issueLocationIds` are derived from the selected operational location rather than
accepting arbitrary scope arrays.

Admin creates/deactivates profiles and maintains `userEmailLinks`/`usersByAuthUid`.
Supervisors can edit only the listed assignment/display fields for an existing BHT whose
old and new operational locations they manage. The exact `issueLocationIds` value must
remain derived from the BHT's `locationId`; it cannot be freely selected.

`SupervisorDashboard` currently listens to the full users collection
(`src/components/SupervisorDashboard.jsx:277-284`). Replace that listener:

- admin: explicit admin-only users query/list;
- supervisor: `role in ['bht', 'tech']` plus `location in managedMainLocations`, chunked
  if disjunction limits require it;
- never download all profiles and filter in memory.

The BHT fan-out and debrief recipient queries use
`where("locationId", "==", exactLocation)` plus `where("active", "==", true)`. Those
constraints are required for the `shiftAssignments` list rule; a global assignment read
followed by client filtering is denied.

### 5.5 `eocIssues` and activity

Issue shape additions:

```text
status: "open" | "in_progress" | "resolved" | "voided"
closedAt: Timestamp | null
voidReason/voidedAt/voidedByUserId/voidedByName: void-only fields
latestActivity:
  activityId, type, summary, note, fromStatus, toStatus,
  actorUserId, actorName, createdAt, version
```

Rules contract:

```javascript
function issueActivityPath(issueId, activityId) {
  return /databases/$(database)/documents/eocIssues/$(issueId)/activity/$(activityId);
}

function activityMatchesLatest(activity, latest) {
  return activity.activityId == latest.activityId
    && activity.type == latest.type
    && activity.summary == latest.summary
    && activity.note == latest.note
    && activity.fromStatus == latest.fromStatus
    && activity.toStatus == latest.toStatus
    && activity.actorUserId == latest.actorUserId
    && activity.actorName == latest.actorName
    && activity.version == latest.version;
}

function issueHasMatchingActivityAfterWrite(issueId, issueData) {
  return issueData.latestActivity is map
    && issueData.latestActivity.activityId is string
    && issueData.latestActivity.version == issueData.version
    && activityMatchesLatest(
      getAfter(
        issueActivityPath(issueId, issueData.latestActivity.activityId)
      ).data,
      issueData.latestActivity
    );
}

match /eocIssues/{issueId} {
  allow get, list: if hasActiveProfile()
    && exactIssueLocationAllowed(resource.data.locationId);

  allow create: if roleAllowed(['bht'])
    && exactIssueLocationAllowed(request.resource.data.locationId)
    && request.resource.data.status == 'open'
    && request.resource.data.reportedByUserId == currentUserId()
    && request.resource.data.version == 1
    && request.resource.data.closedAt == null
    && request.resource.data.latestActivity.activityId == 'reported'
    && issueHasMatchingActivityAfterWrite(issueId, request.resource.data);

  allow update: if roleAllowed(['supervisor', 'admin'])
    && exactIssueLocationAllowed(resource.data.locationId)
    && request.resource.data.locationId == resource.data.locationId
    && request.resource.data.reportedByUserId == resource.data.reportedByUserId
    && request.resource.data.status in ['open', 'in_progress', 'resolved', 'voided']
    && request.resource.data.version == resource.data.version + 1
    && request.resource.data.createdAt == resource.data.createdAt
    && validIssueTransition(resource.data, request.resource.data)
    && issueHasMatchingActivityAfterWrite(issueId, request.resource.data);

  allow delete: if false;

  match /activity/{activityId} {
    allow get, list: if hasActiveProfile()
      && exactIssueLocationAllowed(
        get(/databases/$(database)/documents/eocIssues/$(issueId)).data.locationId
      );

    allow create: if hasActiveProfile()
      && request.resource.data.actorUserId == currentUserId()
      && request.resource.data.issueId == issueId
      && request.resource.data.activityId == activityId
      && exactIssueLocationAllowed(
        get(/databases/$(database)/documents/eocIssues/$(issueId)).data.locationId
      )
      && (
        (
          roleAllowed(['bht'])
          && activityId == 'reported'
          && request.resource.data.type == 'reported'
          && getAfter(
            /databases/$(database)/documents/eocIssues/$(issueId)
          ).data.reportedByUserId == currentUserId()
        )
        || (
          roleAllowed(['supervisor', 'admin'])
          && request.resource.data.type in [
            'in_progress', 'update', 'resolved', 'voided'
          ]
        )
      )
      && request.resource.data.version
        == getAfter(
          /databases/$(database)/documents/eocIssues/$(issueId)
        ).data.version
      && activityMatchesLatest(
        request.resource.data,
        getAfter(
          /databases/$(database)/documents/eocIssues/$(issueId)
        ).data.latestActivity
      );

    allow update, delete: if false;
  }
}
```

Implementation must add field-level transition validation:

- `validIssueTransition(before, after)` accepts only these branches:

| Activity type | Status rule | Required fields | Only mutable parent fields |
|---|---|---|---|
| `in_progress` | `open -> in_progress` | non-empty `inProgressNotes`, timestamp/actor fields | `status`, `inProgressNotes`, `inProgressAt`, `inProgressByUserId`, `inProgressByName`, `latestActivity`, `version`, `updatedAt` |
| `update` | status remains `open` or `in_progress` | non-empty `lastUpdateNote`, timestamp/actor fields | `lastUpdateNote`, `lastUpdatedAt`, `lastUpdatedByUserId`, `lastUpdatedByName`, `latestActivity`, `version`, `updatedAt` |
| `resolved` | `open` or `in_progress` -> `resolved` | non-empty `resolvedNotes`, resolver fields, `closedAt == resolvedAt` | `status`, `resolvedNotes`, `resolvedAt`, `resolvedByUserId`, `resolvedByName`, `closedAt`, `latestActivity`, `version`, `updatedAt` |
| `voided` | `open` or `in_progress` -> `voided` | non-empty `voidReason`, void actor fields, `closedAt == voidedAt` | `status`, `voidReason`, `voidedAt`, `voidedByUserId`, `voidedByName`, `closedAt`, `latestActivity`, `version`, `updatedAt` |

- Actor IDs/names in the parent fields and `latestActivity` must equal the current
  linked profile for the status transaction.
- Create rules use an explicit allowlist for report fields and require the `reported`
  activity actor/reporter, description/summary, status, and version to agree.
- resolved/voided are terminal in this phase.
- the parent `latestActivity` must equal the new activity payload through
  `activityMatchesLatest`.
- the parent update and activity create must be in the same transaction; either write
  alone is denied through `getAfter()`.

### 5.6 Alerts

Authorization is driven by `audience`, not by field presence alone:

- `audience == "bht"` requires `targetUserId == currentUserId()`;
- `audience == "supervisor"` uses the appropriate exact or broad management-location
  rule; `targetUserId`, when present, identifies the subject of the supervisor alert and
  does not make it readable by that BHT.

Do not use one generic create condition for every alert family: current issue, fleet,
transport, and supervisor debrief alerts have different
source documents and audiences (`src/services/notificationService.js:49-66`,
`src/services/notificationService.js:119-175`;
`src/services/shiftDebriefService.js:489-549`;
`src/services/eocTaskEngine.js:238-317`).

```javascript
function issueForAlert(data) {
  return get(
    /databases/$(database)/documents/eocIssues/$(data.issueId)
  ).data;
}

function issueEventForAlert(data) {
  return get(
    /databases/$(database)/documents/eocIssues/$(data.issueId)/activity/$(data.eventId)
  ).data;
}

function assignmentForAlert(data) {
  return get(
    /databases/$(database)/documents/shiftAssignments/$(data.assignmentId)
  ).data;
}

function issueAlertSourceMatches(data) {
  let issue = issueForAlert(data);
  let event = issueEventForAlert(data);
  return data.issueId is string
    && data.eventId == event.activityId
    && event.issueId == data.issueId
    && data.issueVersion == event.version
    && data.locationId == issue.locationId
    && data.status == event.toStatus
    && data.eventType == event.type
    && data.actorUserId == event.actorUserId
    && data.actorName == event.actorName
    && data.message == event.summary
    && (
      !('statusNote' in data)
      || data.statusNote == event.note
    );
}

function issueEventActorAllowed(data) {
  let issue = issueForAlert(data);
  let event = issueEventForAlert(data);
  return (
      event.type == 'reported'
      && event.actorUserId == issue.reportedByUserId
      && (
        (
          roleAllowed(['bht'])
          && issue.reportedByUserId == currentUserId()
        )
        || (
          roleAllowed(['supervisor', 'admin'])
          && exactIssueLocationAllowed(issue.locationId)
        )
      )
    )
    || (
      event.type in ['in_progress', 'update', 'resolved', 'voided']
      && roleAllowed(['supervisor', 'admin'])
      && exactIssueLocationAllowed(issue.locationId)
    );
}

function issueTargetAllowed(data) {
  let issue = issueForAlert(data);
  return (
      data.targetUserId == issue.reportedByUserId
      && data.recipientSource == 'reporter'
      && !('assignmentId' in data)
    )
    || (
      data.targetUserId == issue.reportedByUserId
      && data.recipientSource == 'assignment_and_reporter'
      && data.assignmentId is string
      && assignmentForAlert(data).bhtUserId == data.targetUserId
      && assignmentForAlert(data).locationId == issue.locationId
      && assignmentForAlert(data).active == true
    )
    || (
      data.recipientSource == 'assignment'
      && data.assignmentId is string
      && assignmentForAlert(data).bhtUserId == data.targetUserId
      && assignmentForAlert(data).locationId == issue.locationId
      && assignmentForAlert(data).active == true
    );
}

function validTargetedIssueAlertCreate(data, alertId) {
  return data.type in ['eoc_issue', 'eoc_issue_update']
    && data.audience == 'bht'
    && data.targetUserId is string
    && data.read == false
    && exactIssueLocationAllowed(data.locationId)
    && issueAlertSourceMatches(data)
    && issueEventActorAllowed(data)
    && issueTargetAllowed(data)
    && alertId
      == 'issue_' + data.issueId + '_' + data.eventId + '_' + data.targetUserId;
}

function validIssueSupervisorAlertCreate(data, alertId) {
  let issue = issueForAlert(data);
  return data.type == 'eoc_issue'
    && data.audience == 'supervisor'
    && !('targetUserId' in data)
    && data.read == false
    && data.eventType == 'reported'
    && issueAlertSourceMatches(data)
    && issueEventActorAllowed(data)
    && exactIssueLocationAllowed(issue.locationId)
    && alertId == 'issue_' + data.issueId + '_' + data.eventId + '_supervisor';
}

function exactManagementAlertType(type) {
  return type in [
    'eoc_issue',
    'eoc_issue_update',
    'shift_debrief_submitted',
    'shift_debrief_no_receivers',
    'shift_debrief_missing',
    'shift_debrief_incoming_ack_late'
  ];
}

function broadManagementAlertType(type) {
  return type in [
    'fleet_upcoming',
    'fleet_overdue',
    'transport_completed'
  ];
}

function managementAlertLocationAllowed(data) {
  return (
      exactManagementAlertType(data.type)
      && roleAllowed(['supervisor', 'admin'])
      && exactIssueLocationAllowed(data.locationId)
    )
    || (
      broadManagementAlertType(data.type)
      && broadManagementLocationAllowed(data.locationId)
    );
}

function validBhtAlertReadUpdate() {
  let changed = request.resource.data.diff(resource.data).affectedKeys();
  return resource.data.audience == 'bht'
    && 'targetUserId' in resource.data
    && resource.data.targetUserId == currentUserId()
    && changed.hasOnly(['read', 'readAt', 'updatedAt', 'version'])
    && resource.data.read == false
    && request.resource.data.read == true
    && request.resource.data.readAt == request.time
    && request.resource.data.updatedAt == request.time
    && request.resource.data.version == resource.data.version + 1;
}

function validSupervisorAlertStateUpdate() {
  let changed = request.resource.data.diff(resource.data).affectedKeys();
  return resource.data.audience == 'supervisor'
    && managementAlertLocationAllowed(resource.data)
    && changed.hasOnly([
      'read', 'readAt', 'readByUserId', 'readByName',
      'resolvedAt', 'resolvedByUserId', 'resolvedByName',
      'updatedAt', 'version'
    ])
    && request.resource.data.version == resource.data.version + 1
    && request.resource.data.updatedAt == request.time
    && (
      !changed.hasAny(['read'])
      || (
        resource.data.read == false
        && request.resource.data.read == true
        && request.resource.data.readAt == request.time
        && request.resource.data.readByUserId == currentUserId()
        && request.resource.data.readByName == currentProfile().name
      )
    )
    && (
      !changed.hasAny(['resolvedAt'])
      || (
        request.resource.data.resolvedAt == request.time
        && request.resource.data.resolvedByUserId == currentUserId()
        && request.resource.data.resolvedByName == currentProfile().name
      )
    );
}

match /alerts/{alertId} {
  allow get, list: if hasActiveProfile()
    && (
      (
        resource.data.audience == 'bht'
        && 'targetUserId' in resource.data
        && resource.data.targetUserId == currentUserId()
      )
      || (
        resource.data.audience == 'supervisor'
        && managementAlertLocationAllowed(resource.data)
      )
    );

  allow create: if hasActiveProfile()
    && validAlertKeysAndTypes(request.resource.data)
    && (
      validTargetedIssueAlertCreate(request.resource.data, alertId)
      || validIssueSupervisorAlertCreate(request.resource.data, alertId)
      || validTargetedDebriefAlertCreate(request.resource.data, alertId)
      || validDebriefSupervisorAlertCreate(request.resource.data, alertId)
      || validFleetSupervisorAlertCreate(request.resource.data, alertId)
      || validTransportSupervisorAlertCreate(request.resource.data, alertId)
    );

  allow update: if hasActiveProfile()
    && (
      validBhtAlertReadUpdate()
      || validSupervisorAlertStateUpdate()
    );

  allow delete: if false;
}
```

The remaining family helpers are required, not placeholders to replace with permissive
fallbacks:

- `validTargetedDebriefAlertCreate`: get the referenced `shiftDebriefs/{debriefId}`;
  require `audience == "bht"`, `type == "shift_debrief_submitted"`,
  `targetUserId` present, `read == false`, and alert ID
  `shift_debrief_submitted__{debriefId}__{targetUserId}`. Permit the submitting BHT or
  an exact-location supervisor/admin retry. Require alert `locationId`, `shiftId`,
  `receivingShiftId`, `incomingAcknowledgmentLateAt`, `bhtName`, message/summary, and
  source version to match the debrief. Require the target's active assignment to match
  the exact location and receiving shift. This covers BHT-audience submitted-handoff
  alerts.
- `validDebriefSupervisorAlertCreate`: require `audience == "supervisor"`,
  `read == false`, exact-location access, and one explicit source branch for each
  current type:
  `shift_debrief_submitted`, `shift_debrief_no_receivers`,
  `shift_debrief_missing`, and `shift_debrief_incoming_ack_late`. Submitted and
  no-receiver alerts get `shiftDebriefs/{debriefId}` and require location, shift,
  BHT/message fields, source version, and deterministic IDs to match. Missing alerts get
  the active `shiftAssignments/{assignmentId}` and the deterministic absent debrief ID;
  require matching location, shift, BHT fields, timing configuration, `dueAt <=
  request.time`, and ID
  `shift_debrief_missing__{locationId}__{shiftId}__{bhtUserId}__{dateKey}`. Late-ack
  alerts get the submitted debrief, require the receiving user to remain unacknowledged,
  require `targetUserId` only as the supervisor-alert subject, and use ID
  `shift_debrief_incoming_ack_late__{debriefId}__{receivingUserId}`
  (`src/services/eocTaskEngine.js:286-313`). Because late-ack audience is supervisor,
  that `targetUserId` never grants the subject BHT read access.
- `validFleetSupervisorAlertCreate`: require `audience == "supervisor"`, no
  `targetUserId`, `read == false`, ID `{type}__{taskId}`, and get
  `fleetTasks/{taskId}`. Require alert type/status, vehicle/van fields,
  `locationId`/`mainLocation`, due-state fields, and source version to match the task.
  The source task's location is authorized with `broadManagementLocationAllowed`, not
  exact issue/debrief access.
- `validTransportSupervisorAlertCreate`: require `audience == "supervisor"`, no
  `targetUserId`, `read == false`, ID `transport_completed__{transportId}`, and get
  `transports/{transportId}`. Require a terminal transport status, matching
  `locationId`/`mainLocation`, source version, and creator/actor fields showing the
  current BHT created or completed the transport. The transport location is authorized
  with `broadManagementLocationAllowed`.
- `validAlertKeysAndTypes`: allow only the documented fields for that family, require
  timestamps/version/read types, cap message/note lengths, and reject unknown alert
  types.

Every family helper also validates `alertId` against that family's deterministic source
event key. Merely storing an `alertKey` field is insufficient because a caller could
write the same event under multiple random document IDs.

Issue alert retries may be performed by the original reporter or any currently
authorized supervisor/admin for that exact location. The retrying user does not replace
the historical actor: actor fields and summary must still match the immutable activity
document identified by `eventId`. This allows an older failed fan-out to retry after the
issue has received newer activity.

Required alert-family matrix:

| Alert type | Audience | Source proof | Deterministic ID |
|---|---|---|---|
| `eoc_issue` | BHT | Immutable activity type is `reported`; target is active assignment or reporter | `issue_{issueId}_{eventId}_{targetUserId}` |
| `eoc_issue` | Supervisor | Same reported source; exact issue location | `issue_{issueId}_{eventId}_supervisor` |
| `eoc_issue_update` | BHT | Issue latest activity is in-progress/update/resolved/voided | `issue_{issueId}_{eventId}_{targetUserId}` |
| `shift_debrief_submitted` | BHT | Submitted debrief plus exact receiving assignment | `shift_debrief_submitted__{debriefId}__{targetUserId}` |
| `shift_debrief_submitted` | Supervisor | Submitted debrief | `shift_debrief_submitted_supervisor__{debriefId}` |
| `shift_debrief_no_receivers` | Supervisor | Submitted debrief with no receiving users | `shift_debrief_no_receivers__{debriefId}` |
| `shift_debrief_missing` | Supervisor | Active assignment, deterministic absent debrief, elapsed configured due time | `shift_debrief_missing__{locationId}__{shiftId}__{bhtUserId}__{dateKey}` |
| `shift_debrief_incoming_ack_late` | Supervisor | Submitted debrief, named receiving user still unacknowledged, late time elapsed | `shift_debrief_incoming_ack_late__{debriefId}__{receivingUserId}` |
| `fleet_upcoming` / `fleet_overdue` | Supervisor | Matching fleet task state/location | `{type}__{taskId}` |
| `transport_completed` | Supervisor | Matching terminal transport/creator/location | `transport_completed__{transportId}` |

No other alert type receives create permission until it is added to this matrix, given a
source validator, deterministic ID rule, index/query path, and emulator tests.

Notification UI must render issue event text from the structured, source-validated
fields (`eventType`, status, actor, `statusNote`) or the matched immutable activity
summary. It must not display arbitrary caller-authored alert text.

Existing alerts must be backfilled or intentionally retired before strict rules deploy.
This is a maintenance/Admin SDK migration, not a user-facing client write path:

- add `audience: "bht"` to targeted alerts with a real `targetUserId`;
- add `audience: "supervisor"` to existing untargeted `eoc_issue`, `shift_debrief_*`,
  `fleet_*`, and `transport_completed` supervisor alerts;
- set missing `version` to `1`, `read` to `false` when absent, and `updatedAt` to a
  migration timestamp;
- if an existing alert cannot be classified safely, mark it read/archived with an admin
  migration note rather than leaving it unread under strict rules;
- do not require existing random alert document IDs to match the new deterministic create
  IDs. Deterministic IDs are required for all new and retried writes after cutover.

Management updates to related alert state need a separate tightly validated branch that
allows supervisor/admin to mark matching issue alerts read. It must not allow message,
target, issue, or location changes.

Assignment recipients include `assignmentId`. Reporter fallback alerts may omit it and
must set `recipientSource: "reporter"`. If the reporter is also in the active assignment
set, create only one alert with `recipientSource: "assignment_and_reporter"` and include
the assignment ID. Current derived assignments use deterministic per-user document IDs
(`src/services/assignmentService.js:7-8`,
`src/services/assignmentService.js:57-68`).

### 5.7 Shift debrief and Home-state rules

```javascript
match /shiftDebriefs/{debriefId} {
  allow get: if hasActiveProfile()
    && exactIssueLocationAllowed(resource.data.locationId);

  allow list: if hasActiveProfile()
    && exactIssueLocationAllowed(resource.data.locationId);

  // Preserve existing create/update field validation, but replace claim helpers
  // with roleAllowed(...) and exactIssueLocationAllowed(...).
  allow create: if roleAllowed(['bht'])
    && exactIssueLocationAllowed(request.resource.data.locationId)
    && request.resource.data.submittedByUserId == currentUserId();

  allow update: if hasActiveProfile()
    && exactIssueLocationAllowed(resource.data.locationId)
    && (
      roleAllowed(['supervisor', 'admin'])
      || resource.data.submittedByUserId == currentUserId()
    );

  allow delete: if false;
}

match /shiftDebriefDrafts/{draftId} {
  allow get, list: if hasActiveProfile()
    && exactIssueLocationAllowed(resource.data.locationId)
    && (
      roleAllowed(['supervisor', 'admin'])
      || resource.data.draftByUserId == currentUserId()
    );

  allow create, update: if roleAllowed(['bht'])
    && exactIssueLocationAllowed(request.resource.data.locationId)
    && request.resource.data.draftByUserId == currentUserId()
    && validShiftDebriefDraftData(request.resource.data);

  allow delete: if roleAllowed(['bht'])
    && resource.data.draftByUserId == currentUserId()
    && exactIssueLocationAllowed(resource.data.locationId);
}

function validUserHomeStateShape(uid) {
  let debrief = get(
    /databases/$(database)/documents/shiftDebriefs/$(request.resource.data.lastReviewedIncomingDebriefId)
  ).data;
  return uid == request.auth.uid
    && roleAllowed(['bht'])
    && request.resource.data.userId == currentUserId()
    && request.resource.data.keys().hasOnly([
      'userId',
      'lastReviewedIncomingDebriefId',
      'lastReviewedIncomingDebriefDateKey',
      'reviewedAt',
      'updatedAt',
      'version'
    ])
    && request.resource.data.lastReviewedIncomingDebriefId is string
    && request.resource.data.lastReviewedIncomingDebriefDateKey is string
    && request.resource.data.reviewedAt == request.time
    && request.resource.data.updatedAt == request.time
    && request.resource.data.version is int
    && exactIssueLocationAllowed(debrief.locationId)
    && debrief.dateKey == request.resource.data.lastReviewedIncomingDebriefDateKey
    && debrief.receivingUserIds is list
    && currentUserId() in debrief.receivingUserIds;
}

function validUserHomeStateCreate(uid) {
  return validUserHomeStateShape(uid)
    && request.resource.data.version == 1;
}

function validUserHomeStateUpdate(uid) {
  let changed = request.resource.data.diff(resource.data).affectedKeys();
  return validUserHomeStateShape(uid)
    && request.resource.data.userId == resource.data.userId
    && changed.hasOnly([
      'lastReviewedIncomingDebriefId',
      'lastReviewedIncomingDebriefDateKey',
      'reviewedAt',
      'updatedAt',
      'version'
    ])
    && request.resource.data.version == resource.data.version + 1;
}

match /userHomeState/{uid} {
  allow get: if hasActiveProfile() && uid == request.auth.uid;
  allow create: if hasActiveProfile() && validUserHomeStateCreate(uid);
  allow update: if hasActiveProfile() && validUserHomeStateUpdate(uid);
  allow list, delete: if false;
}
```

The final shift-debrief rules must carry forward the immutable fields and allowed
correction fields at `firestore.rules:689-716`; the shortened snippet above expresses
only the new identity/location gate.

The final shift-debrief-draft rules must carry forward the existing draft field
validation from `firestore.rules:662-682`, but replace broad role/location helpers with
the exact profile gates above.

`userHomeState/{uid}` stores:

```text
userId
lastReviewedIncomingDebriefId
lastReviewedIncomingDebriefDateKey
reviewedAt
version
updatedAt
```

Home gets the known debrief ID. It does not list all debriefs to rediscover the reviewed
record.

### 5.8 Rules access-call budget

Firestore rules permit:

- up to 10 document-access calls for a single-document request or query;
- up to 20 total for multi-document reads, transactions, and batched writes, while the
  10-call per-operation limit still applies;
- repeated accesses to the same path may be cached and cached calls may not count again.

Expected normal query budget:

1. `usersByAuthUid/{uid}`
2. `users/{appUserId}`
3. `issueAccess/{appUserId}` only when temporary exact access must be evaluated

Activity reads add the parent issue lookup. Status transactions add the parent and
`getAfter` checks. Issue alert creation adds the parent issue, immutable activity, and
assignment lookup for assignment-backed recipients.

Do not assume caching without proof. Emulator tests must execute each real query and
write shape, including the largest alert batch.

## 6. Server-constrained issue queries and indexes

Rules do not filter query results. Every issue query must include exact location
constraints obtained from the authenticated profile plus currently active
`issueAccess` entries.

### 6.1 Effective issue locations

At login and scope refresh:

1. Read profile `issueLocationIds`.
2. Read `issueAccess/{appUserId}`.
3. Include only entries where `startsAt <= now <= expiresAt`.
4. Deduplicate exact IDs.
5. Never expand through `normalizeScopeValues`, `locationIdToMainLocation`, or
   `inEocScope`.
6. Re-read at login, app focus, network reconnect, and at the next start/expiry boundary.

The rules use `request.time`, so a stale client list cannot extend access. A stale query
will fail after expiry and must trigger scope refresh and listener re-subscription.

### 6.2 Active board and Home counts

For each chunk of at most 15 exact locations:

```javascript
query(
  collection(db, 'eocIssues'),
  where('locationId', 'in', locationChunk),
  where('status', 'in', ['open', 'in_progress']),
  orderBy('createdAt', 'desc')
)
```

Merge chunk listeners by issue ID and sort by `createdAt` descending. Home counts come
from the same constrained active result:

- open count: `status == "open"`
- in-progress count: `status == "in_progress"`
- total badge: sum of both

No global listener followed by `.filter(inEocScope)` remains. The current global pattern
is at `src/hooks/useScopedIssues.js:26-36`.

### 6.3 Resolved 30 days

For each chunk of at most 15 exact locations:

```javascript
query(
  collection(db, 'eocIssues'),
  where('locationId', 'in', locationChunk),
  where('status', 'in', ['resolved', 'voided']),
  where('closedAt', '>=', thirtyDaysAgo),
  orderBy('closedAt', 'desc')
)
```

`closedAt` is the shared timestamp for resolved and voided issues. Current code writes
`resolvedAt` (`src/components/DashboardSummaryPanel.jsx:355-359`;
`src/components/SupervisorEocPanel.jsx:84-90`), so migration must backfill
`closedAt = resolvedAt` for existing resolved documents before the Resolved tab relies
on this query.

### 6.4 Existing issue migration

Before strict issue rules and the new detail timeline deploy, run an admin migration over
existing `eocIssues`. This is a maintenance/Admin SDK script run before strict rules; it
is not a client feature path:

- set `closedAt = resolvedAt` for every resolved issue that lacks `closedAt`;
- set `closedAt = voidedAt` for any pre-existing voided issue that lacks `closedAt`;
- create one deterministic legacy activity document for any issue without activity:
  - open issues: `activity/reported`, type `reported`, `toStatus: "open"`;
  - in-progress issues: `activity/legacy_in_progress`, type `in_progress`,
    `toStatus: "in_progress"`;
  - resolved issues: `activity/legacy_resolved`, type `resolved`,
    `toStatus: "resolved"`;
  - voided issues: `activity/legacy_voided`, type `voided`, `toStatus: "voided"`;
- set parent `latestActivity` to that legacy activity and preserve/initialize `version`.

Legacy activity summaries must be clearly labeled as migrated history so the UI does not
pretend old intermediate status notes exist when the source data cannot prove them. New
post-cutover activity continues to use `reported` or `v{nextVersion}_{type}` IDs.

### 6.5 Disjunction math

Firestore expands `in` clauses to disjunctive normal form and allows at most 30
disjunctions. Two status values multiplied by 15 locations equals 30:

```text
15 locations x 2 statuses = 30 disjunctions
```

Therefore:

- chunk exact locations at 15 for active and resolved queries;
- do not add another `in` or `array-contains-any` clause to these queries;
- one exact location is still passed as an `in` array of one for one code path, or use
  `==` as an optimized equivalent.

### 6.6 Required indexes

Retain existing indexes and add:

```json
{
  "collectionGroup": "eocIssues",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "locationId", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "eocIssues",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "locationId", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "closedAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "alerts",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "audience", "order": "ASCENDING" },
    { "fieldPath": "targetUserId", "order": "ASCENDING" },
    { "fieldPath": "read", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "alerts",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "audience", "order": "ASCENDING" },
    { "fieldPath": "type", "order": "ASCENDING" },
    { "fieldPath": "locationId", "order": "ASCENDING" },
    { "fieldPath": "read", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "alerts",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "audience", "order": "ASCENDING" },
    { "fieldPath": "issueId", "order": "ASCENDING" },
    { "fieldPath": "type", "order": "ASCENDING" },
    { "fieldPath": "read", "order": "ASCENDING" }
  ]
},
{
  "collectionGroup": "alerts",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "audience", "order": "ASCENDING" },
    { "fieldPath": "issueId", "order": "ASCENDING" },
    { "fieldPath": "type", "order": "ASCENDING" },
    { "fieldPath": "targetUserId", "order": "ASCENDING" },
    { "fieldPath": "read", "order": "ASCENDING" }
  ]
},
{
  "collectionGroup": "alerts",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "audience", "order": "ASCENDING" },
    { "fieldPath": "debriefId", "order": "ASCENDING" },
    { "fieldPath": "type", "order": "ASCENDING" },
    { "fieldPath": "targetUserId", "order": "ASCENDING" },
    { "fieldPath": "read", "order": "ASCENDING" }
  ]
},
{
  "collectionGroup": "shiftAssignments",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "locationId", "order": "ASCENDING" },
    { "fieldPath": "active", "order": "ASCENDING" }
  ]
},
{
  "collectionGroup": "shiftDebriefs",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "locationId", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" }
  ]
},
{
  "collectionGroup": "eocTasks",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "locationId", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" }
  ]
},
{
  "collectionGroup": "users",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "role", "order": "ASCENDING" },
    { "fieldPath": "location", "order": "ASCENDING" }
  ]
}
```

The existing issue index contains only `status + createdAt`
(`firestore.indexes.json:47-59`) and is insufficient.
The users index supports the supervisor's constrained BHT roster query. If Firestore's
index merger satisfies the final query without the composite, keep the explicit
composite anyway for predictable deployment behavior.

## 7. Temporary cross-location access without Functions

Only an admin can grant/revoke exact issue access. Keep `accessGrants` as immutable
lifecycle/audit history and maintain one effective `issueAccess/{appUserId}` document.

Grant transaction:

1. Validate target profile, exact location, start, expiration, and required reason.
2. Read `issueAccess/{targetUserId}`.
3. If that location already has a non-expired grant, require explicit replacement.
4. Create deterministic/new `accessGrants/{grantId}` history.
5. If replacing, mark the previous history record revoked/replaced.
6. Set `issueAccess.locations[locationId]` to the new effective entry.
7. Increment both versions and commit atomically.

Revoke transaction:

1. Read effective entry.
2. Require a revocation reason.
3. Mark its history record revoked.
4. Remove only that location key from the effective access map.
5. Increment version and commit.

Expiration needs no scheduled cleanup because rules enforce `request.time`. The admin UI
can lazily remove expired map entries during later grant/revoke operations.

The current service performs independent `addDoc`/`updateDoc` operations and merges
client-filtered grant rows (`src/services/accessGrantService.js:107-217`). Rewrite it to
the transaction above and stop treating client filtering as authorization.

## 8. Central issue write model

### 8.1 `issueStatusService`

Create `src/services/issueStatusService.js` with:

```text
markIssueInProgress({ issueId, expectedVersion, note, actor })
postIssueUpdate({ issueId, expectedVersion, note, actor })
resolveIssue({ issueId, expectedVersion, note, actor })
voidIssue({ issueId, expectedVersion, reason, actor })
```

Each method runs one transaction:

1. Read the issue.
2. Assert expected version against current version.
3. Validate allowed state transition and required note/reason.
4. Increment version.
5. Update status-specific fields.
6. Write `closedAt` for resolved/voided; leave it null otherwise.
7. Build actor fields from the linked app profile, never caller-supplied role/location.
8. Set parent `latestActivity`.
9. Create immutable `eocIssues/{issueId}/activity/{activityId}`.
10. Commit.

After the transaction:

1. Fan out status/update alerts.
2. Mark obsolete related alert types read where applicable.
3. Write the existing central `auditLogs` entry.

Related alert marking must be server-constrained. Replace the current
`where("issueId", "==", issueId)` scan in `DashboardSummaryPanel`
(`src/components/DashboardSummaryPanel.jsx:362-373`) with:

```javascript
query(
  collection(db, 'alerts'),
  where('audience', '==', 'supervisor'),
  where('issueId', '==', issueId),
  where('type', '==', 'eoc_issue'),
  where('read', '==', false)
)
```

Do not query all alerts for an issue and filter BHT-targeted alerts in memory.

The issue transaction is authoritative. Alert/audit failure must not roll back issue
status. Return a structured partial-success result and queue deterministic retries.

Replace both existing status call sites:

- version-checked dashboard handlers
  (`src/components/DashboardSummaryPanel.jsx:300-375`);
- direct-update `SupervisorEocPanel`
  (`src/components/SupervisorEocPanel.jsx:72-97`).

### 8.2 Activity schema

```text
eocIssues/{issueId}/activity/{activityId}
  issueId
  activityId
  type: "reported" | "in_progress" | "update" | "resolved" | "voided"
  summary
  note
  fromStatus
  toStatus
  actorUserId
  actorName
  actorRole
  version
  createdAt
```

Activity IDs:

- create: `reported`, with `fromStatus: null` and `toStatus: "open"`
- status/update: `v{nextVersion}_{type}`
- migration-only legacy scaffolding: `legacy_in_progress`, `legacy_resolved`, or
  `legacy_voided` as described in Section 6.4; do not use those IDs for new runtime
  writes.

Deterministic IDs make transaction retries idempotent.

### 8.3 Create paths

Both issue-creation paths must write parent issue plus `reported` activity:

- Home report: `src/services/bhtIssueReportService.js:58-74`
- EOC checklist issue creation: `src/services/offlineSyncService.js:240-269`

Parent create fields include:

```text
status: "open"
closedAt: null
version: 1
latestActivity: reported activity summary
```

The create transaction should not include all recipient alerts because fan-out size is
variable. Commit issue + activity first, then fan out deterministic alerts.

## 9. Offline issue determinism

Before enqueueing an offline Home report:

1. Generate the final Firestore issue ID on the client.
2. Use that ID for the local record, offline action, future issue document, activity
   path, and alert keys.
3. Store a stable offline action ID and payload version.

Sync behavior:

- transactionally create `eocIssues/{issueId}` and `/activity/reported` only when absent;
- if the same issue already exists with matching reporter/source payload, treat as
  already synced;
- if the ID exists with conflicting data, mark the action `needsReview`;
- fan out alerts using deterministic IDs after successful/already-synced creation;
- repeated retries create no duplicate issue, activity, or alert.

The current Home service generates a new issue reference inside the online transaction
(`src/services/bhtIssueReportService.js:62-65`), and EOC issue creation also generates
references during sync (`src/services/offlineSyncService.js:240-242`). Both paths must
accept the precomputed ID.

## 10. Location-wide notification fan-out

### Recipient enumeration

Query:

```javascript
query(
  collection(db, 'shiftAssignments'),
  where('locationId', '==', issue.locationId),
  where('active', '==', true)
)
```

Then:

- deduplicate by `bhtUserId`;
- exclude missing user IDs;
- create the active-assignment target set;
- add the reporter even when they have no current active assignment;
- if the reporter is already in the assignment set, keep one target and mark it
  `recipientSource: "assignment_and_reporter"`;
- otherwise add one fallback target with `recipientSource: "reporter"` and no
  `assignmentId`;
- all other recipients use `recipientSource: "assignment"` plus their assignment ID;
- never send a second reporter-only duplicate;
- include the assignment document ID on every assignment-backed alert for rules
  validation.

This replaces reporter-only status notifications
(`src/services/notificationService.js:82-101`).

### Deterministic alert IDs

```text
issue_{issueId}_{eventId}_{targetUserId}
```

`eventId` is the deterministic activity ID (`reported` or
`v{nextVersion}_{eventType}`). Use the same ID on retry. Rules require the alert ID to
match the immutable source activity path; they do not trust a caller-provided key.
Alert documents carry:

```text
type
audience
issueId
issueVersion
eventId
eventType
locationId
assignmentId
recipientSource
targetUserId
targetUserName
status
statusNote
message
read: false
createdAt/updatedAt
version: 1
```

### Atomicity and batch limits

- Issue status/activity transaction commits first.
- Recipient enumeration and alert writes occur second.
- Because alert rules perform a distinct assignment `get()` per assignment target and
  batched writes have a 20-call aggregate rules limit, start with **12 writes per
  batch**.
- Reporter-only fallback writes do not require an assignment lookup. Assignment
  recipients do.
- Worst-case fixed paths include UID mapping, profile, effective access, parent issue,
  and immutable activity; assignment-backed targets then add one distinct assignment
  path each. Twelve assignment recipients therefore budget approximately 17 aggregate
  document accesses before cache behavior, leaving three calls of margin.
- Twelve remains provisional. Emulator-measure the final compiled rules and reduce the
  chunk until both the aggregate 20-call and per-write 10-call limits pass with margin.
- Record failed target IDs for retry; do not repeat successful deterministic writes.

### `useScopedAlerts`

For a BHT's unread targeted alerts:

```javascript
query(
  collection(db, 'alerts'),
  where('audience', '==', 'bht'),
  where('targetUserId', '==', user.id),
  where('read', '==', false),
  orderBy('createdAt', 'desc')
)
```

Remove the broad BHT query at `src/hooks/useScopedAlerts.js:102-120`. The unread badge is
the number of unread returned alerts; read alerts do not remain counted.

Use this one server-authorized BHT targeted-alert listener as the source for both
`issueUpdates` and BHT debrief alerts:

- `issueUpdates`: `type == "eoc_issue_update"`, sorted newest first and capped for the
  Home card if needed;
- BHT debrief alerts: `type == "shift_debrief_submitted"`;
- never create a second broad BHT listener by `type` alone.

Standardize every new/migrated alert with `audience: "bht" | "supervisor"`.
Supervisor/admin listeners must also replace the current global
`where("read", "==", false)` listener
(`src/hooks/useScopedAlerts.js:43-100`) with separate server-constrained family queries:

- issue and debrief families: `audience == "supervisor"`,
  `type in <familyTypes>`, `locationId in <exactLocationChunk>`, `read == false`,
  ordered by `createdAt desc`;
- fleet and transport families: the same audience/read/type constraints with
  `locationId in <authorized broad operational locations>`;
- chunk type/location combinations so total disjunctions stay at or below 30;
- merge by alert ID and sort after all family listeners return;
- never mix exact issue alerts and broad operational alerts in one query because their
  rules predicates differ.

The corresponding rules list branch must be provable from those constraints. A global
unread listener followed by client-side location/type filtering is not permitted.

`markCurrentUserHandoffAlertsRead` currently reads every alert for a debrief and then
filters in memory (`src/services/shiftDebriefService.js:557-570`). Replace that with a
server-constrained query before applying batch updates:

```javascript
query(
  collection(db, 'alerts'),
  where('audience', '==', 'bht'),
  where('debriefId', '==', debriefId),
  where('type', '==', 'shift_debrief_submitted'),
  where('targetUserId', '==', userId),
  where('read', '==', false)
)
```

This query must not read supervisor-audience debrief alerts for the same `debriefId`.
The matching update remains owner-only through the `audience == "bht"` update branch.

Issue status alerts deep-link to `/issues/{issueId}`. Current BHT navigation only focuses
an update on Home (`src/App.jsx:967-980`), so route handling must change.

## 11. BHT Home implementation

Keep the structure and styling of `docs/mockups/bht-home-final.html`.

### Right now

- Greeting and exact assigned location.
- Active transport card using existing create/continue handlers.
- Current EOC task using existing `handleStartEoc`.
- Location Issues card:
  - total active count;
  - open count;
  - in-progress count;
  - tap navigates to `/issues`.
- Incoming debrief card using existing debrief data and reviewed state.

### No active assignment state

Current `BhtHub` exits early when the BHT has no active assignment
(`src/components/BhtHub.jsx:295-312`). Keep that safety behavior in the redesign:

- show the no-assignment message and issue-update/debrief notices that are already
  targeted to the user;
- do not show Report Issue or Location Issues counts without an exact `locationId`;
- provide a clear instruction to contact a supervisor for assignment correction;
- emulator/UI tests must confirm a BHT without exact issue access cannot create or list
  location issues.

### Shift tasks and quick actions

- Preserve transport and EOC actions.
- Report issue opens the shared report modal.
- Add debrief note continues to `/debrief/quick`
  (`src/App.jsx:955-957`).
- Edit/full debrief continues to `/debrief/full`
  (`src/App.jsx:959-960`).
- Preserve `onDebriefAssignmentChange`
  (`src/App.jsx:1160`; `src/components/BhtHub.jsx:43-44`).

### Reviewed incoming debrief

- Store only the last reviewed debrief reference in
  `userHomeState/{firebaseAuthUid}`.
- On review, write debrief ID/date key/reviewed time.
- Home gets the referenced debrief by known ID.
- Do not add mutable review fields to another user's submitted debrief.

## 12. Location Issues board and detail

### Routes

Extend `parseAppRoute` and `renderShell`:

```text
/issues       -> Location Issues board
/issues/:id   -> issue detail/activity
```

Current route parsing falls through unknown routes to Home
(`src/App.jsx:68-95`), so both routes require explicit branches.

### Board

- Header shows exact location context and shared-across-shifts copy.
- Report button opens the same modal used by Home.
- Tabs:
  - Active: open + in progress.
  - Resolved 30 Days: resolved + voided with `closedAt` cutoff.
- BHT view is read-only except Report.
- Supervisors/admins see allowed status controls.
- Cards show label, description, severity, reporter, created time, status, and
  `latestActivity`.
- Voided cards show `VOIDED` plus reason.

### Detail/activity

- Get the known issue by route ID; rules reject out-of-scope IDs.
- Subscribe to `/activity` ordered by `createdAt`.
- Render immutable timeline events.
- Notification click marks that target alert read and navigates to the detail route.
- If issue was removed from current scope or access expired, show:
  `This issue is no longer available for your current location access.`

## 13. Supervisor controls

Allowed controls:

- Open -> Mark in progress, note required.
- Open/in progress -> Post update, note required.
- Open/in progress -> Resolve, resolution note required.
- Open/in progress -> Void, reason required and confirmation required.

All controls call `issueStatusService`. Components must not write `eocIssues` directly.

Resolved and voided records are retained. There is no issue delete path.

## 14. Other query/rule migration impacts

Switching the helper foundation affects more than Location Issues. During Phase C,
replace every use of `authRoleAllowed`, `authLocationAllowed`, and
`authRoleAndLocationAllowed` with profile-based equivalents and remove all legacy
bypasses.

Required compatibility work:

- `shiftAssignments`: authenticated profile reads only; management writes use
  profile role/scope.
- `shiftDebriefs`: exact constrained reads and existing immutable-field checks.
- `users`: no public reads; admin owns identity/security fields, supervisors retain
  only operational edits on existing in-scope BHTs, and full-collection listeners are
  replaced with role/location-constrained queries.
- debrief recipient lookup: query active `shiftAssignments` by exact location and shift,
  rather than all active users (`src/services/shiftDebriefService.js:460-468`).
- `eocTaskEngine`: replace broad browser-side scans of submitted debriefs and
  pending/overdue EOC tasks (`src/services/eocTaskEngine.js:286`,
  `src/services/eocTaskEngine.js:466-467`) with profile-authorized, server-constrained
  location/status chunks. Missing/late debrief alert generation runs only for
  supervisor/admin users with exact access to the affected debrief location.
- `fleetTaskEngine`: replace broad open-task scans
  (`src/services/fleetTaskEngine.js:376-385`) with broad-management
  `mainLocation/status` constraints, keep existing fleet indexes, and use deterministic
  alert IDs for new fleet alerts instead of random alert documents
  (`src/services/fleetTaskEngine.js:434-440`, `src/services/fleetTaskEngine.js:478-484`).
- `alerts`: targeted or management-only reads; no public reads.
- `eocIssues`: exact constrained reads; no public reads.
- `auditLogs`: no public reads. Issue-related audit entries must include `locationId`,
  `collectionPath`, `documentId`, actor fields, and action type so rules can authorize
  issue audit reads with `exactIssueLocationAllowed(locationId)`. Non-issue audit logs use
  the appropriate broad management scope. Do not leave `firestore.rules:790-804` as
  `allow read: if true`.
- `clients`, `destinations`, `transports`, `eocSubmissions`, and other operational
  records that contain client/staff/location details must not remain public-read after
  the profile-rules cutover. Convert them to active-profile reads with the narrowest
  existing module scope that preserves current workflows, and keep existing field
  validators.
- other modules currently relying on claim helpers must receive profile-based helpers
  with equivalent broad operational scope and their existing field validators.

This work must not tighten only issue rules while leaving the same issue content exposed
through alerts or public profile/assignment reads.

## 15. Files expected to change during implementation

This v3.3 planning pass changes no code. Expected implementation files:

```text
src/firebase.js
src/components/PinLogin.jsx (prefer rename to GoogleLogin.jsx)
src/App.jsx
src/components/Header.jsx
src/components/BhtHub.jsx
src/components/LocationIssuesBoard.jsx (new)
src/components/IssueDetail.jsx (new)
src/components/IssueReportModal.jsx (new/shared)
src/components/DashboardSummaryPanel.jsx
src/components/SupervisorEocPanel.jsx
src/components/SupervisorDashboard.jsx
src/components/NotificationCenter.jsx
src/services/authPolicyService.js
src/services/accessGrantService.js
src/services/issueStatusService.js (new)
src/services/bhtIssueReportService.js
src/services/offlineSyncService.js
src/services/notificationService.js
src/services/shiftDebriefService.js
src/services/eocTaskEngine.js
src/services/fleetTaskEngine.js
src/hooks/useScopedIssues.js
src/hooks/useScopedAlerts.js
src/hooks/useUserScope.js
src/utils/orgModel.js
src/index.css
firebase.json
firestore.rules
firestore.indexes.json
package.json
tests/firestore.rules.test.js (new, or equivalent emulator test path)
scripts/migrateIssueHistory.js (new)
scripts/migrateAlertAudience.js (new)
scripts/provisionAuthClaims.js (retire/delete after rollback window)
scripts/verifyAuthClaims.js (retire/delete after rollback window)
```

Do not add:

```text
functions/
firebase-functions
mintPinSession
custom-claim provisioning as a deployment prerequisite
```

`firebase-admin` may remain temporarily for unrelated existing maintenance scripts. Its
presence in `package.json` is not evidence of a runtime Cloud Function.

## 16. Build sequence

1. Use confirmed bootstrap admin app user ID `admin_owner` and confirmed email
   `mark@scottsdaleprovidence.com`.
2. Add Firebase emulator configuration, `npm` scripts such as `test:rules`, and the
   automated rules test harness.
3. Implement and emulator-test profile helpers, identity-link rules, and the exact
   first-admin bootstrap branch.
4. Add Google provider client flow and exact bootstrap transaction.
5. Link and verify the first admin.
6. Remove the bootstrap app/rules exception and prove the bootstrap path is denied.
7. Add email and `issueLocationIds` to admin user management.
8. Add `userEmailLinks` transactional admin maintenance and migration validation report.
9. Populate and verify every active profile through the linked Google admin.
10. Add normal first-login mapping, session persistence, denial states, and Firebase
   logout.
11. Add supervisor operational-BHT update rules and scoped profile queries.
12. Retire the old PIN/auth-policy compatibility path and remove unauthenticated
    `appSettings/authPolicy` dependence from login.
13. Replace claim helpers across existing rules and convert affected client queries.
14. Add `issueAccess` effective document and transactional admin grant/revoke.
15. Add and dry-run issue-history and alert-audience migrations against emulator data.
16. Deploy indexes and wait until they are built.
17. Create `issueStatusService`; move both status call sites.
18. Add activity/latestActivity to status and both create paths.
19. Add deterministic offline issue IDs.
20. Add source-validated alert-family rules, shift-assignment/reporter recipient
    enumeration, deterministic fan-out, retry, and targeted alert hooks.
21. Emulator-measure alert batches and set a passing chunk size with margin.
22. Add `/issues` and `/issues/:id`, board, detail timeline, and deep links.
23. Finish BHT Home visual changes and reviewed-debrief state.
24. Run full emulator, build, lint, and manual mobile/shared-device tests.
25. Perform staged production cutover in Section 4.
26. After rollback window, remove PIN data/UI and retire claim scripts.

Do not deploy strict application rules before the designated admin mapping is complete,
the bootstrap exception is removed, all active profiles are prepared, and the converted
queries pass the emulator.

## 17. Emulator-testable acceptance criteria

### Authentication and identity

- Verified `mark@scottsdaleprovidence.com` with a matching active email link can create
  exactly one UID mapping and load the `admin_owner` profile.
- The client cannot supply another `userId` during linking.
- A second UID cannot claim an already-linked email.
- An unverified email is denied.
- A verified non-company email with no active admin-created external email link is
  denied by client and rules.
- A verified non-company email with an active external email link and complete admin
  approval metadata can link only to that exact approved profile.
- A verified non-company email with `emailType: "external"` but missing
  `externalGoogleAllowed: true`, approval reason, approver, or approval timestamp is
  denied.
- **Domain spoof/no-link denial:** a verified Google email whose domain only contains the
  company domain as a prefix or substring is denied unless that exact email was
  intentionally approved as an external account. Required no-link denial cases:
  `attacker@scottsdaleprovidence.com.evil.com`,
  `attacker@notscottsdaleprovidence.com`, and `a@b@scottsdaleprovidence.com` are each
  rejected, while the confirmed `admin_owner` company email is accepted.
- A mixed-case company email is normalized with `trim().toLowerCase()` and resolves the
  lowercase email-link path.
- A verified company email with no `userEmailLinks` document is denied and signed out.
- An inactive email link or inactive profile is denied.
- A UID mapping cannot be created from an inactive, already-linked, or mismatched
  `userEmailLinks` document.
- The Google login screen does not depend on an unauthenticated
  `appSettings/authPolicy` read or the old `authScopeEnforced` compatibility path.
- Removing the UID mapping or deactivating the profile denies the next Firestore request.
- A BHT cannot create/update/delete staff profiles, email links, or another UID mapping.
- An admin can perform the explicit unlink/relink transaction.
- The bootstrap rule links only the configured Google email to only the configured
  existing admin profile.
- Wrong bootstrap email/profile combinations are denied.
- After bootstrap removal, the same special bootstrap write is denied.
- A supervisor can edit listed operational fields for an existing in-scope BHT.
- A supervisor cannot create a profile or change email, role, active state,
  identity-link fields, or an out-of-scope BHT.

### Exact-location rules

- Lone Mountain BHT can get/list Lone Mountain issues.
- The same BHT cannot get a Mesquite issue by known ID.
- The same BHT's query without a location constraint is denied.
- `where(locationId, in, ["lone_mountain"])` succeeds.
- `where(locationId, in, ["lone_mountain", "mesquite"])` is denied unless both are in
  effective exact access.
- Broad `authorizedLocations: ["OTC"]` alone does not permit either house issue.
- A valid active temporary Mesquite entry permits Mesquite reads.
- The same entry denies before `startsAt` and after `expiresAt` using emulator request
  time.
- Issue activity follows the parent issue's exact scope.
- Shift debrief get follows exact scope.
- Shift debrief draft get/list/create/update follows exact scope and own-draft rules.
- Exact-location active `shiftAssignments` query succeeds; an unbounded assignment list
  query is denied.
- `userHomeState` can be written only by the owning Firebase UID, only with the allowed
  reviewed-debrief fields, and only for a debrief in current exact scope.

### Query/index behavior

- Active query succeeds with exact location + two statuses + createdAt order.
- Resolved query succeeds with exact location + two closed statuses + cutoff/order.
- A 15-location/two-status query is accepted.
- More than 15 locations is split into multiple listeners and merged without duplicates.
- Home counts match the merged active board.
- Required emulator indexes/rules test configuration is committed.
- Existing migrated issues have `closedAt` where needed and a clear legacy activity entry
  before strict issue-detail UI is accepted.

### Issue writes and activity

- BHT can create only `status: open`, `version: 1`, own reporter ID, and an allowed exact
  location.
- Create transaction writes one `reported` activity and matching `latestActivity`.
- Parent-only or activity-only create/update is denied.
- Parent `latestActivity` that differs from the activity document is denied.
- BHT cannot update issue status or forge supervisor activity.
- BHT and supervisor cannot create activity for a parent issue outside their exact
  issue locations.
- Supervisor/admin transition increments version and creates one immutable activity.
- Version conflict fails without a partial parent/activity write.
- Resolve and void require notes, write `closedAt`, and are terminal.
- Void preserves the issue and displays under Resolved.
- Direct component writes no longer bypass `issueStatusService`.
- Issue audit logs include `locationId` and are not public-readable; an out-of-scope user
  cannot read the audit entry by known ID.

### Alerts

- Active `shiftAssignments` at the exact location produce one alert per unique
  `bhtUserId`.
- Reporter receives exactly one alert when actively assigned, using
  `assignment_and_reporter`.
- Reporter still receives exactly one fallback alert after their assignment becomes
  inactive.
- Inactive/different-location assignments receive none unless that user is the original
  reporter.
- A targeted alert is readable only by its target.
- A BHT cannot read another target's alert by known ID or list query.
- A BHT targeted-alert list query succeeds only when it includes
  `audience == "bht"`, `targetUserId == currentUserId`, and `read == false`.
- The same BHT query feeds both issue-update and submitted-handoff cards without a second
  broad type-only listener.
- A supervisor-audience alert with a `targetUserId` subject, such as
  `shift_debrief_incoming_ack_late`, is not returned to or readable by that BHT.
- A caller cannot forge `issueId`, issue version, event type, status, location, actor,
  note, summary/message, target, assignment, or recipient source.
- The same source event written under a random/non-deterministic alert document ID is
  denied.
- Issue supervisor alerts are readable only through exact issue location access.
- Existing untargeted debrief, fleet, and transport supervisor alerts pass only their
  family-specific source validator.
- An alert type not handled by an explicit family validator is denied.
- Supervisor issue/debrief listeners succeed only with exact-location family
  constraints; fleet/transport listeners succeed only with broad operational-location
  constraints.
- Resolving an issue marks only supervisor-audience `eoc_issue` alerts read through the
  constrained `audience + issueId + type + read` query; the old `issueId`-only alert
  scan is denied.
- `markCurrentUserHandoffAlertsRead` succeeds with the constrained
  `audience + debriefId + type + targetUserId + read` query and is denied if it queries
  all alerts for the debrief.
- The old global unread supervisor listener is denied after strict rules deploy.
- Mark-read changes only read metadata, requires `read: false -> true`, writes read
  timestamp/actor metadata, increments `version`, and cannot alter audience, target,
  source, message, issue, debrief, or location fields.
- Existing alerts without `audience` are migrated or intentionally archived before strict
  rules deploy.
- The selected production chunk size passes aggregate and per-write rules access-call
  limits with margin; 12 is the starting test size and is reduced if necessary.
- Retrying fan-out creates no duplicates.
- Unread count drops when an alert is read.
- Alert click routes to `/issues/{issueId}`.

### Offline

- Replaying the same offline action creates one issue, one reported activity, and one
  alert per target.
- Conflicting pre-existing deterministic ID becomes `needsReview`.
- Access revoked before sync causes permission denial and does not leak/create the issue.

### BHT Home and navigation

- A BHT with no active assignment sees the no-assignment state, targeted notices if any,
  and no Report Issue or Location Issues count/action.
- `/issues` and `/issues/:id` survive refresh/deep link after Google sign-in and show the
  out-of-scope message when rules deny the known issue ID.

### Regression

- Transport create/continue/close still works.
- EOC submit still works and generated issues receive activity/fan-out.
- Quick debrief remains `/debrief/quick`.
- Full/edit debrief remains `/debrief/full`.
- `onDebriefAssignmentChange` still supplies assignment context.
- Supervisor dashboards load only authorized server-constrained data.
- EOC task/debrief timing sync and fleet task sync no longer perform broad browser-side
  collection scans and still create/update only authorized in-scope task/alert records.
- `npm run build` passes.
- `npm run lint` passes or has only explicitly documented pre-existing failures.

### Shared-device manual tests

- Logout ends Firebase app access and returns to Google sign-in.
- Next user is forced through account selection.
- Closing/reopening the browser does not silently restore a prior shared-device app
  session beyond session persistence behavior.
- Instructions clearly explain that browser-level Google sign-out may still be needed.

## 18. Cutover runbook

### Before deployment

- Confirm Google provider and authorized domains.
- Confirm company domain spelling remains `scottsdaleprovidence.com` for company
  profiles and that no external email links exist unless intentionally approved with full
  audit metadata.
- Confirm designated admin profile is `users/admin_owner` / `Admin Owner` and exact
  lowercase Google email is `mark@scottsdaleprovidence.com`.
- Confirm designated admin UID mapping already works and the one-time bootstrap branch
  is absent from both app and rules.
- Confirm every active profile has unique lowercase email and reviewed
  `issueLocationIds`.
- Back up `users`, `shiftAssignments`, `shiftDebriefs`, `eocIssues`, `alerts`,
  `accessGrants`, and `appSettings`.
- Run and verify `migrateIssueHistory`: `closedAt` plus legacy activity/latestActivity for
  existing issues.
- Run and verify `migrateAlertAudience`: `audience`, `version`, and read metadata for
  existing alerts, with unclassifiable alerts archived/read by admin migration note.
- Deploy indexes and wait for ready state.
- Pass emulator suite.

### Deployment window

1. Designated admin signs in with Google and re-verifies the existing admin mapping.
2. Deploy app containing normal Google linking, server-constrained queries, source-
   validated alert writes, and new issue UI.
3. Deploy the matching strict profile-based rules with no legacy/bootstrap bypass.
4. Smoke-test one account per role and exact location.
5. Verify unregistered company accounts and unapproved external accounts are denied; if
   an external test account exists, verify only that exact approved external email can
   link.
6. Verify Lone Mountain/Mesquite isolation.
7. Verify grant start/expiration and targeted alerts.
8. Verify old migrated alerts still render or are intentionally archived, and old issues
   open in detail with a clear legacy activity entry.

### Rollback

- Roll back app and rules as a matched pair.
- Do not delete new identity-link documents during rollback.
- Do not delete or rewrite issue/activity history.
- If strict rules block the designated admin, restore the previous rules immediately,
  fix mapping/profile data, and repeat the cutover.

## 19. Residual risks and open questions

### Residual risks

- **Profile `get()` in list authorization:** Firestore supports document lookups in
  rules, but query proof and access-call caching are critical. Emulator proof is a hard
  release gate.
- **Shared devices:** Firebase app logout does not sign the browser out of Google.
  Account-selection prompts and plain instructions reduce but do not eliminate staff
  confusion.
- **First-admin sequencing:** Strict rules before the designated admin mapping exists
  will lock out administration. The exact-email/exact-profile bootstrap and its
  immediate removal are mandatory.
- **Email lifecycle:** Renamed or reassigned Workspace accounts require explicit admin
  unlink/relink. Silent automatic relinking is unsafe.
- **Supervisor workflow change:** Supervisors currently can create BHT profiles. V3.3
  intentionally limits them to operational edits on existing BHTs because creating an
  email-to-profile identity mapping grants system access. Admin coverage and response
  time must be adequate for new-user setup.
- **Client-side fan-out:** The issue transaction can succeed while some alerts fail.
  Deterministic retries and visible partial-success handling are required.
- **Alert-family complexity:** Existing issue, debrief, fleet, and transport alerts need
  separate source validators. A permissive generic fallback is prohibited; every
  current alert type must have an emulator case before strict rules deploy.
- **Data migration accuracy:** Existing alerts and issues were not created with the new
  audience/activity model. Migration scripts must be dry-run, backed up, and spot-checked
  because they affect what staff can see immediately after strict rules deploy.
- **Rules breadth:** Current public reads and legacy helpers affect modules beyond this
  feature. Converting only issue code would leave privacy gaps or cause unrelated
  regressions.
- **Rules batch budget:** A final rule change can alter access-call count. The 12-alert
  chunk is a starting bound, not a substitute for emulator measurement.
- **Offline authentication:** Google sign-in and first linking require connectivity.
  Already-authenticated sessions may use Firestore offline cache, but a logged-out
  shared device cannot start a new offline session.

### Owner decisions now resolved

- First cutover admin app profile: `users/admin_owner`, name `Admin Owner`, role `Admin`,
  status `ACTIVE`, location `GLOBAL (full access)`, Google email
  `mark@scottsdaleprovidence.com`.
- Login policy: admin-approved exact-email allowlist. `scottsdaleprovidence.com` is the
  default company domain; admins may approve an exact external Google email only with
  explicit reason/approver/timestamp metadata.
- Supervisors cannot create login-capable accounts. They may edit allowed operational
  fields on existing BHT profiles or submit a future pending access request, but an admin
  must create the actual email link.

## 20. v3.7 readiness decision

- **Ready for the next independent Claude/codebase audit:** yes.
- **Go for implementation:** yes, after the next independent Claude/codebase audit
  confirms v3.7 and no new blockers are found.
- **Go for production deployment:** no, until bootstrap removal, exact-location query
  proof, all alert-family tests, rules access-call measurement, indexes, build/lint, and
  shared-device tests pass.

## 21. Technical references

- Firebase Google sign-in for web:
  https://firebase.google.com/docs/auth/web/google-signin
- Firebase Security Rules request/auth token:
  https://firebase.google.com/docs/reference/rules/rules.firestore.Request
- Firestore rules conditions and document-access-call limits:
  https://firebase.google.com/docs/firestore/security/rules-conditions
- Securely querying data; rules are not filters:
  https://firebase.google.com/docs/firestore/security/rules-query
- Firestore query limits and disjunctions:
  https://firebase.google.com/docs/firestore/query-data/queries
