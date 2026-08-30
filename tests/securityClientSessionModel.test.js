import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SECURITY_COMPATIBILITY_SESSION_VERSION,
  SECURITY_SESSION_MAX_MS,
  buildStoredSecuritySession,
  clearStoredSecuritySession,
  ensureSecurityDeviceId,
  evaluateLiveSecurityProfile,
  normalizeServerPinLoginResponse,
  persistSecuritySession,
  readStoredSecuritySession,
  sanitizeSecurityProfile,
  securityClientConfigEnabled,
  isSecurityCompatibilityUser,
  toSecurityCompatibilityUser,
  toSecureSessionUser,
  validateStoredSecuritySession
} from '../src/services/securityClientSessionModel.js'

const nowMs = Date.UTC(2026, 7, 25, 18)

function memoryStorage() {
  const values = new Map()
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    snapshot: () => Object.fromEntries(values)
  }
}

function serverResponse(overrides = {}) {
  return {
    customToken: 'synthetic_custom_token_value',
    profile: {
      id: 'phase3_bht',
      name: 'Phase 3 BHT',
      role: 'bht',
      site: 'OTC',
      location: 'OTC',
      house: 'TEST_HOUSE',
      locationId: 'test_house',
      shiftId: 'shift_1',
      vanId: 'van_test',
      vanIds: ['van_test'],
      authorizedLocations: ['OTC', 'TEST_HOUSE'],
      issueLocationIds: ['test_house'],
      securityVersion: 4,
      pinHash: 'must-not-survive',
      internalNote: 'must-not-survive'
    },
    session: {
      id: 'session_phase3_device_01',
      issuedAtMs: nowMs,
      expiresAtMs: nowMs + SECURITY_SESSION_MAX_MS,
      securityVersion: 4
    },
    replayed: false,
    ...overrides
  }
}

test('the Phase 3 client boundary requires both compile and exact versioned server gates', () => {
  const enabled = {
    schemaVersion: 2,
    serverPinLoginEnabled: true,
    clientBootstrapVersion: 3,
    clientBootstrapEnabled: true,
    rolloutState: 'emulator_only'
  }
  assert.equal(securityClientConfigEnabled(enabled, true), true)
  assert.equal(securityClientConfigEnabled(enabled, false), false)
  assert.equal(securityClientConfigEnabled({ ...enabled, clientBootstrapVersion: 2 }, true), false)
  assert.equal(securityClientConfigEnabled({ ...enabled, serverPinLoginEnabled: false }, true), false)
  assert.equal(securityClientConfigEnabled({ ...enabled, rolloutState: 'production_canary', enabledProfileIds: [] }, true), false)
  assert.equal(securityClientConfigEnabled({ ...enabled, rolloutState: 'production_canary', enabledProfileIds: ['test_bht_shift_1'] }, true), true)
})

test('only an explicitly marked legacy login can use compatibility reload restoration', () => {
  const compatibilityUser = toSecurityCompatibilityUser({
    id: 'phase3_compatibility_bht',
    name: 'Compatibility BHT',
    role: 'bht',
    locationId: 'test_house'
  })
  assert.equal(compatibilityUser.securityCompatibilityVersion, SECURITY_COMPATIBILITY_SESSION_VERSION)
  assert.equal(isSecurityCompatibilityUser(compatibilityUser), true)
  assert.equal(isSecurityCompatibilityUser({ ...compatibilityUser, securitySessionVersion: 3 }), false)
  assert.equal(isSecurityCompatibilityUser({ ...compatibilityUser, securityCompatibilityVersion: 2 }), false)
  assert.equal(isSecurityCompatibilityUser({ ...compatibilityUser, id: '' }), false)
  assert.equal(isSecurityCompatibilityUser({ ...compatibilityUser, role: 'unknown' }), false)
})

test('server login response is minimized and fixed to one absolute 84-hour window', () => {
  const normalized = normalizeServerPinLoginResponse(serverResponse(), nowMs)
  assert.equal(normalized.session.expiresAtMs - normalized.session.issuedAtMs, SECURITY_SESSION_MAX_MS)
  assert.equal('pinHash' in normalized.profile, false)
  assert.equal('internalNote' in normalized.profile, false)
  assert.throws(() => normalizeServerPinLoginResponse(serverResponse({
    session: { ...serverResponse().session, expiresAtMs: nowMs + SECURITY_SESSION_MAX_MS + 1 }
  }), nowMs), /absolute expiry/)
})

test('temporary scope expiry is earlier than but never replaces the absolute 84-hour boundary', () => {
  const scopeExpiresAtMs = nowMs + (60 * 60 * 1000)
  const normalized = normalizeServerPinLoginResponse(serverResponse({
    session: { ...serverResponse().session, scopeExpiresAtMs }
  }), nowMs)
  const session = buildStoredSecuritySession({
    response: normalized, authUid: 'staff_phase3_uid', deviceId: 'device_phase3_scope_01'
  })
  assert.equal(session.expiresAtMs - session.issuedAtMs, SECURITY_SESSION_MAX_MS)
  assert.equal(session.scopeExpiresAtMs, scopeExpiresAtMs)
  assert.equal(validateStoredSecuritySession(session, { nowMs: scopeExpiresAtMs }).reason, 'authorization_scope_expiry')
  assert.throws(() => normalizeServerPinLoginResponse(serverResponse({
    session: { ...serverResponse().session, scopeExpiresAtMs: nowMs + SECURITY_SESSION_MAX_MS + 1 }
  }), nowMs), /scope expiry/)
})

