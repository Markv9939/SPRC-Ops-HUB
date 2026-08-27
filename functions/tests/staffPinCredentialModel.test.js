import assert from 'node:assert/strict'
import test from 'node:test'
import {
  containsCredentialMaterial,
  createServerPinCredential,
  deriveLegacyPinHash,
  derivePinLookupKey,
  derivePrivateIdentifier,
  deriveStableStaffAuthUid,
  normalizeStaffPin,
  sanitizeStaffProfile,
  verifyServerPinCredential
} from '../src/staffPinCredentialModel.js'

const secret = 'phase-2-test-secret-that-is-at-least-thirty-two-characters-long'

test('server PIN credentials use salted scrypt and verify without exposing the PIN', async () => {
  const first = await createServerPinCredential('275184', secret, { salt: 'first-test-salt' })
  const second = await createServerPinCredential('275184', secret, { salt: 'second-test-salt' })
  assert.equal(first.algorithm, 'scrypt-v1')
  assert.notEqual(first.hash, second.hash)
  assert.equal(first.lookupKey, second.lookupKey)
  assert.equal(await verifyServerPinCredential('275184', secret, first), true)
  assert.equal(await verifyServerPinCredential('000000', secret, first), false)
  assert.notEqual(first.hash, deriveLegacyPinHash('275184'))
  assert.equal(Object.values(first).includes('275184'), false)
})

test('lookup, device, operation, and Firebase identity keys are stable and purpose-separated', () => {
  assert.equal(derivePinLookupKey('275184', secret), derivePinLookupKey('275184', secret))
  assert.notEqual(derivePinLookupKey('275184', secret), derivePinLookupKey('275185', secret))
  assert.equal(deriveStableStaffAuthUid('profile_a', secret), deriveStableStaffAuthUid('profile_a', secret))
  assert.notEqual(deriveStableStaffAuthUid('profile_a', secret), deriveStableStaffAuthUid('profile_b', secret))
  assert.notEqual(
    derivePrivateIdentifier('same-value', 'device-purpose', secret),
    derivePrivateIdentifier('same-value', 'operation-purpose', secret)
  )
})

test('six-digit validation and minimum server-secret length fail closed', async () => {
  assert.equal(normalizeStaffPin(' 275184 '), '275184')
  assert.throws(() => normalizeStaffPin('12345'), /six-digit/i)
  assert.throws(() => derivePinLookupKey('275184', 'short'), /at least 32/i)
  await assert.rejects(() => createServerPinCredential('not-pin', secret), /six-digit/i)
})

test('sanitized profiles retain workflow scope but remove credentials and internal fields', () => {
  const sanitized = sanitizeStaffProfile('bht_a', {
    name: 'BHT A', role: 'bht', active: true, pinHash: 'secret-hash', securityVersion: 9,
    site: 'OTC', location: 'OTC', house: 'TEST_HOUSE', locationId: 'test_house',
    shiftId: 'shift_1', vanId: 'van_test', vanIds: ['van_test'],
    authorizedLocations: ['OTC', 'TEST_HOUSE'], issueLocationIds: ['test_house']
  })
  assert.equal(sanitized.id, 'bht_a')
  assert.equal(sanitized.locationId, 'test_house')
  assert.equal('pinHash' in sanitized, false)
  assert.equal(sanitized.securityVersion, 9)
  assert.equal('active' in sanitized, false)
  assert.equal(containsCredentialMaterial(sanitized), false)
  assert.equal(containsCredentialMaterial({ nested: { pinHash: 'x' } }), true)
})
