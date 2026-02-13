import { db } from '../firebase'
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore'
import { getVersionNumber } from './versioning'
import { isBhtRole } from '../utils/orgModel'

function assignmentDocIdForUserId(userId) {
  return `asg_${String(userId || '').trim()}`
}

function normalizeVanIds(vanId) {
  const normalized = String(vanId || '').trim().toLowerCase()
  return normalized ? [normalized] : []
}

function shouldHaveActiveAssignment(userRecord) {
  return isBhtRole(userRecord?.role)
    && userRecord?.active === true
    && String(userRecord?.locationId || '').trim().length > 0
    && String(userRecord?.shiftId || '').trim().length > 0
    && String(userRecord?.vanId || '').trim().length > 0
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
      locationId: String(userRecord.locationId || '').trim().toLowerCase(),
      shiftId: String(userRecord.shiftId || '').trim(),
      vanIds: normalizeVanIds(userRecord.vanId),
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
