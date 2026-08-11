import assert from 'node:assert/strict'
import test from 'node:test'
import { EOC_ISSUE_FEATURE_DEFAULTS, normalizeEocIssueFeatureFlags } from '../src/utils/featureFlags.js'

test('new EOC and issue features default off until explicitly enabled', () => {
  assert.deepEqual(normalizeEocIssueFeatureFlags(), EOC_ISSUE_FEATURE_DEFAULTS)
  assert.deepEqual(normalizeEocIssueFeatureFlags({ recurrence: true, photos: 'yes' }), {
    ...EOC_ISSUE_FEATURE_DEFAULTS,
    recurrence: true
  })
})
