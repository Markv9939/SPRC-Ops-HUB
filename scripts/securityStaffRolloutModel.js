import { SECURITY_WORKFLOWS } from '../functions/src/workflowSecurityModel.js'
import { normalizeSecurityRole, validateBhtHomeLocation } from '../functions/src/securityFoundationModel.js'

export const SYNTHETIC_SECURITY_CANARY_PROFILE_IDS = Object.freeze([
  'test_supervisor',
  'test_bht_shift_1',
  'test_bht_shift_2'
])

const EXCLUDED_SECURITY_TEST_PROFILE_IDS = Object.freeze([
  ...SYNTHETIC_SECURITY_CANARY_PROFILE_IDS,
  'test_rtc_shift_1',
  'security_canary_otc_bht'
])

export const MAX_STAFF_COHORT_SIZE = 12

export function isSyntheticSecurityProfileId(profileId) {
  const normalized = String(profileId || '').trim().toLowerCase()
  return EXCLUDED_SECURITY_TEST_PROFILE_IDS.includes(normalized)
    || /^(test_|security_canary_|phase\d+_|emulator_)/.test(normalized)
}

function stringValues(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(item => String(item || '').trim())
    .filter(Boolean))]
}

function sameValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameSet(left, right) {
  const leftValues = [...stringValues(left)].sort()
  const rightValues = [...stringValues(right)].sort()
  return sameValues(leftValues, rightValues)
}

export function normalizeStaffCohortProfileIds(value) {
  const profileIds = stringValues(value)
  if (profileIds.length === 0) throw new Error('Choose at least one staff profile for the cohort.')
  if (profileIds.length > MAX_STAFF_COHORT_SIZE) {
    throw new Error(`A rollout cohort may contain at most ${MAX_STAFF_COHORT_SIZE} profiles.`)
  }
  if (profileIds.some(profileId => !/^[a-zA-Z0-9_-]{2,128}$/.test(profileId))) {
    throw new Error('Every cohort profile ID must use only letters, numbers, underscores, or hyphens.')
  }
  if (profileIds.some(isSyntheticSecurityProfileId)) {
    throw new Error('The real-staff cohort cannot include a synthetic canary profile.')
  }
  return profileIds
}

export function evaluateStaffCohortProfiles({ profileIds, profilesById = {}, locationId } = {}) {
  const requestedProfileIds = normalizeStaffCohortProfileIds(profileIds)
  const expectedLocationId = String(locationId || '').trim().toLowerCase()
  if (!expectedLocationId) throw new Error('Choose one exact home location for the cohort.')

  const profiles = requestedProfileIds.map(profileId => {
    const evidence = profilesById[profileId] || {}
    const profile = evidence.profile || {}
    const role = normalizeSecurityRole(profile.role)
    const home = validateBhtHomeLocation(profile)
    const credentialSource = evidence.serverCredentialExists ? 'server_credential'
      : evidence.legacyPinHashPresent ? 'legacy_pin_hash'
        : 'missing'
    const credentialReady = evidence.serverCredentialExists
      ? evidence.serverCredentialActive === true && evidence.credentialUnique === true
      : evidence.legacyPinHashPresent === true && evidence.credentialUnique === true
    const reasons = []

    if (evidence.exists !== true) reasons.push('missing_profile')
    if (profile.active !== true) reasons.push('inactive_profile')
    if (profile.deleted === true || profile.deletedAt) reasons.push('deleted_profile')
    if (role !== 'bht') reasons.push('bht_or_tech_required')
    if (!home.valid) reasons.push(...home.reasons)
    if (home.valid && home.homeLocationId !== expectedLocationId) reasons.push('wrong_home_location')
    if (!credentialReady) reasons.push('pin_credential_not_ready_or_not_unique')
    if (evidence.identityMappingValid !== true) reasons.push('identity_mapping_conflict')
    if (evidence.alreadyEnrolled === true) reasons.push('already_enrolled')

    return {
      profileId,
      role,
      homeLocationId: home.homeLocationId,
      mainLocation: home.mainLocation,
      credentialSource,
      ready: reasons.length === 0,
      reasons: [...new Set(reasons)]
    }
  })

  return {
    ready: profiles.every(profile => profile.ready),
    locationId: expectedLocationId,
    roleGroup: 'bht',
    profileCount: profiles.length,
    profiles
  }
}

