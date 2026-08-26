import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SECURITY_WORKFLOWS,
  activeSecureWorkflows,
  appCheckMonitoringReady,
  compatibilityRetirementReady,
  validateWorkflowRollout,
  workflowTokenClaims
} from '../src/workflowSecurityModel.js'

test('workflow rollout is exact, allow-listed, deduplicated, and dormant by default', () => {
  assert.deepEqual(activeSecureWorkflows({}), [])
  assert.deepEqual(activeSecureWorkflows({ schemaVersion: 5, enabled: true, workflows: SECURITY_WORKFLOWS }), [])
  assert.deepEqual(activeSecureWorkflows({
    schemaVersion: 6,
    enabled: true,
    workflows: ['transports', 'unknown', 'transports', 'eoc']
  }), ['eoc', 'transports'])
  assert.equal(validateWorkflowRollout({ schemaVersion: 6, enabled: true, workflows: ['unknown'] }).valid, false)
})

test('only an exact enabled rollout becomes a custom-token workflow claim', () => {
  assert.deepEqual(workflowTokenClaims({ schemaVersion: 6, enabled: false, workflows: ['eoc'] }), {})
  assert.deepEqual(workflowTokenClaims({ schemaVersion: 6, enabled: true, workflows: ['eoc', 'transports'] }), {
    workflowSecurityVersion: 6,
    secureWorkflows: ['eoc', 'transports']
  })
})

test('App Check remains monitoring-only and retirement requires every recorded gate', () => {
  assert.equal(appCheckMonitoringReady({ schemaVersion: 7, monitoringEnabled: true, enforcementEnabled: false }), true)
  assert.equal(appCheckMonitoringReady({ schemaVersion: 7, monitoringEnabled: true, enforcementEnabled: true }), false)
  const completeGates = {
    runtimeParity: true,
    emulatorMatrix: true,
    browserMatrix: true,
    offlineReplay: true,
    roleAndNegativeSecurity: true,
    canaryRollback: true
  }
  assert.equal(compatibilityRetirementReady({
    workflowConfig: { schemaVersion: 6, enabled: true, workflows: SECURITY_WORKFLOWS },
    appCheckConfig: { schemaVersion: 7, monitoringEnabled: true, enforcementEnabled: false },
    gates: completeGates
  }).ready, true)
  assert.equal(compatibilityRetirementReady({
    workflowConfig: { schemaVersion: 6, enabled: true, workflows: SECURITY_WORKFLOWS.slice(1) },
    appCheckConfig: { schemaVersion: 7, monitoringEnabled: true, enforcementEnabled: false },
    gates: completeGates
  }).ready, false)
})
