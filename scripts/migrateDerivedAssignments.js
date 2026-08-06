/* global process */
import { initializeApp } from 'firebase/app'
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  query,
  where,
  runTransaction,
  serverTimestamp,
  updateDoc
} from 'firebase/firestore'

const firebaseConfig = {
  apiKey: 'AIzaSyDkeTilCGBAxaR9Vz4uiIHsxLENvvRsy7U',
  authDomain: 'sprc-tx-l.firebaseapp.com',
  projectId: 'sprc-tx-l',
  storageBucket: 'sprc-tx-l.firebasestorage.app',
  messagingSenderId: '699564668509',
  appId: '1:699564668509:web:dc48902d5458fc5383fb4',
  measurementId: 'G-YQJZPLW7P6'
}

const app = initializeApp(firebaseConfig)
const db = getFirestore(app)

const OTC_SHIFTS = new Set(['shift_1', 'shift_2'])
const RES_SHIFTS = new Set([
  'res_shift_1_day',
  'res_shift_1_night',
  'res_shift_2_day',
  'res_shift_2_night'
])

function normalizeRole(roleValue) {
  const normalized = String(roleValue || '').trim().toLowerCase()
  return normalized === 'tech' ? 'bht' : normalized
}

function normalizeMainLocationFromLocationId(locationId) {
  const normalized = String(locationId || '').trim().toLowerCase()
  if (!normalized) return ''
  if (normalized === 'res') return 'RES'
  if (normalized === 'mesquite' || normalized === 'lone_mountain' || normalized === 'test_house') return 'OTC'
  return ''
}

function isShiftAllowedForLocationId(locationId, shiftId) {
  const normalizedShift = String(shiftId || '').trim()
  const mainLocation = normalizeMainLocationFromLocationId(locationId)
  if (!mainLocation) return false
  if (mainLocation === 'OTC') return OTC_SHIFTS.has(normalizedShift)
  if (mainLocation === 'RES') return RES_SHIFTS.has(normalizedShift)
  return false
}

function shouldHaveActiveAssignment(userData) {
  const locationId = String(userData?.locationId || '').trim().toLowerCase()
  const shiftId = String(userData?.shiftId || '').trim()
  return normalizeRole(userData?.role) === 'bht'
    && userData?.active === true
    && locationId.length > 0
    && shiftId.length > 0
    && isShiftAllowedForLocationId(locationId, shiftId)
    && String(userData?.vanId || '').trim().length > 0
}

function buildCanonicalAssignmentDocId(userId) {
  return `asg_${String(userId || '').trim()}`
}

function normalizeVanIds(vanId) {
  const normalized = String(vanId || '').trim().toLowerCase()
  return normalized ? [normalized] : []
}

function readFallbackShiftFromAssignments(assignmentsByUserId, userId) {
  const fallback = assignmentsByUserId.get(String(userId || '').trim())
  if (!fallback) return ''
  const shiftId = String(fallback.shiftId || '').trim()
  return isShiftAllowedForLocationId(fallback.locationId, shiftId) ? shiftId : ''
}

async function buildAssignmentsByUserId() {
  const assignmentsSnap = await getDocs(query(collection(db, 'shiftAssignments'), where('active', '==', true)))
  const byUser = new Map()

  assignmentsSnap.docs.forEach((assignmentDoc) => {
    const assignmentData = assignmentDoc.data()
    const bhtUserId = String(assignmentData?.bhtUserId || '').trim()
    const shiftId = String(assignmentData?.shiftId || '').trim()
    const locationId = String(assignmentData?.locationId || '').trim().toLowerCase()
    if (!bhtUserId || !isShiftAllowedForLocationId(locationId, shiftId)) return
    if (byUser.has(bhtUserId)) return
    byUser.set(bhtUserId, {
      shiftId,
      locationId
    })
  })

  return byUser
}

