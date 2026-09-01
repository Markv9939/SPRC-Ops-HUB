import { doc, getDoc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'

function parseBooleanEnv(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

export async function getAuthPolicy() {
  try {
    const snap = await getDoc(doc(db, 'appSettings', 'authPolicy'))
    if (snap.exists()) {
      return {
        authScopeEnforced: snap.data()?.authScopeEnforced === true
      }
    }
  } catch (error) {
    console.warn('Failed to load auth policy from Firestore, falling back to env:', error)
  }
  return {
    authScopeEnforced: parseBooleanEnv(import.meta.env?.VITE_REQUIRE_AUTH_CLAIMS)
  }
}

export function subscribeToAuthPolicy(onPolicy, onError) {
  return onSnapshot(doc(db, 'appSettings', 'authPolicy'), snapshot => {
    onPolicy?.({ authScopeEnforced: snapshot.exists() && snapshot.data()?.authScopeEnforced === true })
  }, onError)
}
