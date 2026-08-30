import test from 'node:test'
import assert from 'node:assert/strict'
import { SECURITY_WORKFLOWS } from '../functions/src/workflowSecurityModel.js'
import {
  SYNTHETIC_SECURITY_CANARY_PROFILE_IDS,
  evaluateStaffCohortProfiles,
  normalizeStaffCohortProfileIds,
  planStaffCohortEnrollment,
  validateStaffRolloutBackup,
  validateStaffRolloutBoundary
} from '../scripts/securityStaffRolloutModel.js'

const releaseId = 'security-foundation-test-house-v1'

function configs() {
  return {
    foundationConfig: {
      schemaVersion: 2,
      serverPinLoginEnabled: true,
      clientBootstrapVersion: 3,
      clientBootstrapEnabled: true,
      protectedAccountActionsVersion: 4,
      protectedAccountActionsEnabled: true,
      offlineReplayVersion: 5,
      offlineReplayEnabled: true,
      rolloutState: 'production_canary',
      enabledProfileIds: [...SYNTHETIC_SECURITY_CANARY_PROFILE_IDS],
      releaseId
    },
    workflowConfig: {
      schemaVersion: 6,
      enabled: true,
      workflows: [...SECURITY_WORKFLOWS],
      rolloutState: 'production_canary',
      enabledProfileIds: [...SYNTHETIC_SECURITY_CANARY_PROFILE_IDS],
      releaseId
    },
    authPolicy: { authScopeEnforced: false }
  }
}

function readyProfile(overrides = {}) {
  return {
    exists: true,
    profile: {
      role: 'BHT',
      active: true,
      deleted: false,
      locationId: 'mesquite',
      site: 'OTC',
      ...overrides
    },
    serverCredentialExists: true,
    serverCredentialActive: true,
    legacyPinHashPresent: false,
    credentialUnique: true,
    identityMappingValid: true,
    alreadyEnrolled: false
  }
}

test('normalizes a small exact real-staff cohort and rejects synthetic or oversized cohorts', () => {
  assert.deepEqual(normalizeStaffCohortProfileIds(['staff_1', 'staff_1', 'staff_2']), ['staff_1', 'staff_2'])
  assert.throws(() => normalizeStaffCohortProfileIds([]), /at least one/)
  assert.throws(() => normalizeStaffCohortProfileIds(['test_bht_shift_1']), /synthetic/)
  assert.throws(() => normalizeStaffCohortProfileIds(['test_rtc_shift_1']), /synthetic/)
  assert.throws(() => normalizeStaffCohortProfileIds(['security_canary_otc_bht']), /synthetic/)
  assert.throws(() => normalizeStaffCohortProfileIds(Array.from({ length: 13 }, (_, index) => `staff_${index}`)), /at most 12/)
})

test('accepts active BHT and tech profiles at one exact home location with unique PIN credentials', () => {
  const cohort = evaluateStaffCohortProfiles({
    profileIds: ['staff_1', 'staff_2'],
    locationId: 'mesquite',
    profilesById: {
      staff_1: readyProfile(),
      staff_2: readyProfile({ role: 'tech' })
    }
  })
  assert.equal(cohort.ready, true)
  assert.equal(cohort.profileCount, 2)
  assert.equal(cohort.roleGroup, 'bht')
  assert.deepEqual(cohort.profiles.map(profile => profile.role), ['bht', 'bht'])
})

