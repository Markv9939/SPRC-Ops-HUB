import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildManagedUserQueryPlan,
  mergeManagedUserDocumentGroups
} from '../src/services/userManagementQueryModel.js'

test('admins retain the single global Users query', () => {
  assert.deepEqual(buildManagedUserQueryPlan({ isAdmin: true, managedMainLocations: ['OTC'] }), [
    { key: 'all-users', kind: 'all' }
  ])
})

test('supervisors receive only canonical BHT/tech queries for their locations', () => {
  assert.deepEqual(buildManagedUserQueryPlan({
    managedMainLocations: ['OTC', 'RES', 'OTC', 'invalid']
  }), [
    { key: 'otc-bht', kind: 'scoped-bht', location: 'OTC', role: 'bht' },
    { key: 'otc-tech', kind: 'scoped-bht', location: 'OTC', role: 'tech' },
    { key: 'res-bht', kind: 'scoped-bht', location: 'RES', role: 'bht' },
    { key: 'res-tech', kind: 'scoped-bht', location: 'RES', role: 'tech' }
  ])
  assert.deepEqual(buildManagedUserQueryPlan({ managedMainLocations: [] }), [])
})

test('multiple scoped query snapshots merge without duplicate staff rows', () => {
  const first = { id: 'bht_one' }
  const duplicate = { id: 'bht_one' }
  const second = { id: 'bht_two' }
  assert.deepEqual(mergeManagedUserDocumentGroups([[first], [duplicate, second]]), [duplicate, second])
})
