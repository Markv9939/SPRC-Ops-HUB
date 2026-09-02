import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import process from 'node:process'
import test from 'node:test'
import { cert, deleteApp, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { Timestamp, getFirestore } from 'firebase-admin/firestore'
import { containsCredentialMaterial, createServerPinCredential, verifyServerPinCredential } from '../src/staffPinCredentialModel.js'
import { StaffAccountSecurityError, performDormantStaffSecurityAction } from '../src/staffAccountSecurityService.js'
import { authorizeDormantOfflineReplay } from '../src/offlineReplaySecurityService.js'
import { createProtectedTransport } from '../src/transportSecurityService.js'
import { performDormantAccessScopeAction } from '../src/accessScopeSecurityService.js'

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Run this Phase 4 contract through the Firestore and Auth emulators.')
}

const projectId = process.env.GCLOUD_PROJECT || 'demo-sprc-security-foundation'
const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' }
})
const app = initializeApp({
  projectId,
  credential: cert({ projectId, clientEmail: `phase4-tests@${projectId}.iam.gserviceaccount.com`, privateKey })
}, 'phase4-security-contract')
const db = getFirestore(app)
const auth = getAuth(app)
const secret = 'phase-4-emulator-only-secret-with-more-than-thirty-two-characters'
const nowMs = Date.UTC(2026, 7, 26, 12)

function supervisor(overrides = {}) {
  return {
    name: 'OTC Supervisor', role: 'supervisor', active: true, deleted: false,
    site: 'OTC', location: 'OTC', authorizedLocations: ['OTC'], issueLocationIds: ['mesquite', 'lone_mountain'],
    securityVersion: 1, version: 1, ...overrides
  }
}

function admin(overrides = {}) {
  return {
    name: 'Admin User', role: 'admin', active: true, deleted: false,
    site: 'GLOBAL', location: 'GLOBAL', authorizedLocations: [], issueLocationIds: ['mesquite', 'lone_mountain', 'res'],
    securityVersion: 1, version: 1, ...overrides
  }
}

function bht(pin = '481593', overrides = {}) {
  return {
    name: 'Mesquite BHT', role: 'bht', active: true, deleted: false,
    site: 'OTC', location: 'OTC', house: 'MESQUITE', locationId: 'mesquite',
    authorizedLocations: ['OTC'], issueLocationIds: ['mesquite'], shiftId: 'shift_1', vanId: 'van_1', vanIds: ['van_1'],
    _testPin: pin, securityVersion: 1, version: 1, ...overrides
  }
}

async function clearEmulators() {
  for (const collection of await db.listCollections()) {
    const snapshot = await collection.get()
    const batch = db.batch()
    snapshot.docs.forEach(item => batch.delete(item.ref))
    if (!snapshot.empty) await batch.commit()
  }
  const users = await auth.listUsers(1000)
  if (users.users.length) await auth.deleteUsers(users.users.map(user => user.uid))
}

async function enablePhase4() {
  await db.doc('appSettings/securityFoundation').set({
    schemaVersion: 2,
    serverPinLoginEnabled: true,
    protectedAccountActionsVersion: 4,
    protectedAccountActionsEnabled: true,
    offlineReplayVersion: 5,
    offlineReplayEnabled: true,
    rolloutState: 'emulator_only'
  })
}

async function seedActor(profileId, profile, sessionId = `session_${profileId}_device_0001`) {
  const authUid = `auth_${profileId}`
  const { _testPin, ...storedProfile } = profile
  await auth.createUser({ uid: authUid })
  await db.doc(`users/${profileId}`).set({ ...storedProfile, authUid })
  if (_testPin) {
    await db.doc(`staffPinCredentials/${profileId}`).set({
      ...(await createServerPinCredential(_testPin, secret, { salt: `salt-${profileId}` })),
      active: true
    })
  }
  await db.doc(`usersByAuthUid/${authUid}`).set({ userId: profileId, version: 2 })
  await db.doc(`staffAuthIdentities/${profileId}`).set({ profileId, authUid, schemaVersion: 2 })
  await db.doc(`staffSessions/${sessionId}`).set({
    schemaVersion: 2, profileId, authUid, securityVersion: Number(profile.securityVersion || 1),
    issuedAt: Timestamp.fromMillis(nowMs - 1000), expiresAt: Timestamp.fromMillis(nowMs + 60 * 60 * 1000),
    revokedAt: null, active: true
  })
  return {
    authUid,
    sessionId,
    requestAuth: { uid: authUid, token: { profileId, sessionId, securityVersion: Number(profile.securityVersion || 1) } }
  }
}

