import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { hashPin } from '../utils/pinHash'

export function isActiveNonDeletedUser(userData) {
  return userData?.active === true && userData?.deleted !== true && !userData?.deletedAt
}

export async function getActiveUsersByPinHash(pinHash) {
  const normalizedHash = String(pinHash || '').trim()
  if (!normalizedHash) return []

  const usersRef = collection(db, 'users')
  const usersQuery = query(usersRef, where('pinHash', '==', normalizedHash), where('active', '==', true))
  const snapshot = await getDocs(usersQuery)

  return snapshot.docs
    .map(docSnap => ({
      id: docSnap.id,
      ...docSnap.data()
    }))
    .filter(isActiveNonDeletedUser)
}

export async function findDuplicatePinUser(pin, { excludeUserId = null } = {}) {
  const pinHash = await hashPin(pin)
  const excludedId = String(excludeUserId || '').trim()
  const activeUsers = await getActiveUsersByPinHash(pinHash)

  return activeUsers.find(candidate => String(candidate.id || '').trim() !== excludedId) || null
}

