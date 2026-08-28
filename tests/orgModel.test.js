import test from 'node:test'
import assert from 'node:assert/strict'
import { getExactOperationalLocationIdsForUser } from '../src/utils/orgModel.js'

test('supervisors receive exact Firestore query locations for their authorized main scope', () => {
  assert.deepEqual(
    getExactOperationalLocationIdsForUser({ role: 'supervisor', authorizedLocations: ['OTC'] }),
    ['mesquite', 'lone_mountain', 'test_house']
  )
  assert.deepEqual(
    getExactOperationalLocationIdsForUser({ role: 'supervisor', authorizedLocations: ['RES'] }),
    ['res']
  )
})

test('BHT scope stays on the one exact home location instead of expanding to every house', () => {
  assert.deepEqual(
    getExactOperationalLocationIdsForUser({
      role: 'bht',
      authorizedLocations: ['OTC', 'TEST_HOUSE'],
      issueLocationIds: ['test_house'],
      locationId: 'test_house'
    }),
    ['test_house']
  )
})

test('admins retain the complete operational location set', () => {
  assert.deepEqual(
    getExactOperationalLocationIdsForUser({ role: 'admin' }),
    ['mesquite', 'lone_mountain', 'test_house', 'res']
  )
})
