import { normalizeSecurityRole, validateBhtHomeLocation } from './securityFoundationModel.js'

export const STAFF_ACCOUNT_ACTION_CONFIG_VERSION = 4

export const STAFF_ACCOUNT_ACTIONS = Object.freeze({
  CREATE_PROFILE: 'create_profile',
  SAVE_PROFILE: 'save_profile',
  SELF_CHANGE_PIN: 'self_change_pin',
  RESET_PIN: 'reset_pin',
  END_ALL_SESSIONS: 'end_all_sessions',
  CLOSE_DEVICE_SESSION: 'close_device_session',
  SOFT_DELETE: 'soft_delete'
})

const PROFILE_PATCH_FIELDS = new Set([
  'name', 'role', 'site', 'location', 'house', 'locationId', 'shiftId', 'vanId', 'vanIds',
  'authorizedLocations', 'issueLocationIds', 'active'
])

const ARRAY_FIELDS = new Set(['vanIds', 'authorizedLocations', 'issueLocationIds'])

function cleanString(value, maximum = 160) {
  if (value == null) return null
  return String(value).trim().slice(0, maximum)
}

function cleanStringArray(value) {
  if (!Array.isArray(value)) throw new Error('Expected a list of access values.')
  return [...new Set(value.map(item => cleanString(item, 120)).filter(Boolean))]
}

export function protectedAccountActionsEnabled(config = {}) {
  return config.schemaVersion === 2
    && config.serverPinLoginEnabled === true
    && config.protectedAccountActionsVersion === STAFF_ACCOUNT_ACTION_CONFIG_VERSION
    && config.protectedAccountActionsEnabled === true
}

export function normalizeProfilePatch(patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('A valid profile update is required.')
  const normalized = {}
  for (const [key, value] of Object.entries(patch)) {
    if (!PROFILE_PATCH_FIELDS.has(key)) throw new Error(`Profile field is not allowed: ${key}`)
    if (ARRAY_FIELDS.has(key)) normalized[key] = cleanStringArray(value)
    else if (key === 'active') normalized.active = value === true
    else if (key === 'role') normalized.role = normalizeSecurityRole(value)
    else normalized[key] = cleanString(value)
  }
  return normalized
}

function normalizedAccess(profile = {}) {
  const values = [
    profile.site,
    profile.location,
    profile.house,
    profile.locationId,
    ...(Array.isArray(profile.authorizedLocations) ? profile.authorizedLocations : []),
    ...(Array.isArray(profile.issueLocationIds) ? profile.issueLocationIds : [])
  ]
  return new Set(values.map(value => String(value || '').trim().toUpperCase()).filter(Boolean))
}

function roleRank(role) {
  return { bht: 1, supervisor: 2, admin: 3 }[normalizeSecurityRole(role)] || 0
}

export function accountMutationRevocationTriggers({ action, before = {}, after = {}, pinChanged = false }) {
  const triggers = []
  if (pinChanged || action === STAFF_ACCOUNT_ACTIONS.SELF_CHANGE_PIN || action === STAFF_ACCOUNT_ACTIONS.RESET_PIN) {
    triggers.push('pin_changed')
  }
  if (before.active === true && after.active === false) triggers.push('profile_deactivated')
  if (action === STAFF_ACCOUNT_ACTIONS.SOFT_DELETE || after.deleted === true) triggers.push('profile_deactivated')
  if (roleRank(after.role) < roleRank(before.role)) triggers.push('role_reduced')

  const beforeAccess = normalizedAccess(before)
  const afterAccess = normalizedAccess(after)
  if ([...beforeAccess].some(value => !afterAccess.has(value))) triggers.push('location_removed')
  if (action === STAFF_ACCOUNT_ACTIONS.END_ALL_SESSIONS) triggers.push('admin_end_all_sessions')
  if (before.active === false && after.active === true) triggers.push('profile_reactivated')
  return [...new Set(triggers)]
}

export function validateManagedProfile(profile = {}) {
  const role = normalizeSecurityRole(profile.role)
  if (!['bht', 'supervisor', 'admin'].includes(role)) return { valid: false, reason: 'invalid_role' }
  const home = validateBhtHomeLocation({ ...profile, role })
  if (!home.valid) return { valid: false, reason: 'invalid_bht_home_location', details: home.reasons }
  return { valid: true, reason: '', home }
}

export function auditSafeProfileChanges(before = {}, after = {}) {
  const changes = {}
  for (const field of PROFILE_PATCH_FIELDS) {
    const oldValue = before[field] ?? null
    const newValue = after[field] ?? null
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) changes[field] = { before: oldValue, after: newValue }
  }
  return changes
}

export function operationFingerprint({ actorProfileId, targetProfileId, action, requestData = {} }) {
  return JSON.stringify({
    actorProfileId: String(actorProfileId || ''),
    targetProfileId: String(targetProfileId || ''),
    action: String(action || ''),
    expectedVersion: Number(requestData.expectedVersion || 0),
    sessionId: String(requestData.sessionId || ''),
    profilePatch: requestData.profilePatch || null,
    hasNewPin: Boolean(requestData.newPin)
  })
}
