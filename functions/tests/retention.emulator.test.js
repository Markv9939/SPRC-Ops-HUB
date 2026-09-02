import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import test from 'node:test'
import { getApps } from 'firebase-admin/app'
import { Timestamp, getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { createServerPinCredential } from '../src/staffPinCredentialModel.js'

process.env.GCLOUD_PROJECT ||= 'demo-sprc-functions'
process.env.STAFF_PIN_AUTH_SECRET ||= 'retention-emulator-secret-with-more-than-thirty-two-characters'
const {
  assignEocTemplateHandler,
  archiveEocTemplateHandler,
  emergencyPrivacyRemoveHandler,
  previewEocTemplatePurgeHandler,
  publishEocTemplateHandler,
  purgeEocTemplateHandler,
  requestEocTemplateArchiveHandler,
  runPhotoRetentionCleanup,
  saveEocSectionHandler
} = await import('../src/index.js')
const db = getFirestore()
const bucket = getStorage().bucket()
const staffPinSecret = process.env.STAFF_PIN_AUTH_SECRET

async function seedSecureAdmin(profileId, uid, pin, securityVersion = 1) {
  const sessionId = `session_${profileId}_device_01`
  await db.doc(`users/${profileId}`).set({
    role: 'admin', active: true, deleted: false, name: 'Secure Admin',
    securityVersion, authorizedLocations: [], issueLocationIds: []
  })
  await db.doc(`usersByAuthUid/${uid}`).set({ userId: profileId, version: 2 })
  await db.doc(`staffAuthIdentities/${profileId}`).set({ profileId, authUid: uid, schemaVersion: 2 })
  await db.doc(`staffSessions/${sessionId}`).set({
    profileId, authUid: uid, securityVersion, active: true, revokedAt: null,
    expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000)
  })
  await db.doc(`staffPinCredentials/${profileId}`).set({
    ...(await createServerPinCredential(pin, staffPinSecret, { salt: `salt-${profileId}` })),
    active: true
  })
  return { uid, token: { profileId, sessionId, securityVersion } }
}

test.beforeEach(async () => {
  const collections = await db.listCollections()
  for (const collection of collections) {
    const snap = await collection.get()
    for (const item of snap.docs) await item.ref.delete()
  }
})

test('retention deletes due objects, treats missing objects as success, and is idempotent', async () => {
  const due = Timestamp.fromMillis(Date.now() - 1000)
  await db.doc('eocIssues/due_issue').set({ status: 'resolved', photoDeletionDueAt: due })
  await db.doc('eocIssues/due_issue/attachments/present').set({ state: 'uploaded', storagePath: 'issueAttachments/test_house/due_issue/present.jpg', version: 1 })
  await db.doc('eocIssues/due_issue/attachments/missing').set({ state: 'uploaded', storagePath: 'issueAttachments/test_house/due_issue/missing.jpg', version: 1 })
  await bucket.file('issueAttachments/test_house/due_issue/present.jpg').save(Buffer.from([1, 2, 3]), { contentType: 'image/jpeg' })

  const first = await runPhotoRetentionCleanup({ now: Timestamp.now() })
  assert.equal(first.deleted, 1)
  assert.equal(first.missing, 1)
  assert.equal((await db.doc('eocIssues/due_issue/attachments/present').get()).data().state, 'deleted')
  assert.equal((await db.doc('eocIssues/due_issue').get()).data().photoDeletionDueAt, null)
  assert.equal((await db.collection('eocIssues/due_issue/attachmentHistory').get()).size, 2)
  const second = await runPhotoRetentionCleanup({ now: Timestamp.now() })
  assert.equal(second.deleted, 0)
  assert.equal(second.missing, 0)
})

test('reopened issues cancel retention cleanup', async () => {
  await db.doc('eocIssues/reopened').set({ status: 'open', photoDeletionDueAt: Timestamp.fromMillis(Date.now() - 1000) })
  await db.doc('eocIssues/reopened/attachments/photo').set({ state: 'uploaded', storagePath: 'issueAttachments/test_house/reopened/photo.jpg', version: 1 })
  const result = await runPhotoRetentionCleanup({ now: Timestamp.now() })
  assert.equal(result.deleted, 0)
  assert.equal((await db.doc('eocIssues/reopened/attachments/photo').get()).data().state, 'uploaded')
})

