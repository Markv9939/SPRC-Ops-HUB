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
  const [policySnap, userSnap, assignmentSnap] = await Promise.all([
    policyRef.get(),
    userRef.get(),
    assignmentRef.get()
  ])

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
      testAssignment: summarize(assignmentSnap)
    },
    proposed: {
      authScopeEnforced: false,
      testUserId: TEST_USER_ID,
      testUserPin: '8888',
      locationId: 'test_house',
      shiftId: 'shift_1',
      assignmentId: TEST_ASSIGNMENT_ID
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
    pinHash: hashPin('8888'),
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

  await batch.commit()
  console.log('\nPIN Phase 1 preparation completed successfully.')
}

main().catch(error => {
  console.error(error?.message || error)
  process.exitCode = 1
})
