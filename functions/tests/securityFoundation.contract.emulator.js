import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import process from 'node:process'
import test from 'node:test'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import {
  ALL_DEVICE_REVOCATION_TRIGGERS,
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

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Run this security contract through the Firestore and Auth emulators.')
}

process.env.GCLOUD_PROJECT ||= 'demo-sprc-security-foundation'
if (getApps().length === 0) initializeApp({ projectId: process.env.GCLOUD_PROJECT })
const db = getFirestore()
const auth = getAuth()
const baseNowMs = Date.UTC(2026, 7, 25, 12)
const pinHash = pin => crypto.createHash('sha256').update(`security-contract:${pin}`).digest('hex')

function bhtProfile(overrides = {}) {
  return {
    name: 'BHT Contract',
    role: 'bht',
    active: true,
    deleted: false,
    site: 'OTC',
    location: 'OTC',
    house: 'TEST_HOUSE',
    locationId: 'test_house',
    authorizedLocations: ['OTC', 'TEST_HOUSE'],
    issueLocationIds: ['test_house'],
    pinHash: pinHash('275184'),
    securityVersion: 1,
    version: 1,
    ...overrides
  }
}

async function clearEmulators() {
  const collections = await db.listCollections()
  for (const collection of collections) {
    const snapshot = await collection.get()
    const batch = db.batch()
    snapshot.docs.forEach(item => batch.delete(item.ref))
    if (!snapshot.empty) await batch.commit()
  }
  const users = await auth.listUsers(1000)
  if (users.users.length > 0) await auth.deleteUsers(users.users.map(user => user.uid))
}

test.beforeEach(clearEmulators)
test.after(clearEmulators)

async function attemptPinLogin({ profileId, pin, attemptKey, nowMs }) {
  const profileRef = db.doc(`users/${profileId}`)
  const rateRef = db.doc(`securityContractRateLimits/${attemptKey}`)
  return db.runTransaction(async transaction => {
    const [profileSnapshot, rateSnapshot] = await Promise.all([
      transaction.get(profileRef),
      transaction.get(rateRef)
    ])
    const profile = profileSnapshot.exists ? profileSnapshot.data() : null
    const result = evaluatePinLoginAttempt({
      nowMs,
      profile,
      pinMatches: Boolean(profile?.pinHash) && profile.pinHash === pinHash(pin),
      rateLimit: rateSnapshot.data() || {}
    })
    transaction.set(rateRef, { ...result.nextRateLimit, updatedAtMs: nowMs }, { merge: true })
    return result
  })
}

async function issueDeviceSession({ profileId, authUid, deviceId, sessionId, nowMs }) {
  const profile = (await db.doc(`users/${profileId}`).get()).data()
  const session = buildDeviceSession({
    profileId,
    authUid,
    deviceId,
    sessionId,
    nowMs,
    securityVersion: profile.securityVersion
  })
  await db.doc(`securityContractSessions/${sessionId}`).set(session)
  return session
}

async function applyRevocation({ profileId, trigger, nowMs, sessionId = '' }) {
  const scope = revocationScope(trigger)
  if (scope === 'none') throw new Error(`Unsupported revocation trigger: ${trigger}`)
  const profileRef = db.doc(`users/${profileId}`)
  const auditRef = db.collection('securityContractAudit').doc()
  const sessionQuery = db.collection('securityContractSessions').where('profileId', '==', profileId)
  await db.runTransaction(async transaction => {
    const [profileSnapshot, sessionSnapshot] = await Promise.all([
      transaction.get(profileRef),
      transaction.get(sessionQuery)
    ])
    if (!profileSnapshot.exists) throw new Error('Profile is missing.')
    const currentSecurityVersion = Number(profileSnapshot.data().securityVersion || 1)
    const affected = sessionSnapshot.docs.filter(item => scope === 'all_devices' || item.id === sessionId)
    affected.forEach(item => transaction.update(item.ref, { revokedAtMs: nowMs, revocationReason: trigger }))
    if (scope === 'all_devices') {
      transaction.update(profileRef, { securityVersion: currentSecurityVersion + 1, updatedAtMs: nowMs })
    }
    transaction.set(auditRef, {
      action: trigger,
      profileId,
      scope,
      affectedSessionIds: affected.map(item => item.id),
      createdAtMs: nowMs
    })
  })
}

test('emulated PIN contract accepts valid credentials, rejects invalid credentials, and rate-limits repeated failures', async () => {
  await db.doc('users/bht_pin').set(bhtProfile())
  assert.equal((await attemptPinLogin({ profileId: 'bht_pin', pin: '275184', attemptKey: 'device_good', nowMs: baseNowMs })).status, 'valid')
  assert.equal((await attemptPinLogin({ profileId: 'bht_pin', pin: '000000', attemptKey: 'device_bad', nowMs: baseNowMs + 1 })).status, 'invalid')

  let result
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    result = await attemptPinLogin({ profileId: 'bht_pin', pin: '000000', attemptKey: 'device_locked', nowMs: baseNowMs + attempt })
  }
  assert.equal(result.status, 'rate_limited')
  assert.equal((await attemptPinLogin({ profileId: 'bht_pin', pin: '275184', attemptKey: 'device_locked', nowMs: baseNowMs + 10 })).status, 'rate_limited')
  assert.equal((await attemptPinLogin({ profileId: 'bht_pin', pin: '275184', attemptKey: 'device_locked', nowMs: baseNowMs + PIN_ATTEMPT_WINDOW_MS + 10 })).status, 'valid')
})

