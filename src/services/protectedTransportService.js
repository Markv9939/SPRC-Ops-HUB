import { httpsCallable } from 'firebase/functions'
import { auth, functions } from '../firebase'
import { protectedTransportClaimEnabled } from './protectedTransportModel'

function operationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `transport_${Date.now()}_${Math.random().toString(36).slice(2, 18)}`
}

export async function shouldUseProtectedTransport() {
  if (!auth.currentUser) return false
  const token = await auth.currentUser.getIdTokenResult()
  return protectedTransportClaimEnabled(token.claims)
}

export async function createProtectedTransport(site) {
  const call = httpsCallable(functions, 'createProtectedTransportV6')
  const response = await call({ site, operationId: operationId() })
  return response.data
}
