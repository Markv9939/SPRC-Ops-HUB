/* global process */
import { Buffer } from 'buffer'
import { createHash, randomInt } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import { fileURLToPath } from 'url'
import admin from 'firebase-admin'

const PROJECT_ID = 'sprc-tx-l'
const CONFIRM_PHRASE = 'RESET_SPRC_CORE_PRODUCTION'
const PIN_VERSION = 'v2_sha256_6digit'
const GENERATED_PINS = new Set()

const PRESERVED_COLLECTIONS = new Set([
  'appSettings',
  'eocChecklistTemplate',
  'eocTemplateAssignments',
  'eocTemplateLibrary',
  'eocProperties',
  'eocVehicles',
  'fleetMaintenanceTemplates'
])

const DELETED_COLLECTIONS = new Set([
  'users',
  'usersByAuthUid',
  'userEmailLinks',
  'clients',
  'destinations',
  'bhtAssignments',
  'shiftAssignments',
  'eocTasks',
  'eocAssignments',
  'eocSubmissions',
  'eocSubmissionDrafts',
  'shiftDebriefDrafts',
  'shiftDebriefs',
  'eocIssues',
  'alerts',
  'supervisorAlerts',
  'accessGrants',
  'issueAccess',
  'userHomeState',
  'auditLogs',
  'eocTemplateDrafts',
  'eocTemplateVersions',
  'fleetVehicleRuntime',
  'fleetTasks',
  'vehicleServiceRecords',
  'complianceEmployees',
  'complianceItems',
  'cintasServices',
  'transports'
])

const USER_METADATA_FIELDS = [
  'ownerUserId',
  'ownerName',
  'ownerAuthUid',
  'ownerRole',
  'createdByUserId',
  'createdByName',
  'createdByAuthUid',
  'updatedByUserId',
  'updatedByName',
  'updatedByAuthUid'
]

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '..')

