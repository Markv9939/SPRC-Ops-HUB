import assert from 'node:assert/strict'
import test from 'node:test'
import {
  findFirstIncompleteEocItemIndex,
  getEocCategoryProgress,
  getEocChecklistProgress,
  isEocIssueDetailMissing
} from '../src/utils/eocGuidedFlow.js'

const items = [
  { id: 'lock', category: 'Safety', label: 'Front lock' },
  { id: 'light', category: 'Safety', label: 'Exterior light' },
  { id: 'sink', category: 'Kitchen', label: 'Kitchen sink' }
]

test('needs-attention answers are incomplete until relevant details are provided', () => {
  const answers = { lock: 'ok', light: 'repair' }
  assert.equal(isEocIssueDetailMissing('light', answers, {}), true)
  assert.equal(findFirstIncompleteEocItemIndex(items, answers, {}), 1)

  const details = { light: { description: 'Exterior light near the front door does not turn on.' } }
  assert.equal(isEocIssueDetailMissing('light', answers, details), false)
  assert.equal(findFirstIncompleteEocItemIndex(items, answers, details), 2)
})

test('guided progress counts only submission-ready items as complete', () => {
  const progress = getEocChecklistProgress(
    items,
    { lock: 'ok', light: 'repair' },
    { light: { description: '' } }
  )

  assert.deepEqual(progress, {
    totalCount: 3,
    answeredCount: 2,
    readyCount: 1,
    completeCount: 1,
    attentionCount: 1,
    remainingCount: 2,
    percent: 33
  })
})

test('category progress identifies where each section begins', () => {
  const categories = getEocCategoryProgress(
    items,
    { lock: 'ok', light: 'repair', sink: 'ok' },
    { light: { description: 'Bulb does not illuminate.' } }
  )

  assert.deepEqual(categories, [
    { category: 'Safety', firstItemIndex: 0, totalCount: 2, readyCount: 2, attentionCount: 1 },
    { category: 'Kitchen', firstItemIndex: 2, totalCount: 1, readyCount: 1, attentionCount: 0 }
  ])
})

test('required-photo items accept a ready photo or a documented safety exception', () => {
  const item = { id: 'lock', requiresPhotoOnIssue: true }
  const answers = { lock: 'repair' }
  assert.equal(isEocIssueDetailMissing(item, answers, { lock: { description: 'Lock is damaged.' } }), true)
  assert.equal(isEocIssueDetailMissing(item, answers, { lock: { description: 'Lock is damaged.', photos: [{ state: 'ready' }] } }), false)
  assert.equal(isEocIssueDetailMissing(item, answers, { lock: { description: 'Lock is damaged.', unableToTakePhoto: true, unableReason: 'Client information cannot be moved safely.' } }), false)
})
