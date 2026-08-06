/* global process */
import admin from 'firebase-admin'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PROJECT_ID = 'sprc-tx-l'

const MAIN_LOCATION_OTC = 'OTC'
const MAIN_LOCATION_RES = 'RES'
const GLOBAL_SCOPE = 'GLOBAL'
const HOUSE_MESQUITE = 'MESQUITE'
const HOUSE_LONE_MOUNTAIN = 'LONE_MOUNTAIN'
const HOUSE_TEST = 'TEST_HOUSE'

const VAN_IDS_BY_MAIN_LOCATION = Object.freeze({
  [MAIN_LOCATION_OTC]: ['van_1', 'van_2', 'van_4', 'van_test'],
  [MAIN_LOCATION_RES]: ['van_3']
})

function parseArgs(argv) {
  const flags = new Set(argv)
  const userFlagIndex = argv.findIndex(arg => arg === '--user')
  const selectedUserId = userFlagIndex >= 0 ? argv[userFlagIndex + 1] : null
  return {
    confirm: flags.has('--confirm'),
    selectedUserId: selectedUserId || null
  }
}

function initAdmin() {
  try {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: PROJECT_ID
    })
    return
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

function toToken(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '_')
}

function normalizeRole(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'tech') return 'bht'
  return normalized
}

function normalizeMainLocation(value) {
  const normalized = toToken(value)
  if (!normalized) return ''
  if (normalized === 'OTC' || normalized === 'PHP' || normalized === 'RTC' || normalized === 'MESQUITE' || normalized === 'LONE_MOUNTAIN' || normalized === 'TEST_HOUSE') {
    return MAIN_LOCATION_OTC
  }
  if (normalized === 'RES') return MAIN_LOCATION_RES
  if (normalized === GLOBAL_SCOPE) return GLOBAL_SCOPE
  return ''
}

function normalizeHouseId(value) {
  const normalized = toToken(value)
  if (!normalized) return ''
  if (normalized === HOUSE_TEST) return HOUSE_TEST
  if (normalized.includes('MESQUITE')) return HOUSE_MESQUITE
  if (normalized === 'LONEMOUNTAIN' || normalized.includes('LONE_MOUNTAIN') || normalized === 'RTC') return HOUSE_LONE_MOUNTAIN
  return ''
}

function houseToLocationId(houseId) {
  const normalizedHouse = normalizeHouseId(houseId)
  if (normalizedHouse === HOUSE_MESQUITE) return 'mesquite'
  if (normalizedHouse === HOUSE_LONE_MOUNTAIN) return 'lone_mountain'
  if (normalizedHouse === HOUSE_TEST) return 'test_house'
  return ''
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function inferMainLocation(userData) {
  const role = normalizeRole(userData.role)
  if (role === 'admin') return GLOBAL_SCOPE

  const candidates = [
    userData.location,
    userData.site,
    userData.locationId,
    ...(Array.isArray(userData.authorizedLocations) ? userData.authorizedLocations : [])
  ]

  for (const candidate of candidates) {
    const normalized = normalizeMainLocation(candidate)
    if (normalized === MAIN_LOCATION_OTC || normalized === MAIN_LOCATION_RES) return normalized
  }

  return MAIN_LOCATION_OTC
}

function inferHouse(userData, assignmentLocations = []) {
  const candidates = [
    userData.house,
    userData.locationId,
    userData.site,
    userData.location,
    ...(Array.isArray(userData.authorizedLocations) ? userData.authorizedLocations : []),
    ...assignmentLocations
  ]

  for (const candidate of candidates) {
    const normalized = normalizeHouseId(candidate)
    if (normalized) return normalized
  }

  return HOUSE_MESQUITE
}

function inferVanId(userData, mainLocation, assignmentVanIds = []) {
  const allowedVanIds = VAN_IDS_BY_MAIN_LOCATION[mainLocation] || []
  const candidates = [
    String(userData.vanId || '').trim().toLowerCase(),
    ...assignmentVanIds.map(id => String(id || '').trim().toLowerCase())
  ]

  for (const candidate of candidates) {
    if (allowedVanIds.includes(candidate)) return candidate
  }

  return allowedVanIds[0] || ''
}

function buildAuthorizedLocations({ role, mainLocation, houseId }) {
  if (role === 'admin') return [MAIN_LOCATION_OTC, MAIN_LOCATION_RES]
  if (role === 'supervisor') return mainLocation ? [mainLocation] : []
  if (role === 'bht') {
    if (mainLocation === MAIN_LOCATION_OTC) {
      return unique([MAIN_LOCATION_OTC, normalizeHouseId(houseId)])
    }
    if (mainLocation === MAIN_LOCATION_RES) {
      return [MAIN_LOCATION_RES]
    }
  }
  return mainLocation ? [mainLocation] : []
}

function isEqualValue(left, right) {
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return false
    }
    return true
  }
  return left === right
}

