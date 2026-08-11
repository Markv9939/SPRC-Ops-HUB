import { collection, doc } from 'firebase/firestore'
import { db } from '../firebase'
import { buildIssueRecord, getIssueTypeMeta, ISSUE_TYPES } from '../utils/issueModel'
import { createIssueWithActivity } from './issueStatusService'

export const BHT_HOME_ISSUE_TYPES = ISSUE_TYPES

function trimText(value) {
  return String(value || '').trim()
}

function safeIdPart(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
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

  return buildIssueRecord({
    source: 'quick_report',
    issueType: meta.value,
    locationId,
    shiftId,
    vanId: normalizedVanId,
    eocType: meta.eocType,
    label: meta.label,
    category: 'Staff report',
    description: trimmedDescription,
    reportedByUserId: trimText(user.id),
    reportedByName: trimText(user.name)
  })
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
