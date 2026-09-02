export const SECURITY_CLIENT_SESSION_VERSION = 3
export const SECURITY_SERVER_SESSION_VERSION = 2
export const SECURITY_SESSION_MAX_MS = 84 * 60 * 60 * 1000
export const SECURITY_SESSION_STORAGE_KEY = 'sprc_staff_session_v3'
export const SECURITY_DEVICE_STORAGE_KEY = 'sprc_staff_device_v3'

const ID_PATTERN = /^[a-zA-Z0-9_-]{16,160}$/
const ALLOWED_ROLES = new Set(['bht', 'tech', 'supervisor', 'admin'])

function stringArray(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .filter(item => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean))]
}

function normalizedRole(value) {
  const role = String(value || '').trim().toLowerCase()
  return role === 'tech' ? 'bht' : role
}

function requiredInteger(value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0
}

export function securityClientConfigEnabled(config, compiledEnabled) {
  const rolloutState = String(config?.rolloutState || '').trim()
  const canaryReady = rolloutState === 'production_canary'
    && Array.isArray(config?.enabledProfileIds)
    && config.enabledProfileIds.some(value => String(value || '').trim())
  return compiledEnabled === true
    && config?.schemaVersion === SECURITY_SERVER_SESSION_VERSION
    && config?.serverPinLoginEnabled === true
    && config?.clientBootstrapVersion === SECURITY_CLIENT_SESSION_VERSION
    && config?.clientBootstrapEnabled === true
    && (rolloutState === 'emulator_only' || rolloutState === 'active' || canaryReady)
}

export function sanitizeSecurityProfile(profileId, profile = {}) {
  const role = normalizedRole(profile.role)
  if (!String(profileId || '').trim() || !ALLOWED_ROLES.has(role)) {
    throw new Error('The secure staff profile is invalid.')
  }
  return {
    id: String(profileId).trim(),
    name: String(profile.name || '').trim(),
    role,
    site: String(profile.site || '').trim(),
    location: String(profile.location || '').trim(),
    house: profile.house == null ? null : String(profile.house).trim(),
    locationId: profile.locationId == null ? null : String(profile.locationId).trim(),
    shiftId: profile.shiftId == null ? null : String(profile.shiftId).trim(),
    vanId: profile.vanId == null ? null : String(profile.vanId).trim().toLowerCase(),
    vanIds: stringArray(profile.vanIds).map(value => value.toLowerCase()),
    authorizedLocations: stringArray(profile.authorizedLocations),
    issueLocationIds: stringArray(profile.issueLocationIds).map(value => value.toLowerCase()),
    primaryScopes: stringArray(profile.primaryScopes),
    activeBackupGrants: Array.isArray(profile.activeBackupGrants)
      ? profile.activeBackupGrants.map(grant => ({
          id: String(grant?.id || ''),
          locationId: String(grant?.locationId || ''),
          startsAtIso: grant?.startsAtIso || null,
          expiresAtIso: grant?.expiresAtIso || null,
          state: String(grant?.state || '')
        }))
      : [],
    securityVersion: requiredInteger(profile.securityVersion) || 1
  }
}

export function profileAuthorizationSignature(profile = {}) {
  const normalized = sanitizeSecurityProfile(profile.id || 'signature_profile', profile)
  return JSON.stringify({
    role: normalized.role,
    site: normalized.site,
    location: normalized.location,
    house: normalized.house,
    locationId: normalized.locationId,
    authorizedLocations: [...normalized.authorizedLocations].sort(),
    issueLocationIds: [...normalized.issueLocationIds].sort()
  })
}

export function normalizeServerPinLoginResponse(value, nowMs = Date.now()) {
  const response = value || {}
  const session = response.session || {}
  const profile = sanitizeSecurityProfile(response.profile?.id, response.profile)
  const issuedAtMs = Number(session.issuedAtMs)
  const expiresAtMs = Number(session.expiresAtMs)
  const scopeExpiresAtMs = session.scopeExpiresAtMs == null ? 0 : Number(session.scopeExpiresAtMs)
  const securityVersion = requiredInteger(session.securityVersion)
  if (typeof response.customToken !== 'string' || response.customToken.length < 20) {
    throw new Error('The secure login response did not include a valid Firebase token.')
  }
  if (!ID_PATTERN.test(String(session.id || ''))) throw new Error('The secure login response did not include a valid session ID.')
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs)) throw new Error('The secure login response has invalid timestamps.')
  if (expiresAtMs - issuedAtMs !== SECURITY_SESSION_MAX_MS || Number(nowMs) >= expiresAtMs) {
    throw new Error('The secure login response has an invalid absolute expiry.')
  }
  if (scopeExpiresAtMs && (!Number.isFinite(scopeExpiresAtMs) || scopeExpiresAtMs <= issuedAtMs || scopeExpiresAtMs > expiresAtMs)) {
    throw new Error('The secure login response has an invalid authorization-scope expiry.')
  }
  if (scopeExpiresAtMs && Number(nowMs) >= scopeExpiresAtMs) {
    throw new Error('The secure login response authorization scope has expired.')
  }
  if (!securityVersion || securityVersion !== profile.securityVersion) {
    throw new Error('The secure login response has an invalid security version.')
  }
  return {
    customToken: response.customToken,
    profile,
    session: {
      id: String(session.id),
      issuedAtMs,
      expiresAtMs,
      scopeExpiresAtMs: scopeExpiresAtMs || null,
      securityVersion
    },
    replayed: response.replayed === true
  }
}

