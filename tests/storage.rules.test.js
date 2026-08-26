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

test('compatibility rules require auth and validate JPEG path metadata size', async () => {
  await seed('appSettings/authPolicy', { authScopeEnforced: false })
  const path = 'issueAttachments/test_house/issue_1/photo_1.jpg'
  await assertFails(storageFor().ref(path).put(new Uint8Array([1, 2, 3]), metadata()))
  const authed = storageFor('anonymous_1')
  await assertSucceeds(authed.ref(path).put(new Uint8Array([1, 2, 3]), metadata()))
  await assertFails(authed.ref('issueAttachments/test_house/issue_1/photo_2.jpg').put(new Uint8Array([1]), metadata('test_house', 'issue_1', 'wrong_id')))
  await assertFails(authed.ref('issueAttachments/test_house/issue_1/photo_3.jpg').put(new Uint8Array([1]), metadata('test_house', 'issue_1', 'photo_3', 'text/plain')))
  await assertFails(authed.ref('issueAttachments/test_house/issue_1/large.jpg').put(new Uint8Array(2 * 1024 * 1024 + 1), metadata('test_house', 'issue_1', 'large')))
  await assertFails(authed.ref('issueAttachments/test_house').listAll())
  await assertFails(authed.ref(path).delete())
})

test('strict rules enforce location and hide management-only photos from BHT', async () => {
  await seed('appSettings/authPolicy', { authScopeEnforced: true })
  await seed('users/strict_bht', { role: 'bht', active: true, issueLocationIds: ['test_house'] })
  await seed('usersByAuthUid/strict_bht_uid', { userId: 'strict_bht' })
  await seed('users/strict_supervisor', { role: 'supervisor', active: true, issueLocationIds: ['test_house'] })
  await seed('usersByAuthUid/strict_supervisor_uid', { userId: 'strict_supervisor' })
  await seed('eocIssues/strict_issue', { locationId: 'test_house', status: 'open' })
  await seed('eocIssues/strict_issue/attachments/strict_photo', { hiddenFromBht: true, locationId: 'test_house' })

  await env.withSecurityRulesDisabled(async context => {
    const adminStorage = context.storage(bucketUrl)
    await adminStorage.ref('issueAttachments/test_house/strict_issue/strict_photo.jpg').put(new Uint8Array([1, 2, 3]), metadata('test_house', 'strict_issue', 'strict_photo'))
  })

  await assertFails(storageFor('strict_bht_uid').ref('issueAttachments/test_house/strict_issue/strict_photo.jpg').getMetadata())
  const supervisorMetadata = await assertSucceeds(storageFor('strict_supervisor_uid').ref('issueAttachments/test_house/strict_issue/strict_photo.jpg').getMetadata())
  assert.equal(supervisorMetadata.contentType, 'image/jpeg')
  await assertFails(storageFor('strict_bht_uid').ref('issueAttachments/mesquite/strict_issue/strict_photo.jpg').getMetadata())
})

test('photo question files are private and restricted to the submission location', async () => {
  await seed('appSettings/authPolicy', { authScopeEnforced: true })
  await seed('users/response_bht', { role: 'bht', active: true, issueLocationIds: ['test_house'] })
  await seed('usersByAuthUid/response_bht_uid', { userId: 'response_bht' })
  const allowedPath = 'eocSubmissionAttachments/test_house/submission_1/photo_1.jpg'
  const wrongLocationPath = 'eocSubmissionAttachments/mesquite/submission_1/photo_1.jpg'

  await assertFails(storageFor().ref(allowedPath).put(new Uint8Array([1]), responseMetadata()))
  await assertSucceeds(storageFor('response_bht_uid').ref(allowedPath).put(new Uint8Array([1, 2, 3]), responseMetadata()))
  await assertFails(storageFor('response_bht_uid').ref(wrongLocationPath).put(new Uint8Array([1]), responseMetadata('mesquite')))
  await assertFails(storageFor('response_bht_uid').ref(allowedPath).delete())
})

test('dormant workflow claims require a current matching device session for photos', async () => {
  await seed('appSettings/authPolicy', { authScopeEnforced: false })
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
