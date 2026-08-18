import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EOC_QUESTION_TYPES,
  convertEocItemsToSections,
  createEmptyEocTemplateItem,
  createEmptyEocTemplateQuestion,
  createEmptyEocTemplateSection,
  findDuplicateEocQuestionTrackingIds,
  findDuplicateEocTrackingIds,
  flattenEocTemplateSections,
  normalizeEocTemplateDefinition,
  normalizeEocTemplateItems,
  validateEocTemplateDefinition
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

test('legacy flat items convert to editable sections without changing tracking IDs', () => {
  const sections = convertEocItemsToSections([
    { trackingId: 'kitchen_sink', category: 'Kitchen', label: 'Does the sink drain?', order: 1 },
    { trackingId: 'kitchen_fridge', category: 'Kitchen', label: 'Is the refrigerator cold?', order: 2 },
    { trackingId: 'exit_light', category: 'Safety', label: 'Is the exit light on?', order: 3 }
  ])

  assert.equal(sections.length, 2)
  assert.deepEqual(sections[0].questions.map(question => question.trackingId), ['kitchen_sink', 'kitchen_fridge'])
  assert.equal(sections[1].questions[0].trackingId, 'exit_light')
})

test('v3 template definitions support all approved question types and flatten for the runtime', () => {
  const questionTypes = Object.values(EOC_QUESTION_TYPES)
  const sections = [{
    id: 'section_operations',
    title: 'Operations',
    questions: questionTypes.map((questionType, index) => ({
      trackingId: `question_${index + 1}`,
      label: `Question ${index + 1}`,
      questionType,
      options: questionType === EOC_QUESTION_TYPES.MULTIPLE_CHOICE ? ['Yes', 'No'] : [],
      order: index + 1
    }))
  }]
  const normalized = normalizeEocTemplateDefinition({ name: 'Custom EOC', eocType: 'house', sections })
  const flattened = flattenEocTemplateSections(normalized.sections)

  assert.deepEqual(flattened.map(question => question.questionType), questionTypes)
  assert.ok(flattened.every(question => question.category === 'Operations'))
  assert.equal(validateEocTemplateDefinition(normalized).valid, true)
})

test('renaming or moving a v3 question preserves identity while duplication uses a new identity', () => {
  const original = createEmptyEocTemplateQuestion(1)
  const moved = normalizeEocTemplateDefinition({
    name: 'Moved',
    sections: [{ id: 'section_two', title: 'New section', questions: [{ ...original, label: 'Renamed question' }] }]
  })
  const duplicate = createEmptyEocTemplateQuestion(2)

  assert.equal(moved.sections[0].questions[0].trackingId, original.trackingId)
  assert.notEqual(duplicate.trackingId, original.trackingId)
})

test('v3 validation rejects incomplete choices and duplicate recurrence identities', () => {
  const sections = [createEmptyEocTemplateSection(1)]
  sections[0].title = 'Safety'
  sections[0].questions = [
    { trackingId: 'duplicate', label: 'Choose one', questionType: EOC_QUESTION_TYPES.MULTIPLE_CHOICE, options: ['Only one'] },
    { trackingId: 'duplicate', label: 'Second question', questionType: EOC_QUESTION_TYPES.PASS_ISSUE }
  ]
  const result = validateEocTemplateDefinition({ name: 'Invalid', sections })

  assert.equal(result.valid, false)
  assert.equal(findDuplicateEocQuestionTrackingIds(sections).length, 1)
  assert.ok(result.errors.some(error => error.includes('at least two choices')))
  assert.ok(result.errors.some(error => error.includes('tracking IDs')))
})

