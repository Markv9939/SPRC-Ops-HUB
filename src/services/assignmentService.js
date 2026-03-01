import { db } from '../firebase'
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore'
import { getVersionNumber } from './versioning'
import { isShiftAllowedForMainLocation, isValidShiftId } from '../data/eocConstants'
import { buildBhtLocationId, isBhtRole, locationIdToMainLocation, normalizeHouseId, normalizeMainLocation } from '../utils/orgModel'

function assignmentDocIdForUserId(userId) {
  return `asg_${String(userId || '').trim()}`
}

function normalizeVanIds(vanIds, vanId) {
  const list = Array.isArray(vanIds) ? vanIds : []
  const normalizedList = list
    .map(value => String(value || '').trim().toLowerCase())
    .filter(Boolean)
  const normalizedPrimary = String(vanId || '').trim().toLowerCase()
  const merged = normalizedPrimary ? [...normalizedList, normalizedPrimary] : normalizedList
  return [...new Set(merged)]
}

function resolveLocationId(userRecord) {
  const explicitLocationId = String(userRecord?.locationId || '').trim().toLowerCase()
  if (explicitLocationId) return explicitLocationId

  const mainLocation = normalizeMainLocation(userRecord?.location || userRecord?.site)
  const houseId = normalizeHouseId(userRecord?.house)
  return String(buildBhtLocationId(mainLocation, houseId) || '').trim().toLowerCase()
}

function normalizeShiftIdForLocation(locationId, shiftId) {
  const normalizedShiftId = String(shiftId || '').trim()
  const shiftMainLocation = locationIdToMainLocation(locationId)
  if (shiftMainLocation === 'RES') {
    if (normalizedShiftId === 'shift_1') return 'res_shift_1_day'
    if (normalizedShiftId === 'shift_2') return 'res_shift_2_day'
  }
  return normalizedShiftId
}

function shouldHaveActiveAssignment(userRecord) {
  const locationId = resolveLocationId(userRecord)
  const shiftId = normalizeShiftIdForLocation(locationId, userRecord?.shiftId)
  const shiftMainLocation = locationIdToMainLocation(locationId)
  const hasAllowedShift = isValidShiftId(shiftId) && isShiftAllowedForMainLocation(shiftMainLocation, shiftId)
  const normalizedVanIds = normalizeVanIds(userRecord?.vanIds, userRecord?.vanId)
  return isBhtRole(userRecord?.role)
    && userRecord?.active === true
    && String(locationId || '').trim().length > 0
    && hasAllowedShift
    && normalizedVanIds.length > 0
}

/**
 * Upsert/deactivate derived assignment row for a user profile.
 * Assignment rows are canonical derived records and should not be manually edited.
 */
export async function syncDerivedAssignmentForUser(userId, userRecord) {
  const normalizedUserId = String(userId || '').trim()
  if (!normalizedUserId) return { action: 'noop' }

  const assignmentRef = doc(db, 'shiftAssignments', assignmentDocIdForUserId(normalizedUserId))
  const shouldActivate = shouldHaveActiveAssignment(userRecord)
  const resolvedLocationId = resolveLocationId(userRecord)
  const normalizedShiftId = normalizeShiftIdForLocation(resolvedLocationId, userRecord?.shiftId)
  const normalizedVanIds = normalizeVanIds(userRecord?.vanIds, userRecord?.vanId)

  return runTransaction(db, async (transaction) => {
    const assignmentSnap = await transaction.get(assignmentRef)

    if (!shouldActivate) {
      if (!assignmentSnap.exists()) return { action: 'noop' }

      const existing = assignmentSnap.data()
      if (existing.active === false && existing.deleted === true) {
        return { action: 'noop' }
      }

      transaction.update(assignmentRef, {
        bhtUserName: String(userRecord?.name || existing.bhtUserName || normalizedUserId).trim(),
        active: false,
        deleted: true,
        deletedAt: serverTimestamp(),
        deleteReason: 'Derived from inactive/non-BHT user profile',
        effectiveTo: serverTimestamp(),
        version: getVersionNumber(existing) + 1,
        updatedAt: serverTimestamp()
      })
      return { action: 'deactivated' }
    }

    const nextPayload = {
      bhtUserId: normalizedUserId,
      bhtUserName: String(userRecord?.name || normalizedUserId).trim(),
      locationId: resolvedLocationId,
      shiftId: normalizedShiftId,
      vanIds: normalizedVanIds,
      active: true,
      source: 'user_profile',
      deleted: false,
      deletedAt: null,
      deleteReason: null
    }

    if (!assignmentSnap.exists()) {
      transaction.set(assignmentRef, {
        ...nextPayload,
        version: 1,
        effectiveFrom: serverTimestamp(),
        effectiveTo: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
      return { action: 'created' }
    }

    const existing = assignmentSnap.data()
    transaction.update(assignmentRef, {
      ...nextPayload,
      version: getVersionNumber(existing) + 1,
      effectiveTo: null,
      updatedAt: serverTimestamp()
    })
    return { action: 'updated' }
  })
}

export async function hardDeleteDerivedAssignment(userId) {
  const normalizedUserId = String(userId || '').trim()
  if (!normalizedUserId) return { action: 'noop' }

  const assignmentRef = doc(db, 'shiftAssignments', assignmentDocIdForUserId(normalizedUserId))
  return runTransaction(db, async (transaction) => {
    const assignmentSnap = await transaction.get(assignmentRef)
    if (!assignmentSnap.exists()) return { action: 'noop' }
    transaction.delete(assignmentRef)
    return { action: 'deleted' }
  })
}