function buildUserPatch({ userData, userId, assignmentByUser }) {
  const role = normalizeRole(userData.role)
  const assignmentInfo = assignmentByUser.get(userId) || { locationIds: [], vanIds: [] }
  const mainLocation = inferMainLocation(userData)
  const patch = {
    role
  }

  if (role === 'admin') {
    patch.site = GLOBAL_SCOPE
    patch.location = GLOBAL_SCOPE
    patch.house = null
    patch.locationId = null
    patch.vanId = null
    patch.authorizedLocations = [MAIN_LOCATION_OTC, MAIN_LOCATION_RES]
    return patch
  }

  patch.site = mainLocation
  patch.location = mainLocation

  if (role === 'supervisor') {
    patch.house = null
    patch.locationId = null
    patch.vanId = null
    patch.authorizedLocations = buildAuthorizedLocations({ role, mainLocation })
    return patch
  }

  const isBht = role === 'bht'
  if (isBht) {
    if (mainLocation === MAIN_LOCATION_OTC) {
      const house = inferHouse(userData, assignmentInfo.locationIds)
      patch.house = house
      patch.locationId = houseToLocationId(house)
      patch.vanId = inferVanId(userData, mainLocation, assignmentInfo.vanIds)
      patch.authorizedLocations = buildAuthorizedLocations({ role, mainLocation, houseId: house })
      return patch
    }

    patch.house = null
    patch.locationId = 'res'
    patch.vanId = inferVanId(userData, MAIN_LOCATION_RES, assignmentInfo.vanIds)
    patch.authorizedLocations = buildAuthorizedLocations({ role, mainLocation: MAIN_LOCATION_RES })
    return patch
  }

  patch.authorizedLocations = buildAuthorizedLocations({ role: 'supervisor', mainLocation })
  return patch
}

function buildTransportPatch(data) {
  const normalizedSite = normalizeMainLocation(data.site)
  if (!normalizedSite || normalizedSite === data.site) return null
  return { site: normalizedSite }
}

function buildAccessGrantPatch(data) {
  const normalizedLocation = normalizeMainLocation(data.locationId)
  if (!normalizedLocation || normalizedLocation === data.locationId) return null
  return { locationId: normalizedLocation }
}

function buildComplianceEmployeePatch(data) {
  const normalizedSite = normalizeMainLocation(data.site)
  if (!normalizedSite || normalizedSite === data.site) return null
  return { site: normalizedSite }
}

function buildComplianceItemPatch(data) {
  const normalizedSite = normalizeMainLocation(data.employeeSite)
  if (!normalizedSite || normalizedSite === data.employeeSite) return null
  return { employeeSite: normalizedSite }
}

async function getActiveAssignmentIndex(db) {
  const snapshot = await db.collection('shiftAssignments').where('active', '==', true).get()
  const map = new Map()
  snapshot.docs.forEach((docSnap) => {
    const data = docSnap.data() || {}
    const userId = String(data.bhtUserId || '').trim()
    if (!userId) return

    const existing = map.get(userId) || { locationIds: [], vanIds: [] }
    const mergedLocationIds = unique([...existing.locationIds, data.locationId])
    const mergedVanIds = unique([
      ...existing.vanIds,
      ...(Array.isArray(data.vanIds) ? data.vanIds : []),
      data.vanId
    ]).map(id => String(id || '').trim().toLowerCase())

    map.set(userId, {
      locationIds: mergedLocationIds,
      vanIds: mergedVanIds
    })
  })
  return map
}

function diffPatch(data, patch) {
  const updates = {}
  Object.entries(patch).forEach(([key, value]) => {
    const currentValue = data?.[key]
    if (!isEqualValue(currentValue, value)) {
      updates[key] = value
    }
  })
  return updates
}