export function buildStoredSecuritySession({ response, authUid, deviceId }) {
  if (!ID_PATTERN.test(String(deviceId || ''))) throw new Error('A stable device ID is required.')
  if (!String(authUid || '').trim()) throw new Error('A Firebase identity is required.')
  return {
    schemaVersion: SECURITY_CLIENT_SESSION_VERSION,
    serverSessionVersion: SECURITY_SERVER_SESSION_VERSION,
    sessionId: response.session.id,
    profileId: response.profile.id,
    authUid: String(authUid),
    deviceId: String(deviceId),
    issuedAtMs: response.session.issuedAtMs,
    expiresAtMs: response.session.expiresAtMs,
    scopeExpiresAtMs: response.session.scopeExpiresAtMs || null,
    securityVersion: response.session.securityVersion,
    authorizationSignature: profileAuthorizationSignature(response.profile)
  }
}

export function validateStoredSecuritySession(session, {
  nowMs = Date.now(),
  authUid,
  claims = null
} = {}) {
  if (!session || session.schemaVersion !== SECURITY_CLIENT_SESSION_VERSION) return { valid: false, reason: 'missing_or_wrong_version' }
  if (session.serverSessionVersion !== SECURITY_SERVER_SESSION_VERSION) return { valid: false, reason: 'wrong_server_session_version' }
  if (!ID_PATTERN.test(String(session.sessionId || '')) || !ID_PATTERN.test(String(session.deviceId || ''))) return { valid: false, reason: 'invalid_identifier' }
  if (!String(session.profileId || '').trim() || !String(session.authUid || '').trim()) return { valid: false, reason: 'missing_identity' }
  if (!Number.isFinite(Number(session.issuedAtMs)) || !Number.isFinite(Number(session.expiresAtMs))) return { valid: false, reason: 'invalid_expiry' }
  if (Number(session.expiresAtMs) - Number(session.issuedAtMs) !== SECURITY_SESSION_MAX_MS) return { valid: false, reason: 'invalid_absolute_window' }
  if (Number(session.scopeExpiresAtMs || 0) > 0 && Number(nowMs) >= Number(session.scopeExpiresAtMs)) return { valid: false, reason: 'authorization_scope_expiry' }
  if (Number(nowMs) >= Number(session.expiresAtMs)) return { valid: false, reason: 'absolute_expiry' }
  if (authUid != null && String(authUid) !== String(session.authUid)) return { valid: false, reason: 'wrong_firebase_identity' }
  if (claims) {
    if (String(claims.profileId || '') !== String(session.profileId)) return { valid: false, reason: 'wrong_profile_claim' }
    if (String(claims.sessionId || '') !== String(session.sessionId)) return { valid: false, reason: 'wrong_session_claim' }
    if (Number(claims.securityVersion || 0) !== Number(session.securityVersion || 0)) return { valid: false, reason: 'stale_security_claim' }
    if (Number(claims.sessionVersion || 0) !== SECURITY_SERVER_SESSION_VERSION) return { valid: false, reason: 'wrong_session_claim_version' }
  }
  return { valid: true, reason: '' }
}

export function evaluateLiveSecurityProfile(rawProfile, session) {
  if (!rawProfile || rawProfile.exists === false) return { valid: false, reason: 'profile_missing' }
  if (rawProfile.active !== true || rawProfile.deleted === true || rawProfile.deletedAt) return { valid: false, reason: 'profile_inactive_or_deleted' }
  if (Number(rawProfile.securityVersion || 1) !== Number(session?.securityVersion || 0)) return { valid: false, reason: 'security_version_changed' }
  const profile = sanitizeSecurityProfile(session.profileId, rawProfile)
  if (session.authorizationSignature && profileAuthorizationSignature(profile) !== session.authorizationSignature) {
    return { valid: false, reason: 'authorization_scope_changed' }
  }
  return { valid: true, reason: '', profile }
}

export function readStoredSecuritySession(storage) {
  try {
    const raw = storage?.getItem?.(SECURITY_SESSION_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function persistSecuritySession(storage, session) {
  storage?.setItem?.(SECURITY_SESSION_STORAGE_KEY, JSON.stringify(session))
}

export function clearStoredSecuritySession(storage) {
  storage?.removeItem?.(SECURITY_SESSION_STORAGE_KEY)
}

export function ensureSecurityDeviceId(storage, createId) {
  const current = String(storage?.getItem?.(SECURITY_DEVICE_STORAGE_KEY) || '')
  if (ID_PATTERN.test(current)) return current
  const generated = `device_${String(createId()).replace(/[^a-zA-Z0-9_-]/g, '_')}`.slice(0, 128)
  if (!ID_PATTERN.test(generated)) throw new Error('A stable device ID could not be created.')
  storage?.setItem?.(SECURITY_DEVICE_STORAGE_KEY, generated)
  return generated
}

export function createSecurityOperationId(createId) {
  const operationId = `operation_${String(createId()).replace(/[^a-zA-Z0-9_-]/g, '_')}`.slice(0, 128)
  if (!ID_PATTERN.test(operationId)) throw new Error('A secure login operation ID could not be created.')
  return operationId
}

export function toSecureSessionUser(scopedProfile, session, authUid) {
  return {
    ...sanitizeSecurityProfile(session.profileId, scopedProfile),
    authUid: String(authUid || ''),
    workflowSecurityVersion: Number(scopedProfile?.workflowSecurityVersion || 0),
    secureWorkflows: stringArray(scopedProfile?.secureWorkflows),
    securitySessionVersion: SECURITY_CLIENT_SESSION_VERSION,
    securitySessionId: session.sessionId,
    securitySessionExpiresAtMs: session.expiresAtMs,
    authScopeEnforced: true
  }
}