test('inactive and malformed BHT profiles fail the PIN contract without disclosing account state', async () => {
  await db.doc('users/inactive_bht').set(bhtProfile({ active: false }))
  await db.doc('users/no_location_bht').set(bhtProfile({ house: null, locationId: null, authorizedLocations: ['OTC'], issueLocationIds: [] }))
  await db.doc('users/multiple_location_bht').set(bhtProfile({ issueLocationIds: ['test_house', 'mesquite'] }))
  for (const profileId of ['inactive_bht', 'no_location_bht', 'multiple_location_bht']) {
    const result = await attemptPinLogin({ profileId, pin: '275184', attemptKey: `attempt_${profileId}`, nowMs: baseNowMs })
    assert.equal(result.status, 'invalid')
    assert.equal(result.publicMessage, 'PIN verification failed.')
  }
  assert.equal(validateBhtHomeLocation((await db.doc('users/no_location_bht').get()).data()).valid, false)
  assert.equal(validateBhtHomeLocation((await db.doc('users/multiple_location_bht').get()).data()).valid, false)
})

test('two emulated Auth identities produce independent persistent device sessions with one absolute 84-hour limit', async () => {
  await db.doc('users/bht_multi_device').set(bhtProfile())
  await auth.createUser({ uid: 'device_a_auth' })
  await auth.createUser({ uid: 'device_b_auth' })
  const first = await issueDeviceSession({ profileId: 'bht_multi_device', authUid: 'device_a_auth', deviceId: 'device_a', sessionId: 'session_a', nowMs: baseNowMs })
  const second = await issueDeviceSession({ profileId: 'bht_multi_device', authUid: 'device_b_auth', deviceId: 'device_b', sessionId: 'session_b', nowMs: baseNowMs + 1000 })

  assert.notEqual(first.sessionId, second.sessionId)
  assert.notEqual(first.authUid, second.authUid)
  assert.equal(first.expiresAtMs - first.issuedAtMs, SESSION_ABSOLUTE_MAX_MS)
  assert.equal(second.expiresAtMs - second.issuedAtMs, SESSION_ABSOLUTE_MAX_MS)

  // A browser restart reloads the same persistent session record; it does not extend expiry.
  const reopened = (await db.doc('securityContractSessions/session_a').get()).data()
  assert.equal(reopened.storagePolicy, 'persistent_local')
  assert.equal(reopened.expiresAtMs, first.expiresAtMs)
  assert.equal(evaluateDeviceSession(reopened, { nowMs: first.expiresAtMs - 1, authUid: 'device_a_auth', profileId: 'bht_multi_device', currentSecurityVersion: 1 }).valid, true)
  assert.equal(evaluateDeviceSession(reopened, { nowMs: first.expiresAtMs, authUid: 'device_a_auth', profileId: 'bht_multi_device', currentSecurityVersion: 1 }).reason, 'absolute_expiry')
})

test('ordinary logout revokes one device while every approved security trigger revokes all devices and writes audit evidence', async () => {
  await db.doc('users/logout_profile').set(bhtProfile())
  await issueDeviceSession({ profileId: 'logout_profile', authUid: 'logout_auth_a', deviceId: 'a', sessionId: 'logout_a', nowMs: baseNowMs })
  await issueDeviceSession({ profileId: 'logout_profile', authUid: 'logout_auth_b', deviceId: 'b', sessionId: 'logout_b', nowMs: baseNowMs })
  await applyRevocation({ profileId: 'logout_profile', trigger: 'ordinary_logout', nowMs: baseNowMs + 1, sessionId: 'logout_a' })
  assert.equal((await db.doc('securityContractSessions/logout_a').get()).data().revocationReason, 'ordinary_logout')
  assert.equal((await db.doc('securityContractSessions/logout_b').get()).data().revokedAtMs, 0)

  for (const [index, trigger] of ALL_DEVICE_REVOCATION_TRIGGERS.entries()) {
    const profileId = `all_devices_${index}`
    await db.doc(`users/${profileId}`).set(bhtProfile())
    await issueDeviceSession({ profileId, authUid: `${profileId}_auth_a`, deviceId: 'a', sessionId: `${profileId}_a`, nowMs: baseNowMs })
    await issueDeviceSession({ profileId, authUid: `${profileId}_auth_b`, deviceId: 'b', sessionId: `${profileId}_b`, nowMs: baseNowMs })
    await applyRevocation({ profileId, trigger, nowMs: baseNowMs + index + 1 })
    const sessions = await db.collection('securityContractSessions').where('profileId', '==', profileId).get()
    assert.equal(sessions.docs.every(item => item.data().revocationReason === trigger), true)
    assert.equal((await db.doc(`users/${profileId}`).get()).data().securityVersion, 2)
    const audits = await db.collection('securityContractAudit').where('profileId', '==', profileId).get()
    assert.equal(audits.size, 1)
    assert.deepEqual(new Set(audits.docs[0].data().affectedSessionIds), new Set([`${profileId}_a`, `${profileId}_b`]))
  }
})

