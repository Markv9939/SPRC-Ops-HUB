import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import process from 'node:process'
import test from 'node:test'
import { cert, deleteApp, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { Timestamp, getFirestore } from 'firebase-admin/firestore'
import { SESSION_ABSOLUTE_MAX_MS } from '../src/securityFoundationModel.js'
import {
  containsCredentialMaterial,
  createServerPinCredential,
  verifyServerPinCredential
} from '../src/staffPinCredentialModel.js'
import {
  StaffPinLoginError,
  beginDormantStaffPinSession,
  sessionRecordIsCurrent
} from '../src/staffPinLoginService.js'

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Run this Phase 2 contract through the Firestore and Auth emulators.')
}

const projectId = process.env.GCLOUD_PROJECT || 'demo-sprc-security-foundation'
const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' }
})
const app = initializeApp({
  projectId,
  credential: cert({
    projectId,
    clientEmail: `phase2-tests@${projectId}.iam.gserviceaccount.com`,
    privateKey
  })
}, 'phase2-security-contract')
const db = getFirestore(app)
const auth = getAuth(app)
const secret = 'phase-2-emulator-only-secret-with-more-than-thirty-two-characters'
const baseNowMs = Date.UTC(2026, 7, 25, 18)

function bhtProfile(overrides = {}) {
  return {
    name: 'Phase 2 BHT',
    role: 'bht',
    active: true,
    deleted: false,
    site: 'OTC',
    location: 'OTC',
    house: 'TEST_HOUSE',
    locationId: 'test_house',
    authorizedLocations: ['OTC', 'TEST_HOUSE'],
    issueLocationIds: ['test_house'],
    shiftId: 'shift_1',
    vanId: 'van_test',
    vanIds: ['van_test'],
    securityVersion: 1,
    version: 1,
    ...overrides
  }
}

