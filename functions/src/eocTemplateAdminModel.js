const QUESTION_TYPES = new Set(['pass_issue', 'short_text', 'multiple_choice', 'number', 'photo', 'date_time'])
const MAX_SECTIONS = 30
const MAX_QUESTIONS = 300
const MAX_OPTIONS = 20

function text(value, maximum = 500) {
  return String(value || '').trim().slice(0, maximum)
}

function normalizeOptions(options) {
  const seen = new Set()
  return (Array.isArray(options) ? options : [])
    .map(option => text(typeof option === 'object' ? option?.label || option?.value : option, 100))
    .filter((option) => {
      const key = option.toLowerCase()
      if (!option || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAX_OPTIONS)
}

function normalizeQuestion(question, index) {
  const trackingId = text(question?.trackingId || question?.id, 120)
  const questionType = text(question?.questionType || question?.type, 40)
  const label = text(question?.label || question?.prompt, 300)
  if (!trackingId) throw new Error(`Question ${index + 1} is missing its permanent tracking ID.`)
  if (!label) throw new Error(`Question ${index + 1} needs text.`)
  if (!QUESTION_TYPES.has(questionType)) throw new Error(`Question ${index + 1} has an unsupported answer type.`)
  const options = questionType === 'multiple_choice' ? normalizeOptions(question?.options) : []
  if (questionType === 'multiple_choice' && options.length < 2) {
    throw new Error(`${label} needs at least two choices.`)
  }
  return {
    id: trackingId,
    trackingId,
    label,
    questionType,
    required: question?.required !== false,
    helpText: text(question?.helpText, 500),
    options,
    requiresPhotoOnIssue: questionType === 'pass_issue' && question?.requiresPhotoOnIssue === true,
    order: index + 1,
    active: question?.active !== false
  }
}

export function normalizePublishedEocTemplate(payload) {
  const name = text(payload?.name, 120)
  if (!name) throw new Error('Template name is required.')
  const sourceSections = Array.isArray(payload?.sections) ? payload.sections : []
  if (sourceSections.length === 0) throw new Error('Add at least one section.')
  if (sourceSections.length > MAX_SECTIONS) throw new Error(`Templates can contain up to ${MAX_SECTIONS} sections.`)

  let questionCount = 0
  const seenTrackingIds = new Set()
  const sections = sourceSections.map((section, sectionIndex) => {
    const title = text(section?.title || section?.label || section?.category, 120)
    if (!title) throw new Error(`Section ${sectionIndex + 1} needs a name.`)
    const sourceQuestions = Array.isArray(section?.questions) ? section.questions : []
    if (sourceQuestions.length === 0) throw new Error(`${title} needs at least one question.`)
    const questions = sourceQuestions.map((question, questionIndex) => {
      const normalized = normalizeQuestion(question, questionIndex)
      if (seenTrackingIds.has(normalized.trackingId)) throw new Error('Question tracking IDs must be unique within a template.')
      seenTrackingIds.add(normalized.trackingId)
      questionCount += 1
      return normalized
    })
    return {
      id: text(section?.id, 120) || `section_${sectionIndex + 1}`,
      title,
      description: text(section?.description, 500),
      order: sectionIndex + 1,
      active: section?.active !== false,
      questions,
      ...(text(section?.sourceSectionId, 120) ? { sourceSectionId: text(section.sourceSectionId, 120) } : {}),
      ...(text(section?.sourceSectionVersionId, 160) ? { sourceSectionVersionId: text(section.sourceSectionVersionId, 160) } : {})
    }
  })
  if (questionCount > MAX_QUESTIONS) throw new Error(`Templates can contain up to ${MAX_QUESTIONS} questions.`)

  return {
    schemaVersion: 3,
    organizationId: text(payload?.organizationId, 80) || 'sprc',
    name,
    eocType: text(payload?.eocType) === 'van' ? 'van' : 'house',
    status: 'active',
    sections,
    questionCount
  }
}

export function normalizePublishedEocSection(section) {
  const title = text(section?.title || section?.name, 120)
  const wrapped = normalizePublishedEocTemplate({
    name: title || 'Saved section',
    sections: [{ ...section, title }]
  })
  return wrapped.sections[0]
}

export function flattenPassIssueQuestions(sections) {
  return (Array.isArray(sections) ? sections : []).flatMap(section => (
    (Array.isArray(section?.questions) ? section.questions : [])
      .filter(question => question.questionType === 'pass_issue')
      .map(question => ({
        id: question.trackingId,
        trackingId: question.trackingId,
        category: section.title,
        label: question.label,
        helpText: question.helpText || '',
        requiresPhotoOnIssue: question.requiresPhotoOnIssue === true,
        order: question.order,
        active: question.active !== false
      }))
  ))
}

function locationAlias(locationId) {
  const normalized = text(locationId).toLowerCase()
  if (['mesquite', 'lone_mountain', 'test_house', 'otc', 'php', 'rtc'].includes(normalized)) return 'OTC'
  if (normalized === 'res') return 'RES'
  return text(locationId).toUpperCase()
}

export function actorCanAccessEocLocation(actor, locationId) {
  if (actor?.role === 'admin') return true
  const locations = new Set((Array.isArray(actor?.authorizedLocations) ? actor.authorizedLocations : [])
    .map(value => text(value).toUpperCase()))
  const alias = locationAlias(locationId)
  return locations.has(text(locationId).toUpperCase())
    || locations.has(alias)
    || (alias === 'OTC' && (locations.has('PHP') || locations.has('RTC')))
    || (alias === 'RES' && locations.has('PHP'))
}
