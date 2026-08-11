/* global process */
import assert from 'node:assert/strict'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const PROJECT_ID = 'sprc-ops-hub-phase3-e2e'
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'

initializeApp({ projectId: PROJECT_ID })
const db = getFirestore()

async function findSingleIssue(field, value) {
  const snapshot = await db.collection('eocIssues').where(field, '==', value).get()
  assert.equal(snapshot.size, 1, `Expected one issue where ${field} equals ${value}.`)
  return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() }
}

async function eventTypes(issueId) {
  const snapshot = await db.collection('eocIssues').doc(issueId).collection('activity').get()
  return snapshot.docs.map(doc => doc.data().eventType)
}

const safetyIssue = await findSingleIssue(
  'description',
  'Loose handrail at the front steps moves when weight is applied.'
)
assert.equal(safetyIssue.source, 'quick_report')
assert.equal(safetyIssue.issueType, 'safety_concern')
assert.equal(safetyIssue.status, 'open')
assert.equal('severity' in safetyIssue, false)
assert.equal('priority' in safetyIssue, false)
assert.deepEqual(
  new Set(await eventTypes(safetyIssue.id)),
  new Set(['reported', 'note_added', 'in_progress', 'resolved', 'reopened'])
)

const eocIssue = await findSingleIssue(
  'description',
  'Moisture and a slow drip are visible under the kitchen sink cabinet.'
)
assert.equal(eocIssue.source, 'eoc_checklist')
assert.equal(eocIssue.issueType, 'house_property')
assert.equal(eocIssue.templateId, 'phase3_house_template')
assert.equal(eocIssue.templateVersionId, 'phase3_house_template__v1')
assert.ok(eocIssue.taskId)
assert.ok(eocIssue.submissionId)
assert.deepEqual(await eventTypes(eocIssue.id), ['reported'])

const privacyIssue = await findSingleIssue(
  'description',
  'Privacy boundary test issue for Test House only.'
)
assert.equal(privacyIssue.locationId, 'test_house')
assert.equal(privacyIssue.source, 'quick_report')
assert.equal(privacyIssue.issueType, 'other')
assert.equal(privacyIssue.status, 'voided')
assert.deepEqual(
  new Set(await eventTypes(privacyIssue.id)),
  new Set(['reported', 'voided'])
)

const returnedIssueSnap = await db.doc('eocIssues/phase3_resolved_issue').get()
const returnedIssue = returnedIssueSnap.data()
assert.equal(returnedIssue.status, 'open')
assert.equal(returnedIssue.latestActivity.eventType, 'reopened')
assert.deepEqual(
  new Set(await eventTypes('phase3_resolved_issue')),
  new Set(['reported', 'resolved', 'problem_returned', 'reopened'])
)

const completedTaskSnap = await db.doc('eocTasks/task_test_house_shift_1_house_2026-08-09').get()
assert.equal(completedTaskSnap.data()?.status, 'completed')
assert.ok(completedTaskSnap.data()?.submissionId)

const alertsSnap = await db.collection('alerts').get()
const alerts = alertsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
const issueAlerts = alerts.filter(alert => alert.issueId)
assert.ok(issueAlerts.length >= 12, 'Expected issue alerts for supervisors and same-house BHTs.')
assert.ok(issueAlerts.some(alert => (
  alert.issueId === safetyIssue.id
  && alert.eventType === 'reported'
  && alert.audience === 'supervisor'
)))
assert.ok(issueAlerts.some(alert => (
  alert.issueId === safetyIssue.id
  && alert.eventType === 'reported'
  && alert.targetUserId === 'phase3_same_house_bht'
)))
assert.ok(issueAlerts.some(alert => (
  alert.issueId === safetyIssue.id
  && alert.eventType === 'resolved'
  && alert.targetUserId === 'phase3_bht'
)))
assert.ok(issueAlerts.some(alert => (
  alert.issueId === 'phase3_resolved_issue'
  && alert.eventType === 'problem_returned'
  && alert.audience === 'supervisor'
)))
assert.ok(issueAlerts.some(alert => (
  alert.issueId === eocIssue.id
  && alert.eventType === 'reported'
  && alert.targetUserId === 'phase3_same_house_bht'
)))
assert.ok(issueAlerts.some(alert => (
  alert.issueId === privacyIssue.id
  && alert.eventType === 'reported'
  && alert.targetUserId === 'phase3_same_house_bht'
)))
assert.equal(issueAlerts.some(alert => (
  alert.issueId === privacyIssue.id
  && alert.targetUserId === 'phase3_other_house_bht'
)), false)
assert.equal(issueAlerts.some(alert => 'severity' in alert || 'priority' in alert), false)
assert.equal(issueAlerts.some(alert => alert.targetUserId === 'phase3_other_house_bht'), false)

console.log(JSON.stringify({
  safetyIssueId: safetyIssue.id,
  eocIssueId: eocIssue.id,
  privacyIssueId: privacyIssue.id,
  issueAlerts: issueAlerts.length,
  checks: 'passed'
}))
