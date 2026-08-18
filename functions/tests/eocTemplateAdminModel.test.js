import assert from 'node:assert/strict'
import test from 'node:test'
import {
  actorCanAccessEocLocation,
  flattenPassIssueQuestions,
  normalizePublishedEocSection,
  normalizePublishedEocTemplate
} from '../src/eocTemplateAdminModel.js'

function validPayload() {
  return {
    name: 'Night EOC',
    eocType: 'house',
    sections: [{
      id: 'safety',
      title: 'Safety',
      questions: [
        { trackingId: 'front_lock', label: 'Does the front lock work?', questionType: 'pass_issue' },
        { trackingId: 'staff_note', label: 'Shift note', questionType: 'short_text', required: false }
      ]
    }]
  }
}

test('server template normalization enforces the approved v3 schema', () => {
  const result = normalizePublishedEocTemplate(validPayload())
  assert.equal(result.schemaVersion, 3)
  assert.equal(result.organizationId, 'sprc')
  assert.equal(result.questionCount, 2)
  assert.equal(flattenPassIssueQuestions(result.sections).length, 1)
})

test('server template normalization rejects duplicate tracking IDs and incomplete choices', () => {
  const duplicate = validPayload()
  duplicate.sections[0].questions[1].trackingId = 'front_lock'
  assert.throws(() => normalizePublishedEocTemplate(duplicate), /unique/)

  const choices = validPayload()
  choices.sections[0].questions[0] = { trackingId: 'choice', label: 'Choose', questionType: 'multiple_choice', options: ['One'] }
  assert.throws(() => normalizePublishedEocTemplate(choices), /at least two/)
})

test('server location checks keep supervisors inside their authorized scope', () => {
  const otcSupervisor = { role: 'supervisor', authorizedLocations: ['OTC'] }
  assert.equal(actorCanAccessEocLocation(otcSupervisor, 'test_house'), true)
  assert.equal(actorCanAccessEocLocation(otcSupervisor, 'res'), false)
  assert.equal(actorCanAccessEocLocation({ role: 'admin', authorizedLocations: [] }, 'res'), true)
})

test('saved sections use the same strict question validation as templates', () => {
  const section = normalizePublishedEocSection(validPayload().sections[0])
  assert.equal(section.title, 'Safety')
  assert.equal(section.questions.length, 2)
  assert.throws(() => normalizePublishedEocSection({ title: 'Empty', questions: [] }), /at least one question/)
})