async function seedTarget(profileId, profile, sessionCount = 0) {
  const authUid = `auth_${profileId}`
  const { _testPin, ...storedProfile } = profile
  await auth.createUser({ uid: authUid })
  await db.doc(`users/${profileId}`).set({ ...storedProfile, authUid })
  if (_testPin) {
    await db.doc(`staffPinCredentials/${profileId}`).set({
      ...(await createServerPinCredential(_testPin, secret, { salt: `salt-${profileId}` })),
      active: true
    })
  }
  await db.doc(`staffAuthIdentities/${profileId}`).set({ profileId, authUid, schemaVersion: 2 })
  for (let index = 0; index < sessionCount; index += 1) {
    await db.doc(`staffSessions/session_${profileId}_device_000${index}`).set({
      schemaVersion: 2, profileId, authUid, securityVersion: Number(profile.securityVersion || 1),
      issuedAt: Timestamp.fromMillis(nowMs - 1000), expiresAt: Timestamp.fromMillis(nowMs + 60 * 60 * 1000),
      revokedAt: null, active: true
    })
  }
  return { authUid }
}

function action(requestAuth, requestData, authAdapter = auth, time = nowMs) {
  return performDormantStaffSecurityAction({ db, auth: authAdapter, secret, requestAuth, requestData, nowMs: time })
}

function scopeAction(requestAuth, requestData, authAdapter = auth, time = nowMs) {
  return performDormantAccessScopeAction({ db, auth: authAdapter, secret, requestAuth, requestData, nowMs: time })
}

test.beforeEach(clearEmulators)
test.after(async () => {
  await clearEmulators()
  await deleteApp(app)
})

test('protected actions fail closed while the Phase 4 boundary is disabled', async () => {
  const actor = await seedActor('disabled_admin', admin())
  await assert.rejects(() => action(actor.requestAuth, {
    action: 'end_all_sessions', targetProfileId: 'disabled_admin', operationId: 'disabled_operation_0001'
  }), error => error instanceof StaffAccountSecurityError && error.code === 'failed-precondition')
  assert.equal((await db.collection('securityAccountAudit').get()).size, 0)
})

test('administrators and in-location supervisors can securely create valid BHT profiles', async () => {
  await enablePhase4()
  const adminActor = await seedActor('create_admin', admin())
  const profilePatch = {
    name: 'New Mesquite BHT', role: 'bht', active: true,
    site: 'OTC', location: 'OTC', house: 'MESQUITE', locationId: 'mesquite',
    authorizedLocations: ['OTC'], issueLocationIds: ['mesquite'],
    shiftId: 'shift_1', vanId: 'van_1', vanIds: ['van_1']
  }
  const request = {
    action: 'create_profile', targetProfileId: 'new_mesquite_bht', profilePatch,
    newPin: '751936', operationId: 'create_profile_operation_01'
  }
  const created = await action(adminActor.requestAuth, request)
  const replay = await action(adminActor.requestAuth, request, auth, nowMs + 1)
  assert.equal(created.profile.id, 'new_mesquite_bht')
  assert.equal(created.profile.role, 'bht')
  assert.equal(replay.replayed, true)
  assert.equal((await db.doc('users/new_mesquite_bht').get()).data().securityVersion, 1)
  assert.equal(await verifyServerPinCredential('751936', secret, (await db.doc('staffPinCredentials/new_mesquite_bht').get()).data()), true)
  assert.equal((await db.doc('shiftAssignments/asg_new_mesquite_bht').get()).data().active, true)
  const audit = (await db.collection('securityAccountAudit').get()).docs[0].data()
  assert.equal(containsCredentialMaterial(audit), false)

  const supervisorActor = await seedActor('create_supervisor', supervisor())
  const supervisorCreated = await action(supervisorActor.requestAuth, {
    ...request,
    targetProfileId: 'supervisor_created_bht',
    newPin: '529374',
    operationId: 'supervisor_create_allow_01'
  })
  assert.equal(supervisorCreated.profile.id, 'supervisor_created_bht')
  assert.equal(supervisorCreated.profile.locationId, 'mesquite')
  assert.equal((await db.doc('users/supervisor_created_bht').get()).exists, true)
})

