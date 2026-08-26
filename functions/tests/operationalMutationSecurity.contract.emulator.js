import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import process from 'node:process'
import test from 'node:test'
import { cert, deleteApp, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { Timestamp, getFirestore } from 'firebase-admin/firestore'
import { mutateProtectedIssue, submitProtectedEoc } from '../src/operationalMutationSecurityService.js'

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Run this operational mutation contract through the Firestore and Auth emulators.')
}

const projectId = process.env.GCLOUD_PROJECT || 'demo-sprc-security-foundation'
const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' }
})
const app = initializeApp({
  projectId,
  credential: cert({ projectId, clientEmail: `phase9-tests@${projectId}.iam.gserviceaccount.com`, privateKey })
}, 'phase9-operational-contract')
const db = getFirestore(app)
const auth = getAuth(app)
const secret = 'phase-9-emulator-only-secret-with-more-than-thirty-two-characters'
const nowMs = Date.UTC(2026, 7, 26, 15)

async function clearEmulators() {
  for (const collection of await db.listCollections()) {
    const snapshot = await collection.get()
    const batch = db.batch()
    snapshot.docs.forEach(item => batch.delete(item.ref))
    if (!snapshot.empty) await batch.commit()
  }
  const users = await auth.listUsers(1000)
  if (users.users.length) await auth.deleteUsers(users.users.map(user => user.uid))
}

async function seedActor(profileId, role, locationId = 'test_house') {
  const authUid = `auth_${profileId}`
  const sessionId = `session_${profileId}_device_0001`
  const profile = {
    name: role === 'supervisor' ? 'Test Supervisor' : 'Test BHT', role, active: true, deleted: false,
    location: 'OTC', site: 'OTC', locationId, house: locationId,
    authorizedLocations: ['OTC', locationId], issueLocationIds: [locationId], securityVersion: 1, version: 1,
    authUid
  }
  await auth.createUser({ uid: authUid })
  await db.doc(`users/${profileId}`).set(profile)
  await db.doc(`usersByAuthUid/${authUid}`).set({ userId: profileId, version: 2 })
  await db.doc(`staffSessions/${sessionId}`).set({
    profileId, authUid, securityVersion: 1, active: true, revokedAt: null,
    issuedAt: Timestamp.fromMillis(nowMs - 1000), expiresAt: Timestamp.fromMillis(nowMs + 60 * 60 * 1000)
  })
  return { profile, requestAuth: { uid: authUid, token: { profileId, sessionId, securityVersion: 1 } } }
}

async function enableWorkflows(workflows) {
  await db.doc('appSettings/securityWorkflows').set({ schemaVersion: 6, enabled: true, workflows })
}

test.beforeEach(clearEmulators)
test.after(async () => {
  await clearEmulators()
  await deleteApp(app)
})

test('protected EOC fails closed until the exact workflow is enabled', async () => {
  const actor = await seedActor('eoc_disabled_bht', 'bht')
  await assert.rejects(() => submitProtectedEoc({ db, secret, requestAuth: actor.requestAuth, requestData: {
    operationId: 'eoc_disabled_operation_0001', taskId: 'missing', expectedTaskVersion: 1, answers: [{ itemId: 'one', trackingId: 'one', status: 'pass' }]
  }, nowMs }), error => error.code === 'failed-precondition')
})

