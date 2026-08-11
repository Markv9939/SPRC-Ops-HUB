import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCurrentEocStatusRows, buildEocCompletionHistory, buildIssueExportRows, findMissingBhtAssignments } from '../src/utils/supervisorEocModel.js'

test('status board keeps the latest task per property shift and type', () => {
  const rows = buildCurrentEocStatusRows([
    { id: 'old', locationId: 'test_house', shiftId: 'shift_1', taskType: 'house', dueDate: '2026-08-09', status: 'missed' },
    { id: 'new', locationId: 'test_house', shiftId: 'shift_1', taskType: 'house', dueDate: '2026-08-10', status: 'completed' }
  ])
  assert.deepEqual(rows.map(row => row.id), ['new'])
})

test('history combines completed and missed without drafts', () => {
  const rows = buildEocCompletionHistory([{ id: 'done', submittedAt: new Date('2026-08-10'), eocType: 'house' }], [{ id: 'missed', missedAt: new Date('2026-08-09'), taskType: 'van' }])
  assert.deepEqual(rows.map(row => row.status), ['completed', 'missed'])
})

test('missing BHT warnings come only from configured property shift rows', () => {
  const rows = findMissingBhtAssignments([{ locationId: 'test_house', shiftId: 'shift_1' }], [])
  assert.deepEqual(rows, [{ locationId: 'test_house', shiftId: 'shift_1' }])
})

test('issue exports exclude photos, PIN data, priority, and target dates', () => {
  const row = buildIssueExportRows([{ description: 'Leak', photoUrl: 'no', pinHash: 'no', priority: 'no' }])[0]
  assert.equal(row.Description, 'Leak')
  assert.equal('photoUrl' in row, false)
  assert.equal('pinHash' in row, false)
  assert.equal('priority' in row, false)
})

test('issue export model handles thousands of filtered records without leaking excluded fields', () => {
  const issues = Array.from({ length: 5000 }, (_, index) => ({
    id: `issue_${index}`,
    locationId: 'test_house',
    issueType: index % 2 ? 'property' : 'safety_concern',
    source: 'quick_report',
    status: index % 3 ? 'open' : 'resolved',
    description: `Synthetic issue ${index}`,
    reportedByName: 'Synthetic BHT',
    photos: ['never-export'],
    priority: 'never-export',
    targetCompletionDate: 'never-export'
  }))
  const rows = buildIssueExportRows(issues)
  assert.equal(rows.length, 5000)
  assert.equal(rows[4999].Description, 'Synthetic issue 4999')
  assert.equal(Object.values(rows[0]).includes('never-export'), false)
})
