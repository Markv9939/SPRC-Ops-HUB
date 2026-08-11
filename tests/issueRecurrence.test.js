import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addPatternObservation,
  buildIssuePatternId,
  isRecurrenceEligibleIssue,
  RECURRENCE_WINDOW_MS,
  removePatternObservation,
  validateFollowUpRelationship
} from '../src/utils/issueRecurrence.js'

test('recurrence begins on the third valid EOC observation within 90 days', () => {
  const now = Date.UTC(2026, 7, 10)
  let summary = addPatternObservation(null, { issueId: 'one', observedAtMs: now - 20_000 })
  assert.equal(summary.reportedBefore, false)
  assert.equal(summary.recurringIssue, false)
  summary = addPatternObservation(summary, { issueId: 'two', observedAtMs: now - 10_000 })
  assert.equal(summary.reportedBefore, true)
  assert.equal(summary.recurringIssue, false)
  summary = addPatternObservation(summary, { issueId: 'three', observedAtMs: now })
  assert.equal(summary.recentCount, 3)
  assert.equal(summary.recurringIssue, true)
})

test('observations older than 90 days and invalidated observations do not count', () => {
  const now = Date.UTC(2026, 7, 10)
  const old = { observations: [{ issueId: 'old', observedAtMs: now - RECURRENCE_WINDOW_MS - 1 }], lifetimeCount: 1 }
  let summary = addPatternObservation(old, { issueId: 'current', observedAtMs: now })
  assert.equal(summary.recentCount, 1)
  summary = addPatternObservation(summary, { issueId: 'second', observedAtMs: now + 1 })
  summary = removePatternObservation(summary, 'current', now + 2)
  assert.deepEqual(summary.observations.map(item => item.issueId), ['second'])
})

test('only submitted EOC observations with tracking IDs are recurrence eligible', () => {
  assert.equal(isRecurrenceEligibleIssue({ source: 'eoc_checklist', trackingId: 'sink', status: 'resolved' }), true)
  assert.equal(isRecurrenceEligibleIssue({ source: 'quick_report', linkedTrackingId: 'sink', status: 'open' }), false)
  assert.equal(isRecurrenceEligibleIssue({ source: 'eoc_checklist', trackingId: 'sink', status: 'voided' }), false)
})

test('pattern IDs are deterministic and scoped by property and tracking ID', () => {
  assert.equal(buildIssuePatternId('test_house', 'kitchen_sink'), buildIssuePatternId('test_house', 'kitchen_sink'))
  assert.notEqual(buildIssuePatternId('test_house', 'kitchen_sink'), buildIssuePatternId('mesquite', 'kitchen_sink'))
})

test('follow-up relationships require one same-location active parent', () => {
  const child = { id: 'child', locationId: 'test_house', status: 'open' }
  const parent = { id: 'parent', locationId: 'test_house', status: 'open' }
  assert.equal(validateFollowUpRelationship({ child, parent }), true)
  assert.throws(() => validateFollowUpRelationship({ child, parent: { ...parent, status: 'resolved' } }), /Reopen/)
  assert.equal(validateFollowUpRelationship({ child, parent: { ...parent, status: 'resolved' }, reopenParent: true, reason: 'Returned' }), true)
  assert.throws(() => validateFollowUpRelationship({ child, parent: { ...parent, locationId: 'mesquite' } }), /same location/)
})
