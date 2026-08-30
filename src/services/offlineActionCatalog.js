export const OFFLINE_ACTION_TYPES = Object.freeze({
  EOC_SUBMISSION: 'eocSubmission',
  SHIFT_DEBRIEF_QUICK_NOTE: 'shiftDebriefQuickNote',
  SHIFT_DEBRIEF_SUBMISSION: 'shiftDebriefSubmission',
  SHIFT_DEBRIEF_EXTRA_NOTE: 'shiftDebriefExtraNote',
  SHIFT_DEBRIEF_CONFIRMATION: 'shiftDebriefConfirmation',
  BHT_ISSUE_REPORT: 'bhtIssueReport',
  APP_FEEDBACK: 'appFeedback',
  ISSUE_ATTACHMENT_UPLOAD: 'issueAttachmentUpload',
  TRANSPORT_CREATE: 'transportCreate',
  TRANSPORT_UPDATE: 'transportUpdate',
  TRANSPORT_CLOSE: 'transportClose'
})

export const SUPPORTED_SECURE_OFFLINE_ACTION_TYPES = Object.freeze(Object.values(OFFLINE_ACTION_TYPES))

const SUPPORTED_SECURE_OFFLINE_ACTION_TYPE_SET = new Set(SUPPORTED_SECURE_OFFLINE_ACTION_TYPES)

export function isSupportedSecureOfflineActionType(value) {
  return SUPPORTED_SECURE_OFFLINE_ACTION_TYPE_SET.has(String(value || '').trim())
}