test('persistent metadata survives a browser reopen without storing the staff profile or token', () => {
  const storage = memoryStorage()
  const normalized = normalizeServerPinLoginResponse(serverResponse(), nowMs)
  const session = buildStoredSecuritySession({
    response: normalized,
    authUid: 'staff_phase3_stable_uid',
    deviceId: 'device_phase3_primary_01'
  })
  persistSecuritySession(storage, session)
  const reopened = readStoredSecuritySession(storage)
  assert.deepEqual(reopened, session)
  const serialized = JSON.stringify(storage.snapshot()).toLowerCase()
  assert.equal(serialized.includes('custom_token'), false)
  assert.equal(serialized.includes('pin'), false)
  assert.equal(serialized.includes('phase 3 bht'), false)
})

test('absolute expiry identity and token claims fail closed', () => {
  const normalized = normalizeServerPinLoginResponse(serverResponse(), nowMs)
  const session = buildStoredSecuritySession({ response: normalized, authUid: 'staff_phase3_uid', deviceId: 'device_phase3_primary_01' })
  const claims = { profileId: 'phase3_bht', sessionId: session.sessionId, securityVersion: 4, sessionVersion: 2 }
  assert.equal(validateStoredSecuritySession(session, { nowMs: session.expiresAtMs - 1, authUid: 'staff_phase3_uid', claims }).valid, true)
  assert.equal(validateStoredSecuritySession(session, { nowMs: session.expiresAtMs, authUid: 'staff_phase3_uid', claims }).reason, 'absolute_expiry')
  assert.equal(validateStoredSecuritySession(session, { nowMs, authUid: 'different_uid', claims }).reason, 'wrong_firebase_identity')
  assert.equal(validateStoredSecuritySession(session, { nowMs, authUid: 'staff_phase3_uid', claims: { ...claims, securityVersion: 5 } }).reason, 'stale_security_claim')
})

test('live inactive deleted version and authorization changes end the session', () => {
  const normalized = normalizeServerPinLoginResponse(serverResponse(), nowMs)
  const session = buildStoredSecuritySession({ response: normalized, authUid: 'staff_phase3_uid', deviceId: 'device_phase3_primary_01' })
  const live = { ...serverResponse().profile, active: true, deleted: false }
  assert.equal(evaluateLiveSecurityProfile(live, session).valid, true)
  assert.equal(evaluateLiveSecurityProfile({ ...live, active: false }, session).reason, 'profile_inactive_or_deleted')
  assert.equal(evaluateLiveSecurityProfile({ ...live, deleted: true }, session).reason, 'profile_inactive_or_deleted')
  assert.equal(evaluateLiveSecurityProfile({ ...live, securityVersion: 5 }, session).reason, 'security_version_changed')
  assert.equal(evaluateLiveSecurityProfile({ ...live, locationId: 'mesquite' }, session).reason, 'authorization_scope_changed')
})

test('one-device logout keeps another device session and same-device tabs share one record', () => {
  const firstDevice = memoryStorage()
  const secondDevice = memoryStorage()
  const normalized = normalizeServerPinLoginResponse(serverResponse(), nowMs)
  const first = buildStoredSecuritySession({ response: normalized, authUid: 'staff_phase3_uid', deviceId: 'device_phase3_primary_01' })
  const second = buildStoredSecuritySession({
    response: { ...normalized, session: { ...normalized.session, id: 'session_phase3_device_02' } },
    authUid: 'staff_phase3_uid',
    deviceId: 'device_phase3_secondary_02'
  })
  persistSecuritySession(firstDevice, first)
  persistSecuritySession(secondDevice, second)
  assert.deepEqual(readStoredSecuritySession(firstDevice), readStoredSecuritySession(firstDevice))
  clearStoredSecuritySession(firstDevice)
  assert.equal(readStoredSecuritySession(firstDevice), null)
  assert.equal(readStoredSecuritySession(secondDevice).sessionId, 'session_phase3_device_02')
})

test('device identity is stable and secure user state exposes only workflow fields', () => {
  const storage = memoryStorage()
  const first = ensureSecurityDeviceId(storage, () => 'stable_device_uuid_01')
  const second = ensureSecurityDeviceId(storage, () => 'different_uuid_02')
  assert.equal(first, second)
  const secureUser = toSecureSessionUser({
    ...serverResponse().profile,
    active: true,
    email: 'not-needed@example.test',
    pinHash: 'not-needed'
  }, {
    sessionId: 'session_phase3_device_01',
    expiresAtMs: nowMs + SECURITY_SESSION_MAX_MS,
    profileId: 'phase3_bht'
  }, 'staff_phase3_uid')
  assert.equal(secureUser.role, 'bht')
  assert.equal(secureUser.authUid, 'staff_phase3_uid')
  assert.equal('email' in secureUser, false)
  assert.equal('pinHash' in secureUser, false)
  assert.equal('internalNote' in sanitizeSecurityProfile('phase3_bht', serverResponse().profile), false)
})