export function validateStaffRolloutBoundary({ foundationConfig = {}, workflowConfig = {}, authPolicy = {}, releaseId } = {}) {
  const foundationIds = stringValues(foundationConfig.enabledProfileIds)
  const workflowIds = stringValues(workflowConfig.enabledProfileIds)
  const fullWorkflowOrder = Array.isArray(workflowConfig.workflows)
    ? workflowConfig.workflows.map(value => String(value || '').trim())
    : []
  const valid = foundationConfig.schemaVersion === 2
    && foundationConfig.serverPinLoginEnabled === true
    && foundationConfig.clientBootstrapVersion === 3
    && foundationConfig.clientBootstrapEnabled === true
    && foundationConfig.protectedAccountActionsVersion === 4
    && foundationConfig.protectedAccountActionsEnabled === true
    && foundationConfig.offlineReplayVersion === 5
    && foundationConfig.offlineReplayEnabled === true
    && foundationConfig.rolloutState === 'production_canary'
    && foundationConfig.releaseId === releaseId
    && workflowConfig.schemaVersion === 6
    && workflowConfig.enabled === true
    && workflowConfig.rolloutState === 'production_canary'
    && workflowConfig.releaseId === releaseId
    && sameValues(fullWorkflowOrder, SECURITY_WORKFLOWS)
    && sameSet(foundationIds, workflowIds)
    && SYNTHETIC_SECURITY_CANARY_PROFILE_IDS.every(profileId => foundationIds.includes(profileId))
    && authPolicy.authScopeEnforced !== true

  if (!valid) {
    throw new Error('Current protected settings do not match the completed synthetic canary boundary.')
  }
  return { currentProfileIds: foundationIds, workflows: [...SECURITY_WORKFLOWS] }
}

export function planStaffCohortEnrollment({
  foundationConfig,
  workflowConfig,
  authPolicy,
  releaseId,
  cohort
} = {}) {
  const boundary = validateStaffRolloutBoundary({ foundationConfig, workflowConfig, authPolicy, releaseId })
  if (!cohort?.ready || !Array.isArray(cohort.profiles) || cohort.profiles.length === 0) {
    throw new Error('Every selected staff profile must pass the cohort preflight.')
  }
  const targetProfileIds = cohort.profiles.map(profile => profile.profileId)
  if (targetProfileIds.some(profileId => boundary.currentProfileIds.includes(profileId))) {
    throw new Error('The selected cohort contains a profile that is already enrolled.')
  }
  return {
    locationId: cohort.locationId,
    roleGroup: cohort.roleGroup,
    addedProfileIds: targetProfileIds,
    nextEnabledProfileIds: [...boundary.currentProfileIds, ...targetProfileIds],
    workflows: boundary.workflows,
    preservesCompatibilityFallback: true,
    keepsGlobalStrictAuthorizationOff: true,
    keepsAppCheckEnforcementOff: true,
    endsTargetSessions: true,
    incrementsTargetSecurityVersions: true,
    requiresRefreshTokenRevocation: true
  }
}

export function validateStaffRolloutBackup(backup = {}, {
  projectId,
  releaseId,
  locationId,
  profileIds
} = {}) {
  const expectedProfileIds = normalizeStaffCohortProfileIds(profileIds)
  if (backup.schemaVersion !== 1
    || backup.projectId !== projectId
    || backup.releaseId !== releaseId
    || backup.locationId !== String(locationId || '').trim().toLowerCase()
    || !sameSet(backup.profileIds, expectedProfileIds)
    || !backup.config?.['appSettings/securityFoundation']?.exists
    || !backup.config?.['appSettings/securityWorkflows']?.exists
    || !backup.config?.['appSettings/authPolicy']?.exists) {
    throw new Error('The rollback backup does not match this project, release, location, and exact cohort.')
  }
  validateStaffRolloutBoundary({
    foundationConfig: backup.config['appSettings/securityFoundation'].data,
    workflowConfig: backup.config['appSettings/securityWorkflows'].data,
    authPolicy: backup.config['appSettings/authPolicy'].data,
    releaseId
  })
  return true
}
