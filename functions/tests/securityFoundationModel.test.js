import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PIN_ATTEMPT_WINDOW_MS,
  SESSION_ABSOLUTE_MAX_MS,
  buildDeviceSession,
  evaluateDeviceSession,
  evaluateOfflineReplay,
  evaluatePinLoginAttempt,
  evaluateStaffAccountManagement,
  revocationScope,
  validateBhtHomeLocation
} from '../src/securityFoundationModel.js'

const nowMs = Date.UTC(2026, 7, 25, 12)
const bht = (overrides = {}) => ({
  id: 'bht_test',
  name: 'BHT Test',
  role: 'bht',
  active: true,
  site: 'OTC',
  location: 'OTC',
  house: 'TEST_HOUSE',
  locationId: 'test_house',
  authorizedLocations: ['OTC', 'TEST_HOUSE'],
  issueLocationIds: ['test_house'],
  ...overrides
})

const supervisor = (overrides = {}) => ({
  id: 'supervisor_otc',
  role: 'supervisor',
  active: true,
  site: 'OTC',
  authorizedLocations: ['OTC'],
  issueLocationIds: ['mesquite', 'lone_mountain', 'test_house'],
  ...overrides
})

test('BHT and legacy tech profiles resolve one existing home location', () => {
  assert.deepEqual(validateBhtHomeLocation(bht()), {
    valid: true,
    applicable: true,
    homeLocationId: 'test_house',
    mainLocation: 'OTC',
    reasons: []
  })
  assert.equal(validateBhtHomeLocation(bht({ role: 'tech' })).valid, true)
  assert.equal(validateBhtHomeLocation(bht({ site: 'RES', location: 'RES', house: null, locationId: 'res', authorizedLocations: ['RES'], issueLocationIds: ['res'] })).valid, true)
})

test('zero, multiple, and conflicting BHT locations are invalid configuration', () => {
  assert.equal(validateBhtHomeLocation(bht({ house: null, locationId: null, authorizedLocations: ['OTC'], issueLocationIds: [] })).valid, false)
  assert.ok(validateBhtHomeLocation(bht({ issueLocationIds: ['test_house', 'mesquite'] })).reasons.includes('multiple_home_locations'))
  assert.ok(validateBhtHomeLocation(bht({ site: 'RES', location: 'RES' })).reasons.includes('conflicting_main_locations'))
})

test('PIN contract accepts only an active, valid profile and locks the fifth failure', () => {
  let rateLimit = {}
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const result = evaluatePinLoginAttempt({ nowMs: nowMs + attempt, profile: bht(), pinMatches: false, rateLimit })
    assert.equal(result.status, 'invalid')
    rateLimit = result.nextRateLimit
  }
  const fifth = evaluatePinLoginAttempt({ nowMs: nowMs + 5, profile: bht(), pinMatches: false, rateLimit })
  assert.equal(fifth.status, 'rate_limited')
  assert.equal(evaluatePinLoginAttempt({ nowMs: nowMs + 6, profile: bht(), pinMatches: true, rateLimit: fifth.nextRateLimit }).status, 'rate_limited')
  assert.equal(evaluatePinLoginAttempt({ nowMs: nowMs + PIN_ATTEMPT_WINDOW_MS + 6, profile: bht(), pinMatches: true, rateLimit: fifth.nextRateLimit }).status, 'valid')
  assert.equal(evaluatePinLoginAttempt({ nowMs, profile: bht({ active: false }), pinMatches: true, rateLimit: {} }).status, 'invalid')
  assert.equal(evaluatePinLoginAttempt({ nowMs, profile: bht({ house: null, locationId: null, issueLocationIds: [], authorizedLocations: ['OTC'] }), pinMatches: true, rateLimit: {} }).internalReason, 'invalid_profile_configuration')
})

test('sessions persist locally but expire at the absolute 84-hour boundary', () => {
  const session = buildDeviceSession({ sessionId: 'session_a', authUid: 'auth_a', profileId: 'bht_test', deviceId: 'device_a', nowMs, securityVersion: 4 })
  assert.equal(session.storagePolicy, 'persistent_local')
  assert.equal(session.expiresAtMs - session.issuedAtMs, SESSION_ABSOLUTE_MAX_MS)
  assert.equal(evaluateDeviceSession(session, { nowMs: session.expiresAtMs - 1, authUid: 'auth_a', profileId: 'bht_test', currentSecurityVersion: 4 }).valid, true)
  assert.deepEqual(evaluateDeviceSession(session, { nowMs: session.expiresAtMs, authUid: 'auth_a', profileId: 'bht_test', currentSecurityVersion: 4 }), { valid: false, reason: 'absolute_expiry' })
})

