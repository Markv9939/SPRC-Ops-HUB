import assert from 'node:assert/strict'
import test from 'node:test'
import {
  STAFF_ACCOUNT_ACTIONS,
  accountMutationRevocationTriggers,
  auditSafeProfileChanges,
  normalizeProfilePatch,
  protectedAccountActionsEnabled,
  validateManagedProfile
} from '../src/staffAccountSecurityModel.js'

const bht = {
  name: 'Taylor T',
  role: 'bht',
  active: true,
  site: 'OTC',
  location: 'OTC',
  house: 'MESQUITE',
  locationId: 'mesquite',
  authorizedLocations: ['OTC'],
  issueLocationIds: ['mesquite']
}

test('Phase 4 actions require every dormant version gate', () => {
  assert.equal(STAFF_ACCOUNT_ACTIONS.CREATE_PROFILE, 'create_profile')
  assert.equal(protectedAccountActionsEnabled({
    schemaVersion: 2,
    serverPinLoginEnabled: true,
    protectedAccountActionsVersion: 4,
    protectedAccountActionsEnabled: true
  }), true)
  assert.equal(protectedAccountActionsEnabled({ schemaVersion: 2, serverPinLoginEnabled: true }), false)
  assert.equal(protectedAccountActionsEnabled({
    schemaVersion: 2,
    serverPinLoginEnabled: true,
    protectedAccountActionsVersion: 3,
    protectedAccountActionsEnabled: true
  }), false)
})

test('profile patches accept only account fields and normalize tech to BHT', () => {
  assert.deepEqual(normalizeProfilePatch({ role: 'tech', vanIds: ['VAN_1', 'VAN_1'], active: 1 }), {
    role: 'bht',
    vanIds: ['VAN_1'],
    active: false
  })
  assert.throws(() => normalizeProfilePatch({ securityVersion: 99 }), /not allowed/)
  assert.throws(() => normalizeProfilePatch({ pinHash: 'secret' }), /not allowed/)
})

test('valid BHT profiles have exactly one current home location', () => {
  assert.equal(validateManagedProfile(bht).valid, true)
  assert.equal(validateManagedProfile({ ...bht, locationId: '', house: '', issueLocationIds: [] }).valid, false)
  assert.equal(validateManagedProfile({ ...bht, issueLocationIds: ['mesquite', 'lone_mountain'] }).valid, false)
})

test('security-sensitive changes identify every all-device revocation trigger', () => {
  assert.deepEqual(accountMutationRevocationTriggers({
    action: STAFF_ACCOUNT_ACTIONS.RESET_PIN,
    before: bht,
    after: bht,
    pinChanged: true
  }), ['pin_changed'])
  assert.deepEqual(accountMutationRevocationTriggers({
    action: STAFF_ACCOUNT_ACTIONS.SAVE_PROFILE,
    before: { ...bht, role: 'supervisor', authorizedLocations: ['OTC', 'RES'] },
    after: { ...bht, role: 'bht', authorizedLocations: ['OTC'] }
  }), ['role_reduced', 'location_removed'])
  assert.deepEqual(accountMutationRevocationTriggers({
    action: STAFF_ACCOUNT_ACTIONS.SAVE_PROFILE,
    before: bht,
    after: { ...bht, active: false }
  }), ['profile_deactivated'])
  assert.deepEqual(accountMutationRevocationTriggers({
    action: STAFF_ACCOUNT_ACTIONS.END_ALL_SESSIONS,
    before: bht,
    after: bht
  }), ['admin_end_all_sessions'])
})

test('ordinary operational edits do not revoke sessions and audit changes exclude credential fields', () => {
  const after = { ...bht, shiftId: 'shift_2', vanIds: ['van_2'], pinHash: 'must-not-appear' }
  assert.deepEqual(accountMutationRevocationTriggers({
    action: STAFF_ACCOUNT_ACTIONS.SAVE_PROFILE,
    before: bht,
    after
  }), [])
  const changes = auditSafeProfileChanges(bht, after)
  assert.deepEqual(changes.shiftId, { before: null, after: 'shift_2' })
  assert.equal('pinHash' in changes, false)
})