test('blocks inactive, supervisor, wrong-location, malformed, duplicate-PIN, mapped-conflict, and enrolled profiles', () => {
  const cohort = evaluateStaffCohortProfiles({
    profileIds: ['inactive', 'supervisor', 'wrong_location', 'malformed', 'duplicate', 'mapping', 'enrolled'],
    locationId: 'mesquite',
    profilesById: {
      inactive: readyProfile({ active: false }),
      supervisor: readyProfile({ role: 'supervisor' }),
      wrong_location: readyProfile({ locationId: 'lone_mountain' }),
      malformed: readyProfile({ authorizedLocations: ['mesquite', 'lone_mountain'] }),
      duplicate: { ...readyProfile(), credentialUnique: false },
      mapping: { ...readyProfile(), identityMappingValid: false },
      enrolled: { ...readyProfile(), alreadyEnrolled: true }
    }
  })
  assert.equal(cohort.ready, false)
  assert.deepEqual(cohort.profiles.map(profile => profile.ready), [false, false, false, false, false, false, false])
  assert.ok(cohort.profiles[0].reasons.includes('inactive_profile'))
  assert.ok(cohort.profiles[1].reasons.includes('bht_or_tech_required'))
  assert.ok(cohort.profiles[2].reasons.includes('wrong_home_location'))
  assert.ok(cohort.profiles[3].reasons.includes('multiple_home_locations'))
  assert.ok(cohort.profiles[4].reasons.includes('pin_credential_not_ready_or_not_unique'))
  assert.ok(cohort.profiles[5].reasons.includes('identity_mapping_conflict'))
  assert.ok(cohort.profiles[6].reasons.includes('already_enrolled'))
})

test('requires the complete synthetic canary boundary with strict auth still off', () => {
  assert.deepEqual(validateStaffRolloutBoundary({ ...configs(), releaseId }).workflows, SECURITY_WORKFLOWS)
  const strict = configs()
  strict.authPolicy.authScopeEnforced = true
  assert.throws(() => validateStaffRolloutBoundary({ ...strict, releaseId }), /completed synthetic canary boundary/)
  const missingWorkflow = configs()
  missingWorkflow.workflowConfig.workflows = SECURITY_WORKFLOWS.slice(0, -1)
  assert.throws(() => validateStaffRolloutBoundary({ ...missingWorkflow, releaseId }), /completed synthetic canary boundary/)
  const mismatchedIds = configs()
  mismatchedIds.workflowConfig.enabledProfileIds = ['test_supervisor']
  assert.throws(() => validateStaffRolloutBoundary({ ...mismatchedIds, releaseId }), /completed synthetic canary boundary/)
})

test('plans an additive cohort without broad activation or enforcement changes', () => {
  const cohort = evaluateStaffCohortProfiles({
    profileIds: ['staff_1', 'staff_2'],
    locationId: 'mesquite',
    profilesById: { staff_1: readyProfile(), staff_2: readyProfile({ role: 'tech' }) }
  })
  const plan = planStaffCohortEnrollment({ ...configs(), releaseId, cohort })
  assert.deepEqual(plan.addedProfileIds, ['staff_1', 'staff_2'])
  assert.deepEqual(plan.nextEnabledProfileIds, [...SYNTHETIC_SECURITY_CANARY_PROFILE_IDS, 'staff_1', 'staff_2'])
  assert.equal(plan.preservesCompatibilityFallback, true)
  assert.equal(plan.keepsGlobalStrictAuthorizationOff, true)
  assert.equal(plan.keepsAppCheckEnforcementOff, true)
  assert.equal(plan.endsTargetSessions, true)
  assert.equal(plan.incrementsTargetSecurityVersions, true)
})

test('rollback backup must match the exact project, release, location, cohort, and prior boundary', () => {
  const current = configs()
  const backup = {
    schemaVersion: 1,
    projectId: 'sprc-tx-l',
    releaseId,
    locationId: 'mesquite',
    profileIds: ['staff_1'],
    config: {
      'appSettings/securityFoundation': { exists: true, data: current.foundationConfig },
      'appSettings/securityWorkflows': { exists: true, data: current.workflowConfig },
      'appSettings/authPolicy': { exists: true, data: current.authPolicy }
    }
  }
  assert.equal(validateStaffRolloutBackup(backup, {
    projectId: 'sprc-tx-l', releaseId, locationId: 'mesquite', profileIds: ['staff_1']
  }), true)
  assert.throws(() => validateStaffRolloutBackup(backup, {
    projectId: 'sprc-tx-l', releaseId, locationId: 'res', profileIds: ['staff_1']
  }), /does not match/)
})
