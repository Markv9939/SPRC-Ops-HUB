import test from 'node:test'
import assert from 'node:assert/strict'
import { actorCanCreateTransport, newProtectedTransport } from '../src/transportSecurityModel.js'

test('single-home BHT transport scope and supervisor/admin scope are enforced', () => {
  const bht = { id: 'bht', name: 'BHT', role: 'bht', location: 'OTC', locationId: 'test_house', house: 'test_house', authorizedLocations: ['test_house'] }
  assert.equal(actorCanCreateTransport(bht, 'OTC'), true)
  assert.equal(actorCanCreateTransport(bht, 'RES'), false)
  assert.equal(actorCanCreateTransport({ role: 'bht', authorizedLocations: [] }, 'OTC'), false)
  assert.equal(actorCanCreateTransport({ role: 'supervisor', authorizedLocations: ['OTC'] }, 'OTC'), true)
  assert.equal(actorCanCreateTransport({ role: 'supervisor', authorizedLocations: ['OTC'] }, 'RES'), false)
  assert.equal(actorCanCreateTransport({ role: 'admin' }, 'RES'), true)
})

test('protected transport creation derives owner identity and starts at version one', () => {
  const now = { timestamp: true }
  const record = newProtectedTransport({
    actor: { id: 'bht', name: 'BHT', role: 'bht', location: 'OTC', locationId: 'test_house', house: 'test_house', authorizedLocations: ['test_house'] },
    site: 'OTC',
    now
  })
  assert.equal(record.createdByUserId, 'bht')
  assert.equal(record.status, 'open')
  assert.equal(record.version, 1)
  assert.equal(record.securityMutationVersion, 6)
})
