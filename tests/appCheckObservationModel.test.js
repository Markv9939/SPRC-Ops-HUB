import assert from 'node:assert/strict'
import test from 'node:test'
import {
  APP_CHECK_OBSERVATION_GROUPS,
  appCheckWorkflowGroup,
  summarizeAppCheckObservation
} from '../scripts/appCheckObservationModel.js'

function completeEvidence(appCheckPresent = true) {
  return {
    login: [{ appCheckPresent, profileId: 'must_not_leak' }],
    accountAccess: [{ appCheckPresent, targetProfileId: 'must_not_leak' }],
    offlineReplay: [{ appCheckPresent, actorProfileId: 'must_not_leak' }],
    workflow: [
      { action: 'protected_transport_created', appCheckPresent, transportId: 'must_not_leak' },
      { action: 'protected_eoc_submitted', appCheckPresent, taskId: 'must_not_leak' },
      { action: 'protected_issue_reported', appCheckPresent, issueId: 'must_not_leak' }
    ]
  }
}

test('App Check observation categorizes only protected callable workflow evidence', () => {
  assert.equal(appCheckWorkflowGroup('protected_transport_created'), 'transport')
  assert.equal(appCheckWorkflowGroup('protected_eoc_submitted'), 'eoc')
  assert.equal(appCheckWorkflowGroup('protected_issue_resolution_submitted'), 'issues')
  assert.equal(appCheckWorkflowGroup('security_canary_stage_advanced'), '')
})

test('complete monitoring-only evidence is ready whether tokens are present or absent', () => {
  for (const appCheckPresent of [true, false]) {
    const summary = summarizeAppCheckObservation(completeEvidence(appCheckPresent))
    assert.equal(summary.ready, true)
    assert.equal(summary.monitoringOnly, true)
    assert.deepEqual(summary.missingGroups, [])
    assert.deepEqual(Object.keys(summary.groups), [...APP_CHECK_OBSERVATION_GROUPS])
    assert.equal(summary.totals.validSamples, 6)
    assert.equal(summary.totals[appCheckPresent ? 'present' : 'missing'], 6)
    assert.equal(JSON.stringify(summary).includes('must_not_leak'), false)
  }
})

test('enforcement, missing endpoint evidence, and malformed fields fail readiness', () => {
  assert.equal(summarizeAppCheckObservation({ ...completeEvidence(), enforcementEnabled: true }).ready, false)

  const missingIssue = completeEvidence()
  missingIssue.workflow = missingIssue.workflow.filter(record => !record.action.includes('issue'))
  assert.deepEqual(summarizeAppCheckObservation(missingIssue).missingGroups, ['issues'])

  const malformed = completeEvidence()
  malformed.login = [{ appCheckPresent: 'true' }]
  const summary = summarizeAppCheckObservation(malformed)
  assert.equal(summary.ready, false)
  assert.equal(summary.groups.login.malformed, 1)
  assert.equal(summary.groups.login.validSamples, 0)
})