async function upsertCanonicalAssignment(userId, userData) {
  const assignmentRef = doc(db, 'shiftAssignments', buildCanonicalAssignmentDocId(userId))
  const shouldActivate = shouldHaveActiveAssignment(userData)

  return runTransaction(db, async (transaction) => {
    const existingSnap = await transaction.get(assignmentRef)
    const existing = existingSnap.exists() ? existingSnap.data() : null
    const nextVersion = Number(existing?.version || 0) + 1

    if (!shouldActivate) {
      if (!existing) return 'noop'
      if (existing.active === false && existing.deleted === true) return 'noop'
      transaction.update(assignmentRef, {
        bhtUserName: String(userData?.name || existing.bhtUserName || userId).trim(),
        active: false,
        deleted: true,
        deletedAt: serverTimestamp(),
        deleteReason: 'Derived migration deactivation',
        effectiveTo: serverTimestamp(),
        version: nextVersion,
        updatedAt: serverTimestamp()
      })
      return 'deactivated'
    }

    const payload = {
      bhtUserId: String(userId || '').trim(),
      bhtUserName: String(userData?.name || userId).trim(),
      locationId: String(userData?.locationId || '').trim().toLowerCase(),
      shiftId: String(userData?.shiftId || '').trim(),
      vanIds: normalizeVanIds(userData?.vanId),
      active: true,
      source: 'user_profile',
      deleted: false,
      deletedAt: null,
      deleteReason: null
    }

    if (!existing) {
      transaction.set(assignmentRef, {
        ...payload,
        version: 1,
        effectiveFrom: serverTimestamp(),
        effectiveTo: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
      return 'created'
    }

    transaction.update(assignmentRef, {
      ...payload,
      effectiveTo: null,
      version: nextVersion,
      updatedAt: serverTimestamp()
    })
    return 'updated'
  })
}

async function migrate() {
  const assignmentsByUserId = await buildAssignmentsByUserId()
  const usersSnap = await getDocs(collection(db, 'users'))

  let usersPatched = 0
  let assignmentsCreated = 0
  let assignmentsUpdated = 0
  let assignmentsDeactivated = 0
  const unresolvedUsers = []

  for (const userDoc of usersSnap.docs) {
    const userId = userDoc.id
    const userData = userDoc.data()
    const normalizedRole = normalizeRole(userData?.role)
    if (normalizedRole !== 'bht') continue

    let shiftId = String(userData?.shiftId || '').trim()
    const locationId = String(userData?.locationId || '').trim().toLowerCase()
    if (!isShiftAllowedForLocationId(locationId, shiftId)) {
      const fallbackShift = readFallbackShiftFromAssignments(assignmentsByUserId, userId)
      if (fallbackShift) {
        await updateDoc(doc(db, 'users', userId), {
          shiftId: fallbackShift,
          updatedAt: serverTimestamp()
        })
        shiftId = fallbackShift
        usersPatched += 1
      }
    }

    const nextUserData = {
      ...userData,
      shiftId
    }
    const assignmentAction = await upsertCanonicalAssignment(userId, nextUserData)
    if (assignmentAction === 'created') assignmentsCreated += 1
    if (assignmentAction === 'updated') assignmentsUpdated += 1
    if (assignmentAction === 'deactivated') assignmentsDeactivated += 1

    if (!shiftId && userData?.active === true) {
      unresolvedUsers.push(userId)
    }
  }

  console.log('Derived assignment migration complete.')
  console.log(`- Users patched with fallback shiftId: ${usersPatched}`)
  console.log(`- Canonical assignments created: ${assignmentsCreated}`)
  console.log(`- Canonical assignments updated: ${assignmentsUpdated}`)
  console.log(`- Canonical assignments deactivated: ${assignmentsDeactivated}`)
  if (unresolvedUsers.length > 0) {
    console.log(`- Unresolved active BHT users missing shiftId (${unresolvedUsers.length}):`)
    unresolvedUsers.forEach(userId => console.log(`  - ${userId}`))
  }
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Derived assignment migration failed:', err)
    process.exit(1)
  })
