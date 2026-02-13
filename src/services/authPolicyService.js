import { db } from '../firebase'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'

const AUTH_POLICY_DOC = doc(db, 'appSettings', 'security')

export async function getAuthPolicy() {
  const snap = await getDoc(AUTH_POLICY_DOC)
  if (!snap.exists()) {
    return {
      authScopeEnforced: false
    }
  }

  const data = snap.data()
  return {
    authScopeEnforced: data.authScopeEnforced === true
  }
}

export async function setAuthScopeEnforced({
  enabled,
  actorUserId,
  actorName,
  reason
}) {
  await setDoc(AUTH_POLICY_DOC, {
    authScopeEnforced: enabled === true,
    updatedAt: serverTimestamp(),
    updatedByUserId: actorUserId || null,
    updatedByName: actorName || null,
    updateReason: String(reason || '').trim() || null
  }, { merge: true })
}
