import assert from 'node:assert/strict'
import test from 'node:test'
import {
  OFFLINE_ACTION_TYPES,
  SUPPORTED_SECURE_OFFLINE_ACTION_TYPES
} from '../src/services/offlineActionCatalog.js'
import {
  buildOfflineSecurityBinding,
  evaluateOfflineActionForCurrentUser,
  offlineActionLocation
} from '../src/services/offlineSecurityModel.js'
import {
  OFFLINE_REPLAY_ACTION_TYPES,
  evaluateOfflineReplayAuthorization
} from '../functions/src/offlineReplaySecurityModel.js'

const secureUser = Object.freeze({
  id: 'bht_owner',
  authUid: 'staff_owner_uid',
  role: 'bht',
  active: true,
  deleted: false,
  securitySessionVersion: 3,
  securitySessionId: 'session_owner_device_0001',
  securitySessionExpiresAtMs: 1999999999999,
  securityVersion: 4,
  site: 'OTC',
  location: 'OTC',
  house: 'MESQUITE',
  locationId: 'mesquite',
  authorizedLocations: ['OTC'],
  issueLocationIds: ['mesquite']
})

function payloadFor(actionType) {
  const base = { user: secureUser, expectedVersion: 2 }
  if (actionType === OFFLINE_ACTION_TYPES.EOC_SUBMISSION) {
    return { ...base, task: { locationId: 'mesquite', version: 2 } }
  }
  if (actionType.startsWith('shiftDebrief')) {
    return { ...base, context: { locationId: 'mesquite', version: 2 } }
  }
  if (actionType.startsWith('transport')) {
    return { ...base, snapshot: { locationId: 'mesquite' } }
  }
  return { ...base, locationId: 'mesquite' }
}

function actionFor(actionType) {
  const payload = payloadFor(actionType)
  return {
    id: `offline_${actionType}`,
    type: actionType,
    payload,
    ownerProfileId: secureUser.id,
    securityBinding: buildOfflineSecurityBinding(actionType, payload)
  }
}

test('client and server recognize the same complete offline replay catalog', () => {
  assert.equal(SUPPORTED_SECURE_OFFLINE_ACTION_TYPES.length, 11)
  assert.deepEqual(
    [...SUPPORTED_SECURE_OFFLINE_ACTION_TYPES].sort(),
    [...OFFLINE_REPLAY_ACTION_TYPES].sort()
  )
})

for (const actionType of SUPPORTED_SECURE_OFFLINE_ACTION_TYPES) {
  test(`${actionType} binds owner scope and safely handles reconnect identity changes`, () => {
    const action = actionFor(actionType)
    assert.equal(offlineActionLocation(actionType, action.payload), 'mesquite')
    assert.deepEqual(action.securityBinding, {
      schemaVersion: 5,
      ownerProfileId: secureUser.id,
      ownerAuthUid: secureUser.authUid,
      queuedSessionId: secureUser.securitySessionId,
      queuedSecurityVersion: secureUser.securityVersion,
      queuedSessionExpiresAtMs: secureUser.securitySessionExpiresAtMs,
      actionType,
      locationId: 'mesquite',
      expectedVersion: 2
    })
    assert.deepEqual(evaluateOfflineActionForCurrentUser(action, secureUser), {
      disposition: 'allow', reason: ''
    })
    assert.deepEqual(evaluateOfflineActionForCurrentUser(action, {
      ...secureUser, securitySessionId: 'session_owner_device_0002'
    }), { disposition: 'reauthorize', reason: 'new_device_session' })
    assert.deepEqual(evaluateOfflineActionForCurrentUser(action, {
      ...secureUser, id: 'different_bht'
    }), { disposition: 'hold_for_owner', reason: 'wrong_owner' })
    assert.deepEqual(evaluateOfflineActionForCurrentUser(action, {
      ...secureUser, authUid: 'different_auth_uid'
    }), { disposition: 'hold_for_owner', reason: 'wrong_firebase_identity' })
    assert.deepEqual(evaluateOfflineActionForCurrentUser(action, {
      ...secureUser,
      site: 'RES', location: 'RES', house: 'RES', locationId: 'res',
      authorizedLocations: ['RES'], issueLocationIds: ['res']
    }), { disposition: 'needs_review', reason: 'location_access_removed' })

    const replayRequest = {
      ownerProfileId: secureUser.id,
      ownerAuthUid: secureUser.authUid,
      actionType,
      locationId: 'mesquite'
    }
    assert.deepEqual(evaluateOfflineReplayAuthorization({ actor: secureUser, request: replayRequest }), {
      allowed: true, reason: ''
    })
    assert.equal(evaluateOfflineReplayAuthorization({
      actor: secureUser,
      request: { ...replayRequest, ownerProfileId: 'different_bht' }
    }).reason, 'wrong_owner')
    assert.equal(evaluateOfflineReplayAuthorization({
      actor: secureUser,
      request: { ...replayRequest, locationId: 'res' }
    }).reason, 'location_access_removed')
  })
}
