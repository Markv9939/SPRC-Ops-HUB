export const EOC_TEMPLATE_ITEM_SCHEMA_VERSION = 2
export const EOC_TEMPLATE_SCHEMA_VERSION = 3
export const EOC_DEFAULT_ORGANIZATION_ID = 'sprc'

export const EOC_QUESTION_TYPES = Object.freeze({
  PASS_ISSUE: 'pass_issue',
  SHORT_TEXT: 'short_text',
  MULTIPLE_CHOICE: 'multiple_choice',
  NUMBER: 'number',
  PHOTO: 'photo',
  DATE_TIME: 'date_time'
})

export const EOC_QUESTION_TYPE_OPTIONS = Object.freeze([
  { value: EOC_QUESTION_TYPES.PASS_ISSUE, label: 'Pass / issue' },
  { value: EOC_QUESTION_TYPES.SHORT_TEXT, label: 'Short text' },
  { value: EOC_QUESTION_TYPES.MULTIPLE_CHOICE, label: 'Multiple choice' },
  { value: EOC_QUESTION_TYPES.NUMBER, label: 'Number' },
  { value: EOC_QUESTION_TYPES.PHOTO, label: 'Photo' },
  { value: EOC_QUESTION_TYPES.DATE_TIME, label: 'Date and time' }
])

const VALID_QUESTION_TYPES = new Set(EOC_QUESTION_TYPE_OPTIONS.map(option => option.value))

function cleanText(value) {
  return String(value || '').trim()
}

function slug(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 54)
}

function randomSuffix() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function cleanOptions(value) {
  const seen = new Set()
  return (Array.isArray(value) ? value : [])
    .map(option => cleanText(typeof option === 'object' ? option?.label || option?.value : option))
    .filter((option) => {
      const key = option.toLowerCase()
      if (!option || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 20)
}

export function createEocTrackingId(prefix = 'item') {
  return `${slug(prefix) || 'item'}_${randomSuffix()}`
}

export function getEocItemTrackingId(item, index = 0) {
  const explicitId = cleanText(item?.trackingId || item?.id)
  if (explicitId) return explicitId

  const categoryPart = slug(item?.category) || 'category'
  const labelPart = slug(item?.label) || 'item'
  return `legacy_${categoryPart}_${labelPart}_${index + 1}`.slice(0, 120)
}

export function createEmptyEocTemplateItem(order = 1) {
  const trackingId = createEocTrackingId('item')
  return {
    id: trackingId,
    trackingId,
    category: '',
    label: '',
    helpText: '',
    requiresPhotoOnIssue: false,
    order,
    active: true
  }
}

export function createEmptyEocTemplateQuestion(order = 1, questionType = EOC_QUESTION_TYPES.PASS_ISSUE) {
  const trackingId = createEocTrackingId('question')
  return {
    id: trackingId,
    trackingId,
    label: '',
    questionType: VALID_QUESTION_TYPES.has(questionType) ? questionType : EOC_QUESTION_TYPES.PASS_ISSUE,
    required: true,
    helpText: '',
    options: [],
    requiresPhotoOnIssue: false,
    order,
    active: true
  }
}

export function createEmptyEocTemplateSection(order = 1) {
  return {
    id: createEocTrackingId('section'),
    title: '',
    description: '',
    order,
    active: true,
    questions: [createEmptyEocTemplateQuestion(1)]
  }
}

export function normalizeEocTemplateItems(items, { includeIncomplete = false } = {}) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => {
      const trackingId = getEocItemTrackingId(item, index)
      return {
        id: trackingId,
        trackingId,
        category: cleanText(item?.category),
        label: cleanText(item?.label),
        helpText: cleanText(item?.helpText),
        requiresPhotoOnIssue: item?.requiresPhotoOnIssue === true,
        order: Number(item?.order) || (index + 1),
        active: item?.active !== false
      }
    })
    .filter(item => includeIncomplete || (item.category && item.label))
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
}

export function findDuplicateEocTrackingIds(items) {
  const seen = new Set()
  const duplicates = new Set()

  normalizeEocTemplateItems(items, { includeIncomplete: true }).forEach((item) => {
    if (seen.has(item.trackingId)) duplicates.add(item.trackingId)
    seen.add(item.trackingId)
  })

  return [...duplicates]
}

function normalizeQuestion(question, index, { includeIncomplete = false } = {}) {
  const trackingId = getEocItemTrackingId(question, index)
  const questionType = VALID_QUESTION_TYPES.has(cleanText(question?.questionType || question?.type))
    ? cleanText(question?.questionType || question?.type)
    : EOC_QUESTION_TYPES.PASS_ISSUE
  const label = cleanText(question?.label || question?.prompt)
  const options = questionType === EOC_QUESTION_TYPES.MULTIPLE_CHOICE
    ? cleanOptions(question?.options)
    : []

  if (!includeIncomplete && !label) return null

  return {
    id: trackingId,
    trackingId,
    label,
    questionType,
    required: question?.required !== false,
    helpText: cleanText(question?.helpText),
    options,
    requiresPhotoOnIssue: questionType === EOC_QUESTION_TYPES.PASS_ISSUE
      && question?.requiresPhotoOnIssue === true,
    order: Number(question?.order) || (index + 1),
    active: question?.active !== false
  }
}

