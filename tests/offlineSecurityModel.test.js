import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOfflineSecurityBinding, evaluateOfflineActionForCurrentUser } from '../src/services/offlineSecurityModel.js'

const secureUser = {
  id: 'bht_owner', authUid: 'staff_owner_uid', role: 'bht', securitySessionVersion: 3,
  securitySessionId: 'session_owner_device_0001', securitySessionExpiresAtMs: Date.now() + 100000,
  securityVersion: 4, site: 'OTC', location: 'OTC', locationId: 'mesquite',
  authorizedLocations: ['OTC'], issueLocationIds: ['mesquite']
}

function action(overrides = {}) {
  const payload = { user: secureUser, locationId: 'mesquite', expectedVersion: 2 }
  return {
    id: 'offline_action_1', type: 'bhtIssueReport', payload,
    ownerProfileId: secureUser.id,
    securityBinding: buildOfflineSecurityBinding('bhtIssueReport', payload),
    ...overrides
  }
}

test('secure offline actions bind owner Firebase identity session version location and record version', () => {
  assert.deepEqual(action().securityBinding, {
    schemaVersion: 5,
    ownerProfileId: 'bht_owner',
    ownerAuthUid: 'staff_owner_uid',
    queuedSessionId: 'session_owner_device_0001',
    queuedSecurityVersion: 4,
    queuedSessionExpiresAtMs: secureUser.securitySessionExpiresAtMs,
    actionType: 'bhtIssueReport',
    locationId: 'mesquite',
    expectedVersion: 2
  })
})

test('wrong-owner work is held for its original owner and never reassigned', () => {
  assert.deepEqual(evaluateOfflineActionForCurrentUser(action(), { ...secureUser, id: 'different_bht' }), {
    disposition: 'hold_for_owner', reason: 'wrong_owner'
  })
})

test('new sessions can reauthorize original-owner work when current location access remains', () => {
  const result = evaluateOfflineActionForCurrentUser(action(), {
    ...secureUser,
    securitySessionId: 'session_owner_device_0002',
    securityVersion: 5
  })
  assert.deepEqual(result, { disposition: 'reauthorize', reason: 'security_version_changed' })
})

test('location removal and wrong Firebase mapping stop replay for review', () => {
  assert.deepEqual(evaluateOfflineActionForCurrentUser(action(), {
    ...secureUser,
    site: 'RES', location: 'RES', locationId: 'res', authorizedLocations: ['RES'], issueLocationIds: ['res']
  }), { disposition: 'needs_review', reason: 'location_access_removed' })
  assert.deepEqual(evaluateOfflineActionForCurrentUser(action(), { ...secureUser, authUid: 'different_uid' }), {
    disposition: 'hold_for_owner', reason: 'wrong_firebase_identity'
  })
})

test('legacy unbound work is preserved but requires review after secure cutover', () => {
  assert.deepEqual(evaluateOfflineActionForCurrentUser({ ...action(), securityBinding: null }, secureUser), {
    disposition: 'needs_review', reason: 'legacy_unbound_action'
  })
  assert.deepEqual(evaluateOfflineActionForCurrentUser({ ...action(), securityBinding: null }, {
    ...secureUser, securitySessionVersion: 0, securitySessionId: '', authUid: ''
  }), { disposition: 'allow', reason: 'legacy_compatibility' })
})
