import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CORE_RESET_STORAGE_KEY,
  CORE_RESET_VERSION,
  browserNeedsCoreReset
} from '../src/utils/coreResetCutover.js'

function storageWith(value) {
  return {
    getItem(key) {
      assert.equal(key, CORE_RESET_STORAGE_KEY)
      return value
    }
  }
}

test('browser data resets when the reset marker is missing or stale', () => {
  assert.equal(browserNeedsCoreReset(storageWith(null)), true)
  assert.equal(browserNeedsCoreReset(storageWith('older-reset')), true)
})

test('browser data is not cleared again after the current reset succeeds', () => {
  assert.equal(browserNeedsCoreReset(storageWith(CORE_RESET_VERSION)), false)
})
