import {
  browserLocalPersistence,
  onIdTokenChanged,
  setPersistence,
  signInWithCustomToken,
  signOut
} from 'firebase/auth'
import {
  doc,
  getDocFromCache,
  getDocFromServer,
  onSnapshot
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { auth, db, functions } from '../firebase'
import {
  beginDormantClientPinSession,
  endDormantClientSession,
  evaluateMonitoredSecuritySession,
  restoreDormantClientSession
} from './securityClientBootstrap.js'
import {
  SECURITY_SESSION_STORAGE_KEY,
  readStoredSecuritySession,
  sanitizeSecurityProfile,
  toSecureSessionUser
} from './securityClientSessionModel.js'
import {
  closeCurrentSecurityDeviceSession,
  flushPendingSecurityDeviceClosures
} from './securityAccountActions.js'

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

export const SECURITY_CLIENT_BOOTSTRAP_COMPILED = parseBoolean(import.meta.env?.VITE_ENABLE_SECURITY_BOOTSTRAP_V3)

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  const values = new Uint32Array(4)
  globalThis.crypto?.getRandomValues?.(values)
  return [...values].map(value => value.toString(16).padStart(8, '0')).join('_')
}

async function waitForAuthReady() {
  if (typeof auth.authStateReady === 'function') {
    await auth.authStateReady()
    return
  }
  await new Promise(resolve => {
    const stop = onIdTokenChanged(auth, () => {
      stop()
      resolve()
    })
  })
}

async function loadRawProfile(profileId, { cacheOnly = false } = {}) {
  const reference = doc(db, 'users', profileId)
  const snapshot = cacheOnly ? await getDocFromCache(reference) : await getDocFromServer(reference)
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : { exists: false }
}

async function loadScopedProfile(profileId, rawProfile, { claims = {} } = {}) {
  const scoped = {
    ...rawProfile,
    authorizedLocations: Array.isArray(claims.authorizedLocations) ? claims.authorizedLocations : [],
    issueLocationIds: Array.isArray(claims.issueLocationIds) ? claims.issueLocationIds : [],
    locationId: claims.locationId == null ? rawProfile.locationId : String(claims.locationId)
  }
  return {
    ...sanitizeSecurityProfile(profileId, scoped),
    active: rawProfile.active === true,
    deleted: rawProfile.deleted === true,
    deletedAt: rawProfile.deletedAt || null,
    securityVersion: Number(rawProfile.securityVersion || 1)
  }
}

function runtimeAdapters() {
  return {
    compiledEnabled: SECURITY_CLIENT_BOOTSTRAP_COMPILED,
    storage: globalThis.localStorage,
    now: () => Date.now(),
    createId,
    loadConfig: async () => {
      const snapshot = await getDocFromServer(doc(db, 'appSettings', 'securityFoundation'))
      return snapshot.exists() ? snapshot.data() : {}
    },
    callServerPinLogin: async payload => {
      const response = await httpsCallable(functions, 'beginStaffPinSessionV2')(payload)
      return response.data
    },
    usePersistentAuth: () => setPersistence(auth, browserLocalPersistence),
    signInWithCustomToken: token => signInWithCustomToken(auth, token),
    waitForAuthReady,
    currentAuthUser: () => auth.currentUser,
    getIdTokenClaims: async user => (await user.getIdTokenResult()).claims,
    loadProfile: loadRawProfile,
    loadScopedProfile,
    signOut: () => signOut(auth)
  }
}

export async function beginSecurityClientPinLogin(pin) {
  const result = await beginDormantClientPinSession(pin, runtimeAdapters())
  if (result.status === 'authenticated') await flushPendingSecurityDeviceClosures()
  return result
}

export async function restoreSecurityClientSession({ offline = false } = {}) {
  const result = await restoreDormantClientSession(runtimeAdapters(), { offline })
  if (!offline && result.status === 'authenticated') await flushPendingSecurityDeviceClosures()
  return result
}

export async function endSecurityClientSession({ skipRemote = false } = {}) {
  if (!skipRemote) await closeCurrentSecurityDeviceSession()
  return endDormantClientSession(runtimeAdapters())
}

export function subscribeToSecurityClientSession({ onUser, onInvalid, onTransientError }) {
  if (!SECURITY_CLIENT_BOOTSTRAP_COMPILED) return () => {}
  const session = readStoredSecuritySession(globalThis.localStorage)
  if (!session) return () => {}
  let stopped = false
  let profileStop = () => {}
  const scopeExpiryMs = Number(session.scopeExpiresAtMs || 0)
  const effectiveExpiryMs = scopeExpiryMs > 0 ? Math.min(Number(session.expiresAtMs), scopeExpiryMs) : Number(session.expiresAtMs)
  const expiryReason = scopeExpiryMs > 0 && scopeExpiryMs <= Number(session.expiresAtMs)
    ? 'authorization_scope_expiry'
    : 'absolute_expiry'
  const expiryDelay = Math.max(0, effectiveExpiryMs - Date.now())
  const expiryTimer = setTimeout(() => invalidate(expiryReason), expiryDelay)
  const invalidate = async reason => {
    if (stopped) return
    stopped = true
    profileStop()
    await endSecurityClientSession()
    onInvalid?.(reason)
  }

  const authStop = onIdTokenChanged(auth, async currentUser => {
    if (stopped) return
    if (!currentUser) {
      await invalidate('firebase_signed_out')
      return
    }
    try {
      const claims = (await currentUser.getIdTokenResult()).claims
      profileStop()
      profileStop = onSnapshot(doc(db, 'users', session.profileId), async snapshot => {
        if (stopped) return
        try {
          const rawProfile = snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : { exists: false }
          const validation = evaluateMonitoredSecuritySession({
            session,
            authUid: currentUser.uid,
            claims,
            rawProfile,
            nowMs: Date.now()
          })
          if (!validation.valid) {
            await invalidate(validation.reason)
            return
          }
          const scopedProfile = await loadScopedProfile(session.profileId, rawProfile, { claims })
          onUser?.(toSecureSessionUser(scopedProfile, session, currentUser.uid))
        } catch (error) {
          if (navigator.onLine === false) onTransientError?.(error)
          else await invalidate('profile_refresh_failed')
        }
      }, error => {
        if (navigator.onLine === false) onTransientError?.(error)
        else invalidate('profile_listener_failed')
      })
    } catch (error) {
      if (navigator.onLine === false) onTransientError?.(error)
      else await invalidate('token_refresh_failed')
    }
  })

  const storageHandler = event => {
    if (event.key === SECURITY_SESSION_STORAGE_KEY && event.newValue == null) invalidate('device_signed_out')
  }
  globalThis.addEventListener?.('storage', storageHandler)

  return () => {
    stopped = true
    clearTimeout(expiryTimer)
    authStop()
    profileStop()
    globalThis.removeEventListener?.('storage', storageHandler)
  }
}
