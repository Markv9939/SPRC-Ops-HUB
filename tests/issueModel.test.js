import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildIssueRecord,
  hasPendingProblemReturned,
  inferIssueType,
  ISSUE_SCHEMA_VERSION,
  ISSUE_TYPES
} from '../src/utils/issueModel.js'

test('quick reports use the shared issue record without priority or severity', () => {
  const issue = buildIssueRecord({
    source: 'quick_report',
    issueType: 'safety_concern',
    locationId: 'lone_mountain',
    shiftId: 'am',
    description: 'Loose handrail at the front steps.',
    reportedByUserId: 'bht-1',
    reportedByName: 'Alex R.'
  })

  assert.equal(issue.schemaVersion, ISSUE_SCHEMA_VERSION)
  assert.equal(issue.issueType, 'safety_concern')
  assert.equal(issue.issueTypeLabel, 'Safety concern')
  assert.equal(issue.source, 'quick_report')
  assert.equal(issue.locationId, 'lone_mountain')
  assert.equal(issue.status, 'open')
  assert.equal('severity' in issue, false)
  assert.equal('priority' in issue, false)
})

test('EOC issues retain checklist and template context', () => {
  const issue = buildIssueRecord({
    source: 'eoc_checklist',
    eocType: 'van',
    locationId: 'mesquite',
    shiftId: 'pm',
    vanId: 'van_2',
    taskId: 'task-1',
    submissionId: 'submission-1',
    templateId: 'template-1',
    templateVersion: 3,
    templateVersionId: 'template-1-v3',
    itemId: 'tires',
    trackingId: 'van_tires',
    label: 'Are the tires in good condition?',
    category: 'Exterior',
    description: 'Rear tire has visible sidewall damage.',
    reportedByUserId: 'bht-2',
    reportedByName: 'Jordan T.'
  })

  assert.equal(issue.issueType, 'van_vehicle')
  assert.equal(issue.vanId, 'van_2')
  assert.equal(issue.taskId, 'task-1')
  assert.equal(issue.templateVersion, 3)
  assert.equal(issue.trackingId, 'van_tires')
})

test('legacy issues infer a usable issue type', () => {
  assert.equal(inferIssueType({ eocType: 'van' }), 'van_vehicle')
  assert.equal(inferIssueType({ eocType: 'house' }), 'house_property')
  assert.deepEqual(ISSUE_TYPES.map(type => type.value), [
    'house_property',
    'van_vehicle',
    'safety_concern',
    'other'
  ])
})

test('problem returned stays pending until a supervisor reopens or closes again', () => {
  assert.equal(hasPendingProblemReturned([
    { eventType: 'problem_returned' },
    { eventType: 'resolved' }
  ]), true)
  assert.equal(hasPendingProblemReturned([
    { eventType: 'reopened' },
    { eventType: 'problem_returned' },
    { eventType: 'resolved' }
  ]), false)
})