async function seedLoginProfile(profileId, pin, overrides = {}) {
  await db.doc(`users/${profileId}`).set(bhtProfile(overrides))
  await db.doc(`staffPinCredentials/${profileId}`).set({
    ...(await createServerPinCredential(pin, secret, { salt: `salt-${profileId}` })),
    active: true
  })
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

async function enableDormantEndpoint() {
  await db.doc('appSettings/securityFoundation').set({
    schemaVersion: 2,
    serverPinLoginEnabled: true,
    rolloutState: 'emulator_only'
  })
}

function requestData(pin, deviceId = 'device_contract_0001', operationId = 'operation_contract_0001') {
  return { pin, deviceId, operationId }
}

function begin({
  pin,
  deviceId = 'device_contract_0001',
  operationId = 'operation_contract_0001',
  nowMs = baseNowMs,
  authAdapter = auth,
  sourceAddress = '192.0.2.10'
}) {
  return beginDormantStaffPinSession({
    db,
    auth: authAdapter,
    secret,
    requestData: requestData(pin, deviceId, operationId),
    sourceAddress,
    nowMs
  })
}

function decodeJwtPayload(token) {
  return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'))
}

test.beforeEach(clearEmulators)
test.after(async () => {
  await clearEmulators()
  await deleteApp(app)
})

test('the versioned endpoint is fail-closed and makes no auth, credential, mapping, or session writes while disabled', async () => {
  await db.doc('users/disabled_boundary_bht').set(bhtProfile())
  await assert.rejects(
    () => begin({ pin: '275184' }),
    error => error instanceof StaffPinLoginError && error.code === 'failed-precondition'
  )
  assert.equal((await db.collection('staffPinCredentials').get()).size, 0)
  assert.equal((await db.collection('staffAuthIdentities').get()).size, 0)
  assert.equal((await db.collection('staffSessions').get()).size, 0)
  assert.equal((await db.collection('usersByAuthUid').get()).size, 0)
  assert.equal((await auth.listUsers()).users.length, 0)
})

test('valid server credentials create a signed custom token and return only sanitized profile/session data', async () => {
  await enableDormantEndpoint()
  await seedLoginProfile('credential_bht', '275184', { internalNote: 'never return' })
  const result = await begin({ pin: '275184' })

  assert.equal(typeof result.customToken, 'string')
  assert.equal(result.profile.id, 'credential_bht')
  assert.equal(result.profile.locationId, 'test_house')
  assert.equal(result.session.expiresAtMs - result.session.issuedAtMs, SESSION_ABSOLUTE_MAX_MS)
  assert.equal(result.replayed, false)
  assert.equal(containsCredentialMaterial(result), false)
  assert.equal('internalNote' in result.profile, false)

  const tokenPayload = decodeJwtPayload(result.customToken)
  assert.equal(tokenPayload.uid.startsWith('staff_'), true)
  assert.equal(tokenPayload.claims.profileId, 'credential_bht')
  assert.equal(tokenPayload.claims.sessionId, result.session.id)
  assert.equal(tokenPayload.claims.securityVersion, 1)
  assert.equal(containsCredentialMaterial(tokenPayload.claims), false)

  const credential = (await db.doc('staffPinCredentials/credential_bht').get()).data()
  assert.equal(await verifyServerPinCredential('275184', secret, credential), true)
  assert.equal('pinHash' in (await db.doc('users/credential_bht').get()).data(), false)
  assert.equal((await db.collection('staffSessions').get()).size, 1)
  assert.equal((await db.collection('securityLoginAudit').get()).size, 1)
})

test('production canary enrollment leaves a valid non-enrolled profile on legacy login without creating secure artifacts', async () => {
  await db.doc('appSettings/securityFoundation').set({
    schemaVersion: 2,
    serverPinLoginEnabled: true,
    clientBootstrapVersion: 3,
    clientBootstrapEnabled: true,
    rolloutState: 'production_canary',
    enabledProfileIds: ['enrolled_canary_bht']
  })
  await seedLoginProfile('not_enrolled_bht', '275184')
  const result = await begin({ pin: '275184' })

  assert.deepEqual(result, { status: 'not_enrolled' })
  assert.equal((await db.collection('staffPinCredentials').get()).size, 1)
  assert.equal((await db.collection('staffAuthIdentities').get()).size, 0)
  assert.equal((await db.collection('staffSessions').get()).size, 0)
  assert.equal((await db.collection('usersByAuthUid').get()).size, 0)
  assert.equal((await auth.listUsers()).users.length, 0)
})

test('all-active rollout gives a previously non-enrolled valid profile the secure custom-token path', async () => {
  await db.doc('appSettings/securityFoundation').set({
    schemaVersion: 2,
    serverPinLoginEnabled: true,
    clientBootstrapVersion: 3,
    clientBootstrapEnabled: true,
    rolloutState: 'active',
    enabledProfileIds: ['original_canary_only']
  })
  await seedLoginProfile('all_active_bht', '275184')
  const result = await begin({
    pin: '275184',
    deviceId: 'all_active_device_01',
    operationId: 'all_active_operation_01'
  })

  assert.equal(result.profile.id, 'all_active_bht')
  assert.equal(typeof result.customToken, 'string')
  assert.equal((await db.doc('staffAuthIdentities/all_active_bht').get()).exists, true)
  assert.equal((await db.collection('staffSessions').where('profileId', '==', 'all_active_bht').get()).size, 1)
})

test('preferred server-only credentials work after migration without a client-readable legacy PIN hash', async () => {
  await enableDormantEndpoint()
  await db.doc('users/server_credential_bht').set(bhtProfile())
  await db.doc('staffPinCredentials/server_credential_bht').set({
    ...(await createServerPinCredential('385104', secret, { salt: 'preferred-credential-salt' })),
    active: true
  })
  const result = await begin({ pin: '385104', deviceId: 'preferred_device_01', operationId: 'preferred_operation_01' })
  assert.equal(result.profile.id, 'server_credential_bht')
  assert.equal(result.replayed, false)
})

test('disabled preferred credentials fail closed without falling back to the legacy browser hash', async () => {
  await enableDormantEndpoint()
  await db.doc('users/disabled_credential_bht').set(bhtProfile())
  await db.doc('staffPinCredentials/disabled_credential_bht').set({
    ...(await createServerPinCredential('385104', secret, { salt: 'disabled-credential-salt' })),
    active: false
  })
  await assert.rejects(
    () => begin({
      pin: '385104',
      deviceId: 'disabled_credential_device',
      operationId: 'disabled_credential_operation'
    }),
    error => error.code === 'permission-denied' && error.message === 'PIN verification failed.'
  )
  assert.equal((await db.collection('staffSessions').get()).size, 0)
})

test('invalid, ambiguous, inactive, deleted, and malformed-location profiles have one indistinguishable public failure', async () => {
  await enableDormantEndpoint()
  await seedLoginProfile('ambiguous_a', '111111')
  await seedLoginProfile('ambiguous_b', '111111')
  await seedLoginProfile('inactive_bht', '222222', { active: false })
  await seedLoginProfile('deleted_bht', '333333', { deleted: true })
  await seedLoginProfile('malformed_bht', '444444', {
    house: null,
    locationId: null,
    authorizedLocations: ['OTC'],
    issueLocationIds: []
  })

  const cases = [
    ['000000', 'negative_device_001', 'negative_operation_001'],
    ['111111', 'negative_device_002', 'negative_operation_002'],
    ['222222', 'negative_device_003', 'negative_operation_003'],
    ['333333', 'negative_device_004', 'negative_operation_004'],
    ['444444', 'negative_device_005', 'negative_operation_005']
  ]
  for (const [pin, deviceId, operationId] of cases) {
    await assert.rejects(
      () => begin({ pin, deviceId, operationId }),
      error => error instanceof StaffPinLoginError
        && error.code === 'permission-denied'
        && error.message === 'PIN verification failed.'
    )
  }
  assert.equal((await db.collection('staffSessions').get()).size, 0)
  assert.equal((await db.collection('usersByAuthUid').get()).size, 0)
})

test('the fifth failed attempt locks the device even if the next PIN is correct, then expires after 15 minutes', async () => {
  await enableDormantEndpoint()
  const deviceId = 'rate_limit_device_01'
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await assert.rejects(
      () => begin({ pin: '000000', deviceId, operationId: `rate_operation_000${attempt}`, nowMs: baseNowMs + attempt }),
      error => error.code === 'permission-denied'
    )
  }
  await assert.rejects(
    () => begin({ pin: '000000', deviceId, operationId: 'rate_operation_0005', nowMs: baseNowMs + 5 }),
    error => error.code === 'resource-exhausted'
  )
  await seedLoginProfile('rate_limit_bht', '275184')
  await assert.rejects(
    () => begin({ pin: '275184', deviceId, operationId: 'rate_operation_0006', nowMs: baseNowMs + 6 }),
    error => error.code === 'resource-exhausted'
  )
  const recovered = await begin({
    pin: '275184',
    deviceId,
    operationId: 'rate_operation_0007',
    nowMs: baseNowMs + (15 * 60 * 1000) + 7
  })
  assert.equal(recovered.profile.id, 'rate_limit_bht')
})

