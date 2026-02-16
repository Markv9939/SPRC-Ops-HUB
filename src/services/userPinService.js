import { addDoc, collection, doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { hashPin } from '../utils/pinHash'
import { normalizeRole } from '../utils/orgModel'

function isFourDigitPin(value) {
  return /^\d{4}$/.test(String(value || '').trim())
}

function roleCanSelfRotate(role) {
  const normalizedRole = normalizeRole(role)
  return normalizedRole === 'bht' || normalizedRole === 'supervisor'
}

function toError(message) {
  return new Error(String(message || 'PIN update failed.'))
}

export async function changeOwnPin({ sessionUser, currentPin, newPin, confirmPin }) {
  const userId = String(sessionUser?.id || '').trim()
  const userName = String(sessionUser?.name || '').trim()

  if (!userId) throw toError('Missing user session.')
  if (!roleCanSelfRotate(sessionUser?.role)) throw toError('You do not have permission to change PIN here.')
  if (!isFourDigitPin(currentPin) || !isFourDigitPin(newPin) || !isFourDigitPin(confirmPin)) {
    throw toError('PIN must be exactly 4 digits.')
  }
  if (String(newPin) !== String(confirmPin)) throw toError('New PIN and confirm PIN must match.')
  if (String(currentPin) === String(newPin)) throw toError('New PIN must be different from current PIN.')

  const userRef = doc(db, 'users', userId)
  const userSnap = await getDoc(userRef)
  if (!userSnap.exists()) throw toError('User record not found.')

  const userData = userSnap.data() || {}
  if (userData.active === false) throw toError('This account is inactive.')
  if (!roleCanSelfRotate(userData.role)) throw toError('Role is not eligible for self-service PIN rotation.')

  const currentPinHash = await hashPin(currentPin)
  if (String(userData.pinHash || '') !== currentPinHash) {
    throw toError('Current PIN is incorrect.')
  }

  const newPinHash = await hashPin(newPin)
  await updateDoc(userRef, {
    pinHash: newPinHash,
    pinVersion: 'v1_sha256',
    pinUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  })

  try {
    await addDoc(collection(db, 'auditLogs'), {
      action: 'user.pin.self_rotate',
      collectionPath: 'users',
      documentId: userId,
      performedByUserId: userId,
      performedByName: userName || userId,
      reason: 'Self-service PIN rotation',
      version: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    })
  } catch (auditError) {
    console.warn('PIN updated, but audit log write failed:', auditError)
  }
}
