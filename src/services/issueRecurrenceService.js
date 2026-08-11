import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  Timestamp,
  where
} from 'firebase/firestore'
import { db } from '../firebase'
import { RECURRENCE_WINDOW_MS } from '../utils/issueRecurrence'

export async function getMatchingChecklistIssues({ locationId, trackingId, maximum = 5, nowMs = Date.now() }) {
  if (!locationId || !trackingId) return []
  const snap = await getDocs(query(
    collection(db, 'eocIssues'),
    where('locationId', '==', locationId),
    where('sourceTrackingId', '==', trackingId),
    where('createdAt', '>=', Timestamp.fromMillis(nowMs - RECURRENCE_WINDOW_MS)),
    orderBy('createdAt', 'desc'),
    limit(Math.max(1, Math.min(5, Number(maximum) || 5)))
  ))
  return snap.docs
    .map(item => ({ id: item.id, ...item.data() }))
    .filter(issue => !(issue.status === 'voided' && issue.recurrenceInvalidated === true))
}

export async function getRelationshipCandidates({ issue, maximum = 12 }) {
  if (!issue?.locationId) return []
  const snap = await getDocs(query(
    collection(db, 'eocIssues'),
    where('locationId', '==', issue.locationId),
    where('status', 'in', ['open', 'in_progress', 'resolved']),
    orderBy('createdAt', 'desc'),
    limit(Math.max(1, Math.min(20, Number(maximum) || 12)))
  ))
  return snap.docs
    .map(item => ({ id: item.id, ...item.data() }))
    .filter(candidate => candidate.id !== issue.id && !candidate.parentIssueId)
}

export async function getChecklistChoicesForLocation(locationId) {
  if (!locationId) return []
  const assignments = await getDocs(query(
    collection(db, 'eocTemplateAssignments'),
    where('locationId', '==', locationId)
  ))
  const choices = new Map()
  for (const assignmentDoc of assignments.docs) {
    const assignment = assignmentDoc.data()
    let templateSnap = null
    if (assignment.defaultTemplateVersionId) {
      templateSnap = await getDoc(doc(db, 'eocTemplateVersions', assignment.defaultTemplateVersionId))
    }
    if (!templateSnap?.exists() && assignment.defaultTemplateId) {
      templateSnap = await getDoc(doc(db, 'eocTemplateLibrary', assignment.defaultTemplateId))
    }
    if (!templateSnap?.exists()) continue
    for (const item of templateSnap.data()?.items || []) {
      const trackingId = String(item.trackingId || item.id || '').trim()
      if (!trackingId || choices.has(trackingId)) continue
      choices.set(trackingId, {
        trackingId,
        label: String(item.label || 'Checklist item').trim(),
        category: String(item.category || 'Checklist').trim(),
        eocType: assignment.eocType || templateSnap.data()?.eocType || 'house'
      })
    }
  }
  return Array.from(choices.values()).sort((a, b) => `${a.category} ${a.label}`.localeCompare(`${b.category} ${b.label}`))
}