test('session identity and security-version mismatches fail closed', () => {
  const session = buildDeviceSession({ sessionId: 'session_a', authUid: 'auth_a', profileId: 'bht_test', deviceId: 'device_a', nowMs, securityVersion: 4 })
  assert.equal(evaluateDeviceSession(session, { nowMs, authUid: 'auth_b', profileId: 'bht_test', currentSecurityVersion: 4 }).reason, 'wrong_firebase_identity')
  assert.equal(evaluateDeviceSession(session, { nowMs, authUid: 'auth_a', profileId: 'other', currentSecurityVersion: 4 }).reason, 'wrong_profile')
  assert.equal(evaluateDeviceSession(session, { nowMs, authUid: 'auth_a', profileId: 'bht_test', currentSecurityVersion: 5 }).reason, 'stale_security_version')
  assert.equal(evaluateDeviceSession({ ...session, revokedAtMs: nowMs }, { nowMs, authUid: 'auth_a', profileId: 'bht_test', currentSecurityVersion: 4 }).reason, 'revoked_session')
})

test('temporary authorization expiry ends the device session before the absolute 84-hour limit', () => {
  const session = buildDeviceSession({
    sessionId: 'scope_session', authUid: 'auth_a', profileId: 'bht_test', deviceId: 'device_a', nowMs, securityVersion: 4
  })
  const scoped = { ...session, scopeExpiresAtMs: nowMs + 1000 }
  assert.equal(evaluateDeviceSession(scoped, { nowMs: nowMs + 999, authUid: 'auth_a', profileId: 'bht_test', currentSecurityVersion: 4 }).valid, true)
  assert.equal(evaluateDeviceSession(scoped, { nowMs: nowMs + 1000, authUid: 'auth_a', profileId: 'bht_test', currentSecurityVersion: 4 }).reason, 'authorization_scope_expiry')
})

test('revocation triggers distinguish one-device logout from all-device security events', () => {
  assert.equal(revocationScope('ordinary_logout'), 'one_device')
  for (const trigger of ['profile_deactivated', 'pin_changed', 'role_reduced', 'location_removed', 'admin_end_all_sessions']) {
    assert.equal(revocationScope(trigger), 'all_devices')
  }
})

test('supervisors retain practical in-location BHT controls without elevated authority', () => {
  for (const action of ['reset_pin', 'deactivate', 'reactivate', 'end_all_sessions', 'update_operational_assignment']) {
    assert.equal(evaluateStaffAccountManagement({ actor: supervisor(), target: bht(), action }).allowed, true)
  }
  assert.equal(evaluateStaffAccountManagement({ actor: supervisor(), target: bht({ role: 'supervisor' }), action: 'reset_pin' }).reason, 'supervisor_may_only_manage_bht')
  assert.equal(evaluateStaffAccountManagement({ actor: supervisor(), target: bht(), action: 'update_operational_assignment', requestedRole: 'admin' }).reason, 'role_elevation_denied')
  assert.equal(evaluateStaffAccountManagement({ actor: supervisor(), target: bht(), action: 'update_operational_assignment', requestedLocationId: 'res' }).reason, 'requested_location_outside_actor_scope')
  assert.equal(evaluateStaffAccountManagement({ actor: supervisor(), target: bht(), action: 'change_global_security', changesGlobalSecurity: true }).reason, 'global_security_admin_only')
  assert.equal(evaluateStaffAccountManagement({ actor: supervisor({ site: 'RES', authorizedLocations: ['RES'], issueLocationIds: ['res'] }), target: bht(), action: 'reset_pin' }).reason, 'target_outside_actor_location')
  assert.equal(evaluateStaffAccountManagement({ actor: bht(), target: bht(), action: 'reset_pin' }).reason, 'supervisor_or_admin_required')
})

test('offline replay allows only the correct owner, current session, and current mutable record', () => {
  const session = buildDeviceSession({ sessionId: 'session_a', authUid: 'auth_a', profileId: 'bht_test', deviceId: 'device_a', nowMs, securityVersion: 4 })
  const action = { operationId: 'op_1', ownerProfileId: 'bht_test', securityVersion: 4, expectedVersion: 3 }
  const sessionContext = { nowMs, authUid: 'auth_a', profileId: 'bht_test', currentSecurityVersion: 4 }
  assert.equal(evaluateOfflineReplay({ action, session, sessionContext, currentRecord: { version: 3, status: 'open' } }).disposition, 'allow')
  assert.equal(evaluateOfflineReplay({ action: { ...action, ownerProfileId: 'other' }, session, sessionContext, currentRecord: { version: 3 } }).reason, 'wrong_owner')
  assert.equal(evaluateOfflineReplay({ action, session, sessionContext, currentRecord: { version: 4 } }).reason, 'stale_record_version')
  assert.equal(evaluateOfflineReplay({ action, session: { ...session, revokedAtMs: nowMs }, sessionContext, currentRecord: { version: 3 } }).reason, 'revoked_session')
  assert.equal(evaluateOfflineReplay({ action, session, sessionContext, currentRecord: { version: 3, status: 'final' } }).reason, 'record_no_longer_mutable')
  assert.equal(evaluateOfflineReplay({ action, session, sessionContext, currentRecord: { version: 3, appliedOperationIds: ['op_1'] } }).disposition, 'already_applied')
})
