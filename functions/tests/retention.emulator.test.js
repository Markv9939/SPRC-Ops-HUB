import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import process from 'node:process'
import test from 'node:test'
import { getApps } from 'firebase-admin/app'
import { Timestamp, getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

process.env.GCLOUD_PROJECT ||= 'demo-sprc-functions'
const { emergencyPrivacyRemoveHandler, runPhotoRetentionCleanup } = await import('../src/index.js')
const db = getFirestore()
const bucket = getStorage().bucket()
const pinHash = pin => crypto.createHash('sha256').update(`sprc-pin-v2-6digit:${pin}`).digest('hex')

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
  await db.doc('users/admin_test').set({ role: 'admin', active: true, name: 'Admin Test', pinHash: pinHash('385104') })
  await db.doc('eocIssues/privacy_issue').set({ status: 'open', locationId: 'test_house' })
  await db.doc('eocIssues/privacy_issue/attachments/private').set({ state: 'uploaded', storagePath: 'issueAttachments/test_house/privacy_issue/private.jpg', version: 1 })
  await bucket.file('issueAttachments/test_house/privacy_issue/private.jpg').save(Buffer.from([1, 2, 3]), { contentType: 'image/jpeg' })
  await assert.rejects(() => emergencyPrivacyRemoveHandler({ auth: { uid: 'anon' }, data: { adminProfileId: 'admin_test', pin: '000000', issueId: 'privacy_issue', attachmentId: 'private', reason: 'Contains identifying information.' } }), /Admin PIN/)
  const result = await emergencyPrivacyRemoveHandler({ auth: { uid: 'anon' }, data: { adminProfileId: 'admin_test', pin: '385104', issueId: 'privacy_issue', attachmentId: 'private', reason: 'Contains identifying information.' } })
  assert.equal(result.removed, true)
  assert.equal((await db.doc('eocIssues/privacy_issue/attachments/private').get()).data().state, 'privacy_removed')
  assert.equal((await db.collection('auditLogs').where('action', '==', 'attachment_privacy_removed').get()).size, 1)
  const repeated = await emergencyPrivacyRemoveHandler({ auth: { uid: 'anon' }, data: { adminProfileId: 'admin_test', pin: '385104', issueId: 'privacy_issue', attachmentId: 'private', reason: 'Contains identifying information.' } })
  assert.equal(repeated.alreadyRemoved, true)
  assert.equal((await db.collection('auditLogs').where('action', '==', 'attachment_privacy_removed').get()).size, 1)
})

test('emergency privacy removal locks repeated invalid PIN attempts', async () => {
  await db.doc('users/admin_lock_test').set({ role: 'admin', active: true, name: 'Locked Admin', pinHash: pinHash('492815') })
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await assert.rejects(() => emergencyPrivacyRemoveHandler({ auth: { uid: 'anon' }, data: { adminProfileId: 'admin_lock_test', pin: '000000', issueId: 'missing', attachmentId: 'missing', reason: 'Synthetic invalid attempt.' } }), error => error?.code === 'permission-denied')
  }
  await assert.rejects(() => emergencyPrivacyRemoveHandler({ auth: { uid: 'anon' }, data: { adminProfileId: 'admin_lock_test', pin: '000000', issueId: 'missing', attachmentId: 'missing', reason: 'Synthetic invalid attempt.' } }), error => error?.code === 'resource-exhausted')
  await assert.rejects(() => emergencyPrivacyRemoveHandler({ auth: { uid: 'anon' }, data: { adminProfileId: 'admin_lock_test', pin: '492815', issueId: 'missing', attachmentId: 'missing', reason: 'Synthetic locked attempt.' } }), error => error?.code === 'resource-exhausted')
})

test.after(() => {
  assert.ok(getApps().length > 0)
})