test('shared-network rate limiting blocks distributed attempts across many device IDs', async () => {
  await enableDormantEndpoint()
  const sourceAddress = '192.0.2.200'
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await assert.rejects(
      () => begin({
        pin: '000000',
        deviceId: `network_device_${String(attempt).padStart(4, '0')}`,
        operationId: `network_operation_${String(attempt).padStart(4, '0')}`,
        nowMs: baseNowMs + attempt,
        sourceAddress
      }),
      error => error.code === 'permission-denied'
    )
  }
  await assert.rejects(
    () => begin({
      pin: '000000',
      deviceId: 'network_device_blocked_0100',
      operationId: 'network_operation_blocked_0100',
      nowMs: baseNowMs + 100,
      sourceAddress
    }),
    error => error.code === 'resource-exhausted'
  )
})

test('one profile keeps one stable Firebase UID while separate devices receive independent absolute 84-hour sessions', async () => {
  await enableDormantEndpoint()
  await seedLoginProfile('multi_device_bht', '492815')
  const first = await begin({ pin: '492815', deviceId: 'multi_device_alpha', operationId: 'multi_operation_alpha', nowMs: baseNowMs })
  const second = await begin({ pin: '492815', deviceId: 'multi_device_bravo', operationId: 'multi_operation_bravo', nowMs: baseNowMs + 5000 })
  const firstToken = decodeJwtPayload(first.customToken)
  const secondToken = decodeJwtPayload(second.customToken)

  assert.equal(firstToken.uid, secondToken.uid)
  assert.notEqual(first.session.id, second.session.id)
  assert.equal(first.session.expiresAtMs - first.session.issuedAtMs, SESSION_ABSOLUTE_MAX_MS)
  assert.equal(second.session.expiresAtMs - second.session.issuedAtMs, SESSION_ABSOLUTE_MAX_MS)
  assert.equal((await db.collection('staffSessions').get()).size, 2)
  assert.equal((await auth.listUsers()).users.length, 1)
})

