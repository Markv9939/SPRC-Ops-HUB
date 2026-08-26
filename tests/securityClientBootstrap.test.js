import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SecurityClientBootstrapError,
  beginDormantClientPinSession,
  endDormantClientSession,
  evaluateMonitoredSecuritySession,
  restoreDormantClientSession
} from '../src/services/securityClientBootstrap.js'
import { SECURITY_SESSION_MAX_MS, readStoredSecuritySession } from '../src/services/securityClientSessionModel.js'

const baseNowMs = Date.UTC(2026, 7, 25, 18)

function memoryStorage() {
  const values = new Map()
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  }
}

function enabledConfig() {
  return { schemaVersion: 2, serverPinLoginEnabled: true, clientBootstrapVersion: 3, clientBootstrapEnabled: true }
}

function baseProfile(overrides = {}) {
  return {
    id: 'phase3_bht',
    name: 'Phase 3 BHT',
    role: 'bht',
    active: true,
    deleted: false,
    site: 'OTC',
    location: 'OTC',
    house: 'TEST_HOUSE',
    locationId: 'test_house',
    shiftId: 'shift_1',
    vanId: 'van_test',
    vanIds: ['van_test'],
    authorizedLocations: ['OTC', 'TEST_HOUSE'],
    issueLocationIds: ['test_house'],
    securityVersion: 7,
    ...overrides
  }
}

function response() {
  return {
    customToken: 'phase3_synthetic_custom_token',
    profile: baseProfile(),
    session: {
      id: 'session_phase3_primary_01',
      issuedAtMs: baseNowMs,
      expiresAtMs: baseNowMs + SECURITY_SESSION_MAX_MS,
      securityVersion: 7
    }
  }
}

function adapters(overrides = {}) {
  const storage = overrides.storage || memoryStorage()
  const state = {
    nowMs: baseNowMs,
    currentUser: null,
    signOutCount: 0,
    callCount: 0,
    cacheOnlyValues: []
  }
  const base = {
    compiledEnabled: true,
    storage,
    now: () => state.nowMs,
    createId: (() => { let value = 0; return () => `generated_uuid_${String(++value).padStart(4, '0')}` })(),
    loadConfig: async () => enabledConfig(),
    callServerPinLogin: async () => { state.callCount += 1; return response() },
    usePersistentAuth: async () => {},
    signInWithCustomToken: async () => {
      state.currentUser = { uid: 'staff_phase3_uid' }
      return { user: state.currentUser }
    },
    waitForAuthReady: async () => {},
    currentAuthUser: () => state.currentUser,
    getIdTokenClaims: async () => ({
      profileId: 'phase3_bht',
      sessionId: 'session_phase3_primary_01',
      securityVersion: 7,
      sessionVersion: 2,
      authorizedLocations: ['OTC', 'TEST_HOUSE'],
      issueLocationIds: ['test_house'],
      locationId: 'test_house'
    }),
    loadProfile: async (_profileId, options) => {
      state.cacheOnlyValues.push(options.cacheOnly === true)
      return baseProfile()
    },
    loadScopedProfile: async (_profileId, profile) => profile,
    signOut: async () => { state.signOutCount += 1; state.currentUser = null }
  }
  return { adapters: { ...base, ...overrides, storage }, state, storage }
}

test('disabled compile/config boundaries preserve legacy fallback without calling the server', async () => {
  const compileOff = adapters({ compiledEnabled: false })
  assert.equal((await beginDormantClientPinSession('275184', compileOff.adapters)).status, 'disabled')
  assert.equal(compileOff.state.callCount, 0)

  const configOff = adapters({ loadConfig: async () => ({ ...enabledConfig(), clientBootstrapEnabled: false }) })
  assert.equal((await beginDormantClientPinSession('275184', configOff.adapters)).status, 'disabled')
  assert.equal(configOff.state.callCount, 0)
})

test('valid login establishes Firebase first then persists a minimum stable session', async () => {
  const context = adapters()
  const result = await beginDormantClientPinSession('275184', context.adapters)
  assert.equal(result.status, 'authenticated')
  assert.equal(result.user.id, 'phase3_bht')
  assert.equal(result.user.authUid, 'staff_phase3_uid')
  assert.equal(result.user.securitySessionVersion, 3)
  assert.equal('pinHash' in result.user, false)
  assert.equal(readStoredSecuritySession(context.storage).profileId, 'phase3_bht')
})

