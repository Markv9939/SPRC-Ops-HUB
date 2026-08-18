import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CLIENT_NOTE_SECTIONS,
  DEBRIEF_SCHEMA_VERSION,
  GENERAL_HANDOFF_SECTIONS,
  canUserConfirmDebrief,
  getDebriefCorrectionCount,
  getQuickNoteMergeState,
  groupDebriefItemsForReadView,
  hasValidIncomingSignoff,
  isCurrentDebriefPayload,
  mergeUniqueDebriefItems,
  sanitizeDebriefItems,
  sanitizeReviewedIssues
} from '../src/services/shiftDebriefModel.js'

const item = (overrides = {}) => ({
  id: overrides.id || `item_${Math.random()}`,
  type: 'client',
  section: 'medication_changes',
  clientName: 'Jordan R.',
  note: 'Medication changed.',
  source: 'editor',
  createdAtIso: '2026-08-09T12:00:00.000Z',
  ...overrides
})

test('V2 exposes only the six approved sections in document order', () => {
  assert.equal(DEBRIEF_SCHEMA_VERSION, 2)
  assert.deepEqual(CLIENT_NOTE_SECTIONS.map(section => section.id), [
    'medication_changes',
    'medical_concerns',
    'client_progress_concerns'
  ])
  assert.deepEqual(GENERAL_HANDOFF_SECTIONS.map(section => section.id), [
    'pending_task',
    'urgent_time_sensitive_task',
    'maintenance_van_facility_operational'
  ])
})

test('handoff issue review markers retain exact versions and remove invalid duplicates', () => {
  assert.deepEqual(sanitizeReviewedIssues([
    { issueId: 'bathroom', issueVersion: 2, latestActivityId: 'v2' },
    { issueId: 'bathroom', issueVersion: 3, latestActivityId: 'v3' },
    { issueId: '', issueVersion: 1 },
    { issueId: 'invalid', issueVersion: 0 }
  ]), [{ issueId: 'bathroom', issueVersion: 3, latestActivityId: 'v3' }])
})

test('read grouping combines client names case-insensitively within a section', () => {
  const grouped = groupDebriefItemsForReadView([
    item({ id: 'one', clientName: 'Jordan R.' }),
    item({ id: 'two', clientName: '  jordan   r.  ', note: 'Follow up tomorrow.' })
  ])

  assert.equal(grouped.clientSections.length, 1)
  assert.equal(grouped.clientSections[0].clients.length, 1)
  assert.equal(grouped.clientSections[0].clients[0].notes.length, 2)
})

test('the same client in different sections remains in separate groups', () => {
  const grouped = groupDebriefItemsForReadView([
    item({ id: 'one' }),
    item({ id: 'two', section: 'medical_concerns' })
  ])

  assert.deepEqual(grouped.clientSections.map(section => section.key), [
    'medication_changes',
    'medical_concerns'
  ])
  assert.ok(grouped.clientSections.every(section => section.clients.length === 1))
})

test('quick-note replay is idempotent by item id', () => {
  const first = item({ id: 'quick_one', note: 'Initial text.', source: 'quick_note' })
  const replay = { ...first, note: 'Latest text.' }
  const merged = mergeUniqueDebriefItems([first], [replay])

  assert.equal(merged.length, 1)
  assert.equal(merged[0].note, 'Latest text.')
})

test('submission filtering removes blank placeholders and normalizes source metadata', () => {
  const sanitized = sanitizeDebriefItems([
    item({ id: 'blank_client', note: '   ' }),
    item({ id: 'missing_client', clientName: '', note: 'Cannot submit without a client.' }),
    item({ id: 'blank_general', type: 'general', section: 'pending_task', clientName: '', note: '' }),
    item({ id: 'quick', note: '  Keep this.  ', source: 'quick_note' }),
    item({ id: 'editor', type: 'general', section: 'pending_task', clientName: 'ignored', note: ' Keep general. ', source: 'unknown' })
  ])

  assert.deepEqual(sanitized.map(row => ({ id: row.id, note: row.note, source: row.source, clientName: row.clientName })), [
    { id: 'quick', note: 'Keep this.', source: 'quick_note', clientName: 'Jordan R.' },
    { id: 'editor', note: 'Keep general.', source: 'editor', clientName: '' }
  ])
})

test('quick-note merge state distinguishes same-section and other-section groups', () => {
  const existing = [item({ id: 'one', clientName: 'Jordan R.' })]
  assert.equal(getQuickNoteMergeState(existing, 'medication_changes', ' jordan r. '), 'existing_section')
  assert.equal(getQuickNoteMergeState(existing, 'medical_concerns', 'JORDAN R.'), 'other_section')
  assert.equal(getQuickNoteMergeState(existing, 'medical_concerns', 'Taylor S.'), 'new')
})

test('offline action validation rejects V1 and accepts V2 payloads', () => {
  assert.equal(isCurrentDebriefPayload({ schemaVersion: 1 }), false)
  assert.equal(isCurrentDebriefPayload({ context: { schemaVersion: 1 } }), false)
  assert.equal(isCurrentDebriefPayload({ schemaVersion: 2 }), true)
  assert.equal(isCurrentDebriefPayload({ context: { schemaVersion: 2 } }), true)
})

test('only assigned incoming staff can confirm a submitted debrief', () => {
  const debrief = {
    submittedByUserId: 'outgoing_staff',
    receivingUserIds: ['incoming_one', 'incoming_two']
  }

  assert.equal(canUserConfirmDebrief({ id: 'incoming_one' }, debrief), true)
  assert.equal(canUserConfirmDebrief({ id: 'outgoing_staff' }, debrief), false)
  assert.equal(canUserConfirmDebrief({ id: 'unassigned_staff' }, debrief), false)
  assert.equal(canUserConfirmDebrief({ id: 'outgoing_staff' }, {
    ...debrief,
    receivingUserIds: ['outgoing_staff']
  }), false)
})

test('the first valid incoming signoff closes corrections', () => {
  const debrief = {
    receivingUserIds: ['incoming_one', 'incoming_two'],
    extraNotes: [{ id: 'correction_one' }],
    confirmation: {
      acknowledgments: {
        outgoing_staff: { confirmed: true },
        incoming_one: { confirmed: false }
      }
    },
    confirmed: false
  }

  assert.equal(getDebriefCorrectionCount(debrief), 1)
  assert.equal(hasValidIncomingSignoff(debrief), false)
  debrief.confirmation.acknowledgments.incoming_one.confirmed = true
  assert.equal(hasValidIncomingSignoff(debrief), true)
})