async function runMigration({ confirm, selectedUserId }) {
  initAdmin()
  const db = admin.firestore()

  const assignmentByUser = await getActiveAssignmentIndex(db)

  const usersSnapshot = selectedUserId
    ? await db.collection('users').where(admin.firestore.FieldPath.documentId(), '==', selectedUserId).get()
    : await db.collection('users').get()
  const transportsSnapshot = await db.collection('transports').get()
  const grantsSnapshot = await db.collection('accessGrants').get()
  const complianceEmployeesSnapshot = await db.collection('complianceEmployees').get()
  const complianceItemsSnapshot = await db.collection('complianceItems').get()

  const summary = {
    users: { scanned: usersSnapshot.size, changed: 0 },
    transports: { scanned: transportsSnapshot.size, changed: 0 },
    accessGrants: { scanned: grantsSnapshot.size, changed: 0 },
    complianceEmployees: { scanned: complianceEmployeesSnapshot.size, changed: 0 },
    complianceItems: { scanned: complianceItemsSnapshot.size, changed: 0 }
  }

  const updates = []

  usersSnapshot.docs.forEach((docSnap) => {
    const data = docSnap.data() || {}
    const patch = buildUserPatch({
      userData: data,
      userId: docSnap.id,
      assignmentByUser
    })
    const delta = diffPatch(data, patch)
    if (Object.keys(delta).length > 0) {
      summary.users.changed += 1
      updates.push({ ref: docSnap.ref, data: delta, collection: 'users', id: docSnap.id })
    }
  })

  transportsSnapshot.docs.forEach((docSnap) => {
    const patch = buildTransportPatch(docSnap.data() || {})
    if (!patch) return
    summary.transports.changed += 1
    updates.push({ ref: docSnap.ref, data: patch, collection: 'transports', id: docSnap.id })
  })

  grantsSnapshot.docs.forEach((docSnap) => {
    const patch = buildAccessGrantPatch(docSnap.data() || {})
    if (!patch) return
    summary.accessGrants.changed += 1
    updates.push({ ref: docSnap.ref, data: patch, collection: 'accessGrants', id: docSnap.id })
  })

  complianceEmployeesSnapshot.docs.forEach((docSnap) => {
    const patch = buildComplianceEmployeePatch(docSnap.data() || {})
    if (!patch) return
    summary.complianceEmployees.changed += 1
    updates.push({ ref: docSnap.ref, data: patch, collection: 'complianceEmployees', id: docSnap.id })
  })

  complianceItemsSnapshot.docs.forEach((docSnap) => {
    const patch = buildComplianceItemPatch(docSnap.data() || {})
    if (!patch) return
    summary.complianceItems.changed += 1
    updates.push({ ref: docSnap.ref, data: patch, collection: 'complianceItems', id: docSnap.id })
  })

  console.log('Org model migration summary')
  console.log(`- users: scanned=${summary.users.scanned}, changed=${summary.users.changed}`)
  console.log(`- transports: scanned=${summary.transports.scanned}, changed=${summary.transports.changed}`)
  console.log(`- accessGrants: scanned=${summary.accessGrants.scanned}, changed=${summary.accessGrants.changed}`)
  console.log(`- complianceEmployees: scanned=${summary.complianceEmployees.scanned}, changed=${summary.complianceEmployees.changed}`)
  console.log(`- complianceItems: scanned=${summary.complianceItems.scanned}, changed=${summary.complianceItems.changed}`)
  console.log(`- total pending writes: ${updates.length}`)

  if (updates.length === 0) {
    console.log('No changes required.')
    return
  }

  if (!confirm) {
    console.log('')
    console.log('Dry-run only. Re-run with --confirm to apply changes.')
    console.log('Example:')
    console.log('  npm run migrate:org-model -- --confirm')
    return
  }

  let committed = 0
  while (updates.length > 0) {
    const chunk = updates.splice(0, 400)
    const batch = db.batch()
    chunk.forEach((updateItem) => {
      batch.set(updateItem.ref, {
        ...updateItem.data,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true })
    })
    await batch.commit()
    committed += chunk.length
  }

  console.log('')
  console.log(`Migration applied successfully. Documents updated: ${committed}`)
}

function printUsage() {
  console.log('Usage:')
  console.log('  npm run migrate:org-model')
  console.log('  npm run migrate:org-model -- --confirm')
  console.log('  npm run migrate:org-model -- --user <userId>')
}

const options = parseArgs(process.argv.slice(2))

runMigration(options).catch((error) => {
  console.error('Org model migration failed:', error)
  console.error('Credential setup required: configure ADC (GOOGLE_APPLICATION_CREDENTIALS) or place serviceAccountKey.json in project root.')
  printUsage()
  process.exit(1)
})
