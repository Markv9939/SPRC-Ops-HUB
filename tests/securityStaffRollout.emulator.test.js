import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import admin from 'firebase-admin'
import { SECURITY_WORKFLOWS } from '../functions/src/workflowSecurityModel.js'
import { evaluateStaffCohortProfiles } from '../scripts/securityStaffRolloutModel.js'
import {
  applyStaffCohortEnrollment,
  applyStaffCohortRollback,
  captureStaffRolloutConfig,
  captureStaffRolloutProfileEvidence
} from '../scripts/manageSecurityStaffRollout.js'

const projectId = 'demo-sprc-security-staff-rollout'
const releaseId = 'security-foundation-test-house-v1'
const profileId = 'real_mesquite_bht_1'
const authUid = 'rollout_auth_uid_1'
const sessionId = 'rollout_existing_session_1'
const backupSha256 = 'a'.repeat(64)
const enrollmentAuditId = `staff_rollout_enroll_${backupSha256.slice(0, 32)}`
const rollbackAuditId = `staff_rollout_rollback_${backupSha256.slice(0, 32)}`

if (!admin.apps.length) admin.initializeApp({ projectId })
const db = admin.firestore()
const auth = admin.auth()

async function deleteIfPresent(ref) {
  try {
    await ref.delete()
  } catch {
    // Emulator cleanup remains best-effort for absent documents.
  }
}

before(async () => {
  await Promise.all([
    deleteIfPresent(db.doc('appSettings/securityFoundation')),
    deleteIfPresent(db.doc('appSettings/securityWorkflows')),
    deleteIfPresent(db.doc('appSettings/authPolicy')),
    deleteIfPresent(db.doc('appSettings/appCheckMonitoring')),
    deleteIfPresent(db.doc(`users/${profileId}`)),
    deleteIfPresent(db.doc(`staffPinCredentials/${profileId}`)),
    deleteIfPresent(db.doc(`staffAuthIdentities/${profileId}`)),
    deleteIfPresent(db.doc(`usersByAuthUid/${authUid}`)),
    deleteIfPresent(db.doc(`staffSessions/${sessionId}`)),
    deleteIfPresent(db.doc(`securityWorkflowAudit/${enrollmentAuditId}`)),
    deleteIfPresent(db.doc(`securityWorkflowAudit/${rollbackAuditId}`))
  ])
  try {
    await auth.deleteUser(authUid)
  } catch {
    // The user may not exist in a fresh emulator.
  }

  await auth.createUser({ uid: authUid, displayName: 'Synthetic rollout BHT' })
  const now = admin.firestore.Timestamp.now()
  const canaryIds = ['test_supervisor', 'test_bht_shift_1', 'test_bht_shift_2']
  await Promise.all([
    db.doc('appSettings/securityFoundation').set({
      schemaVersion: 2,
      serverPinLoginEnabled: true,
      clientBootstrapVersion: 3,
      clientBootstrapEnabled: true,
      protectedAccountActionsVersion: 4,
      protectedAccountActionsEnabled: true,
      offlineReplayVersion: 5,
      offlineReplayEnabled: true,
      rolloutState: 'production_canary',
      enabledProfileIds: canaryIds,
      releaseId,
      updatedAt: now
    }),
    db.doc('appSettings/securityWorkflows').set({
      schemaVersion: 6,
      enabled: true,
      workflows: SECURITY_WORKFLOWS,
      rolloutState: 'production_canary',
      enabledProfileIds: canaryIds,
      releaseId,
      updatedAt: now
    }),
    db.doc('appSettings/authPolicy').set({ authScopeEnforced: false, updatedAt: now }),
    db.doc('appSettings/appCheckMonitoring').set({ schemaVersion: 7, monitoringEnabled: true, enforcementEnabled: false, updatedAt: now }),
    db.doc(`users/${profileId}`).set({
      name: 'Synthetic rollout BHT',
      role: 'BHT',
      active: true,
      deleted: false,
      locationId: 'mesquite',
      site: 'OTC',
      securityVersion: 1,
      authUid,
      pinHash: 'synthetic_legacy_pin_hash',
      updatedAt: now
    }),
    db.doc(`staffAuthIdentities/${profileId}`).set({ profileId, authUid, schemaVersion: 2, updatedAt: now }),
    db.doc(`usersByAuthUid/${authUid}`).set({ userId: profileId, version: 2, updatedAt: now }),
    db.doc(`staffSessions/${sessionId}`).set({
      profileId,
      authUid,
      securityVersion: 1,
      active: true,
      issuedAt: now,
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 60_000),
      updatedAt: now
    })
  ])
})

after(async () => {
  await Promise.all([
    deleteIfPresent(db.doc('appSettings/securityFoundation')),
    deleteIfPresent(db.doc('appSettings/securityWorkflows')),
    deleteIfPresent(db.doc('appSettings/authPolicy')),
    deleteIfPresent(db.doc('appSettings/appCheckMonitoring')),
    deleteIfPresent(db.doc(`users/${profileId}`)),
    deleteIfPresent(db.doc(`staffAuthIdentities/${profileId}`)),
    deleteIfPresent(db.doc(`usersByAuthUid/${authUid}`)),
    deleteIfPresent(db.doc(`staffSessions/${sessionId}`)),
    deleteIfPresent(db.doc(`securityWorkflowAudit/${enrollmentAuditId}`)),
    deleteIfPresent(db.doc(`securityWorkflowAudit/${rollbackAuditId}`))
  ])
  try {
    await auth.deleteUser(authUid)
  } catch {
    // Best-effort cleanup.
  }
})