function legacySectionId(category, index) {
  return `legacy_section_${slug(category) || index + 1}`.slice(0, 120)
}

export function convertEocItemsToSections(items) {
  const groups = new Map()

  normalizeEocTemplateItems(items).forEach((item) => {
    const title = cleanText(item.category) || 'Checklist'
    const key = title.toLowerCase()
    const group = groups.get(key) || {
      id: legacySectionId(title, groups.size),
      title,
      description: '',
      order: groups.size + 1,
      active: true,
      questions: []
    }
    group.questions.push({
      id: item.trackingId,
      trackingId: item.trackingId,
      label: item.label,
      questionType: EOC_QUESTION_TYPES.PASS_ISSUE,
      required: true,
      helpText: item.helpText,
      options: [],
      requiresPhotoOnIssue: item.requiresPhotoOnIssue,
      order: group.questions.length + 1,
      active: item.active
    })
    groups.set(key, group)
  })

  return [...groups.values()]
}

export function normalizeEocTemplateSections(sections, {
  fallbackItems = [],
  includeIncomplete = false
} = {}) {
  const sourceSections = Array.isArray(sections) && sections.length > 0
    ? sections
    : convertEocItemsToSections(fallbackItems)

  return sourceSections
    .map((section, sectionIndex) => {
      const title = cleanText(section?.title || section?.label || section?.category)
      const questions = (Array.isArray(section?.questions) ? section.questions : [])
        .map((question, questionIndex) => normalizeQuestion(question, questionIndex, { includeIncomplete }))
        .filter(Boolean)
        .sort((a, b) => a.order - b.order)
        .map((question, questionIndex) => ({ ...question, order: questionIndex + 1 }))

      if (!includeIncomplete && (!title || questions.length === 0)) return null

      return {
        id: cleanText(section?.id) || createEocTrackingId('section'),
        title,
        description: cleanText(section?.description),
        order: Number(section?.order) || (sectionIndex + 1),
        active: section?.active !== false,
        questions,
        ...(cleanText(section?.sourceSectionId) ? { sourceSectionId: cleanText(section.sourceSectionId) } : {}),
        ...(cleanText(section?.sourceSectionVersionId) ? { sourceSectionVersionId: cleanText(section.sourceSectionVersionId) } : {})
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.order - b.order)
    .map((section, index) => ({ ...section, order: index + 1 }))
}

export function flattenEocTemplateSections(sections, { includeInactive = false } = {}) {
  return normalizeEocTemplateSections(sections)
    .filter(section => includeInactive || section.active !== false)
    .flatMap(section => section.questions
      .filter(question => includeInactive || question.active !== false)
      .map(question => ({
        ...question,
        category: section.title,
        sectionId: section.id,
        sectionDescription: section.description,
        order: question.order
      })))
}

export function normalizeEocTemplateDefinition(template, { includeIncomplete = false } = {}) {
  const sections = normalizeEocTemplateSections(template?.sections, {
    fallbackItems: template?.items,
    includeIncomplete
  })
  return {
    schemaVersion: Number(template?.schemaVersion || 0) >= EOC_TEMPLATE_SCHEMA_VERSION
      ? Number(template.schemaVersion)
      : EOC_TEMPLATE_SCHEMA_VERSION,
    organizationId: cleanText(template?.organizationId) || EOC_DEFAULT_ORGANIZATION_ID,
    name: cleanText(template?.name),
    eocType: cleanText(template?.eocType) === 'van' ? 'van' : 'house',
    status: cleanText(template?.status) === 'archived' ? 'archived' : 'active',
    sections
  }
}

export function findDuplicateEocQuestionTrackingIds(sections) {
  const seen = new Set()
  const duplicates = new Set()
  normalizeEocTemplateSections(sections, { includeIncomplete: true }).forEach((section) => {
    section.questions.forEach((question) => {
      if (seen.has(question.trackingId)) duplicates.add(question.trackingId)
      seen.add(question.trackingId)
    })
  })
  return [...duplicates]
}

export function validateEocTemplateDefinition(template) {
  const normalized = normalizeEocTemplateDefinition(template, { includeIncomplete: true })
  const errors = []
  if (!normalized.name) errors.push('Template name is required.')
  if (normalized.sections.length === 0) errors.push('Add at least one section.')

  normalized.sections.forEach((section, sectionIndex) => {
    if (!section.title) errors.push(`Section ${sectionIndex + 1} needs a name.`)
    if (section.questions.length === 0) errors.push(`${section.title || `Section ${sectionIndex + 1}`} needs at least one question.`)
    section.questions.forEach((question, questionIndex) => {
      if (!question.label) errors.push(`${section.title || `Section ${sectionIndex + 1}`}, question ${questionIndex + 1} needs text.`)
      if (question.questionType === EOC_QUESTION_TYPES.MULTIPLE_CHOICE && question.options.length < 2) {
        errors.push(`${question.label || `Question ${questionIndex + 1}`} needs at least two choices.`)
      }
    })
  })

  if (findDuplicateEocQuestionTrackingIds(normalized.sections).length > 0) {
    errors.push('Question tracking IDs must be unique within a template.')
  }

  return { valid: errors.length === 0, errors, template: normalized }
}