test('invalid PIN and function/network failures never downgrade into legacy login', async () => {
  const invalid = adapters({ callServerPinLogin: async () => { throw { code: 'functions/permission-denied' } } })
  await assert.rejects(
    () => beginDormantClientPinSession('000000', invalid.adapters),
    error => error instanceof SecurityClientBootstrapError && error.code === 'permission-denied'
  )
  assert.equal(invalid.state.currentUser, null)

  const network = adapters({ callServerPinLogin: async () => { throw { code: 'functions/unavailable' } } })
  await assert.rejects(
    () => beginDormantClientPinSession('275184', network.adapters),
    error => error instanceof SecurityClientBootstrapError && error.code === 'unavailable'
  )
})

test('reload restores the saved Firebase identity and offline startup uses cached profile state', async () => {
  const first = adapters()
  await beginDormantClientPinSession('275184', first.adapters)

  const reopened = adapters({ storage: first.storage })
  reopened.state.currentUser = { uid: 'staff_phase3_uid' }
  const online = await restoreDormantClientSession(reopened.adapters)
  assert.equal(online.status, 'authenticated')
  assert.equal(online.user.locationId, 'test_house')

  const offline = await restoreDormantClientSession(reopened.adapters, { offline: true })
  assert.equal(offline.status, 'authenticated')
  assert.equal(reopened.state.cacheOnlyValues.at(-1), true)
})

test('absolute expiry clears only this device while another device remains signed in', async () => {
  const first = adapters()
  const second = adapters()
  await beginDormantClientPinSession('275184', first.adapters)
  await beginDormantClientPinSession('275184', second.adapters)
  first.state.nowMs = baseNowMs + SECURITY_SESSION_MAX_MS
  const expired = await restoreDormantClientSession(first.adapters)
  assert.equal(expired.status, 'signed_out')
  assert.equal(readStoredSecuritySession(first.storage), null)
  assert.notEqual(readStoredSecuritySession(second.storage), null)
})

test('ordinary logout clears one device and same-device tabs observe the shared record', async () => {
  const device = adapters()
  await beginDormantClientPinSession('275184', device.adapters)
  const secondTab = adapters({ storage: device.storage })
  assert.equal(readStoredSecuritySession(secondTab.storage).sessionId, 'session_phase3_primary_01')
  await endDormantClientSession(device.adapters)
  assert.equal(readStoredSecuritySession(secondTab.storage), null)
  assert.equal(device.state.signOutCount, 1)
})

test('revocation and authorization changes end sessions while shift and van assignments may refresh', async () => {
  const context = adapters()
  await beginDormantClientPinSession('275184', context.adapters)
  const session = readStoredSecuritySession(context.storage)
  const claims = await context.adapters.getIdTokenClaims()
  const normal = { session, authUid: 'staff_phase3_uid', claims, rawProfile: baseProfile(), nowMs: baseNowMs + 1 }
  assert.equal(evaluateMonitoredSecuritySession(normal).valid, true)
  assert.equal(evaluateMonitoredSecuritySession({ ...normal, rawProfile: baseProfile({ active: false }) }).reason, 'profile_inactive_or_deleted')
  assert.equal(evaluateMonitoredSecuritySession({ ...normal, rawProfile: baseProfile({ deleted: true }) }).reason, 'profile_inactive_or_deleted')
  assert.equal(evaluateMonitoredSecuritySession({ ...normal, rawProfile: baseProfile({ securityVersion: 8 }) }).reason, 'security_version_changed')
  assert.equal(evaluateMonitoredSecuritySession({ ...normal, rawProfile: baseProfile({ authorizedLocations: ['OTC', 'MESQUITE'] }) }).reason, 'authorization_scope_changed')
  assert.equal(evaluateMonitoredSecuritySession({
    ...normal,
    rawProfile: baseProfile({ shiftId: 'shift_2', vanId: 'van_two', vanIds: ['van_two'] })
  }).valid, true)
})

test('offline restore without cached profile is held until reconnect instead of trusting browser profile data', async () => {
  const context = adapters()
  await beginDormantClientPinSession('275184', context.adapters)
  const reopened = adapters({
    storage: context.storage,
    loadProfile: async () => { throw new Error('cache-miss') }
  })
  reopened.state.currentUser = { uid: 'staff_phase3_uid' }
  await assert.rejects(
    () => restoreDormantClientSession(reopened.adapters, { offline: true }),
    error => error instanceof SecurityClientBootstrapError && error.code === 'offline-cache-unavailable'
  )
  assert.notEqual(readStoredSecuritySession(context.storage), null)

  reopened.adapters.loadProfile = async (_profileId, { cacheOnly } = {}) => {
    if (cacheOnly) throw new Error('cache-miss')
    return baseProfile()
  }
  const reconnected = await restoreDormantClientSession(reopened.adapters)
  assert.equal(reconnected.status, 'authenticated')
  assert.equal(reconnected.user.id, 'phase3_bht')
})
