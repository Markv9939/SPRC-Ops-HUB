import { normalizeSecurityRole, validateBhtHomeLocation } from './securityFoundationModel.js'

export const OFFLINE_REPLAY_CONFIG_VERSION = 5

export const OFFLINE_REPLAY_ACTION_TYPES = Object.freeze([
  'eocSubmission', 'shiftDebriefQuickNote', 'shiftDebriefSubmission', 'shiftDebriefExtraNote',
  'shiftDebriefConfirmation', 'bhtIssueReport', 'appFeedback', 'issueAttachmentUpload',
  'transportCreate', 'transportUpdate', 'transportClose'
])

const ALLOWED_ACTIONS = new Set(OFFLINE_REPLAY_ACTION_TYPES)

function token(value) {
  return String(value || '').trim().toUpperCase()
}

function mainLocation(value) {
  const normalized = token(value)
  if (['OTC', 'PHP', 'RTC', 'MESQUITE', 'LONE_MOUNTAIN', 'TEST_HOUSE'].includes(normalized)) return 'OTC'
  if (normalized === 'RES') return 'RES'
  return ''
}

export function offlineReplayEnabled(config = {}) {
  return config.schemaVersion === 2
    && config.serverPinLoginEnabled === true
    && config.offlineReplayVersion === OFFLINE_REPLAY_CONFIG_VERSION
    && config.offlineReplayEnabled === true
}

export function evaluateOfflineReplayAuthorization({ actor, request = {} }) {
  if (!actor || actor.active !== true || actor.deleted === true) return { allowed: false, reason: 'inactive_actor' }
  if (String(request.ownerProfileId || '') !== String(actor.id || '')) return { allowed: false, reason: 'wrong_owner' }
  if (String(request.ownerAuthUid || '') !== String(actor.authUid || '')) return { allowed: false, reason: 'wrong_firebase_identity' }
  if (!ALLOWED_ACTIONS.has(String(request.actionType || ''))) return { allowed: false, reason: 'unsupported_action' }
  const role = normalizeSecurityRole(actor.role)
  if (!['bht', 'supervisor', 'admin'].includes(role)) return { allowed: false, reason: 'unsupported_role' }

  const requestedLocation = String(request.locationId || '').trim()
  if (!requestedLocation || role === 'admin') return { allowed: true, reason: '' }
  if (role === 'bht') {
    const home = validateBhtHomeLocation(actor)
    if (!home.valid) return { allowed: false, reason: 'invalid_bht_home_location' }
    const requestedMain = mainLocation(requestedLocation)
    if (requestedLocation.toLowerCase() !== home.homeLocationId && requestedMain !== home.mainLocation) {
      return { allowed: false, reason: 'location_access_removed' }
    }
    return { allowed: true, reason: '' }
  }
  const locations = new Set([
    actor.site,
    actor.location,
    ...(Array.isArray(actor.authorizedLocations) ? actor.authorizedLocations : []),
    ...(Array.isArray(actor.issueLocationIds) ? actor.issueLocationIds : [])
  ].map(mainLocation).filter(Boolean))
  return locations.has(mainLocation(requestedLocation))
    ? { allowed: true, reason: '' }
    : { allowed: false, reason: 'location_access_removed' }
}
