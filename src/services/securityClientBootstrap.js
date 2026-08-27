import {
  buildStoredSecuritySession,
  clearStoredSecuritySession,
  createSecurityOperationId,
  ensureSecurityDeviceId,
  evaluateLiveSecurityProfile,
  normalizeServerPinLoginResponse,
  persistSecuritySession,
  profileAuthorizationSignature,
  readStoredSecuritySession,
  securityClientConfigEnabled,
  toSecureSessionUser,
  validateStoredSecuritySession
} from './securityClientSessionModel.js'

export class SecurityClientBootstrapError extends Error {
  constructor(code, message, cause = null) {
    super(message)
    this.name = 'SecurityClientBootstrapError'
    this.code = code
    this.cause = cause
  }
}

function callableError(error) {
  const code = String(error?.code || '').replace(/^functions\//, '')
  if (code === 'permission-denied') return new SecurityClientBootstrapError(code, 'PIN verification failed.', error)
  if (code === 'resource-exhausted') return new SecurityClientBootstrapError(code, 'Too many failed attempts. Try again later.', error)
  if (code === 'invalid-argument') return new SecurityClientBootstrapError(code, 'A six-digit PIN is required.', error)
  return new SecurityClientBootstrapError('unavailable', 'Secure login is temporarily unavailable. Check the connection and try again.', error)
}

async function safeClear(adapters) {
  clearStoredSecuritySession(adapters.storage)
  try {
    await adapters.signOut()
  } catch {
    // A local record must still be cleared if Firebase sign-out cannot reach the network.
  }
}

async function verifiedAuthContext(adapters, expected) {
  await adapters.waitForAuthReady()
  const currentUser = adapters.currentAuthUser()
  if (!currentUser?.uid) throw new SecurityClientBootstrapError('unauthenticated', 'The secure Firebase session was not established.')
  const claims = await adapters.getIdTokenClaims(currentUser)
  const validation = validateStoredSecuritySession(expected, {
    nowMs: adapters.now(),
    authUid: currentUser.uid,
    claims
  })
  if (!validation.valid) throw new SecurityClientBootstrapError('session-invalid', `The secure session is invalid (${validation.reason}).`)
  return { currentUser, claims }
}

async function loadVerifiedProfile(adapters, session, { cacheOnly = false, claims = null, trustedProfile = null, initializeSignature = false } = {}) {
  const rawProfile = await adapters.loadProfile(session.profileId, { cacheOnly })
  if (initializeSignature) session.authorizationSignature = profileAuthorizationSignature(rawProfile)
  const liveValidation = evaluateLiveSecurityProfile(rawProfile, session)
  if (!liveValidation.valid) {
    throw new SecurityClientBootstrapError('session-revoked', `The secure session is no longer valid (${liveValidation.reason}).`)
  }
  if (trustedProfile) return trustedProfile
  return adapters.loadScopedProfile(session.profileId, rawProfile, { cacheOnly, claims })
}

export async function beginDormantClientPinSession(pin, adapters) {
  if (adapters.compiledEnabled !== true) return { status: 'disabled' }
  let config
  try {
    config = await adapters.loadConfig()
  } catch (error) {
    throw new SecurityClientBootstrapError('config-unavailable', 'Secure login readiness could not be verified. Check the connection and try again.', error)
  }
  if (!securityClientConfigEnabled(config, true)) return { status: 'disabled' }

  const deviceId = ensureSecurityDeviceId(adapters.storage, adapters.createId)
  const operationId = createSecurityOperationId(adapters.createId)
  let signedIn = false
  try {
    let callableResult
    try {
      callableResult = await adapters.callServerPinLogin({ pin, deviceId, operationId })
    } catch (error) {
      throw callableError(error)
    }
    if (callableResult?.status === 'not_enrolled') return { status: 'disabled' }
    const response = normalizeServerPinLoginResponse(callableResult, adapters.now())
    await adapters.usePersistentAuth()
    const credential = await adapters.signInWithCustomToken(response.customToken)
    signedIn = true
    const provisional = buildStoredSecuritySession({ response, authUid: credential.user.uid, deviceId })
    const { currentUser, claims } = await verifiedAuthContext(adapters, provisional)
    const scopedProfile = await loadVerifiedProfile(adapters, provisional, {
      claims,
      trustedProfile: response.profile,
      initializeSignature: true
    })
    persistSecuritySession(adapters.storage, provisional)
    return {
      status: 'authenticated',
      user: toSecureSessionUser(scopedProfile, provisional, currentUser.uid),
      session: provisional
    }
  } catch (error) {
    if (signedIn) await safeClear(adapters)
    if (error instanceof SecurityClientBootstrapError) throw error
    throw new SecurityClientBootstrapError('unavailable', 'Secure login could not be completed. Check the connection and try again.', error)
  }
}

export async function restoreDormantClientSession(adapters, { offline = false } = {}) {
  if (adapters.compiledEnabled !== true) return { status: 'disabled' }
  const stored = readStoredSecuritySession(adapters.storage)

  if (!offline) {
    let config
    try {
      config = await adapters.loadConfig()
    } catch (error) {
      if (!stored) throw new SecurityClientBootstrapError('config-unavailable', 'Secure session readiness could not be verified.', error)
      throw new SecurityClientBootstrapError('config-unavailable', 'The saved secure session could not be verified.', error)
    }
    if (!securityClientConfigEnabled(config, true)) {
      if (stored) await safeClear(adapters)
      return { status: 'disabled' }
    }
  }

  if (!stored) return { status: 'signed_out' }
  const localValidation = validateStoredSecuritySession(stored, { nowMs: adapters.now() })
  if (!localValidation.valid) {
    await safeClear(adapters)
    return { status: 'signed_out', reason: localValidation.reason }
  }

  try {
    const { currentUser, claims } = await verifiedAuthContext(adapters, stored)
    const scopedProfile = await loadVerifiedProfile(adapters, stored, { cacheOnly: offline, claims })
    return {
      status: 'authenticated',
      user: toSecureSessionUser(scopedProfile, stored, currentUser.uid),
      session: stored,
      offline
    }
  } catch (error) {
    if (offline && error?.code !== 'session-revoked' && error?.code !== 'session-invalid') {
      throw new SecurityClientBootstrapError('offline-cache-unavailable', 'Reconnect to verify this saved session.', error)
    }
    await safeClear(adapters)
    return { status: 'signed_out', reason: error?.code || 'restore_failed' }
  }
}

export async function endDormantClientSession(adapters) {
  await safeClear(adapters)
}

export function evaluateMonitoredSecuritySession({ session, authUid, claims, rawProfile, nowMs }) {
  const storedValidation = validateStoredSecuritySession(session, { nowMs, authUid, claims })
  if (!storedValidation.valid) return storedValidation
  return evaluateLiveSecurityProfile(rawProfile, session)
}
