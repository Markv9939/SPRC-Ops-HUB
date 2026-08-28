// Dormant Phase 1/2 executable contract. Phase 2 server tests import this model,
// but the current client runtime does not use it and the new login remains disabled.
export const SESSION_ABSOLUTE_MAX_MS = 84 * 60 * 60 * 1000
export const PIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000
export const PIN_MAX_FAILED_ATTEMPTS = 5

export const ALL_DEVICE_REVOCATION_TRIGGERS = Object.freeze([
  'profile_deactivated',
  'pin_changed',
  'role_reduced',
  'location_removed',
  'admin_end_all_sessions'
])

const EXACT_LOCATIONS = Object.freeze({
  mesquite: { mainLocation: 'OTC', house: 'MESQUITE' },
  lone_mountain: { mainLocation: 'OTC', house: 'LONE_MOUNTAIN' },
  test_house: { mainLocation: 'OTC', house: 'TEST_HOUSE' },
  res: { mainLocation: 'RES', house: '' }
})

const EXACT_LOCATION_ALIASES = Object.freeze({
  MESQUITE: 'mesquite',
  LONE_MOUNTAIN: 'lone_mountain',
  LONEMOUNTAIN: 'lone_mountain',
  TEST_HOUSE: 'test_house',
  RES: 'res'
})

const MAIN_LOCATION_ALIASES = Object.freeze({
  OTC: 'OTC',
  PHP: 'OTC',
  RTC: 'OTC',
  MESQUITE: 'OTC',
  LONE_MOUNTAIN: 'OTC',
  LONEMOUNTAIN: 'OTC',
  TEST_HOUSE: 'OTC',
  RES: 'RES'
})

const SUPERVISOR_BHT_ACTIONS = new Set([
  'create_profile',
  'reset_pin',
  'deactivate',
  'reactivate',
  'end_all_sessions',
  'update_operational_assignment'
])

function normalizedToken(value) {
  return String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_')
}

export function normalizeSecurityRole(value) {
  const role = String(value || '').trim().toLowerCase()
  return role === 'tech' ? 'bht' : role
}

function exactLocationId(value) {
  const token = normalizedToken(value)
  return EXACT_LOCATION_ALIASES[token] || ''
}

function mainLocationId(value) {
  return MAIN_LOCATION_ALIASES[normalizedToken(value)] || ''
}

function arrayValues(value) {
  return Array.isArray(value) ? value : []
}

export function validateBhtHomeLocation(profile = {}) {
  if (normalizeSecurityRole(profile.role) !== 'bht') {
    return { valid: true, applicable: false, homeLocationId: '', mainLocation: '', reasons: [] }
  }

  const exactCandidates = new Set()
  const addExact = value => {
    const locationId = exactLocationId(value)
    if (locationId) exactCandidates.add(locationId)
  }

  addExact(profile.locationId)
  addExact(profile.house)
  arrayValues(profile.issueLocationIds).forEach(addExact)
  arrayValues(profile.authorizedLocations).forEach(addExact)

  // RES is itself an exact work location. OTC still needs a specific house.
  if (mainLocationId(profile.site) === 'RES') addExact('res')
  if (mainLocationId(profile.location) === 'RES') addExact('res')

  const homeLocations = [...exactCandidates]
  const reasons = []
  if (homeLocations.length === 0) reasons.push('missing_home_location')
  if (homeLocations.length > 1) reasons.push('multiple_home_locations')

  const homeLocationId = homeLocations.length === 1 ? homeLocations[0] : ''
  const expected = homeLocationId ? EXACT_LOCATIONS[homeLocationId] : null
  const statedMainLocations = new Set([
    mainLocationId(profile.site),
    mainLocationId(profile.location),
    ...arrayValues(profile.authorizedLocations).map(mainLocationId)
  ].filter(Boolean))

  if (statedMainLocations.size > 1) reasons.push('conflicting_main_locations')
  if (expected && statedMainLocations.size > 0 && !statedMainLocations.has(expected.mainLocation)) {
    reasons.push('home_location_outside_main_location')
  }
  if (expected?.mainLocation === 'OTC' && !expected.house) reasons.push('missing_otc_house')
  if (expected?.mainLocation === 'RES' && exactLocationId(profile.house) && exactLocationId(profile.house) !== 'res') {
    reasons.push('res_profile_has_house')
  }

  return {
    valid: reasons.length === 0,
    applicable: true,
    homeLocationId,
    mainLocation: expected?.mainLocation || '',
    reasons: [...new Set(reasons)]
  }
}

