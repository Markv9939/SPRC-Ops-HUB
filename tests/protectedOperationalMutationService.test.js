import test from 'node:test'
import assert from 'node:assert/strict'
import { protectedWorkflowClaimEnabled } from '../src/services/protectedOperationalMutationModel.js'

test('protected operational mutations require the exact versioned workflow claim', () => {
  assert.equal(protectedWorkflowClaimEnabled({ workflowSecurityVersion: 6, secureWorkflows: ['eoc'] }, 'eoc'), true)
  assert.equal(protectedWorkflowClaimEnabled({ workflowSecurityVersion: 5, secureWorkflows: ['eoc'] }, 'eoc'), false)
  assert.equal(protectedWorkflowClaimEnabled({ workflowSecurityVersion: 6, secureWorkflows: ['issues_feedback_audit'] }, 'eoc'), false)
})