test('login claims include active temporary and issue access and the session stops at the earliest grant expiry', async () => {
  await enableDormantEndpoint()
  await seedLoginProfile('scoped_login_bht', '593817')
  const grantExpiryMs = baseNowMs + (60 * 60 * 1000)
  await db.doc('accessGrants/scoped_login_grant').set({
    userId: 'scoped_login_bht', locationId: 'RES', revoked: false,
    startsAt: Timestamp.fromMillis(baseNowMs - 1000), expiresAt: Timestamp.fromMillis(grantExpiryMs), version: 1
  })
  await db.doc('issueAccess/scoped_login_bht').set({ userId: 'scoped_login_bht', locationIds: ['res'], active: true, version: 1 })

  const result = await begin({ pin: '593817', deviceId: 'scoped_login_device_01', operationId: 'scoped_login_operation_01' })
  const claims = decodeJwtPayload(result.customToken).claims
  assert.equal(result.profile.authorizedLocations.includes('RES'), true)
  assert.equal(result.profile.issueLocationIds.includes('res'), true)
  assert.equal(claims.authorizedLocations.includes('RES'), true)
  assert.equal(claims.issueLocationIds.includes('res'), true)
  assert.equal(result.session.scopeExpiresAtMs, grantExpiryMs)
  assert.equal(result.session.expiresAtMs - result.session.issuedAtMs, SESSION_ABSOLUTE_MAX_MS)
  const stored = (await db.doc(`staffSessions/${result.session.id}`).get()).data()
  assert.equal(sessionRecordIsCurrent(result.session.id, stored, {
    nowMs: grantExpiryMs,
    authUid: decodeJwtPayload(result.customToken).uid,
    profileId: 'scoped_login_bht',
    currentSecurityVersion: 1
  }).reason, 'authorization_scope_expiry')
})

test('replaying the same login operation is idempotent and never extends absolute expiry', async () => {
  await enableDormantEndpoint()
  await seedLoginProfile('replay_bht', '615827')
  const first = await begin({ pin: '615827', deviceId: 'replay_device_0001', operationId: 'replay_operation_0001', nowMs: baseNowMs })
  const replay = await begin({ pin: '615827', deviceId: 'replay_device_0001', operationId: 'replay_operation_0001', nowMs: baseNowMs + 60000 })
  assert.equal(replay.replayed, true)
  assert.equal(replay.session.id, first.session.id)
  assert.equal(replay.session.issuedAtMs, first.session.issuedAtMs)
  assert.equal(replay.session.expiresAtMs, first.session.expiresAtMs)
  assert.equal((await db.collection('staffSessions').get()).size, 1)
  assert.equal((await db.collection('securityLoginAudit').get()).size, 1)
})

test('two devices racing the first login converge on one stable Firebase identity', async () => {
  await enableDormantEndpoint()
  await seedLoginProfile('concurrent_login_bht', '583106')
  const [first, second] = await Promise.all([
    begin({ pin: '583106', deviceId: 'concurrent_device_0001', operationId: 'concurrent_operation_0001' }),
    begin({ pin: '583106', deviceId: 'concurrent_device_0002', operationId: 'concurrent_operation_0002' })
  ])
  assert.equal(decodeJwtPayload(first.customToken).uid, decodeJwtPayload(second.customToken).uid)
  assert.notEqual(first.session.id, second.session.id)
  assert.equal((await db.collection('staffSessions').where('profileId', '==', 'concurrent_login_bht').get()).size, 2)
  assert.equal((await auth.listUsers(100)).users.length, 1)
})

