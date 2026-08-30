function sorted(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))].sort()
}

function sameValues(left, right) {
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right))
}

export function summarizeIdentityCanaryEvidence({
  expectedProfileIds = [],
  foundationConfig = {},
  workflowConfig = {},
  profiles = [],
  mappings = [],
  sessions = [],
  rollbackAnchorVerified = false,
  rollbackAnchorMatchesCurrent = false
} = {}) {
  const expected = sorted(expectedProfileIds)
  const profileById = new Map(profiles.map(profile => [String(profile?.profileId || '').trim(), profile]))
  const mappingById = new Map(mappings.map(mapping => [String(mapping?.profileId || '').trim(), mapping]))
  const enabledFoundation = sorted(foundationConfig.enabledProfileIds)
  const enabledWorkflows = sorted(workflowConfig.enabledProfileIds)
  const configuredWorkflows = sorted(workflowConfig.workflows)
  const profileStatus = expected.map(profileId => ({
    profileId,
    role: String(profileById.get(profileId)?.role || ''),
    valid: profileById.get(profileId)?.valid === true,
    securityVersion: Number(profileById.get(profileId)?.securityVersion || 0),
    mapped: mappingById.get(profileId)?.exists === true,
    sessions: sessions.filter(session => String(session?.profileId || '') === profileId).length,
    activeSessions: sessions.filter(session => String(session?.profileId || '') === profileId && session?.active === true).length
  }))
  const exactCohort = sameValues(enabledFoundation, expected) && sameValues(enabledWorkflows, expected)
  const identityUsersOnly = configuredWorkflows.length === 1 && configuredWorkflows[0] === 'identity_users'
  const foundationBoundaryValid = foundationConfig.schemaVersion === 2
    && foundationConfig.serverPinLoginEnabled === true
    && foundationConfig.clientBootstrapVersion === 3
    && foundationConfig.clientBootstrapEnabled === true
    && foundationConfig.protectedAccountActionsVersion === 4
    && foundationConfig.protectedAccountActionsEnabled === true
    && foundationConfig.offlineReplayEnabled === false
    && foundationConfig.rolloutState === 'production_canary'
  const workflowBoundaryValid = workflowConfig.schemaVersion === 6
    && workflowConfig.enabled === true
    && workflowConfig.rolloutState === 'production_canary'
    && identityUsersOnly
  const missingProfiles = profileStatus.filter(profile => !profile.valid).map(profile => profile.profileId)
  const missingMappings = profileStatus.filter(profile => !profile.mapped).map(profile => profile.profileId)

  return {
    exactCohort,
    identityUsersOnly,
    foundationBoundaryValid,
    workflowBoundaryValid,
    rollbackAnchorVerified: rollbackAnchorVerified === true,
    rollbackAnchorMatchesCurrent: rollbackAnchorMatchesCurrent === true,
    missingProfiles,
    missingMappings,
    sessionCounts: {
      total: sessions.length,
      active: sessions.filter(session => session?.active === true).length,
      inactive: sessions.filter(session => session?.active !== true).length
    },
    profiles: profileStatus,
    readyForRemainingLiveJourneys: exactCohort
      && foundationBoundaryValid
      && workflowBoundaryValid
      && missingProfiles.length === 0
      && rollbackAnchorVerified === true
      && rollbackAnchorMatchesCurrent === true
  }
}