test('emergency privacy removal verifies admin PIN, deletes bytes, and audits', async () => {
  const requestAuth = await seedSecureAdmin('admin_test', 'admin_test_uid', '385104')
  await db.doc('eocIssues/privacy_issue').set({ status: 'open', locationId: 'test_house' })
  await db.doc('eocIssues/privacy_issue/attachments/private').set({ state: 'uploaded', storagePath: 'issueAttachments/test_house/privacy_issue/private.jpg', version: 1 })
  await bucket.file('issueAttachments/test_house/privacy_issue/private.jpg').save(Buffer.from([1, 2, 3]), { contentType: 'image/jpeg' })
  await assert.rejects(() => emergencyPrivacyRemoveHandler({ auth: requestAuth, data: { adminProfileId: 'admin_test', currentPin: '000000', issueId: 'privacy_issue', attachmentId: 'private', reason: 'Contains identifying information.' } }), /Admin PIN/)
  const result = await emergencyPrivacyRemoveHandler({ auth: requestAuth, data: { adminProfileId: 'admin_test', currentPin: '385104', issueId: 'privacy_issue', attachmentId: 'private', reason: 'Contains identifying information.' } })
  assert.equal(result.removed, true)
  assert.equal((await db.doc('eocIssues/privacy_issue/attachments/private').get()).data().state, 'privacy_removed')
  assert.equal((await db.collection('auditLogs').where('action', '==', 'attachment_privacy_removed').get()).size, 1)
  const repeated = await emergencyPrivacyRemoveHandler({ auth: requestAuth, data: { adminProfileId: 'admin_test', currentPin: '385104', issueId: 'privacy_issue', attachmentId: 'private', reason: 'Contains identifying information.' } })
  assert.equal(repeated.alreadyRemoved, true)
  assert.equal((await db.collection('auditLogs').where('action', '==', 'attachment_privacy_removed').get()).size, 1)
})

test('emergency privacy removal locks repeated invalid PIN attempts', async () => {
  const requestAuth = await seedSecureAdmin('admin_lock_test', 'admin_lock_test_uid', '492815')
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await assert.rejects(() => emergencyPrivacyRemoveHandler({ auth: requestAuth, data: { adminProfileId: 'admin_lock_test', currentPin: '000000', issueId: 'missing', attachmentId: 'missing', reason: 'Synthetic invalid attempt.' } }), error => error?.code === 'permission-denied')
  }
  await assert.rejects(() => emergencyPrivacyRemoveHandler({ auth: requestAuth, data: { adminProfileId: 'admin_lock_test', currentPin: '000000', issueId: 'missing', attachmentId: 'missing', reason: 'Synthetic invalid attempt.' } }), error => error?.code === 'resource-exhausted')
  await assert.rejects(() => emergencyPrivacyRemoveHandler({ auth: requestAuth, data: { adminProfileId: 'admin_lock_test', currentPin: '492815', issueId: 'missing', attachmentId: 'missing', reason: 'Synthetic locked attempt.' } }), error => error?.code === 'resource-exhausted')
})