test('security-version changes invalidate sessions and revoked operation IDs cannot be replayed', async () => {
  await enableDormantEndpoint()
  await seedLoginProfile('revoked_bht', '728394', { securityVersion: 3 })
  const first = await begin({ pin: '728394', deviceId: 'revoked_device_01', operationId: 'revoked_operation_01', nowMs: baseNowMs })
  const sessionRef = db.doc(`staffSessions/${first.session.id}`)
  const stored = (await sessionRef.get()).data()
  assert.equal(sessionRecordIsCurrent(first.session.id, stored, {
    nowMs: baseNowMs + 1,
    authUid: decodeJwtPayload(first.customToken).uid,
    profileId: 'revoked_bht',
    currentSecurityVersion: 4
  }).reason, 'stale_security_version')

  await db.doc('users/revoked_bht').update({ securityVersion: 4 })
  await sessionRef.update({ active: false, revokedAt: Timestamp.fromMillis(baseNowMs + 2), revocationReason: 'pin_changed' })
  await assert.rejects(
    () => begin({ pin: '728394', deviceId: 'revoked_device_01', operationId: 'revoked_operation_01', nowMs: baseNowMs + 3 }),
    error => error.code === 'failed-precondition'
  )
  const replacement = await begin({ pin: '728394', deviceId: 'revoked_device_01', operationId: 'revoked_operation_02', nowMs: baseNowMs + 4 })
  assert.equal(replacement.session.securityVersion, 4)
  assert.equal(replacement.session.issuedAtMs, baseNowMs + 4)
})

test('Auth provisioning failure preserves the server credential but creates no mapping, identity, or session', async () => {
  await enableDormantEndpoint()
  await seedLoginProfile('auth_failure_bht', '839405')
  const failingAuth = {
    getUser: async () => {
      const error = new Error('Synthetic missing user')
      error.code = 'auth/user-not-found'
      throw error
    },
    createUser: async () => {
      const error = new Error('Synthetic Auth provisioning failure')
      error.code = 'auth/internal-error'
      throw error
    },
    createCustomToken: (...args) => auth.createCustomToken(...args)
  }
  await assert.rejects(() => begin({ pin: '839405', authAdapter: failingAuth }), /provisioning failure/i)
  assert.equal((await db.doc('staffPinCredentials/auth_failure_bht').get()).exists, true)
  assert.equal(await verifyServerPinCredential(
    '839405',
    secret,
    (await db.doc('staffPinCredentials/auth_failure_bht').get()).data()
  ), true)
  assert.equal((await db.doc('staffAuthIdentities/auth_failure_bht').get()).exists, false)
  assert.equal((await db.collection('staffSessions').get()).size, 0)
  assert.equal((await db.collection('usersByAuthUid').get()).size, 0)
  assert.equal((await db.doc('users/auth_failure_bht').get()).data().authUid, undefined)
})

test('custom-token failure leaves one recoverable session and retry reuses it without extending expiry', async () => {
  await enableDormantEndpoint()
  await seedLoginProfile('token_failure_bht', '941627')
  let shouldFail = true
  const recoverableAuth = {
    getUser: (...args) => auth.getUser(...args),
    createUser: (...args) => auth.createUser(...args),
    createCustomToken: (...args) => {
      if (shouldFail) {
        shouldFail = false
        const error = new Error('Synthetic token signing failure')
        error.code = 'auth/token-signing-failed'
        throw error
      }
      return auth.createCustomToken(...args)
    }
  }
  await assert.rejects(
    () => begin({ pin: '941627', authAdapter: recoverableAuth }),
    error => error instanceof StaffPinLoginError && error.code === 'internal'
  )
  const sessionAfterFailure = (await db.collection('staffSessions').get()).docs[0].data()
  const recovered = await begin({ pin: '941627', authAdapter: recoverableAuth, nowMs: baseNowMs + 5000 })
  assert.equal(recovered.replayed, true)
  assert.equal(recovered.session.issuedAtMs, sessionAfterFailure.issuedAt.toMillis())
  assert.equal((await db.collection('staffSessions').get()).size, 1)
  const audit = (await db.collection('securityLoginAudit').get()).docs[0].data()
  assert.equal(Boolean(audit.tokenIssueFailedAt), true)
  assert.equal(Boolean(audit.tokenIssuedAt), true)
})
