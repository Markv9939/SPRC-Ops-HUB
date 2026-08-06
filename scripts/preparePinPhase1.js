/* global process */
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import admin from 'firebase-admin'

const PROJECT_ID = 'sprc-tx-l'
const CONFIRM_PHRASE = 'PREPARE_PIN_PHASE_1'
const TEST_USER_ID = 'tech_test_house'
const TEST_ASSIGNMENT_ID = `asg_${TEST_USER_ID}`
const TEST_PIN = '8064'
const RECEIVING_USER_ID = 'tech_test_house_shift_2'
const RECEIVING_ASSIGNMENT_ID = `asg_${RECEIVING_USER_ID}`
const RECEIVING_PIN = '8065'
const SUPERVISOR_USER_ID = 'test_supervisor'
const SUPERVISOR_PIN = '8066'
const ADMIN_USER_ID = 'phase1_test_admin'
const ADMIN_PIN = '8067'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function argumentValue(name) {
  const prefix = `--${name}=`
  const argument = process.argv.find(value => value.startsWith(prefix))
  return argument ? argument.slice(prefix.length) : ''
}

function initAdmin() {
  try {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: PROJECT_ID
    })
  } catch {
    const serviceAccount = JSON.parse(
      readFileSync(join(__dirname, '../serviceAccountKey.json'), 'utf8')
    )
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: PROJECT_ID
    })
  }
}

function hashPin(pin) {
  return createHash('sha256')
    .update(`sprc-pin-v1:${String(pin).trim()}`)
    .digest('hex')
}

function summarize(snapshot) {
  if (!snapshot.exists) return { exists: false }
  const data = snapshot.data() || {}
  return {
    exists: true,
    name: data.name || null,
    role: data.role || null,
    active: data.active === true,
    locationId: data.locationId || null,
    shiftId: data.shiftId || null,
    hasPinHash: typeof data.pinHash === 'string' && data.pinHash.length >= 32,
    version: Number(data.version || 0)
  }
}