test('template publishing is owner-scoped, immutable, and idempotent', async () => {
  await db.doc('users/template_supervisor').set({ role: 'supervisor', active: true, name: 'Template Supervisor', authorizedLocations: ['OTC'] })
  await db.doc('usersByAuthUid/template_supervisor_uid').set({ userId: 'template_supervisor' })
  const request = {
    auth: { uid: 'template_supervisor_uid' },
    data: {
      operationId: 'publish_operation_1',
      template: {
        name: 'Night Safety',
        eocType: 'house',
        sections: [{
          id: 'safety',
          title: 'Safety',
          questions: [{ trackingId: 'front_lock', label: 'Does the front lock work?', questionType: 'pass_issue' }]
        }]
      }
    }
  }
  const first = await publishEocTemplateHandler(request)
  const repeated = await publishEocTemplateHandler(request)
  assert.equal(first.templateId, repeated.templateId)
  assert.equal(first.versionNumber, 1)
  assert.equal((await db.collection('eocTemplateVersions').get()).size, 1)
  assert.equal((await db.doc(`eocTemplateLibrary/${first.templateId}`).get()).data().schemaVersion, 3)

  await db.doc('users/other_supervisor').set({ role: 'supervisor', active: true, name: 'Other Supervisor', authorizedLocations: ['OTC'] })
  await db.doc('usersByAuthUid/other_supervisor_uid').set({ userId: 'other_supervisor' })
  await assert.rejects(() => publishEocTemplateHandler({
    auth: { uid: 'other_supervisor_uid' },
    data: { ...request.data, operationId: 'publish_operation_2', templateId: first.templateId, expectedVersion: 1 }
  }), error => error?.code === 'permission-denied')
})

test('template assignment verifies published version and supervisor location scope', async () => {
  await db.doc('users/assignment_supervisor').set({ role: 'supervisor', active: true, name: 'Assignment Supervisor', authorizedLocations: ['OTC'] })
  await db.doc('usersByAuthUid/assignment_supervisor_uid').set({ userId: 'assignment_supervisor' })
  const published = await publishEocTemplateHandler({
    auth: { uid: 'assignment_supervisor_uid' },
    data: {
      operationId: 'publish_for_assignment',
      template: {
        name: 'Assignment Template',
        eocType: 'house',
        sections: [{ id: 'section', title: 'Section', questions: [{ trackingId: 'question', label: 'Question', questionType: 'pass_issue' }] }]
      }
    }
  })
  const assigned = await assignEocTemplateHandler({
    auth: { uid: 'assignment_supervisor_uid' },
    data: {
      operationId: 'assign_operation_1',
      locationId: 'test_house',
      shiftId: 'shift_1',
      eocType: 'house',
      templateId: published.templateId,
      templateVersionId: published.versionId
    }
  })
  assert.equal(assigned.assignmentId, 'asg_test_house_shift_1_house')
  await assert.rejects(() => assignEocTemplateHandler({
    auth: { uid: 'assignment_supervisor_uid' },
    data: {
      operationId: 'assign_operation_2',
      locationId: 'res',
      shiftId: 'res_shift_1_day',
      eocType: 'house',
      templateId: published.templateId,
      templateVersionId: published.versionId
    }
  }), error => error?.code === 'permission-denied')
})

test('saved section versions are owner-scoped and reusable snapshots', async () => {
  await db.doc('users/section_supervisor').set({ role: 'supervisor', active: true, name: 'Section Supervisor', authorizedLocations: ['OTC'] })
  await db.doc('usersByAuthUid/section_supervisor_uid').set({ userId: 'section_supervisor' })
  const result = await saveEocSectionHandler({
    auth: { uid: 'section_supervisor_uid' },
    data: {
      operationId: 'section_operation_1',
      eocType: 'house',
      section: {
        id: 'kitchen',
        title: 'Kitchen',
        questions: [{ trackingId: 'sink', label: 'Does the sink drain?', questionType: 'pass_issue' }]
      }
    }
  })
  assert.equal(result.questionCount, 1)
  assert.equal((await db.doc(`eocSectionVersions/${result.versionId}`).get()).exists, true)
})

