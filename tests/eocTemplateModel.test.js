import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createEmptyEocTemplateItem,
  findDuplicateEocTrackingIds,
  normalizeEocTemplateItems
} from '../src/utils/eocTemplateModel.js'

test('template normalization preserves permanent tracking IDs and approved metadata', () => {
  const [item] = normalizeEocTemplateItems([{
    id: 'house_kitchen_disposal',
    category: 'Kitchen',
    label: 'Does the disposal work?',
    helpText: 'Run water while testing.',
    requiresPhotoOnIssue: true,
    order: 4
  }])

  assert.equal(item.id, 'house_kitchen_disposal')
  assert.equal(item.trackingId, 'house_kitchen_disposal')
  assert.equal(item.helpText, 'Run water while testing.')
  assert.equal(item.requiresPhotoOnIssue, true)
})

test('renaming and reordering an item does not change its tracking ID', () => {
  const original = normalizeEocTemplateItems([
    { trackingId: 'front_lights', category: 'Exterior', label: 'Do the lights work?', order: 1 },
    { trackingId: 'front_lock', category: 'Exterior', label: 'Does the lock work?', order: 2 }
  ])
  const edited = normalizeEocTemplateItems([
    { ...original[1], label: 'Does the front entrance lock operate?', order: 1 },
    { ...original[0], category: 'Safety', order: 2 }
  ])

  assert.deepEqual(edited.map(item => item.trackingId), ['front_lock', 'front_lights'])
})

test('legacy items receive deterministic tracking IDs until first persisted save', () => {
  const input = [{ category: 'Kitchen', label: 'Check refrigerator', order: 1 }]
  const first = normalizeEocTemplateItems(input)
  const second = normalizeEocTemplateItems(input)

  assert.equal(first[0].trackingId, second[0].trackingId)
  assert.match(first[0].trackingId, /^legacy_kitchen_check_refrigerator_1$/)
})

test('new blank items receive a stable generated tracking ID', () => {
  const item = createEmptyEocTemplateItem(3)

  assert.equal(item.id, item.trackingId)
  assert.ok(item.trackingId.startsWith('item_'))
  assert.equal(item.order, 3)
})

test('duplicate tracking IDs are detected before publishing', () => {
  const duplicates = findDuplicateEocTrackingIds([
    { trackingId: 'same_item', category: 'One', label: 'First' },
    { trackingId: 'same_item', category: 'Two', label: 'Second' }
  ])

  assert.deepEqual(duplicates, ['same_item'])
})

