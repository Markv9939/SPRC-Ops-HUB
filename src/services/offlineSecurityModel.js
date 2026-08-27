const BHT_ACTION_TYPES = new Set([
  'eocSubmission', 'shiftDebriefQuickNote', 'shiftDebriefSubmission', 'shiftDebriefExtraNote',
  'shiftDebriefConfirmation', 'bhtIssueReport', 'appFeedback', 'issueAttachmentUpload',
  'transportCreate', 'transportUpdate', 'transportClose'
])

function clean(value) {
  return String(value || '').trim()
}

function locationValues(user = {}) {
  return new Set([
    user.site, user.location, user.house, user.locationId,
    ...(Array.isArray(user.authorizedLocations) ? user.authorizedLocations : []),
    ...(Array.isArray(user.issueLocationIds) ? user.issueLocationIds : [])
  ].map(value => clean(value).toUpperCase()).filter(Boolean))
}

export function offlineActionLocation(type, payload = {}) {
  if (type === 'eocSubmission') return clean(payload.task?.locationId || payload.assignment?.locationId)
  if (type === 'bhtIssueReport' || type === 'issueAttachmentUpload') return clean(payload.locationId || payload.user?.locationId)
  if (type.startsWith('transport')) return clean(payload.snapshot?.locationId || payload.transport?.locationId || payload.user?.locationId || payload.snapshot?.site)
  if (type.startsWith('shiftDebrief')) return clean(payload.context?.locationId || payload.locationId || payload.user?.locationId)
  return clean(payload.locationId || payload.user?.locationId)
}

export function buildOfflineSecurityBinding(type, payload = {}) {
  const user = payload.user || {}
  if (Number(user.securitySessionVersion || 0) !== 3) return null
  return {
    schemaVersion: 5,
    ownerProfileId: clean(user.id || payload.normalizedUserId),
    ownerAuthUid: clean(user.authUid),
    queuedSessionId: clean(user.securitySessionId),
    queuedSecurityVersion: Number(user.securityVersion || 0),
    queuedSessionExpiresAtMs: Number(user.securitySessionExpiresAtMs || 0),
    actionType: clean(type),
    locationId: offlineActionLocation(type, payload),
    expectedVersion: Number(payload.expectedVersion || payload.task?.version || payload.context?.version || 0)
  }
}

export function evaluateOfflineActionForCurrentUser(action = {}, currentUser = {}) {
  const ownerProfileId = clean(action.ownerProfileId || action.payload?.user?.id || action.payload?.normalizedUserId)
  const currentProfileId = clean(currentUser.id)
  if (!ownerProfileId || ownerProfileId !== currentProfileId) return { disposition: 'hold_for_owner', reason: 'wrong_owner' }

  const binding = action.securityBinding || null
  const secureCurrent = Number(currentUser.securitySessionVersion || 0) === 3
  if (!binding) return secureCurrent
    ? { disposition: 'needs_review', reason: 'legacy_unbound_action' }
    : { disposition: 'allow', reason: 'legacy_compatibility' }
  if (!secureCurrent) return { disposition: 'hold_for_owner', reason: 'secure_action_requires_secure_session' }
  if (clean(binding.ownerProfileId) !== currentProfileId || clean(binding.ownerAuthUid) !== clean(currentUser.authUid)) {
    return { disposition: 'hold_for_owner', reason: 'wrong_firebase_identity' }
  }
  if (!BHT_ACTION_TYPES.has(clean(action.type))) return { disposition: 'needs_review', reason: 'unsupported_action' }

  const locationId = clean(binding.locationId).toUpperCase()
  const allowed = locationValues(currentUser)
  const isAdmin = clean(currentUser.role).toLowerCase() === 'admin'
  if (locationId && !isAdmin) {
    const normalized = ['MESQUITE', 'LONE_MOUNTAIN', 'TEST_HOUSE'].includes(locationId) ? 'OTC' : locationId
    if (!allowed.has(locationId) && !allowed.has(normalized)) {
      return { disposition: 'needs_review', reason: 'location_access_removed' }
    }
  }

  const currentSecurityVersion = Number(currentUser.securityVersion || 0)
  const versionChanged = Number(binding.queuedSecurityVersion || 0) !== currentSecurityVersion
  const sessionChanged = clean(binding.queuedSessionId) !== clean(currentUser.securitySessionId)
  return {
    disposition: versionChanged || sessionChanged ? 'reauthorize' : 'allow',
    reason: versionChanged ? 'security_version_changed' : (sessionChanged ? 'new_device_session' : '')
  }
}
