import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateOfflineReplayAuthorization, offlineReplayEnabled } from '../src/offlineReplaySecurityModel.js'

const actor = {
  id: 'bht_owner', authUid: 'staff_owner_uid', name: 'BHT Owner', role: 'bht', active: true, deleted: false,
  site: 'OTC', location: 'OTC', house: 'MESQUITE', locationId: 'mesquite',
  authorizedLocations: ['OTC'], issueLocationIds: ['mesquite']
}

const request = {
  ownerProfileId: 'bht_owner', ownerAuthUid: 'staff_owner_uid', actionType: 'eocSubmission', locationId: 'mesquite'
}

test('offline replay has an exact dormant version boundary', () => {
  assert.equal(offlineReplayEnabled({ schemaVersion: 2, serverPinLoginEnabled: true, offlineReplayVersion: 5, offlineReplayEnabled: true }), true)
  assert.equal(offlineReplayEnabled({ schemaVersion: 2, serverPinLoginEnabled: true, offlineReplayVersion: 5 }), false)
})

test('the mapped original BHT may replay only work in the current home scope', () => {
  assert.deepEqual(evaluateOfflineReplayAuthorization({ actor, request }), { allowed: true, reason: '' })
  assert.deepEqual(evaluateOfflineReplayAuthorization({ actor, request: { ...request, locationId: 'res' } }), {
    allowed: false, reason: 'location_access_removed'
  })
})

test('wrong owner, wrong Firebase identity, malformed profile, and unsupported action fail closed', () => {
  assert.equal(evaluateOfflineReplayAuthorization({ actor, request: { ...request, ownerProfileId: 'other' } }).reason, 'wrong_owner')
  assert.equal(evaluateOfflineReplayAuthorization({ actor, request: { ...request, ownerAuthUid: 'other_uid' } }).reason, 'wrong_firebase_identity')
  assert.equal(evaluateOfflineReplayAuthorization({ actor: { ...actor, house: null, locationId: null, issueLocationIds: [] }, request }).reason, 'invalid_bht_home_location')
  assert.equal(evaluateOfflineReplayAuthorization({ actor, request: { ...request, actionType: 'deleteEverything' } }).reason, 'unsupported_action')
})