test('admin archive review reassigns defaults and resolves the supervisor request', async () => {
  await db.doc('users/archive_supervisor').set({ role: 'supervisor', active: true, name: 'Archive Supervisor', authorizedLocations: ['OTC'] })
  await db.doc('usersByAuthUid/archive_supervisor_uid').set({ userId: 'archive_supervisor' })
  await db.doc('users/archive_admin').set({ role: 'admin', active: true, name: 'Archive Admin', authorizedLocations: [] })
  await db.doc('usersByAuthUid/archive_admin_uid').set({ userId: 'archive_admin' })
  const publish = async (operationId, name, trackingId) => publishEocTemplateHandler({
    auth: { uid: 'archive_supervisor_uid' },
    data: {
      operationId,
      template: {
        name,
        eocType: 'house',
        sections: [{ id: `${trackingId}_section`, title: 'Safety', questions: [{ trackingId, label: 'Safety check', questionType: 'pass_issue' }] }]
      }
    }
  })
  const original = await publish('archive_publish_original', 'Original Template', 'original_check')
  const replacement = await publish('archive_publish_replacement', 'Replacement Template', 'replacement_check')
  await assignEocTemplateHandler({
    auth: { uid: 'archive_supervisor_uid' },
    data: { operationId: 'archive_assign', locationId: 'test_house', shiftId: 'shift_1', eocType: 'house', templateId: original.templateId, templateVersionId: original.versionId }
  })
  const archiveRequest = await requestEocTemplateArchiveHandler({
    auth: { uid: 'archive_supervisor_uid' },
    data: { templateId: original.templateId, reason: 'Replace the old safety checklist.' }
  })
  const result = await archiveEocTemplateHandler({
    auth: { uid: 'archive_admin_uid' },
    data: {
      operationId: 'archive_approve',
      templateId: original.templateId,
      replacementTemplateId: replacement.templateId,
      archiveRequestId: archiveRequest.requestId,
      reason: 'Approved after assignment review.'
    }
  })
  assert.equal(result.reassignedScopeCount, 1)
  assert.equal((await db.doc(`eocTemplateLibrary/${original.templateId}`).get()).data().status, 'archived')
  assert.equal((await db.doc('eocTemplateAssignments/asg_test_house_shift_1_house').get()).data().defaultTemplateId, replacement.templateId)
  assert.equal((await db.doc(`eocTemplateArchiveRequests/${archiveRequest.requestId}`).get()).data().status, 'approved')
})

test('permanent template deletion requires an archived unused template and the current admin PIN', async () => {
  await db.doc('users/purge_supervisor').set({ role: 'supervisor', active: true, name: 'Purge Supervisor', authorizedLocations: ['OTC'] })
  await db.doc('usersByAuthUid/purge_supervisor_uid').set({ userId: 'purge_supervisor' })
  const purgeAdminAuth = await seedSecureAdmin('purge_admin', 'purge_admin_uid', '614295')
  const published = await publishEocTemplateHandler({
    auth: { uid: 'purge_supervisor_uid' },
    data: { operationId: 'purge_publish', template: { name: 'Unused Template', eocType: 'house', sections: [{ id: 'unused_section', title: 'Unused', questions: [{ trackingId: 'unused_question', label: 'Unused check', questionType: 'pass_issue' }] }] } }
  })
  await archiveEocTemplateHandler({
    auth: { uid: 'purge_admin_uid' },
    data: { operationId: 'purge_archive', templateId: published.templateId, reason: 'Unused test template.' }
  })
  const impact = await previewEocTemplatePurgeHandler({ auth: { uid: 'purge_admin_uid' }, data: { templateId: published.templateId } })
  assert.equal(impact.purgeAllowed, true)
  await assert.rejects(() => purgeEocTemplateHandler({
    auth: purgeAdminAuth,
    data: { operationId: 'purge_wrong_pin', templateId: published.templateId, adminProfileId: 'purge_admin', currentPin: '000000', reason: 'Remove unused test template.' }
  }), error => error?.code === 'permission-denied')
  const result = await purgeEocTemplateHandler({
    auth: purgeAdminAuth,
    data: { operationId: 'purge_success', templateId: published.templateId, adminProfileId: 'purge_admin', currentPin: '614295', reason: 'Remove unused test template.' }
  })
  assert.equal(result.purged, true)
  assert.equal((await db.doc(`eocTemplateLibrary/${published.templateId}`).get()).exists, false)
  assert.equal((await db.doc(`eocTemplateVersions/${published.versionId}`).get()).exists, false)
})

test.after(() => {
  assert.ok(getApps().length > 0)
})