test('supervisors cannot create elevated or out-of-location profiles', async () => {
  await enablePhase4()
  const supervisorActor = await seedActor('restricted_create_supervisor', supervisor())
  const validBht = {
    name: 'Scoped BHT', role: 'bht', active: true,
    site: 'OTC', location: 'OTC', house: 'MESQUITE', locationId: 'mesquite',
    authorizedLocations: ['OTC'], issueLocationIds: ['mesquite'],
    shiftId: 'shift_1', vanId: 'van_1', vanIds: ['van_1']
  }

  await assert.rejects(() => action(supervisorActor.requestAuth, {
    action: 'create_profile', targetProfileId: 'supervisor_created_admin',
    profilePatch: { ...validBht, role: 'admin', site: 'GLOBAL', location: 'GLOBAL', house: null, locationId: null, authorizedLocations: [], issueLocationIds: [], shiftId: null, vanId: null, vanIds: [] },
    newPin: '682491', operationId: 'supervisor_create_admin_deny_01'
  }), error => error.code === 'permission-denied')

  await assert.rejects(() => action(supervisorActor.requestAuth, {
    action: 'create_profile', targetProfileId: 'supervisor_created_res_bht',
    profilePatch: { ...validBht, site: 'RES', location: 'RES', house: null, locationId: 'res', authorizedLocations: ['RES'], issueLocationIds: ['res'], shiftId: 'res_shift_1_day', vanId: 'van_3', vanIds: ['van_3'] },
    newPin: '496281', operationId: 'supervisor_create_res_deny_01'
  }), error => error.code === 'permission-denied')

  assert.equal((await db.doc('users/supervisor_created_admin').get()).exists, false)
  assert.equal((await db.doc('users/supervisor_created_res_bht').get()).exists, false)
})

test('an in-location supervisor reset updates server and rollback credentials and revokes every target device', async () => {
  await enablePhase4()
  const actor = await seedActor('otc_supervisor', supervisor())
  const target = await seedTarget('mesquite_bht', bht(), 2)
  let revokeCalls = 0
  const authAdapter = {
    revokeRefreshTokens: async uid => { revokeCalls += 1; assert.equal(uid, target.authUid) }
  }
  const result = await action(actor.requestAuth, {
    action: 'reset_pin', targetProfileId: 'mesquite_bht', newPin: '739251', expectedVersion: 1,
    operationId: 'supervisor_reset_0001', reason: 'Reset requested 481593'
  }, authAdapter)

  assert.equal(result.allDevicesRevoked, true)
  assert.equal(result.cleanupStatus, 'completed')
  assert.equal(revokeCalls, 1)
  const profile = (await db.doc('users/mesquite_bht').get()).data()
  assert.equal(profile.securityVersion, 2)
  assert.equal('pinHash' in profile, false)
  assert.equal(await verifyServerPinCredential('739251', secret, (await db.doc('staffPinCredentials/mesquite_bht').get()).data()), true)
  const sessions = await db.collection('staffSessions').where('profileId', '==', 'mesquite_bht').get()
  assert.equal(sessions.docs.every(snapshot => snapshot.data().active === false), true)
  const audit = (await db.collection('securityAccountAudit').get()).docs[0].data()
  assert.equal(audit.reason.includes('481593'), false)
  assert.equal(containsCredentialMaterial(audit), false)
})