function rateState(rateLimit = {}) {
  return {
    failedAttempts: Number(rateLimit.failedAttempts || 0),
    windowStartedAtMs: Number(rateLimit.windowStartedAtMs || 0),
    lockedUntilMs: Number(rateLimit.lockedUntilMs || 0)
  }
}

export function evaluatePinLoginAttempt({ nowMs, profile, pinMatches, rateLimit }) {
  const now = Number(nowMs)
  const currentRate = rateState(rateLimit)
  if (currentRate.lockedUntilMs > now) {
    return { status: 'rate_limited', publicMessage: 'Too many failed attempts. Try again later.', nextRateLimit: currentRate }
  }

  const activeProfile = profile && profile.active === true && profile.deleted !== true
  const home = profile ? validateBhtHomeLocation(profile) : { valid: false }
  const configurationValid = !profile || normalizeSecurityRole(profile.role) !== 'bht' || home.valid
  if (activeProfile && configurationValid && pinMatches === true) {
    return {
      status: 'valid',
      publicMessage: '',
      nextRateLimit: { failedAttempts: 0, windowStartedAtMs: 0, lockedUntilMs: 0 }
    }
  }

  const inWindow = currentRate.windowStartedAtMs > 0 && now - currentRate.windowStartedAtMs < PIN_ATTEMPT_WINDOW_MS
  const failedAttempts = (inWindow ? currentRate.failedAttempts : 0) + 1
  const locked = failedAttempts >= PIN_MAX_FAILED_ATTEMPTS
  return {
    status: locked ? 'rate_limited' : 'invalid',
    publicMessage: locked ? 'Too many failed attempts. Try again later.' : 'PIN verification failed.',
    internalReason: activeProfile && !configurationValid ? 'invalid_profile_configuration' : 'invalid_credentials_or_inactive_profile',
    nextRateLimit: {
      failedAttempts,
      windowStartedAtMs: inWindow ? currentRate.windowStartedAtMs : now,
      lockedUntilMs: locked ? now + PIN_ATTEMPT_WINDOW_MS : 0
    }
  }
}

export function buildDeviceSession({ sessionId, authUid, profileId, deviceId, nowMs, securityVersion = 1 }) {
  if (!sessionId || !authUid || !profileId || !deviceId) throw new Error('Session, Firebase identity, profile, and device IDs are required.')
  const issuedAtMs = Number(nowMs)
  if (!Number.isFinite(issuedAtMs)) throw new Error('A valid issue time is required.')
  return {
    sessionId,
    authUid,
    profileId,
    deviceId,
    securityVersion: Number(securityVersion || 1),
    issuedAtMs,
    expiresAtMs: issuedAtMs + SESSION_ABSOLUTE_MAX_MS,
    storagePolicy: 'persistent_local',
    revokedAtMs: 0,
    revocationReason: ''
  }
}

export function evaluateDeviceSession(session, { nowMs, authUid, profileId, currentSecurityVersion }) {
  if (!session) return { valid: false, reason: 'missing_session' }
  if (session.revokedAtMs > 0) return { valid: false, reason: 'revoked_session' }
  if (String(session.authUid || '') !== String(authUid || '')) return { valid: false, reason: 'wrong_firebase_identity' }
  if (String(session.profileId || '') !== String(profileId || '')) return { valid: false, reason: 'wrong_profile' }
  if (Number(session.securityVersion || 0) !== Number(currentSecurityVersion || 0)) return { valid: false, reason: 'stale_security_version' }
  if (Number(session.scopeExpiresAtMs || 0) > 0 && Number(nowMs) >= Number(session.scopeExpiresAtMs)) {
    return { valid: false, reason: 'authorization_scope_expiry' }
  }
  if (Number(nowMs) >= Number(session.expiresAtMs || 0)) return { valid: false, reason: 'absolute_expiry' }
  return { valid: true, reason: '' }
}

