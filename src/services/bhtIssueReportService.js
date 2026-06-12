import { collection, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { createIssueWithActivity } from './issueStatusService'

export const BHT_HOME_ISSUE_TYPES = [
  { value: 'house_property', label: 'House/property', eocType: 'house', severity: 'medium' },
  { value: 'van_vehicle', label: 'Van/vehicle', eocType: 'van', severity: 'medium' },
  { value: 'safety_concern', label: 'Safety concern', eocType: 'house', severity: 'high' },
  { value: 'other', label: 'Other', eocType: 'house', severity: 'medium' }
]

function trimText(value) {
  return String(value || '').trim()
}

function safeIdPart(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
}

function getIssueTypeMeta(issueType) {
  return BHT_HOME_ISSUE_TYPES.find(item => item.value === issueType) || BHT_HOME_ISSUE_TYPES[0]
}

function buildBhtHomeIssueData({ user, assignment, issueType, description, vanId }) {
  const meta = getIssueTypeMeta(issueType)
  const locationId = trimText(assignment?.locationId || user?.locationId)
  const shiftId = trimText(assignment?.shiftId || user?.shiftId)
  const normalizedVanId = meta.eocType === 'van'
    ? trimText(vanId || assignment?.vanId || user?.vanId)
    : ''
  const trimmedDescription = trimText(description)

  if (!user?.id) throw new Error('Missing staff user for issue report.')
  if (!locationId) throw new Error('Missing location for issue report.')
  if (!shiftId) throw new Error('Missing shift for issue report.')
  if (!trimmedDescription) throw new Error('Describe the issue before submitting.')
  if (meta.eocType === 'van' && !normalizedVanId) throw new Error('Select the van for this issue.')

  return {
    taskId: null,
    submissionId: null,
    locationId,
    shiftId,
    vanId: normalizedVanId || null,
    eocType: meta.eocType,
    itemId: `bht_home_${meta.value}`,
    label: meta.label,
    category: 'BHT home report',
    description: trimmedDescription,
    severity: meta.severity,
    status: 'open',
    source: 'bht_home',
    issueType: meta.value,
    reportedByUserId: trimText(user.id),
    reportedByName: trimText(user.name),
    version: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }
}

export async function submitBhtIssueReportOnline(payload) {
  const issueData = buildBhtHomeIssueData(payload || {})
  const localReportId = safeIdPart(payload?.localReportId)
  const issueRef = localReportId
    ? doc(db, 'eocIssues', `bht_${localReportId}`)
    : doc(collection(db, 'eocIssues'))

  const result = await createIssueWithActivity({
    issueRef,
    issueData,
    actorUser: payload?.user,
    eventType: 'reported'
  })

  return { issueId: result.issueId }
}