test('ordinary logout closes one chosen device without changing securityVersion or another device', async () => {
  await enablePhase4()
  const actor = await seedActor('logout_bht', bht('527194'), 'session_logout_device_0001')
  await db.doc('staffSessions/session_logout_device_0002').set({
    profileId: 'logout_bht', authUid: actor.authUid, securityVersion: 1,
    issuedAt: Timestamp.fromMillis(nowMs - 1000), expiresAt: Timestamp.fromMillis(nowMs + 100000), active: true
  })
  let revokeCalls = 0
  const authAdapter = { revokeRefreshTokens: async () => { revokeCalls += 1 } }
  const request = {
    action: 'close_device_session', targetProfileId: 'logout_bht', sessionId: actor.sessionId,
    operationId: 'ordinary_logout_0001'
  }
  const first = await action(actor.requestAuth, request, authAdapter)
  const replay = await action(actor.requestAuth, request, authAdapter, nowMs + 50)
  assert.equal(first.allDevicesRevoked, false)
  assert.equal(replay.replayed, true)
  assert.equal(revokeCalls, 0)
  assert.equal((await db.doc(`staffSessions/${actor.sessionId}`).get()).data().active, false)
  assert.equal((await db.doc('staffSessions/session_logout_device_0002').get()).data().active, true)
  assert.equal((await db.doc('users/logout_bht').get()).data().securityVersion, 1)
})

test('admin backup-access changes are atomic, audited, idempotent, and revoke every target device', async () => {
  await enablePhase4()
  const actor = await seedActor('scope_admin', admin())
  await seedTarget('scope_bht', bht('527194'), 2)
  const grantRequest = {
    action: 'grant_backup_access', targetProfileId: 'scope_bht', locationId: 'RES',
    startsAt: new Date(nowMs - 1000).toISOString(), expiresAt: new Date(nowMs + 3600000).toISOString(),
    reason: 'Temporary coverage', operationId: 'scope_grant_operation_001'
  }
  const granted = await scopeAction(actor.requestAuth, grantRequest)
  const replay = await scopeAction(actor.requestAuth, grantRequest, auth, nowMs + 1)
  assert.equal(granted.allDevicesRevoked, true)
  assert.equal(replay.replayed, true)
  assert.equal((await db.doc('users/scope_bht').get()).data().securityVersion, 2)
  assert.equal((await db.doc(`accessGrants/${granted.grantId}`).get()).data().locationId, 'RES')
  assert.equal((await db.collection('staffSessions').where('profileId', '==', 'scope_bht').get()).docs.every(item => item.data().active === false), true)

  await db.doc('staffSessions/session_scope_bht_fresh').set({
    schemaVersion: 2, profileId: 'scope_bht', authUid: 'auth_scope_bht', securityVersion: 2,
    issuedAt: Timestamp.fromMillis(nowMs), expiresAt: Timestamp.fromMillis(nowMs + 3600000), active: true, revokedAt: null
  })
  const revoked = await scopeAction(actor.requestAuth, {
    action: 'revoke_backup_access', grantId: granted.grantId,
    reason: 'Coverage ended', operationId: 'scope_revoke_operation_01'
  }, auth, nowMs + 2)
  assert.equal(revoked.securityVersion, 3)
  assert.equal((await db.doc(`accessGrants/${granted.grantId}`).get()).data().revoked, true)
  assert.equal((await db.doc('staffSessions/session_scope_bht_fresh').get()).data().active, false)
  assert.equal((await db.collection('securityAccountAudit').get()).size, 2)
})

