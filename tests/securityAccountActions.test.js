import assert from 'node:assert/strict'
import test from 'node:test'
import {
  performSecurityAccountActionWithAdapters,
  securityAccountActionsConfigEnabled,
  securityOperationId
} from '../src/services/securityAccountActionsModel.js'

const enabledConfig = {
  schemaVersion: 2,
  serverPinLoginEnabled: true,
  protectedAccountActionsVersion: 4,
  protectedAccountActionsEnabled: true
}

test('Phase 4 client action boundary is exact and disabled safely', async () => {
  assert.equal(securityAccountActionsConfigEnabled(enabledConfig), true)
  assert.equal(securityAccountActionsConfigEnabled({ ...enabledConfig, protectedAccountActionsEnabled: false }), false)
  let called = false
  const result = await performSecurityAccountActionWithAdapters({ action: 'end_all_sessions' }, {
    loadConfig: async () => ({ ...enabledConfig, protectedAccountActionsVersion: 3 }),
    createId: () => '01234567-89ab-cdef-0123-456789abcdef',
    callAction: async () => { called = true }
  })
  assert.deepEqual(result, { status: 'disabled' })
  assert.equal(called, false)
})

test('transient retry reuses the same idempotency operation ID', async () => {
  const calls = []
  const result = await performSecurityAccountActionWithAdapters({
    action: 'reset_pin',
    targetProfileId: 'bht_one',
    newPin: '481593'
  }, {
    loadConfig: async () => enabledConfig,
    createId: () => '01234567-89ab-cdef-0123-456789abcdef',
    callAction: async payload => {
      calls.push(payload)
      if (calls.length === 1) throw { code: 'functions/unavailable' }
      return { allDevicesRevoked: true, cleanupStatus: 'completed' }
    }
  })
  assert.equal(result.status, 'completed')
  assert.equal(calls.length, 2)
  assert.equal(calls[0].operationId, calls[1].operationId)
  assert.equal(calls[0].newPin, '481593')
})

test('permission failures are not retried and operation IDs are valid', async () => {
  let calls = 0
  await assert.rejects(performSecurityAccountActionWithAdapters({ action: 'soft_delete' }, {
    loadConfig: async () => enabledConfig,
    createId: () => '01234567-89ab-cdef-0123-456789abcdef',
    callAction: async () => {
      calls += 1
      throw { code: 'functions/permission-denied', message: 'Supervisor may only manage a BHT.' }
    }
  }), /Supervisor may only manage a BHT/)
  assert.equal(calls, 1)
  assert.match(securityOperationId(() => '01234567-89ab-cdef-0123-456789abcdef'), /^account_[a-zA-Z0-9_-]{16,}$/)
})
