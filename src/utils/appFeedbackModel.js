export const APP_FEEDBACK_TYPE = 'app_feedback'

export const APP_FEEDBACK_STATUSES = Object.freeze([
  { value: 'new', label: 'New' },
  { value: 'reviewing', label: 'Reviewing' },
  { value: 'planned', label: 'Planned' },
  { value: 'completed', label: 'Completed' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'not_actionable', label: 'Not actionable' }
])

const STATUS_VALUES = new Set(APP_FEEDBACK_STATUSES.map(option => option.value))

function clean(value) {
  return String(value || '').trim()
}

export function normalizeAppFeedbackStatus(value) {
  const normalized = clean(value).toLowerCase()
  return STATUS_VALUES.has(normalized) ? normalized : 'new'
}

export function getAppFeedbackStatusLabel(value) {
  const normalized = normalizeAppFeedbackStatus(value)
  return APP_FEEDBACK_STATUSES.find(option => option.value === normalized)?.label || 'New'
}

export function buildAppFeedbackRecord({ user, assignment, description, context = {}, localFeedbackId = '' }) {
  const text = clean(description)
  if (!clean(user?.id)) throw new Error('Missing staff user for app feedback.')
  if (!text) throw new Error('Describe the bug or suggestion before submitting.')

  return {
    schemaVersion: 1,
    feedbackType: APP_FEEDBACK_TYPE,
    originalText: text,
    submittedByUserId: clean(user.id),
    submittedByName: clean(user.name) || 'Staff',
    submittedByRole: clean(user.role).toLowerCase(),
    locationId: clean(assignment?.locationId || user?.locationId) || null,
    shiftId: clean(assignment?.shiftId || user?.shiftId) || null,
    route: clean(context.route) || null,
    appVersion: clean(context.appVersion) || null,
    userAgent: clean(context.userAgent).slice(0, 300) || null,
    localFeedbackId: clean(localFeedbackId) || null,
    status: 'new',
    adminNote: '',
    version: 1
  }
}

