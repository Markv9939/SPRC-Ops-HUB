import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PIN_LENGTH,
  generateSecurePin,
  isObviousPin,
  isValidPin,
  normalizePin
} from '../src/utils/pinPolicy.js'

test('six-digit PIN policy validates and normalizes consistently', () => {
  assert.equal(PIN_LENGTH, 6)
  assert.equal(normalizePin('12a34-567'), '123456')
  assert.equal(isValidPin('482915'), true)
  assert.equal(isValidPin('48291'), false)
  assert.equal(isValidPin('4829157'), false)
})

test('obvious PINs are rejected for creation and reset', () => {
  for (const pin of ['000000', '111111', '123456', '654321', '012345', '987654']) {
    assert.equal(isObviousPin(pin), true, pin)
  }
  assert.equal(isObviousPin('482915'), false)
})

test('secure generator returns allowed six-digit PINs', () => {
  for (let index = 0; index < 100; index += 1) {
    const pin = generateSecurePin()
    assert.equal(isValidPin(pin), true)
    assert.equal(isObviousPin(pin), false)
    assert.equal(Number(pin) >= 100000 && Number(pin) <= 999999, true)
  }
})
