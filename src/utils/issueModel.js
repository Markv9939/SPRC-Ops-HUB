export const ISSUE_SCHEMA_VERSION = 2

export const ISSUE_TYPES = [
  { value: 'house_property', label: 'House/property', eocType: 'house' },
  { value: 'van_vehicle', label: 'Van/vehicle', eocType: 'van' },
  { value: 'safety_concern', label: 'Safety concern', eocType: 'house' },
  { value: 'other', label: 'Other', eocType: 'house' }
]

const SOURCE_LABELS = {
  quick_report: 'Staff report',
  bht_home: 'Staff report',
  eoc_checklist: 'EOC checklist'
}

function trim(value) {
  return String(value || '').trim()
}

function trimOrNull(value) {
  return trim(value) || null
}

export function getIssueTypeMeta(issueType) {
  return ISSUE_TYPES.find(type => type.value === issueType) || ISSUE_TYPES[0]
}

export function inferIssueType(issue) {
  if (ISSUE_TYPES.some(type => type.value === issue?.issueType)) return issue.issueType
  return issue?.eocType === 'van' ? 'van_vehicle' : 'house_property'
}

export function getIssueSourceLabel(source) {
  return SOURCE_LABELS[source] || 'Issue report'
}

export function buildIssueRecord({
  source = 'quick_report',
  issueType,
  eocType,
  locationId,
  shiftId,
  vanId,
  taskId,
  submissionId,
  templateId,
  templateVersion,
  templateVersionId,
  itemId,
  trackingId,
  label,
  category,
  description,
  requiresPhotoOnIssue = false,
  reportedByUserId,
  reportedByName
}) {
  const resolvedIssueType = issueType || (eocType === 'van' ? 'van_vehicle' : 'house_property')
  const meta = getIssueTypeMeta(resolvedIssueType)
  const resolvedEocType = trim(eocType) || meta.eocType
  const resolvedItemId = trimOrNull(itemId)

  return {
    schemaVersion: ISSUE_SCHEMA_VERSION,
    source,
    issueType: meta.value,
    issueTypeLabel: meta.label,
    eocType: resolvedEocType,
    locationId: trim(locationId),
    shiftId: trim(shiftId),
    vanId: resolvedEocType === 'van' ? trimOrNull(vanId) : null,
    taskId: trimOrNull(taskId),
    submissionId: trimOrNull(submissionId),
    templateId: trimOrNull(templateId),
    templateVersion: Number(templateVersion || 0) || null,
    templateVersionId: trimOrNull(templateVersionId),
    itemId: resolvedItemId,
    trackingId: trimOrNull(trackingId) || resolvedItemId,
    label: trim(label) || meta.label,
    category: trim(category) || getIssueSourceLabel(source),
    description: trim(description),
    requiresPhotoOnIssue: requiresPhotoOnIssue === true,
    status: 'open',
    reportedByUserId: trim(reportedByUserId),
    reportedByName: trim(reportedByName),
    version: 1
  }
}

export function hasPendingProblemReturned(activities) {
  const latestRelevant = (Array.isArray(activities) ? activities : []).find(activity => (
    ['problem_returned', 'reopened', 'resolved', 'voided'].includes(activity?.eventType)
  ))
  return latestRelevant?.eventType === 'problem_returned'
}