test('supervisors cannot change backup or issue access and admin issue-access changes revoke all devices', async () => {
  await enablePhase4()
  const supervisorActor = await seedActor('scope_supervisor_denied', supervisor())
  await seedTarget('scope_issue_bht', bht('638295'), 1)
  const request = {
    action: 'save_issue_access', targetProfileId: 'scope_issue_bht', locationIds: ['res'], active: true,
    reason: 'Issue coverage', operationId: 'scope_issue_operation_001'
  }
  await assert.rejects(() => scopeAction(supervisorActor.requestAuth, request), error => error.code === 'permission-denied')
  assert.equal((await db.doc('issueAccess/scope_issue_bht').get()).exists, false)

  const adminActor = await seedActor('scope_issue_admin', admin())
  const result = await scopeAction(adminActor.requestAuth, { ...request, operationId: 'scope_issue_operation_002' })
  assert.equal(result.securityVersion, 2)
  assert.deepEqual((await db.doc('issueAccess/scope_issue_bht').get()).data().locationIds, ['res'])
  assert.equal((await db.doc('staffSessions/session_scope_issue_bht_device_0000').get()).data().active, false)
})

test('supervisor authority denies supervisor/admin targets, out-of-location BHTs, role elevation, and malformed BHTs', async () => {
  await enablePhase4()
  const actor = await seedActor('scope_supervisor', supervisor())
  await seedTarget('other_supervisor', supervisor())
  await seedTarget('res_bht', bht('632975', { site: 'RES', location: 'RES', house: null, locationId: 'res', authorizedLocations: ['RES'], issueLocationIds: ['res'] }))
  await seedTarget('malformed_bht', bht('864297', { house: null, locationId: null, issueLocationIds: [] }))
  const denied = [
    { action: 'reset_pin', targetProfileId: 'other_supervisor', newPin: '384619', operationId: 'deny_supervisor_0001' },
    { action: 'end_all_sessions', targetProfileId: 'res_bht', operationId: 'deny_location_000001' },
    { action: 'save_profile', targetProfileId: 'res_bht', profilePatch: { role: 'supervisor' }, operationId: 'deny_elevation_00001' },
    { action: 'reset_pin', targetProfileId: 'malformed_bht', newPin: '294681', operationId: 'deny_malformed_000001' }
  ]
  for (const request of denied) {
    await assert.rejects(() => action(actor.requestAuth, request), error => ['permission-denied', 'failed-precondition'].includes(error.code))
  }
  assert.equal((await db.collection('securityAccountAudit').get()).size, 0)
})

test('self PIN change requires the current PIN and revokes the staff member on every device', async () => {
  await enablePhase4()
  const actor = await seedActor('self_bht', bht('517294'), 'session_self_device_0001')
  await db.doc('staffSessions/session_self_device_0002').set({
    profileId: 'self_bht', authUid: actor.authUid, securityVersion: 1,
    issuedAt: Timestamp.fromMillis(nowMs - 1000), expiresAt: Timestamp.fromMillis(nowMs + 100000), active: true
  })
  await assert.rejects(() => action(actor.requestAuth, {
    action: 'self_change_pin', currentPin: '000000', newPin: '418639', operationId: 'self_pin_wrong_000001'
  }), error => error.code === 'permission-denied')
  const result = await action(actor.requestAuth, {
    action: 'self_change_pin', currentPin: '517294', newPin: '418639', operationId: 'self_pin_change_00001'
  })
  assert.equal(result.allDevicesRevoked, true)
  assert.equal((await db.doc('users/self_bht').get()).data().securityVersion, 2)
  const sessions = await db.collection('staffSessions').where('profileId', '==', 'self_bht').get()
  assert.equal(sessions.docs.every(snapshot => snapshot.data().active === false), true)
})

