import assert from 'node:assert/strict'
import test from 'node:test'
import { SECURITY_WORKFLOWS } from '../functions/src/workflowSecurityModel.js'
import {
  evaluateSecurityCutover,
  planSecurityCutover,
  securityCutoverConfirmation,
  validateSecurityCutoverBackup
} from '../scripts/securityCompatibilityCutoverModel.js'

function boundary(overrides = {}) {
  return {
    target: 'all_active',
    foundationConfig: {
      schemaVersion: 2,
      serverPinLoginEnabled: true,
      clientBootstrapVersion: 3,
      clientBootstrapEnabled: true,
      rolloutState: 'production_canary'
    },
    workflowConfig: { schemaVersion: 6, enabled: true, workflows: SECURITY_WORKFLOWS },
    authPolicy: { authScopeEnforced: false },
    readiness: { broadActivationReady: true, strictAuthorizationReady: false },
    ...overrides
  }
}

test('all-active activation requires the complete canary boundary and read-only readiness', () => {
  assert.equal(evaluateSecurityCutover(boundary()).ready, true)
  assert.equal(evaluateSecurityCutover(boundary({ readiness: { broadActivationReady: false } })).ready, false)
  assert.equal(evaluateSecurityCutover(boundary({ authPolicy: { authScopeEnforced: true } })).ready, false)
  assert.equal(evaluateSecurityCutover(boundary({
    workflowConfig: { schemaVersion: 6, enabled: true, workflows: SECURITY_WORKFLOWS.slice(1) }
  })).ready, false)
})

test('strict authorization waits for all-active login and every active stable identity', () => {
  const strict = boundary({
    target: 'strict_authorization',
    foundationConfig: { ...boundary().foundationConfig, rolloutState: 'active' },
    readiness: { broadActivationReady: true, strictAuthorizationReady: true }
  })
  assert.equal(evaluateSecurityCutover(strict).ready, true)
  assert.equal(evaluateSecurityCutover({
    ...strict,
    foundationConfig: { ...strict.foundationConfig, rolloutState: 'production_canary' }
  }).ready, false)
  assert.equal(evaluateSecurityCutover({
    ...strict,
    readiness: { ...strict.readiness, strictAuthorizationReady: false }
  }).ready, false)
})

test('plans change only the exact target setting', () => {
  assert.deepEqual(planSecurityCutover({ target: 'all_active' }), {
    target: 'all_active',
    foundationPatch: { rolloutState: 'active' },
    authPolicyPatch: null
  })
  assert.deepEqual(planSecurityCutover({
    target: 'strict_authorization',
    authPolicy: { version: 1, authScopeEnforced: false }
  }), {
    target: 'strict_authorization',
    foundationPatch: null,
    authPolicyPatch: { version: 1, authScopeEnforced: true }
  })
})

test('confirmation phrases and rollback packages are exact', () => {
  assert.equal(securityCutoverConfirmation('all_active'), 'ACTIVATE SECURE LOGIN FOR ALL ACTIVE PROFILES')
  assert.equal(securityCutoverConfirmation('strict_authorization', 'rollback'), 'ROLL BACK STRICT AUTHORIZATION')
  const backup = {
    schemaVersion: 1,
    projectId: 'sprc-tx-l',
    target: 'all_active',
    configHash: 'abc',
    config: { value: true },
    capturedAt: '2026-09-01T00:00:00.000Z'
  }
  assert.equal(validateSecurityCutoverBackup(backup, {
    projectId: 'sprc-tx-l', target: 'all_active', configHash: 'abc'
  }), true)
  assert.throws(() => validateSecurityCutoverBackup(backup, {
    projectId: 'sprc-tx-l', target: 'strict_authorization', configHash: 'abc'
  }))
})
