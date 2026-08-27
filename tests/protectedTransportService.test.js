import test from 'node:test'
import assert from 'node:assert/strict'
import { protectedTransportClaimEnabled } from '../src/services/protectedTransportModel.js'

test('protected transport client activates only for the exact workflow claim', () => {
  assert.equal(protectedTransportClaimEnabled({}), false)
  assert.equal(protectedTransportClaimEnabled({ workflowSecurityVersion: 5, secureWorkflows: ['transports'] }), false)
  assert.equal(protectedTransportClaimEnabled({ workflowSecurityVersion: 6, secureWorkflows: ['eoc'] }), false)
  assert.equal(protectedTransportClaimEnabled({ workflowSecurityVersion: 6, secureWorkflows: ['transports'] }), true)
})
