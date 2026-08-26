import { doc, getDocFromServer } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { securityOperationId } from './securityAccountActionsModel'

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  const values = new Uint32Array(4)
  globalThis.crypto?.getRandomValues?.(values)
  return [...values].map(value => value.toString(16).padStart(8, '0')).join('_')
}

export function offlineReplayClientEnabled(config = {}) {
  return config.schemaVersion === 2
    && config.serverPinLoginEnabled === true
    && config.offlineReplayVersion === 5
    && config.offlineReplayEnabled === true
}

export async function authorizeOfflineActionReplay(action) {
  const configSnapshot = await getDocFromServer(doc(db, 'appSettings', 'securityFoundation'))
  const config = configSnapshot.exists() ? configSnapshot.data() : {}
  if (!offlineReplayClientEnabled(config)) throw new Error('Protected offline replay is not enabled.')
  const binding = action.securityBinding || {}
  const response = await httpsCallable(functions, 'authorizeOfflineReplayV5')({
    operationId: securityOperationId(createId),
    actionId: String(action.id || ''),
    actionType: String(action.type || ''),
    ownerProfileId: String(binding.ownerProfileId || action.ownerProfileId || ''),
    ownerAuthUid: String(binding.ownerAuthUid || ''),
    locationId: String(binding.locationId || ''),
    expectedVersion: Number(binding.expectedVersion || 0),
    queuedSecurityVersion: Number(binding.queuedSecurityVersion || 0),
    queuedSessionId: String(binding.queuedSessionId || '')
  })
  return response.data
}
