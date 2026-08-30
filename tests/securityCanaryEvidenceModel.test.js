import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeIdentityCanaryEvidence } from '../scripts/securityCanaryEvidenceModel.js'

const ids = ['test_supervisor', 'test_bht_shift_1', 'test_bht_shift_2']
const foundationConfig = {
  schemaVersion: 2,
  serverPinLoginEnabled: true,
  clientBootstrapVersion: 3,
  clientBootstrapEnabled: true,
  protectedAccountActionsVersion: 4,
  protectedAccountActionsEnabled: true,
  offlineReplayEnabled: false,
  rolloutState: 'production_canary',
  enabledProfileIds: ids
}
const workflowConfig = {
  schemaVersion: 6,
  enabled: true,
  rolloutState: 'production_canary',
  enabledProfileIds: ids,
  workflows: ['identity_users']
}

test('identity status summarizes the exact protected cohort without exposing record contents', () => {
  const summary = summarizeIdentityCanaryEvidence({
    expectedProfileIds: ids,
    foundationConfig,
    workflowConfig,
    profiles: ids.map((profileId, index) => ({
      profileId, role: index ? 'bht' : 'supervisor', valid: true, securityVersion: index + 1,
      name: 'must_not_leak', pinHash: 'must_not_leak'
    })),
    mappings: ids.map(profileId => ({ profileId, exists: true, authUid: 'must_not_leak' })),
    sessions: [
      { profileId: ids[0], active: true, sessionId: 'must_not_leak' },
      { profileId: ids[0], active: false, sessionId: 'must_not_leak' },
      { profileId: ids[1], active: true, sessionId: 'must_not_leak' }
    ],
    rollbackAnchorVerified: true,
    rollbackAnchorMatchesCurrent: true
  })
  assert.equal(summary.readyForRemainingLiveJourneys, true)
  assert.deepEqual(summary.sessionCounts, { total: 3, active: 2, inactive: 1 })
  assert.deepEqual(summary.missingMappings, [])
  assert.equal(JSON.stringify(summary).includes('must_not_leak'), false)
})

test('wrong cohort, workflow expansion, invalid profiles, or a stale rollback anchor fail readiness', () => {
  const summary = summarizeIdentityCanaryEvidence({
    expectedProfileIds: ids,
    foundationConfig: { ...foundationConfig, enabledProfileIds: [...ids, 'unexpected'] },
    workflowConfig: { ...workflowConfig, workflows: ['identity_users', 'templates_photos'] },
    profiles: ids.map(profileId => ({ profileId, role: 'bht', valid: profileId !== ids[2], securityVersion: 1 })),
    mappings: [{ profileId: ids[0], exists: true }],
    sessions: [],
    rollbackAnchorVerified: true,
    rollbackAnchorMatchesCurrent: false
  })
  assert.equal(summary.readyForRemainingLiveJourneys, false)
  assert.equal(summary.exactCohort, false)
  assert.equal(summary.identityUsersOnly, false)
  assert.deepEqual(summary.missingProfiles, [ids[2]])
  assert.deepEqual(summary.missingMappings, [ids[1], ids[2]])
})
