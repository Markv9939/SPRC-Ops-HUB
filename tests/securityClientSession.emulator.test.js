import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import process from 'node:process'
import test from 'node:test'
import { cert, deleteApp as deleteAdminApp, initializeApp as initializeAdminApp } from 'firebase-admin/app'
import { getAuth as getAdminAuth } from 'firebase-admin/auth'
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore'
import { deleteApp, initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, signInWithCustomToken, signOut } from 'firebase/auth'
import { connectFirestoreEmulator, doc, getDoc, getFirestore, onSnapshot } from 'firebase/firestore'
import {
  SECURITY_SESSION_MAX_MS,
  evaluateLiveSecurityProfile,
  profileAuthorizationSignature,
  validateStoredSecuritySession
} from '../src/services/securityClientSessionModel.js'

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Run the Phase 3 client session contract through the Firestore and Auth emulators.')
}

const projectId = process.env.GCLOUD_PROJECT || 'demo-sprc-security-foundation'
const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' }
})
const adminApp = initializeAdminApp({
  projectId,
  credential: cert({
    projectId,
    clientEmail: `phase3-client-tests@${projectId}.iam.gserviceaccount.com`,
    privateKey
  })
}, 'phase3-client-contract-admin')
const adminDb = getAdminFirestore(adminApp)
const adminAuth = getAdminAuth(adminApp)
const clientApps = []

function profile(overrides = {}) {
  return {
    name: 'Phase 3 Client BHT',
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
    securityVersion: 3,
    version: 1,
    ...overrides
  }
}

async function clearEmulators() {
  for (const collection of await adminDb.listCollections()) {
    const snapshot = await collection.get()
    const batch = adminDb.batch()
    snapshot.docs.forEach(item => batch.delete(item.ref))
    if (!snapshot.empty) await batch.commit()
  }
  const users = await adminAuth.listUsers(1000)
  if (users.users.length) await adminAuth.deleteUsers(users.users.map(user => user.uid))
}

function client(name) {
  const app = initializeApp({ projectId, apiKey: 'demo-api-key', authDomain: `${projectId}.firebaseapp.com` }, name)
  clientApps.push(app)
  const auth = getAuth(app)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  const db = getFirestore(app)
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  return { auth, db }
}

async function issueToken({ uid, profileId, sessionId, securityVersion = 3 }) {
  try {
    await adminAuth.getUser(uid)
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error
    await adminAuth.createUser({ uid })
  }
  await adminDb.doc(`staffSessions/${sessionId}`).set({
    active: true,
    authUid: uid,
    profileId,
    securityVersion,
    expiresAt: new Date(Date.now() + 60_000)
  })
  return adminAuth.createCustomToken(uid, {
    profileId,
    sessionId,
    securityVersion,
    sessionVersion: 2,
    role: 'bht',
    authorizedLocations: ['OTC'],
    issueLocationIds: ['test_house'],
    locationId: 'test_house',
    workflowSecurityVersion: 6,
    secureWorkflows: ['identity_users']
  })
}

async function seedMappedProfile(profileId, uid, data = profile()) {
  await adminDb.doc('appSettings/authPolicy').set({ authScopeEnforced: true })
  await adminDb.doc(`users/${profileId}`).set(data)
  await adminDb.doc(`usersByAuthUid/${uid}`).set({ userId: profileId, version: 2 })
}

test.beforeEach(clearEmulators)
test.after(async () => {
  await clearEmulators()
  await Promise.all(clientApps.map(app => deleteApp(app)))
  await deleteAdminApp(adminApp)
})

test('two devices establish the same stable Firebase identity and one-device logout leaves the other active', async () => {
  const uid = 'staff_phase3_stable_uid'
  const profileId = 'phase3_client_bht'
  await seedMappedProfile(profileId, uid)
  const deviceA = client('phase3-device-a')
  const deviceB = client('phase3-device-b')
  const tokenA = await issueToken({ uid, profileId, sessionId: 'session_phase3_device_a' })
  const tokenB = await issueToken({ uid, profileId, sessionId: 'session_phase3_device_b' })
  await signInWithCustomToken(deviceA.auth, tokenA)
  await signInWithCustomToken(deviceB.auth, tokenB)

  assert.equal(deviceA.auth.currentUser.uid, uid)
  assert.equal(deviceB.auth.currentUser.uid, uid)
  assert.equal((await getDoc(doc(deviceA.db, 'users', profileId))).data().locationId, 'test_house')
  assert.equal((await getDoc(doc(deviceB.db, 'users', profileId))).data().shiftId, 'shift_1')

  await signOut(deviceA.auth)
  assert.equal(deviceA.auth.currentUser, null)
  assert.equal(deviceB.auth.currentUser.uid, uid)
})

test('custom-token claims match the persistent client session without exposing credentials', async () => {
  const uid = 'staff_phase3_claim_uid'
  const profileId = 'phase3_claim_bht'
  const sessionId = 'session_phase3_claim_01'
  await seedMappedProfile(profileId, uid)
  const device = client('phase3-claims-device')
  await signInWithCustomToken(device.auth, await issueToken({ uid, profileId, sessionId }))
  const claims = (await device.auth.currentUser.getIdTokenResult()).claims
  const nowMs = Date.UTC(2026, 7, 25, 18)
  const session = {
    schemaVersion: 3,
    serverSessionVersion: 2,
    sessionId,
    profileId,
    authUid: uid,
    deviceId: 'device_phase3_claim_01',
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + SECURITY_SESSION_MAX_MS,
    securityVersion: 3
  }
  assert.equal(validateStoredSecuritySession(session, { nowMs, authUid: uid, claims }).valid, true)
  const decoded = JSON.parse(Buffer.from((await issueToken({ uid, profileId, sessionId })).split('.')[1], 'base64url').toString('utf8'))
  const serialized = JSON.stringify(decoded).toLowerCase()
  assert.equal(serialized.includes('pinhash'), false)
  assert.equal(serialized.includes('salt'), false)
  assert.equal(serialized.includes('lookupkey'), false)
})

test('a live security-version change is observed and invalidates all device session contracts', async () => {
  const uid = 'staff_phase3_revoked_uid'
  const profileId = 'phase3_revoked_bht'
  await seedMappedProfile(profileId, uid)
  const device = client('phase3-revocation-device')
  await signInWithCustomToken(device.auth, await issueToken({ uid, profileId, sessionId: 'session_phase3_revoked_01' }))
  const initialSnapshot = await getDoc(doc(device.db, 'users', profileId))
  const initialProfile = { id: initialSnapshot.id, ...initialSnapshot.data() }
  const session = {
    profileId,
    securityVersion: 3,
    authorizationSignature: profileAuthorizationSignature({ id: profileId, ...initialProfile })
  }
  assert.equal(evaluateLiveSecurityProfile(initialProfile, session).valid, true)

  const changed = new Promise((resolve, reject) => {
    let seenInitial = false
    const stop = onSnapshot(doc(device.db, 'users', profileId), snapshot => {
      const current = { id: snapshot.id, ...snapshot.data() }
      if (!seenInitial) {
        seenInitial = true
        return
      }
      stop()
      resolve(evaluateLiveSecurityProfile(current, session))
    }, reject)
  })
  await adminDb.doc(`users/${profileId}`).update({
    securityVersion: 4,
    authorizedLocations: ['OTC'],
    issueLocationIds: []
  })
  const result = await changed
  assert.equal(result.valid, false)
  assert.equal(result.reason, 'security_version_changed')
})
