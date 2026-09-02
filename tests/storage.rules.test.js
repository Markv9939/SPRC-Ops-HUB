import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'

const projectId = 'demo-sprc-storage-rules'
const bucketUrl = `gs://${projectId}.appspot.com`
const env = await initializeTestEnvironment({
  projectId,
  firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  storage: { rules: readFileSync('storage.rules', 'utf8') }
})

test.after(async () => env.cleanup())

async function seed(path, data) {
  await env.withSecurityRulesDisabled(async context => setDoc(doc(context.firestore(), path), data))
}

function storageFor(uid = '', claims = {}) {
  return (uid ? env.authenticatedContext(uid, claims) : env.unauthenticatedContext()).storage(bucketUrl)
}

function metadata(locationId = 'test_house', issueId = 'issue_1', attachmentId = 'photo_1', contentType = 'image/jpeg') {
  return { contentType, customMetadata: { locationId, issueId, attachmentId, kind: 'report' } }
}

function responseMetadata(locationId = 'test_house', submissionId = 'submission_1', attachmentId = 'photo_1', contentType = 'image/jpeg') {
  return { contentType, customMetadata: { locationId, submissionId, attachmentId, itemId: 'question_photo', kind: 'response' } }
}

async function secureStorageFor({ uid, profileId, sessionId, role, workflows, locationIds = ['test_house'], securityVersion = 1 }) {
  await seed(`users/${profileId}`, {
    role,
    active: true,
    deleted: false,
    securityVersion,
    issueLocationIds: locationIds
  })
  await seed(`usersByAuthUid/${uid}`, { userId: profileId })
  await seed(`staffSessions/${sessionId}`, {
    active: true,
    authUid: uid,
    profileId,
    securityVersion,
    expiresAt: new Date(Date.now() + 60_000)
  })
  return storageFor(uid, {
    profileId,
    sessionId,
    sessionVersion: 2,
    securityVersion,
    workflowSecurityVersion: 6,
    secureWorkflows: workflows
  })
}

test('secure rules require a current session and validate JPEG path metadata size', async () => {
  const path = 'issueAttachments/test_house/issue_1/photo_1.jpg'
  await assertFails(storageFor().ref(path).put(new Uint8Array([1, 2, 3]), metadata()))
  await assertFails(storageFor('unmapped_uid').ref(path).put(new Uint8Array([1, 2, 3]), metadata()))
  const secure = await secureStorageFor({
    uid: 'validation_uid',
    profileId: 'validation_bht',
    sessionId: 'validation_session',
    role: 'bht',
    workflows: ['issues_feedback_audit']
  })
  await assertSucceeds(secure.ref(path).put(new Uint8Array([1, 2, 3]), metadata()))
  await assertFails(secure.ref('issueAttachments/test_house/issue_1/photo_2.jpg').put(new Uint8Array([1]), metadata('test_house', 'issue_1', 'wrong_id')))
  await assertFails(secure.ref('issueAttachments/test_house/issue_1/photo_3.jpg').put(new Uint8Array([1]), metadata('test_house', 'issue_1', 'photo_3', 'text/plain')))
  await assertFails(secure.ref('issueAttachments/test_house/issue_1/large.jpg').put(new Uint8Array(2 * 1024 * 1024 + 1), metadata('test_house', 'issue_1', 'large')))
  await assertFails(secure.ref('issueAttachments/test_house').listAll())
  await assertFails(secure.ref(path).delete())
})

test('strict rules enforce location and hide management-only photos from BHT', async () => {
  const bhtStorage = await secureStorageFor({
    uid: 'strict_bht_uid', profileId: 'strict_bht', sessionId: 'strict_bht_session',
    role: 'bht', workflows: ['issues_feedback_audit']
  })
  const supervisorStorage = await secureStorageFor({
    uid: 'strict_supervisor_uid', profileId: 'strict_supervisor', sessionId: 'strict_supervisor_session',
    role: 'supervisor', workflows: ['issues_feedback_audit']
  })
  await seed('eocIssues/strict_issue', { locationId: 'test_house', status: 'open' })
  await seed('eocIssues/strict_issue/attachments/strict_photo', { hiddenFromBht: true, locationId: 'test_house' })

  await env.withSecurityRulesDisabled(async context => {
    const adminStorage = context.storage(bucketUrl)
    await adminStorage.ref('issueAttachments/test_house/strict_issue/strict_photo.jpg').put(new Uint8Array([1, 2, 3]), metadata('test_house', 'strict_issue', 'strict_photo'))
  })

  await assertFails(bhtStorage.ref('issueAttachments/test_house/strict_issue/strict_photo.jpg').getMetadata())
  const supervisorMetadata = await assertSucceeds(supervisorStorage.ref('issueAttachments/test_house/strict_issue/strict_photo.jpg').getMetadata())
  assert.equal(supervisorMetadata.contentType, 'image/jpeg')
  await assertFails(bhtStorage.ref('issueAttachments/mesquite/strict_issue/strict_photo.jpg').getMetadata())
})

test('photo question files are private and restricted to the submission location', async () => {
  const responseStorage = await secureStorageFor({
    uid: 'response_bht_uid', profileId: 'response_bht', sessionId: 'response_bht_session',
    role: 'bht', workflows: ['templates_photos']
  })
  const allowedPath = 'eocSubmissionAttachments/test_house/submission_1/photo_1.jpg'
  const wrongLocationPath = 'eocSubmissionAttachments/mesquite/submission_1/photo_1.jpg'

  await assertFails(storageFor().ref(allowedPath).put(new Uint8Array([1]), responseMetadata()))
  await assertSucceeds(responseStorage.ref(allowedPath).put(new Uint8Array([1, 2, 3]), responseMetadata()))
  await assertFails(responseStorage.ref(wrongLocationPath).put(new Uint8Array([1]), responseMetadata('mesquite')))
  await assertFails(responseStorage.ref(allowedPath).delete())
})

test('workflow claims require a current matching device session for photos', async () => {
  await seed('users/workflow_bht', {
    role: 'bht', active: true, deleted: false, securityVersion: 4,
    issueLocationIds: ['test_house']
  })
  await seed('usersByAuthUid/workflow_uid', { userId: 'workflow_bht' })
  await seed('staffSessions/workflow_session', {
    active: true,
    authUid: 'workflow_uid',
    profileId: 'workflow_bht',
    securityVersion: 4,
    expiresAt: new Date(Date.now() + 60_000)
  })
  const claims = {
    profileId: 'workflow_bht',
    sessionId: 'workflow_session',
    sessionVersion: 2,
    securityVersion: 4,
    workflowSecurityVersion: 6,
    secureWorkflows: ['templates_photos', 'issues_feedback_audit']
  }
  const path = 'eocSubmissionAttachments/test_house/submission_1/workflow_photo.jpg'
  await assertSucceeds(storageFor('workflow_uid', claims).ref(path).put(
    new Uint8Array([1, 2, 3]),
    responseMetadata('test_house', 'submission_1', 'workflow_photo')
  ))
  await seed('staffSessions/workflow_session', {
    active: false,
    authUid: 'workflow_uid',
    profileId: 'workflow_bht',
    securityVersion: 4,
    expiresAt: new Date(Date.now() + 60_000)
  })
  await assertFails(storageFor('workflow_uid', claims).ref(path).getMetadata())
})