test('guarded staff enrollment and rollback are atomic, session-safe, audited, and retryable', async () => {
  const config = await captureStaffRolloutConfig(db)
  const evidenceById = await captureStaffRolloutProfileEvidence({
    db,
    auth,
    profileIds: [profileId],
    enrolledProfileIds: ['test_supervisor', 'test_bht_shift_1', 'test_bht_shift_2']
  })
  const cohort = evaluateStaffCohortProfiles({
    profileIds: [profileId],
    profilesById: evidenceById,
    locationId: 'mesquite'
  })
  assert.equal(cohort.ready, true)

  const backup = {
    schemaVersion: 1,
    projectId: 'sprc-tx-l',
    releaseId,
    createdAt: new Date().toISOString(),
    locationId: 'mesquite',
    profileIds: [profileId],
    config,
    profileState: {
      [profileId]: {
        stateHash: evidenceById[profileId].stateHash,
        profileDocumentHash: evidenceById[profileId].profileDocumentHash,
        securityVersion: evidenceById[profileId].securityVersion,
        authUid
      }
    }
  }

  await assert.rejects(() => applyStaffCohortEnrollment({
    db, auth, backup, backupSha256, profileIds: [profileId], locationId: 'mesquite', confirmation: 'wrong'
  }), /ENROLL MESQUITE BHT SECURITY COHORT/)

  const enrolled = await applyStaffCohortEnrollment({
    db,
    auth,
    backup,
    backupSha256,
    profileIds: [profileId],
    locationId: 'mesquite',
    confirmation: 'ENROLL MESQUITE BHT SECURITY COHORT'
  })
  assert.equal(enrolled.replayed, false)
  assert.equal(enrolled.cleanupStatus, 'completed')
  const [enrolledFoundation, enrolledWorkflow, enrolledProfile, closedSession, enrollmentAudit] = await Promise.all([
    db.doc('appSettings/securityFoundation').get(),
    db.doc('appSettings/securityWorkflows').get(),
    db.doc(`users/${profileId}`).get(),
    db.doc(`staffSessions/${sessionId}`).get(),
    db.doc(`securityWorkflowAudit/${enrollmentAuditId}`).get()
  ])
  assert.ok(enrolledFoundation.data().enabledProfileIds.includes(profileId))
  assert.deepEqual(enrolledFoundation.data().enabledProfileIds, enrolledWorkflow.data().enabledProfileIds)
  assert.equal(enrolledProfile.data().securityVersion, 2)
  assert.equal(closedSession.data().active, false)
  assert.equal(closedSession.data().revocationReason, 'staff_security_cohort_enrollment')
  assert.equal(enrollmentAudit.data().cleanupStatus, 'completed')

  const enrollmentRetry = await applyStaffCohortEnrollment({
    db,
    auth,
    backup,
    backupSha256,
    profileIds: [profileId],
    locationId: 'mesquite',
    confirmation: 'ENROLL MESQUITE BHT SECURITY COHORT'
  })
  assert.equal(enrollmentRetry.replayed, true)
  assert.equal((await db.doc(`users/${profileId}`).get()).data().securityVersion, 2)

  await db.doc('staffSessions/rollout_new_session_2').set({
    profileId,
    authUid,
    securityVersion: 2,
    active: true,
    issuedAt: admin.firestore.Timestamp.now(),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 60_000)
  })
  const rolledBack = await applyStaffCohortRollback({
    db,
    auth,
    backup,
    backupSha256,
    profileIds: [profileId],
    locationId: 'mesquite',
    confirmation: 'ROLL BACK MESQUITE BHT SECURITY COHORT'
  })
  assert.equal(rolledBack.replayed, false)
  assert.equal(rolledBack.cleanupStatus, 'completed')
  const [restoredFoundation, restoredWorkflow, restoredProfile, rollbackSession, rollbackAudit] = await Promise.all([
    db.doc('appSettings/securityFoundation').get(),
    db.doc('appSettings/securityWorkflows').get(),
    db.doc(`users/${profileId}`).get(),
    db.doc('staffSessions/rollout_new_session_2').get(),
    db.doc(`securityWorkflowAudit/${rollbackAuditId}`).get()
  ])
  assert.equal(restoredFoundation.data().enabledProfileIds.includes(profileId), false)
  assert.deepEqual(restoredFoundation.data().enabledProfileIds, restoredWorkflow.data().enabledProfileIds)
  assert.equal(restoredProfile.data().securityVersion, 3)
  assert.equal(rollbackSession.data().active, false)
  assert.equal(rollbackSession.data().revocationReason, 'staff_security_cohort_rollback')
  assert.equal(rollbackAudit.data().cleanupStatus, 'completed')

  const rollbackRetry = await applyStaffCohortRollback({
    db,
    auth,
    backup,
    backupSha256,
    profileIds: [profileId],
    locationId: 'mesquite',
    confirmation: 'ROLL BACK MESQUITE BHT SECURITY COHORT'
  })
  assert.equal(rollbackRetry.replayed, true)
  assert.equal((await db.doc(`users/${profileId}`).get()).data().securityVersion, 3)

  await deleteIfPresent(db.doc('staffSessions/rollout_new_session_2'))
})
