import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateCompatibilityRetirementSources } from '../scripts/securityCompatibilityRetirementModel.js'

function retiredSources(overrides = {}) {
  return {
    pinLogin: "PIN_LENGTH Enter PIN to access beginSecurityClientPinLogin",
    app: 'secure application bootstrap',
    sessionModel: 'SECURITY_SESSION_MAX_MS = 84 * 60 * 60 * 1000 validateStoredSecuritySession',
    userPinService: "performSecurityAccountAction action: 'self_change_pin'",
    supervisorDashboard: 'performSecurityAccountAction',
    staffPinLoginService: 'staffPinCredentials createCustomToken staffSessions',
    functionsIndex: 'protected callable exports',
    firestoreRules: 'function hasCurrentSecuritySession() { session.scopeExpiresAt > request.time; } match /securityWorkflowAudit/{auditId}',
    storageRules: 'currentWorkflowSession(locationId)',
    ...overrides
  }
}

test('retirement gate requires removal of every compatibility trust path while preserving secure login', () => {
  const result = evaluateCompatibilityRetirementSources(retiredSources())
  assert.equal(result.retired, true)
  assert.deepEqual(result.blockers, [])
})

test('browser PIN lookup, anonymous bootstrap, and compatibility markers each block retirement', () => {
  const result = evaluateCompatibilityRetirementSources(retiredSources({
    pinLogin: "PIN_LENGTH Enter PIN to access beginSecurityClientPinLogin signInAnonymously where('pinHash' toSecurityCompatibilityUser",
    app: 'securityCompatibilityVersion compatibilitySessionRequiresFreshLogin',
    sessionModel: 'SECURITY_SESSION_MAX_MS = 84 * 60 * 60 * 1000 validateStoredSecuritySession SECURITY_COMPATIBILITY_SESSION_VERSION'
  }))
  assert.equal(result.retired, false)
  assert.ok(result.blockers.includes('browserPinTrustRemoved'))
  assert.ok(result.blockers.includes('compatibilitySessionMarkerRemoved'))
})

test('legacy server lookup, private endpoints, and permissive rules each block retirement', () => {
  const result = evaluateCompatibilityRetirementSources(retiredSources({
    staffPinLoginService: "staffPinCredentials createCustomToken staffSessions where('pinHash' source: 'legacy_pin_hash'",
    functionsIndex: 'establishPinSessionHandler requireAdminPin(',
    firestoreRules: 'function hasCurrentSecuritySession() { session.scopeExpiresAt > request.time; } function hasLegacyAuthSession() {} !workflowSecurityEnabled( match /securityWorkflowAudit/{auditId}',
    storageRules: 'function strictAuthEnabled() {} : locationAllowed(locationId)'
  }))
  assert.equal(result.retired, false)
  assert.ok(result.blockers.includes('serverLegacyPinMigrationRemoved'))
  assert.ok(result.blockers.includes('privateLegacyPinEndpointsRemoved'))
  assert.ok(result.blockers.includes('firestoreCompatibilityBypassesRemoved'))
  assert.ok(result.blockers.includes('storageCompatibilityBypassesRemoved'))
})

test('retirement cannot pass by deleting the secure six-digit flow or 84-hour session contract', () => {
  const result = evaluateCompatibilityRetirementSources(retiredSources({
    pinLogin: '',
    userPinService: '',
    sessionModel: '',
    staffPinLoginService: ''
  }))
  assert.equal(result.retired, false)
  assert.ok(result.blockers.includes('sixDigitPinExperiencePreserved'))
  assert.ok(result.blockers.includes('secureServerLoginPreserved'))
  assert.ok(result.blockers.includes('secureAccountActionsPreserved'))
  assert.ok(result.blockers.includes('absolute84HourSessionPreserved'))
})
