import assert from 'node:assert/strict'
import test from 'node:test'
import { APP_FEEDBACK_STATUSES, buildAppFeedbackRecord } from '../src/utils/appFeedbackModel.js'

test('app feedback stays separate from operational issue data', () => {
  const record = buildAppFeedbackRecord({
    user: { id: 'bht_1', name: 'Alex R.', role: 'bht', locationId: 'test_house', shiftId: 'shift_1' },
    description: 'The Report button did not open.',
    context: { route: '/issues', appVersion: 'test', userAgent: 'test browser' }
  })
  assert.equal(record.feedbackType, 'app_feedback')
  assert.equal(record.originalText, 'The Report button did not open.')
  assert.equal(record.status, 'new')
  assert.equal('issueType' in record, false)
  assert.equal('clientName' in record, false)
})

test('admin feedback statuses are the locked workflow values', () => {
  assert.deepEqual(APP_FEEDBACK_STATUSES.map(option => option.value), [
    'new', 'reviewing', 'planned', 'completed', 'duplicate', 'not_actionable'
  ])
})