test('deactivation, location removal, role reduction, reactivation, and end-all actions increment securityVersion', async () => {
  await enablePhase4()
  const actor = await seedActor('phase4_admin', admin())
  await seedTarget('mutation_bht', bht('452861'))
  let documentVersion = 1
  const steps = [
    { action: 'save_profile', profilePatch: { active: false }, operationId: 'deactivate_action_0001' },
    { action: 'save_profile', profilePatch: { active: true }, operationId: 'reactivate_action_0001' },
    { action: 'save_profile', profilePatch: { site: 'RES', location: 'RES', house: null, locationId: 'res', authorizedLocations: ['RES'], issueLocationIds: ['res'] }, operationId: 'location_action_000001' },
    { action: 'save_profile', profilePatch: { role: 'supervisor', house: null, locationId: null, authorizedLocations: ['RES'], issueLocationIds: ['res'] }, operationId: 'elevate_action_000001' },
    { action: 'save_profile', profilePatch: { role: 'bht', house: null, locationId: 'res', authorizedLocations: ['RES'], issueLocationIds: ['res'] }, operationId: 'reduce_action_0000001' },
    { action: 'end_all_sessions', operationId: 'end_all_action_000001' }
  ]
  const expectedSecurityVersions = [2, 3, 4, 4, 5, 6]
  for (const [index, step] of steps.entries()) {
    const result = await action(actor.requestAuth, { ...step, targetProfileId: 'mutation_bht', expectedVersion: documentVersion })
    documentVersion += 1
    assert.equal(result.securityVersion, expectedSecurityVersions[index])
  }
  assert.equal((await db.doc('users/mutation_bht').get()).data().securityVersion, 6)
  assert.equal((await db.collection('securityAccountAudit').get()).size, 6)
})

test('partial Auth cleanup failure is recorded and an exact retry completes without a second profile mutation', async () => {
  await enablePhase4()
  const actor = await seedActor('retry_admin', admin())
  await seedTarget('retry_bht', bht('628419'), 1)
  const request = { action: 'end_all_sessions', targetProfileId: 'retry_bht', expectedVersion: 1, operationId: 'cleanup_retry_operation_01' }
  const failingAuth = { revokeRefreshTokens: async () => { const error = new Error('synthetic cleanup failure'); error.code = 'auth/internal-error'; throw error } }
  const first = await action(actor.requestAuth, request, failingAuth)
  assert.equal(first.cleanupStatus, 'failed')
  assert.equal((await db.doc('users/retry_bht').get()).data().securityVersion, 2)
  assert.equal((await db.collection('securityAccountAudit').get()).size, 1)
  const retry = await action(actor.requestAuth, request, { revokeRefreshTokens: async () => {} }, nowMs + 100)
  assert.equal(retry.replayed, true)
  assert.equal(retry.cleanupStatus, 'completed')
  assert.equal((await db.doc('users/retry_bht').get()).data().securityVersion, 2)
  assert.equal((await db.doc((await db.collection('securityCleanupJobs').get()).docs[0].ref.path).get()).data().attempts, 2)
})

test('inactive, deleted, stale-session, wrong-owner, and reused-operation requests fail closed', async () => {
  await enablePhase4()
  const actor = await seedActor('negative_admin', admin())
  await seedTarget('inactive_target', bht('715294', { active: false }))
  await seedTarget('deleted_target', bht('819364', { deleted: true }))
  await assert.rejects(() => action(actor.requestAuth, { action: 'reset_pin', targetProfileId: 'inactive_target', newPin: '294753', operationId: 'inactive_target_000001' }), error => error.code === 'failed-precondition')
  await assert.rejects(() => action(actor.requestAuth, { action: 'reset_pin', targetProfileId: 'deleted_target', newPin: '395274', operationId: 'deleted_target_0000001' }), error => error.code === 'not-found')

  await db.doc(`staffSessions/${actor.sessionId}`).update({ active: false, revokedAt: Timestamp.fromMillis(nowMs) })
  await assert.rejects(() => action(actor.requestAuth, { action: 'end_all_sessions', targetProfileId: 'inactive_target', operationId: 'stale_actor_000000001' }), error => error.code === 'permission-denied')

  await db.doc(`staffSessions/${actor.sessionId}`).update({ active: true, revokedAt: null })
  const goodRequest = { action: 'end_all_sessions', targetProfileId: 'negative_admin', operationId: 'fingerprint_operation_01' }
  await action(actor.requestAuth, goodRequest)
  await assert.rejects(() => action({ ...actor.requestAuth, uid: 'wrong_auth_uid' }, goodRequest), error => error.code === 'permission-denied')
  await assert.rejects(() => action(actor.requestAuth, { ...goodRequest, targetProfileId: 'inactive_target' }), error => error.code === 'already-exists')
})

