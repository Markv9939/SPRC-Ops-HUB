import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SECURITY_CANARY_STAGES,
  configuredCanaryStage,
  evaluateOperationsAdminDataReadiness,
  planCanaryStageAdvance,
  validateCanaryStageBackup,
  workflowsThroughStage
} from '../scripts/securityCanaryStageModel.js'

const releaseId = 'security-foundation-test-house-v1'

function configs(stage = 'identity_users') {
  return {
    foundationConfig: {
      rolloutState: 'production_canary',
      releaseId,
      offlineReplayEnabled: false
    },
    workflowConfig: {
      schemaVersion: 6,
      enabled: true,
      workflows: workflowsThroughStage(stage),
      rolloutState: 'production_canary',
      releaseId
    }
  }
}

test('security canary stages use the approved cumulative workflow order', () => {
  assert.deepEqual(SECURITY_CANARY_STAGES, [
    'identity_users',
    'templates_photos',
    'eoc',
    'debriefs_alerts',
    'issues_feedback_audit',
    'transports',
    'operations_admin',
    'settings'
  ])
  assert.deepEqual(workflowsThroughStage('eoc'), ['identity_users', 'templates_photos', 'eoc'])
})

test('stage planning advances exactly one workflow and ends old claim sessions', () => {
  const plan = planCanaryStageAdvance({ ...configs(), targetStage: 'templates_photos', releaseId })
  assert.equal(plan.currentStage, 'identity_users')
  assert.deepEqual(plan.targetWorkflows, ['identity_users', 'templates_photos'])
  assert.deepEqual(plan.protectedEndpointsToOpen, [])
  assert.deepEqual(plan.foundationUpdates, {})
  assert.equal(plan.endsCanarySessions, true)
  assert.equal(plan.requiresRefreshTokenRevocation, true)
})

test('EOC stage turns on owner-bound offline replay only after templates/photos', () => {
  const plan = planCanaryStageAdvance({ ...configs('templates_photos'), targetStage: 'eoc', releaseId })
  assert.deepEqual(plan.targetWorkflows, ['identity_users', 'templates_photos', 'eoc'])
  assert.deepEqual(plan.protectedEndpointsToOpen, ['authorizeOfflineReplayV5', 'submitProtectedEocV9'])
  assert.deepEqual(plan.foundationUpdates, { offlineReplayEnabled: true })
})

test('later stage previews name only the protected endpoints needed by that workflow', () => {
  assert.deepEqual(planCanaryStageAdvance({
    ...configs('debriefs_alerts'), targetStage: 'issues_feedback_audit', releaseId
  }).protectedEndpointsToOpen, ['mutateProtectedIssueV9'])
  assert.deepEqual(planCanaryStageAdvance({
    ...configs('issues_feedback_audit'), targetStage: 'transports', releaseId
  }).protectedEndpointsToOpen, ['createProtectedTransportV6'])
  assert.deepEqual(planCanaryStageAdvance({
    ...configs('transports'), targetStage: 'operations_admin', releaseId
  }).protectedEndpointsToOpen, [])
})

test('stage planning rejects skipped, repeated, malformed, or wrong-release transitions', () => {
  assert.throws(
    () => planCanaryStageAdvance({ ...configs(), targetStage: 'eoc', releaseId }),
    /requires the current stage to be templates_photos/
  )
  assert.throws(
    () => planCanaryStageAdvance({ ...configs(), targetStage: 'identity_users', releaseId }),
    /not an advance target/
  )
  const malformed = configs()
  malformed.workflowConfig.workflows = ['templates_photos', 'identity_users']
  assert.equal(configuredCanaryStage(malformed.workflowConfig), 'invalid')
  assert.throws(
    () => planCanaryStageAdvance({ ...malformed, targetStage: 'templates_photos', releaseId }),
    /found invalid/
  )
  assert.throws(
    () => planCanaryStageAdvance({ ...configs(), targetStage: 'templates_photos', releaseId: 'wrong' }),
    /do not match the active canary release/
  )
})

test('stage rollback backup must match the exact project, release, and target stage', () => {
  const saved = configs()
  const backup = {
    projectId: 'sprc-tx-l',
    releaseId,
    previousStage: 'identity_users',
    targetStage: 'templates_photos',
    config: {
      'appSettings/securityFoundation': { exists: true, data: saved.foundationConfig },
      'appSettings/securityWorkflows': { exists: true, data: saved.workflowConfig }
    }
  }
  assert.equal(validateCanaryStageBackup(backup, {
    projectId: 'sprc-tx-l', releaseId, targetStage: 'templates_photos'
  }), true)
  assert.throws(
    () => validateCanaryStageBackup(backup, {
      projectId: 'sprc-tx-l', releaseId, targetStage: 'eoc'
    }),
    /does not match/
  )
  backup.config['appSettings/securityWorkflows'].data.workflows = ['identity_users', 'templates_photos']
  assert.throws(
    () => validateCanaryStageBackup(backup, {
      projectId: 'sprc-tx-l', releaseId, targetStage: 'templates_photos'
    }),
    /does not contain the exact recorded previous canary stage/
  )
})

test('operations administration readiness accepts only exact current location metadata', () => {
  const readiness = evaluateOperationsAdminDataReadiness({
    eocProperties: [{ data: { mainLocation: 'OTC' } }],
    eocVehicles: [{ data: { mainLocation: 'RES' } }],
    fleetMaintenanceTemplates: [{ data: { mainLocation: 'OTC' } }],
    fleetVehicleRuntime: [{ data: { mainLocation: 'OTC' } }],
    fleetTasks: [{ data: { mainLocation: 'RES' } }],
    vehicleServiceRecords: [{ data: { mainLocation: 'OTC' } }],
    complianceEmployees: [{ data: { site: 'RES' } }],
    complianceItems: [
      { data: { targetType: 'employee', employeeSite: 'OTC' } },
      { data: { targetType: 'location', mainLocation: 'RES' } }
    ],
    cintasServices: [{ data: { mainLocation: 'OTC' } }]
  })
  assert.equal(readiness.ready, true)
  assert.equal(readiness.scannedCount, 10)
  assert.equal(readiness.invalidCount, 0)
})

test('operations administration readiness blocks legacy or ambiguous records without exposing their contents', () => {
  const readiness = evaluateOperationsAdminDataReadiness({
    eocProperties: [{ id: 'missing_location', data: { locationId: 'test_house' } }],
    complianceEmployees: [{ id: 'invalid_site', data: { site: 'PHP' } }],
    complianceItems: [
      { id: 'legacy_employee', data: { employeeSite: 'OTC' } },
      { id: 'wrong_location', data: { targetType: 'location', mainLocation: 'MESQUITE' } }
    ]
  })
  assert.equal(readiness.ready, false)
  assert.equal(readiness.invalidCount, 4)
  assert.deepEqual(Object.keys(readiness.collections[0]).sort(), ['collection', 'invalidCount', 'scannedCount'])
  assert.equal(JSON.stringify(readiness).includes('missing_location'), false)
  assert.equal(JSON.stringify(readiness).includes('legacy_employee'), false)
})