test('supervisor account controls are limited to BHT or tech profiles in the supervisor existing location scope', async () => {
  const actor = {
    role: 'supervisor', active: true, site: 'OTC', authorizedLocations: ['OTC'], issueLocationIds: ['mesquite', 'lone_mountain', 'test_house']
  }
  const otcBht = bhtProfile()
  const resBht = bhtProfile({ site: 'RES', location: 'RES', house: null, locationId: 'res', authorizedLocations: ['RES'], issueLocationIds: ['res'] })
  await db.doc('users/supervisor_otc').set(actor)
  await db.doc('users/bht_otc').set(otcBht)
  await db.doc('users/bht_res').set(resBht)
  const storedActor = (await db.doc('users/supervisor_otc').get()).data()

  for (const action of ['reset_pin', 'deactivate', 'reactivate', 'end_all_sessions', 'update_operational_assignment']) {
    assert.equal(evaluateStaffAccountManagement({ actor: storedActor, target: otcBht, action }).allowed, true)
  }
  assert.equal(evaluateStaffAccountManagement({ actor: storedActor, target: resBht, action: 'reset_pin' }).reason, 'target_outside_actor_location')
  assert.equal(evaluateStaffAccountManagement({ actor: storedActor, target: { ...otcBht, role: 'admin' }, action: 'reset_pin' }).reason, 'supervisor_may_only_manage_bht')
  assert.equal(evaluateStaffAccountManagement({ actor: storedActor, target: { ...otcBht, role: 'supervisor' }, action: 'deactivate' }).reason, 'supervisor_may_only_manage_bht')
  assert.equal(evaluateStaffAccountManagement({ actor: storedActor, target: otcBht, action: 'update_operational_assignment', requestedRole: 'supervisor' }).reason, 'role_elevation_denied')
  assert.equal(evaluateStaffAccountManagement({ actor: storedActor, target: otcBht, action: 'update_operational_assignment', requestedLocationId: 'res' }).reason, 'requested_location_outside_actor_scope')
  assert.equal(evaluateStaffAccountManagement({ actor: storedActor, target: otcBht, action: 'change_global_security', changesGlobalSecurity: true }).reason, 'global_security_admin_only')
})

test('emulated offline queue holds wrong-owner and revoked work, and routes stale or finalized records to review', async () => {
  await db.doc('users/offline_owner').set(bhtProfile({ securityVersion: 7 }))
  const session = await issueDeviceSession({ profileId: 'offline_owner', authUid: 'offline_auth', deviceId: 'offline_device', sessionId: 'offline_session', nowMs: baseNowMs })
  await db.doc('securityContractRecords/transport_1').set({ version: 3, status: 'open', appliedOperationIds: [] })
  await db.doc('securityContractOfflineActions/op_1').set({ operationId: 'op_1', ownerProfileId: 'offline_owner', securityVersion: 7, expectedVersion: 3 })
  const action = (await db.doc('securityContractOfflineActions/op_1').get()).data()
  const record = (await db.doc('securityContractRecords/transport_1').get()).data()
  const context = { nowMs: baseNowMs + 1, authUid: 'offline_auth', profileId: 'offline_owner', currentSecurityVersion: 7 }

  assert.equal(evaluateOfflineReplay({ action, session, sessionContext: context, currentRecord: record }).disposition, 'allow')
  assert.deepEqual(evaluateOfflineReplay({ action: { ...action, ownerProfileId: 'other_staff' }, session, sessionContext: context, currentRecord: record }), { disposition: 'hold_for_owner', reason: 'wrong_owner' })
  assert.deepEqual(evaluateOfflineReplay({ action: { ...action, expectedVersion: 2 }, session, sessionContext: context, currentRecord: record }), { disposition: 'needs_review', reason: 'stale_record_version' })
  assert.deepEqual(evaluateOfflineReplay({ action, session, sessionContext: context, currentRecord: { ...record, status: 'final' } }), { disposition: 'needs_review', reason: 'record_no_longer_mutable' })

  await applyRevocation({ profileId: 'offline_owner', trigger: 'profile_deactivated', nowMs: baseNowMs + 2 })
  const revokedSession = (await db.doc('securityContractSessions/offline_session').get()).data()
  const revokedContext = { ...context, nowMs: baseNowMs + 3, currentSecurityVersion: 8 }
  assert.deepEqual(evaluateOfflineReplay({ action, session: revokedSession, sessionContext: revokedContext, currentRecord: record }), { disposition: 'hold_for_owner', reason: 'revoked_session' })
})