test('mapped current sessions authorize original-owner offline replay idempotently without exposing payload data', async () => {
  await enablePhase4()
  const actor = await seedActor('offline_owner', bht('371925'))
  const requestData = {
    operationId: 'offline_authorize_00001', actionId: 'eoc-submit:task:owner', actionType: 'eocSubmission',
    ownerProfileId: 'offline_owner', ownerAuthUid: actor.authUid, locationId: 'mesquite', expectedVersion: 2
  }
  const first = await authorizeDormantOfflineReplay({ db, secret, requestAuth: actor.requestAuth, requestData, nowMs })
  const replay = await authorizeDormantOfflineReplay({ db, secret, requestAuth: actor.requestAuth, requestData, nowMs: nowMs + 1 })
  assert.equal(first.authorizationId, replay.authorizationId)
  assert.equal(first.profileId, 'offline_owner')
  assert.equal((await db.collection('securityOfflineReplayAudit').get()).size, 1)
  assert.equal(JSON.stringify((await db.collection('securityOfflineReplayAudit').get()).docs[0].data()).includes('client'), false)
})

test('offline replay rejects wrong owner, removed location scope, and stale device sessions', async () => {
  await enablePhase4()
  const actor = await seedActor('offline_negative', bht('582417'))
  const base = {
    operationId: 'offline_negative_00001', actionId: 'transport-close:one', actionType: 'transportClose',
    ownerProfileId: 'offline_negative', ownerAuthUid: actor.authUid, locationId: 'mesquite', expectedVersion: 1
  }
  await assert.rejects(() => authorizeDormantOfflineReplay({ db, secret, requestAuth: actor.requestAuth, requestData: { ...base, ownerProfileId: 'other_owner' }, nowMs }), error => error.code === 'permission-denied')
  await assert.rejects(() => authorizeDormantOfflineReplay({ db, secret, requestAuth: actor.requestAuth, requestData: { ...base, operationId: 'offline_location_00001', locationId: 'res' }, nowMs }), error => error.code === 'permission-denied')
  await db.doc(`staffSessions/${actor.sessionId}`).update({ active: false, revokedAt: Timestamp.fromMillis(nowMs) })
  await assert.rejects(() => authorizeDormantOfflineReplay({ db, secret, requestAuth: actor.requestAuth, requestData: { ...base, operationId: 'offline_stale_0000001' }, nowMs }), error => error.code === 'permission-denied')
})

test('two devices cannot race into two active transports for the same staff profile', async () => {
  await enablePhase4()
  await db.doc('appSettings/securityWorkflows').set({
    schemaVersion: 6,
    enabled: true,
    workflows: ['transports']
  })
  const first = await seedActor('transport_bht', bht('857241'), 'session_transport_device_0001')
  await db.doc('staffSessions/session_transport_device_0002').set({
    schemaVersion: 2,
    profileId: 'transport_bht',
    authUid: first.authUid,
    securityVersion: 1,
    issuedAt: Timestamp.fromMillis(nowMs - 1000),
    expiresAt: Timestamp.fromMillis(nowMs + 60 * 60 * 1000),
    revokedAt: null,
    active: true
  })
  const secondAuth = {
    uid: first.authUid,
    token: { profileId: 'transport_bht', sessionId: 'session_transport_device_0002', securityVersion: 1 }
  }
  const attempts = await Promise.allSettled([
    createProtectedTransport({
      db, secret, requestAuth: first.requestAuth,
      requestData: { site: 'OTC', operationId: 'transport_device_one_0001' }, nowMs
    }),
    createProtectedTransport({
      db, secret, requestAuth: secondAuth,
      requestData: { site: 'OTC', operationId: 'transport_device_two_0001' }, nowMs
    })
  ])
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(attempts.filter(result => result.status === 'rejected').length, 1)
  const active = await db.collection('transports').where('createdByUserId', '==', 'transport_bht').get()
  assert.equal(active.size, 1)
  assert.equal(active.docs[0].data().status, 'open')
  assert.equal((await db.collection('securityWorkflowAudit').get()).size, 1)
})
