import { doc, getDocFromServer } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { readStoredSecuritySession } from './securityClientSessionModel'
import {
  performSecurityAccountActionWithAdapters,
  securityOperationId
} from './securityAccountActionsModel'

export const SECURITY_LOGOUT_PENDING_KEY = 'sprc_security_logout_pending_v4'

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  const values = new Uint32Array(4)
  globalThis.crypto?.getRandomValues?.(values)
  return [...values].map(value => value.toString(16).padStart(8, '0')).join('_')
}

function runtimeAdapters() {
  return {
    createId,
    loadConfig: async () => {
      const snapshot = await getDocFromServer(doc(db, 'appSettings', 'securityFoundation'))
      return snapshot.exists() ? snapshot.data() : {}
    },
    callAction: async payload => {
      const response = await httpsCallable(functions, 'manageStaffSecurityV4')(payload)
      return response.data
    }
  }
}

export function performSecurityAccountAction(request) {
  return performSecurityAccountActionWithAdapters(request, runtimeAdapters())
}

function readPending(storage) {
  try {
    const value = JSON.parse(storage?.getItem?.(SECURITY_LOGOUT_PENDING_KEY) || '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function writePending(storage, entries) {
  if (!entries.length) storage?.removeItem?.(SECURITY_LOGOUT_PENDING_KEY)
  else storage?.setItem?.(SECURITY_LOGOUT_PENDING_KEY, JSON.stringify(entries.slice(-10)))
}

export async function closeCurrentSecurityDeviceSession({ storage = globalThis.localStorage, expectedSessionId = '' } = {}) {
  const session = readStoredSecuritySession(storage)
  if (!session?.sessionId) return { status: 'no_session' }
  if (expectedSessionId && session.sessionId !== expectedSessionId) return { status: 'superseded' }
  const operationId = securityOperationId(createId)
  try {
    const result = await performSecurityAccountAction({
      action: 'close_device_session',
      targetProfileId: session.profileId,
      sessionId: session.sessionId,
      operationId
    })
    if (result.status === 'disabled') return result
    return { status: 'closed', operationId }
  } catch (error) {
    const pending = readPending(storage).filter(item => item.sessionId !== session.sessionId)
    pending.push({ sessionId: session.sessionId, profileId: session.profileId, operationId })
    writePending(storage, pending)
    return { status: 'queued', error }
  }
}

export async function flushPendingSecurityDeviceClosures({ storage = globalThis.localStorage } = {}) {
  const session = readStoredSecuritySession(storage)
  if (!session?.profileId) return { status: 'no_session', remaining: readPending(storage).length }
  const pending = readPending(storage)
  const remaining = []
  let closed = 0
  for (const entry of pending) {
    if (entry.profileId !== session.profileId || entry.sessionId === session.sessionId) {
      remaining.push(entry)
      continue
    }
    try {
      const result = await performSecurityAccountAction({
        action: 'close_device_session',
        targetProfileId: session.profileId,
        sessionId: entry.sessionId,
        operationId: entry.operationId
      })
      if (result.status === 'disabled') remaining.push(entry)
      else closed += 1
    } catch {
      remaining.push(entry)
    }
  }
  writePending(storage, remaining)
  return { status: 'completed', closed, remaining: remaining.length }
}

export function isSecureSessionUser(user) {
  return Number(user?.securitySessionVersion || 0) === 3 && Boolean(user?.securitySessionId)
}