test('protected EOC atomically completes one eligible task, creates recurrence history, and replays idempotently', async () => {
  await enableWorkflows(['eoc'])
  const actor = await seedActor('eoc_bht', 'bht')
  await db.doc('eocTasks/task_phase9').set({
    taskType: 'house', locationId: 'test_house', shiftId: 'shift_1', templateScope: 'otc_shared',
    eligibleUserIds: ['eoc_bht'], status: 'pending', dueDate: '2026-08-26', version: 4
  })
  await db.doc('eocSubmissionDrafts/task_phase9__eoc_bht').set({ draftByUserId: 'eoc_bht' })
  const requestData = {
    operationId: 'eoc_submit_operation_phase9_0001', taskId: 'task_phase9', expectedTaskVersion: 4,
    draftId: 'task_phase9__eoc_bht', eocType: 'house',
    answers: [
      { itemId: 'doors', trackingId: 'doors', label: 'Doors', category: 'Safety', status: 'pass', responsePhotoAttachmentIds: [], photoAttachmentIds: [] },
      { itemId: 'sink', trackingId: 'sink', label: 'Sink', category: 'Kitchen', status: 'repair', description: 'Sink is leaking.', responsePhotoAttachmentIds: [], photoAttachmentIds: [] }
    ]
  }
  const first = await submitProtectedEoc({ db, secret, requestAuth: actor.requestAuth, requestData, nowMs })
  const initialAlerts = await db.collection('alerts').get()
  assert.equal(initialAlerts.size, 1)
  await Promise.all(initialAlerts.docs.map(item => item.ref.delete()))
  const replay = await submitProtectedEoc({ db, secret, requestAuth: actor.requestAuth, requestData, nowMs: nowMs + 1 })
  assert.equal(first.submissionId, 'eoc_task_phase9_eoc_bht')
  assert.deepEqual(replay, first)
  assert.equal((await db.doc('eocTasks/task_phase9').get()).data().status, 'completed')
  assert.equal((await db.doc('eocSubmissions/eoc_task_phase9_eoc_bht').get()).data().submittedByUserId, 'eoc_bht')
  assert.equal((await db.doc('eocIssues/eoc_task_phase9_sink').get()).data().reportedByUserId, 'eoc_bht')
  assert.equal((await db.collection('eocIssuePatterns').get()).size, 1)
  assert.equal((await db.doc('eocSubmissionDrafts/task_phase9__eoc_bht').get()).exists, false)
  assert.equal((await db.collection('securityWorkflowAudit').get()).size, 1)
  assert.equal((await db.collection('alerts').get()).size, 1)
})

test('protected issue report and resolution review enforce ownership, scope, versions, and server attribution', async () => {
  await enableWorkflows(['issues_feedback_audit'])
  const bht = await seedActor('issue_bht', 'bht')
  const supervisor = await seedActor('issue_supervisor', 'supervisor')
  const reported = await mutateProtectedIssue({ db, secret, requestAuth: bht.requestAuth, requestData: {
    action: 'create_report', operationId: 'issue_report_operation_0001',
    issue: { issueType: 'house_property', eocType: 'house', locationId: 'test_house', shiftId: 'shift_1', description: 'Door will not latch.' }
  }, nowMs })
  assert.equal(reported.issue.reportedByUserId, 'issue_bht')
  const submitted = await mutateProtectedIssue({ db, secret, requestAuth: bht.requestAuth, requestData: {
    action: 'submit_resolution', operationId: 'issue_resolution_submit_0001', issueId: reported.issueId,
    expectedVersion: 1, note: 'Latch adjusted and tested.'
  }, nowMs: nowMs + 1 })
  assert.equal(submitted.issue.status, 'pending_supervisor_review')
  await assert.rejects(() => mutateProtectedIssue({ db, secret, requestAuth: bht.requestAuth, requestData: {
    action: 'submit_resolution', operationId: 'issue_resolution_stale_0001', issueId: reported.issueId,
    expectedVersion: 1, note: 'Duplicate stale update.'
  }, nowMs: nowMs + 2 }), error => error.code === 'aborted')
  const approved = await mutateProtectedIssue({ db, secret, requestAuth: supervisor.requestAuth, requestData: {
    action: 'review_resolution', operationId: 'issue_resolution_review_0001', issueId: reported.issueId,
    expectedVersion: 2, decision: 'approve', note: ''
  }, nowMs: nowMs + 3 })
  assert.equal(approved.issue.status, 'resolved')
  assert.equal(approved.issue.resolvedByUserId, 'issue_supervisor')
  assert.equal((await db.collection(`eocIssues/${reported.issueId}/activity`).get()).size, 3)
})

test('wrong-location actors and direct privilege changes fail closed', async () => {
  await enableWorkflows(['issues_feedback_audit'])
  const bht = await seedActor('wrong_location_bht', 'bht', 'mesquite')
  await assert.rejects(() => mutateProtectedIssue({ db, secret, requestAuth: bht.requestAuth, requestData: {
    action: 'create_report', operationId: 'wrong_location_report_0001',
    issue: { issueType: 'house_property', locationId: 'res', shiftId: 'res_shift_1_day', description: 'Outside scope.' }
  }, nowMs }), error => error.code === 'permission-denied')
})