async function main() {
  if (!admin.apps.length) initAdmin()

  const db = admin.firestore()
  const policyRef = db.doc('appSettings/authPolicy')
  const userRef = db.doc(`users/${TEST_USER_ID}`)
  const assignmentRef = db.doc(`shiftAssignments/${TEST_ASSIGNMENT_ID}`)
  const receivingUserRef = db.doc(`users/${RECEIVING_USER_ID}`)
  const receivingAssignmentRef = db.doc(`shiftAssignments/${RECEIVING_ASSIGNMENT_ID}`)
  const supervisorUserRef = db.doc(`users/${SUPERVISOR_USER_ID}`)
  const adminUserRef = db.doc(`users/${ADMIN_USER_ID}`)
  const pinHash = hashPin(TEST_PIN)
  const receivingPinHash = hashPin(RECEIVING_PIN)
  const supervisorPinHash = hashPin(SUPERVISOR_PIN)
  const adminPinHash = hashPin(ADMIN_PIN)
  const [
    policySnap,
    userSnap,
    assignmentSnap,
    pinMatchesSnap,
    receivingUserSnap,
    receivingAssignmentSnap,
    receivingPinMatchesSnap,
    supervisorUserSnap,
    supervisorPinMatchesSnap,
    adminUserSnap,
    adminPinMatchesSnap
  ] = await Promise.all([
    policyRef.get(),
    userRef.get(),
    assignmentRef.get(),
    db.collection('users').where('pinHash', '==', pinHash).where('active', '==', true).get(),
    receivingUserRef.get(),
    receivingAssignmentRef.get(),
    db.collection('users').where('pinHash', '==', receivingPinHash).where('active', '==', true).get(),
    supervisorUserRef.get(),
    db.collection('users').where('pinHash', '==', supervisorPinHash).where('active', '==', true).get(),
    adminUserRef.get(),
    db.collection('users').where('pinHash', '==', adminPinHash).where('active', '==', true).get()
  ])
  const conflictingUsers = pinMatchesSnap.docs
    .filter(snapshot => snapshot.id !== TEST_USER_ID)
    .map(snapshot => ({ id: snapshot.id, name: snapshot.data()?.name || null }))
  const receivingConflictingUsers = receivingPinMatchesSnap.docs
    .filter(snapshot => snapshot.id !== RECEIVING_USER_ID)
    .map(snapshot => ({ id: snapshot.id, name: snapshot.data()?.name || null }))
  const supervisorConflictingUsers = supervisorPinMatchesSnap.docs
    .filter(snapshot => snapshot.id !== SUPERVISOR_USER_ID)
    .map(snapshot => ({ id: snapshot.id, name: snapshot.data()?.name || null }))
  const adminConflictingUsers = adminPinMatchesSnap.docs
    .filter(snapshot => snapshot.id !== ADMIN_USER_ID)
    .map(snapshot => ({ id: snapshot.id, name: snapshot.data()?.name || null }))

  const policy = policySnap.exists ? policySnap.data() || {} : {}
  console.log(JSON.stringify({
    projectId: PROJECT_ID,
    mode: argumentValue('confirm') === CONFIRM_PHRASE ? 'confirmed write' : 'preview only',
    current: {
      authPolicy: {
        exists: policySnap.exists,
        authScopeEnforced: policy.authScopeEnforced === true
      },
      testUser: summarize(userSnap),
      testAssignment: summarize(assignmentSnap),
      receivingUser: summarize(receivingUserSnap),
      receivingAssignment: summarize(receivingAssignmentSnap),
      supervisorUser: summarize(supervisorUserSnap),
      adminUser: summarize(adminUserSnap)
    },
    proposed: {
      authScopeEnforced: false,
      testUserId: TEST_USER_ID,
      testUserPin: TEST_PIN,
      conflictingUsers,
      locationId: 'test_house',
      shiftId: 'shift_1',
      assignmentId: TEST_ASSIGNMENT_ID,
      receivingUserId: RECEIVING_USER_ID,
      receivingUserPin: RECEIVING_PIN,
      receivingConflictingUsers,
      receivingShiftId: 'shift_2',
      receivingAssignmentId: RECEIVING_ASSIGNMENT_ID,
      supervisorUserId: SUPERVISOR_USER_ID,
      supervisorPin: SUPERVISOR_PIN,
      supervisorConflictingUsers,
      adminUserId: ADMIN_USER_ID,
      adminPin: ADMIN_PIN,
      adminConflictingUsers
    }
  }, null, 2))

  const confirmed = argumentValue('confirm') === CONFIRM_PHRASE
  const confirmedProject = argumentValue('project')
  if (!confirmed) {
    console.log(`\nPreview complete. No writes performed. Confirm with --project=${PROJECT_ID} --confirm=${CONFIRM_PHRASE}`)
    return
  }
  if (confirmedProject !== PROJECT_ID) {
    throw new Error(`Refusing write: --project must exactly equal ${PROJECT_ID}.`)
  }
  if (conflictingUsers.length > 0) {
    throw new Error(`Refusing write: PIN ${TEST_PIN} is already assigned to another active user.`)
  }
  if (receivingConflictingUsers.length > 0) {
    throw new Error(`Refusing write: PIN ${RECEIVING_PIN} is already assigned to another active user.`)
  }
  if (supervisorConflictingUsers.length > 0) {
    throw new Error(`Refusing write: PIN ${SUPERVISOR_PIN} is already assigned to another active user.`)
  }
  if (adminConflictingUsers.length > 0) {
    throw new Error(`Refusing write: PIN ${ADMIN_PIN} is already assigned to another active user.`)
  }

  const now = admin.firestore.FieldValue.serverTimestamp()
  const batch = db.batch()
  batch.set(policyRef, {
    authScopeEnforced: false,
    updatedAt: now
  }, { merge: true })
  batch.set(userRef, {
    name: 'BHT Test House',
    role: 'bht',
    site: 'OTC',
    location: 'OTC',
    house: 'TEST_HOUSE',
    locationId: 'test_house',
    shiftId: 'shift_1',
    vanId: 'van_test',
    vanIds: ['van_test'],
    active: true,
    authorizedLocations: ['OTC', 'TEST_HOUSE'],
    issueLocationIds: ['test_house'],
    pinHash,
    pinVersion: 'v1_sha256',
    pinUpdatedAt: now,
    version: Number(userSnap.data()?.version || 0) + 1,
    createdAt: userSnap.data()?.createdAt || now,
    updatedAt: now
  }, { merge: true })
  batch.set(assignmentRef, {
    bhtUserId: TEST_USER_ID,
    bhtUserName: 'BHT Test House',
    locationId: 'test_house',
    shiftId: 'shift_1',
    vanId: 'van_test',
    vanIds: ['van_test'],
    source: 'user_profile',
    active: true,
    version: Number(assignmentSnap.data()?.version || 0) + 1,
    createdAt: assignmentSnap.data()?.createdAt || now,
    updatedAt: now
  }, { merge: true })
  batch.set(receivingUserRef, {
    name: 'BHT Test House Shift 2',
    role: 'bht',
    site: 'OTC',
    location: 'OTC',
    house: 'TEST_HOUSE',
    locationId: 'test_house',
    shiftId: 'shift_2',
    vanId: 'van_test',
    vanIds: ['van_test'],
    active: true,
    authorizedLocations: ['OTC', 'TEST_HOUSE'],
    issueLocationIds: ['test_house'],
    pinHash: receivingPinHash,
    pinVersion: 'v1_sha256',
    pinUpdatedAt: now,
    version: Number(receivingUserSnap.data()?.version || 0) + 1,
    createdAt: receivingUserSnap.data()?.createdAt || now,
    updatedAt: now
  }, { merge: true })
  batch.set(receivingAssignmentRef, {
    bhtUserId: RECEIVING_USER_ID,
    bhtUserName: 'BHT Test House Shift 2',
    locationId: 'test_house',
    shiftId: 'shift_2',
    vanId: 'van_test',
    vanIds: ['van_test'],
    source: 'user_profile',
    active: true,
    version: Number(receivingAssignmentSnap.data()?.version || 0) + 1,
    createdAt: receivingAssignmentSnap.data()?.createdAt || now,
    updatedAt: now
  }, { merge: true })
  batch.set(supervisorUserRef, {
    name: 'Phase 1 Test Supervisor',
    role: 'supervisor',
    site: 'OTC',
    location: 'OTC',
    locationId: null,
    shiftId: null,
    vanId: null,
    vanIds: [],
    active: true,
    authorizedLocations: ['OTC'],
    issueLocationIds: ['lone_mountain', 'mesquite', 'test_house'],
    pinHash: supervisorPinHash,
    pinVersion: 'v1_sha256',
    pinUpdatedAt: now,
    version: Number(supervisorUserSnap.data()?.version || 0) + 1,
    createdAt: supervisorUserSnap.data()?.createdAt || now,
    updatedAt: now
  }, { merge: true })
  batch.set(adminUserRef, {
    name: 'Phase 1 Test Admin',
    role: 'admin',
    site: 'GLOBAL',
    location: 'GLOBAL',
    locationId: null,
    shiftId: null,
    vanId: null,
    vanIds: [],
    active: true,
    authorizedLocations: [],
    issueLocationIds: ['lone_mountain', 'mesquite', 'test_house', 'res'],
    pinHash: adminPinHash,
    pinVersion: 'v1_sha256',
    pinUpdatedAt: now,
    version: Number(adminUserSnap.data()?.version || 0) + 1,
    createdAt: adminUserSnap.data()?.createdAt || now,
    updatedAt: now
  }, { merge: true })

  await batch.commit()
  console.log('\nPIN Phase 1 preparation completed successfully.')
}

main().catch(error => {
  console.error(error?.message || error)
  process.exitCode = 1
})