export function revocationScope(trigger) {
  if (trigger === 'ordinary_logout') return 'one_device'
  if (ALL_DEVICE_REVOCATION_TRIGGERS.includes(trigger)) return 'all_devices'
  return 'none'
}

function actorMainLocations(actor = {}) {
  if (normalizeSecurityRole(actor.role) === 'admin') return ['OTC', 'RES']
  return [...new Set([
    mainLocationId(actor.site),
    mainLocationId(actor.location),
    ...arrayValues(actor.authorizedLocations).map(mainLocationId),
    ...arrayValues(actor.issueLocationIds).map(value => EXACT_LOCATIONS[exactLocationId(value)]?.mainLocation || '')
  ].filter(Boolean))]
}

export function evaluateStaffAccountManagement({ actor, target, action, requestedRole, requestedLocationId, changesGlobalSecurity = false }) {
  const actorRole = normalizeSecurityRole(actor?.role)
  const targetRole = normalizeSecurityRole(target?.role)
  if (!actor || actor.active !== true || actor.deleted === true) return { allowed: false, reason: 'inactive_actor' }
  if (!target) return { allowed: false, reason: 'missing_target' }
  if (changesGlobalSecurity) return { allowed: actorRole === 'admin', reason: actorRole === 'admin' ? '' : 'global_security_admin_only' }
  if (actorRole === 'admin') return { allowed: true, reason: '' }
  if (actorRole !== 'supervisor') return { allowed: false, reason: 'supervisor_or_admin_required' }
  if (!SUPERVISOR_BHT_ACTIONS.has(action)) return { allowed: false, reason: 'action_not_delegated' }
  if (targetRole !== 'bht') return { allowed: false, reason: 'supervisor_may_only_manage_bht' }
  if (requestedRole && normalizeSecurityRole(requestedRole) !== 'bht') return { allowed: false, reason: 'role_elevation_denied' }

  const targetHome = validateBhtHomeLocation(target)
  if (!targetHome.valid) return { allowed: false, reason: 'invalid_target_home_location' }
  const actorLocations = actorMainLocations(actor)
  if (!actorLocations.includes(targetHome.mainLocation)) return { allowed: false, reason: 'target_outside_actor_location' }

  if (requestedLocationId) {
    const requested = EXACT_LOCATIONS[exactLocationId(requestedLocationId)]
    if (!requested || !actorLocations.includes(requested.mainLocation)) {
      return { allowed: false, reason: 'requested_location_outside_actor_scope' }
    }
  }
  return { allowed: true, reason: '' }
}

export function evaluateOfflineReplay({ action, session, sessionContext, currentRecord }) {
  if (!action?.operationId) return { disposition: 'needs_review', reason: 'missing_operation_id' }
  if (String(action.ownerProfileId || '') !== String(sessionContext?.profileId || '')) {
    return { disposition: 'hold_for_owner', reason: 'wrong_owner' }
  }

  const sessionResult = evaluateDeviceSession(session, sessionContext)
  if (!sessionResult.valid) return { disposition: 'hold_for_owner', reason: sessionResult.reason }
  if (Number(action.securityVersion || 0) !== Number(session.securityVersion || 0)) {
    return { disposition: 'hold_for_owner', reason: 'stale_offline_security_version' }
  }
  if (arrayValues(currentRecord?.appliedOperationIds).includes(action.operationId)) {
    return { disposition: 'already_applied', reason: 'duplicate_operation' }
  }
  if (currentRecord?.revoked === true || currentRecord?.immutable === true || ['closed', 'final', 'voided'].includes(String(currentRecord?.status || '').toLowerCase())) {
    return { disposition: 'needs_review', reason: 'record_no_longer_mutable' }
  }
  if (Number(action.expectedVersion || 0) !== Number(currentRecord?.version || 0)) {
    return { disposition: 'needs_review', reason: 'stale_record_version' }
  }
  return { disposition: 'allow', reason: '' }
}