function argumentValue(name) {
  const prefix = `--${name}=`
  const argument = process.argv.find(value => value.startsWith(prefix))
  return argument ? argument.slice(prefix.length) : ''
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`)
}

function initAdmin() {
  if (admin.apps.length) return

  const serviceAccountPath = join(repoRoot, 'serviceAccountKey.json')
  if (existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'))
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: PROJECT_ID
    })
    return
  }

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: PROJECT_ID
  })
}

function classifyCollection(collectionId) {
  if (PRESERVED_COLLECTIONS.has(collectionId)) return 'preserve'
  if (DELETED_COLLECTIONS.has(collectionId)) return 'delete'
  return 'unclassified'
}

function serializeValue(value) {
  if (value === null || value === undefined) return value ?? null
  if (value instanceof admin.firestore.Timestamp) {
    return { __type: 'timestamp', value: value.toDate().toISOString() }
  }
  if (value instanceof admin.firestore.GeoPoint) {
    return { __type: 'geopoint', latitude: value.latitude, longitude: value.longitude }
  }
  if (value instanceof admin.firestore.DocumentReference) {
    return { __type: 'reference', path: value.path }
  }
  if (Buffer.isBuffer(value)) {
    return { __type: 'bytes', value: value.toString('base64') }
  }
  if (value instanceof Date) {
    return { __type: 'date', value: value.toISOString() }
  }
  if (Array.isArray(value)) return value.map(serializeValue)
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, serializeValue(nestedValue)])
    )
  }
  return value
}

async function captureCollection(collectionRef) {
  const documentRefs = await collectionRef.listDocuments()
  const documents = []
  let documentCount = 0
  let subcollectionCount = 0

  for (const documentRef of documentRefs) {
    const snapshot = await documentRef.get()
    const childCollectionRefs = await documentRef.listCollections()
    const subcollections = []

    if (snapshot.exists) documentCount += 1

    for (const childCollectionRef of childCollectionRefs) {
      const captured = await captureCollection(childCollectionRef)
      subcollections.push(captured)
      documentCount += captured.documentCount
      subcollectionCount += 1 + captured.subcollectionCount
    }

    documents.push({
      path: documentRef.path,
      exists: snapshot.exists,
      data: snapshot.exists ? serializeValue(snapshot.data()) : null,
      subcollections
    })
  }

  return {
    id: collectionRef.id,
    path: collectionRef.path,
    directDocumentCount: documents.filter(document => document.exists).length,
    documentCount,
    subcollectionCount,
    documents
  }
}

async function captureFirestore(db) {
  const rootCollections = await db.listCollections()
  const collections = []

  for (const collectionRef of rootCollections.sort((left, right) => left.id.localeCompare(right.id))) {
    collections.push(await captureCollection(collectionRef))
  }

  return collections
}

async function captureAuthUsers(auth) {
  const users = []
  let pageToken

  do {
    const page = await auth.listUsers(1000, pageToken)
    users.push(...page.users.map(userRecord => serializeValue(userRecord.toJSON())))
    pageToken = page.pageToken
  } while (pageToken)

  return users
}

function buildInventory(collections, authUsers) {
  const rows = collections.map(collectionData => ({
    collection: collectionData.id,
    classification: classifyCollection(collectionData.id),
    directDocuments: collectionData.directDocumentCount,
    descendantDocuments: collectionData.documentCount - collectionData.directDocumentCount,
    subcollections: collectionData.subcollectionCount,
    totalDocuments: collectionData.documentCount
  }))

  const deleteDocumentCount = rows
    .filter(row => row.classification === 'delete')
    .reduce((sum, row) => sum + row.totalDocuments, 0)
  const preservedDocumentCount = rows
    .filter(row => row.classification === 'preserve')
    .reduce((sum, row) => sum + row.totalDocuments, 0)
  const unclassified = rows.filter(row => row.classification === 'unclassified')

  return {
    projectId: PROJECT_ID,
    authUserCount: authUsers.length,
    deleteDocumentCount,
    preservedDocumentCount,
    totalFirestoreDocuments: rows.reduce((sum, row) => sum + row.totalDocuments, 0),
    unclassifiedCollections: unclassified.map(row => row.collection),
    collections: rows
  }
}

function resolveBackupDirectory() {
  const requested = argumentValue('backup-dir')
  const fallbackDirectory = process.env.USERPROFILE
    ? join(process.env.USERPROFILE, 'Documents', 'SPRC Backups')
    : join(process.env.TEMP || 'C:\\tmp', 'sprc-reset-backups')
  const backupDirectory = resolve(requested || fallbackDirectory)
  const relativeToRepo = relative(repoRoot, backupDirectory)

  if (!isAbsolute(backupDirectory)) throw new Error('Backup directory must be an absolute path.')
  if (relativeToRepo === '' || (!relativeToRepo.startsWith('..') && !isAbsolute(relativeToRepo))) {
    throw new Error('Backup directory must be outside the repository.')
  }

  return backupDirectory
}

function writeAndValidateBackup({ collections, authUsers, inventory }) {
  const backupDirectory = resolveBackupDirectory()
  mkdirSync(backupDirectory, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = join(backupDirectory, `sprc-tx-l-core-reset-${timestamp}.json`)
  const payload = {
    formatVersion: 1,
    projectId: PROJECT_ID,
    createdAt: new Date().toISOString(),
    purpose: 'Rollback-only backup before SPRC core reset',
    inventory,
    authenticationUsers: authUsers,
    firestoreCollections: collections
  }

  writeFileSync(backupPath, JSON.stringify(payload, null, 2), 'utf8')
  const validated = JSON.parse(readFileSync(backupPath, 'utf8'))
  const backupDocumentCount = validated.firestoreCollections
    .reduce((sum, collectionData) => sum + Number(collectionData.documentCount || 0), 0)

  if (validated.projectId !== PROJECT_ID) throw new Error('Backup validation failed: project mismatch.')
  if (validated.authenticationUsers.length !== inventory.authUserCount) {
    throw new Error('Backup validation failed: Authentication user count mismatch.')
  }
  if (backupDocumentCount !== inventory.totalFirestoreDocuments) {
    throw new Error('Backup validation failed: Firestore document count mismatch.')
  }

  return backupPath
}

function hashPin(pin) {
  return createHash('sha256')
    .update(`sprc-pin-v2-6digit:${String(pin).trim()}`)
    .digest('hex')
}

function isObviousPin(pin) {
  return /^(\d)\1+$/.test(pin) || ['012345', '123456', '654321', '987654'].includes(pin)
}

function generateUniquePin() {
  while (true) {
    const pin = String(randomInt(100000, 1000000))
    if (GENERATED_PINS.has(pin) || isObviousPin(pin)) continue
    GENERATED_PINS.add(pin)
    return pin
  }
}

function buildTestUsers() {
  return [
    {
      id: 'test_admin',
      name: 'Test Admin',
      pin: generateUniquePin(),
      role: 'admin',
      site: 'GLOBAL',
      location: 'GLOBAL',
      house: null,
      locationId: null,
      shiftId: null,
      vanId: null,
      vanIds: [],
      authorizedLocations: [],
      issueLocationIds: ['lone_mountain', 'mesquite', 'test_house', 'res']
    },
    {
      id: 'test_supervisor',
      name: 'Test Supervisor',
      pin: generateUniquePin(),
      role: 'supervisor',
      site: 'OTC',
      location: 'OTC',
      house: null,
      locationId: null,
      shiftId: null,
      vanId: null,
      vanIds: [],
      authorizedLocations: ['OTC'],
      issueLocationIds: ['lone_mountain', 'mesquite', 'test_house']
    },
    {
      id: 'test_bht_shift_1',
      name: 'Test BHT Shift 1',
      pin: generateUniquePin(),
      role: 'bht',
      site: 'OTC',
      location: 'OTC',
      house: 'TEST_HOUSE',
      locationId: 'test_house',
      shiftId: 'shift_1',
      vanId: 'van_test',
      vanIds: ['van_test'],
      authorizedLocations: ['OTC', 'TEST_HOUSE'],
      issueLocationIds: ['test_house']
    },
    {
      id: 'test_bht_shift_2',
      name: 'Test BHT Shift 2',
      pin: generateUniquePin(),
      role: 'bht',
      site: 'OTC',
      location: 'OTC',
      house: 'TEST_HOUSE',
      locationId: 'test_house',
      shiftId: 'shift_2',
      vanId: 'van_test',
      vanIds: ['van_test'],
      authorizedLocations: ['OTC', 'TEST_HOUSE'],
      issueLocationIds: ['test_house']
    }
  ]
}

async function deleteAuthenticationUsers(auth) {
  const userIds = []
  let pageToken

  do {
    const page = await auth.listUsers(1000, pageToken)
    userIds.push(...page.users.map(userRecord => userRecord.uid))
    pageToken = page.pageToken
  } while (pageToken)

  let deleted = 0
  for (let index = 0; index < userIds.length; index += 1000) {
    const result = await auth.deleteUsers(userIds.slice(index, index + 1000))
    if (result.failureCount > 0) {
      throw new Error(`Authentication deletion failed for ${result.failureCount} users.`)
    }
    deleted += result.successCount
  }

  return deleted
}

async function scrubPreservedUserMetadata(db, existingCollectionIds) {
  let updated = 0
  const fieldDeletes = Object.fromEntries(
    USER_METADATA_FIELDS.map(field => [field, admin.firestore.FieldValue.delete()])
  )

  for (const collectionId of PRESERVED_COLLECTIONS) {
    if (!existingCollectionIds.has(collectionId) || collectionId === 'appSettings') continue
    const snapshot = await db.collection(collectionId).get()

    for (let index = 0; index < snapshot.docs.length; index += 400) {
      const chunk = snapshot.docs.slice(index, index + 400)
      const batch = db.batch()
      let chunkUpdates = 0

      chunk.forEach(documentSnapshot => {
        const data = documentSnapshot.data() || {}
        if (!USER_METADATA_FIELDS.some(field => field in data)) return
        batch.update(documentSnapshot.ref, fieldDeletes)
        chunkUpdates += 1
      })

      if (chunkUpdates > 0) {
        await batch.commit()
        updated += chunkUpdates
      }
    }
  }

  return updated
}

async function seedTestUsers(db) {
  const users = buildTestUsers()
  const now = admin.firestore.FieldValue.serverTimestamp()
  const batch = db.batch()

  users.forEach(user => {
    const { pin, ...profile } = user
    batch.set(db.doc(`users/${user.id}`), {
      ...profile,
      active: true,
      pinHash: hashPin(pin),
      pinVersion: PIN_VERSION,
      pinUpdatedAt: now,
      version: 1,
      createdAt: now,
      updatedAt: now
    })

    if (user.role === 'bht') {
      batch.set(db.doc(`shiftAssignments/asg_${user.id}`), {
        bhtUserId: user.id,
        bhtUserName: user.name,
        locationId: user.locationId,
        shiftId: user.shiftId,
        vanId: user.vanId,
        vanIds: user.vanIds,
        source: 'user_profile',
        active: true,
        version: 1,
        createdAt: now,
        updatedAt: now
      })
    }
  })

  batch.set(db.doc('appSettings/authPolicy'), {
    authScopeEnforced: false,
    updatedAt: now
  }, { merge: true })

  await batch.commit()
  return users.map(({ id, name, role, pin }) => ({ id, name, role, pin }))
}

function assertResetApproved(inventory) {
  if (argumentValue('project') !== PROJECT_ID) {
    throw new Error(`Refusing reset: --project must exactly equal ${PROJECT_ID}.`)
  }
  if (argumentValue('confirm') !== CONFIRM_PHRASE) {
    throw new Error(`Refusing reset: --confirm must exactly equal ${CONFIRM_PHRASE}.`)
  }
  if (!hasFlag('backup')) throw new Error('Refusing reset: --backup is required.')
  if (Number(argumentValue('expected-auth-users')) !== inventory.authUserCount) {
    throw new Error('Refusing reset: Authentication user count changed since preview.')
  }
  if (Number(argumentValue('expected-delete-docs')) !== inventory.deleteDocumentCount) {
    throw new Error('Refusing reset: deletable Firestore document count changed since preview.')
  }
  if (inventory.unclassifiedCollections.length > 0) {
    throw new Error(`Refusing reset: unclassified collections found: ${inventory.unclassifiedCollections.join(', ')}`)
  }

  const overlap = [...PRESERVED_COLLECTIONS].filter(collectionId => DELETED_COLLECTIONS.has(collectionId))
  if (overlap.length > 0) {
    throw new Error(`Refusing reset: preserved collection appears in delete set: ${overlap.join(', ')}`)
  }
}

async function executeReset({ db, auth, inventory }) {
  assertResetApproved(inventory)
  const rootCollections = await db.listCollections()
  const rootCollectionMap = new Map(rootCollections.map(collectionRef => [collectionRef.id, collectionRef]))

  let deletedDocuments = 0
  for (const row of inventory.collections.filter(item => item.classification === 'delete')) {
    const collectionRef = rootCollectionMap.get(row.collection)
    if (!collectionRef) continue
    await db.recursiveDelete(collectionRef)
    deletedDocuments += row.totalDocuments
  }

  const deletedAuthUsers = await deleteAuthenticationUsers(auth)
  const scrubbedDocuments = await scrubPreservedUserMetadata(db, new Set(rootCollectionMap.keys()))
  const testUsers = await seedTestUsers(db)

  return { deletedDocuments, deletedAuthUsers, scrubbedDocuments, testUsers }
}

async function verifyCoreState(db, auth) {
  const expectedUserIds = [
    'test_admin',
    'test_bht_shift_1',
    'test_bht_shift_2',
    'test_supervisor'
  ]
  const expectedAssignmentIds = [
    'asg_test_bht_shift_1',
    'asg_test_bht_shift_2'
  ]
  const [authPage, usersSnapshot, assignmentsSnapshot, policySnapshot, rootCollections] = await Promise.all([
    auth.listUsers(1000),
    db.collection('users').get(),
    db.collection('shiftAssignments').get(),
    db.doc('appSettings/authPolicy').get(),
    db.listCollections()
  ])

  const actualUserIds = usersSnapshot.docs.map(document => document.id).sort()
  const actualAssignmentIds = assignmentsSnapshot.docs.map(document => document.id).sort()
  const rootCollectionIds = new Set(rootCollections.map(collectionRef => collectionRef.id))
  const unexpectedActivityCollections = [...DELETED_COLLECTIONS]
    .filter(collectionId => !['users', 'shiftAssignments'].includes(collectionId))
    .filter(collectionId => rootCollectionIds.has(collectionId))

  const invalidPinUsers = usersSnapshot.docs
    .filter(document => {
      const data = document.data() || {}
      return data.active !== true
        || data.pinVersion !== PIN_VERSION
        || typeof data.pinHash !== 'string'
        || data.pinHash.length !== 64
    })
    .map(document => document.id)

  const preservedMetadataReferences = []
  for (const collectionId of PRESERVED_COLLECTIONS) {
    if (!rootCollectionIds.has(collectionId) || collectionId === 'appSettings') continue
    const snapshot = await db.collection(collectionId).get()
    snapshot.docs.forEach(document => {
      const data = document.data() || {}
      const staleFields = USER_METADATA_FIELDS.filter(field => field in data)
      if (staleFields.length > 0) {
        preservedMetadataReferences.push({ path: document.ref.path, fields: staleFields })
      }
    })
  }

  const checks = {
    authenticationUsersCleared: authPage.users.length === 0 && !authPage.pageToken,
    expectedTestUsersOnly: JSON.stringify(actualUserIds) === JSON.stringify(expectedUserIds),
    expectedAssignmentsOnly: JSON.stringify(actualAssignmentIds) === JSON.stringify(expectedAssignmentIds),
    testPinsValid: invalidPinUsers.length === 0,
    authScopeEnforcementOff: policySnapshot.exists && policySnapshot.data()?.authScopeEnforced === false,
    activityCollectionsCleared: unexpectedActivityCollections.length === 0,
    preservedMetadataScrubbed: preservedMetadataReferences.length === 0
  }

  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    details: {
      authUserCount: authPage.users.length,
      userIds: actualUserIds,
      assignmentIds: actualAssignmentIds,
      invalidPinUsers,
      unexpectedActivityCollections,
      preservedMetadataReferences
    }
  }
}

async function main() {
  initAdmin()
  const db = admin.firestore()
  const auth = admin.auth()
  const confirmed = Boolean(argumentValue('confirm'))

  if (hasFlag('verify-core')) {
    const verification = await verifyCoreState(db, auth)
    console.log(JSON.stringify(verification, null, 2))
    if (!verification.passed) throw new Error('Production core verification failed.')
    return
  }

  const [collections, authUsers] = await Promise.all([
    captureFirestore(db),
    captureAuthUsers(auth)
  ])
  const inventory = buildInventory(collections, authUsers)
  const backupPath = hasFlag('backup')
    ? writeAndValidateBackup({ collections, authUsers, inventory })
    : null

  console.log(JSON.stringify({
    mode: confirmed ? 'confirmed production reset' : 'preview only',
    inventory,
    backup: backupPath
      ? { created: true, validated: true, path: backupPath }
      : { created: false, validated: false, path: null }
  }, null, 2))

  if (!confirmed) {
    console.log('\nPreview complete. No Firebase writes or deletions were performed.')
    console.log('A confirmed reset remains blocked until the inventory and backup are reviewed.')
    return
  }

  const result = await executeReset({ db, auth, inventory })
  console.log('\nProduction core reset completed successfully.')
  console.log(JSON.stringify(result, null, 2))
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === __filename

if (isDirectRun) {
  main().catch(error => {
    console.error(error?.stack || error?.message || error)
    process.exitCode = 1
  })
}

export {
  DELETED_COLLECTIONS,
  PRESERVED_COLLECTIONS,
  buildInventory,
  captureAuthUsers,
  captureFirestore,
  classifyCollection,
  executeReset,
  verifyCoreState
}
