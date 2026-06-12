import { collection, doc, runTransaction, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { assertExpectedVersion, getVersionNumber } from './versioning'
import { fanOutIssueAlerts, writeAuditLog } from './notificationService'

const TERMINAL_STATUSES = new Set(['resolved', 'voided'])

function trim(value) {
  return String(value || '').trim()
}

function activityLabel(eventType) {
  if (eventType === 'reported') return 'Reported'
  if (eventType === 'in_progress') return 'Marked in progress'
  if (eventType === 'resolved') return 'Resolved'
  if (eventType === 'voided') return 'Voided'
  return 'Update'
}

function buildActivity({ eventType, issueId, issue, actorUser, note, nextStatus, nextVersion }) {
  const trimmedNote = trim(note)
  return {
    issueId,
    eventType,
    label: activityLabel(eventType),
    status: nextStatus || issue?.status || 'open',
    note: trimmedNote,
    actorUserId: trim(actorUser?.id || issue?.reportedByUserId),
    actorName: trim(actorUser?.name || issue?.reportedByName) || 'Unknown',
    locationId: issue?.locationId || null,
    issueVersion: nextVersion || issue?.version || 1,
    version: 1,
    immutable: true,
    createdAt: serverTimestamp()
  }
}

export async function createIssueWithActivity({
  issueRef,
  issueData,
  actorUser,
  eventType = 'reported'
}) {
  const resolvedIssueRef = issueRef || doc(collection(db, 'eocIssues'))
  const issueId = resolvedIssueRef.id
  const activityId = 'v1_reported'
  const activityRef = doc(db, 'eocIssues', issueId, 'activity', activityId)
  const activityData = buildActivity({
    eventType,
    issueId,
    issue: { ...issueData, id: issueId, version: 1, status: issueData.status || 'open' },
    actorUser,
    note: issueData.description,
    nextStatus: issueData.status || 'open',
    nextVersion: 1
  })

  const latestActivity = {
    id: activityId,
    eventType,
    label: activityData.label,
    note: activityData.note,
    actorUserId: activityData.actorUserId,
    actorName: activityData.actorName,
    createdAt: serverTimestamp()
  }

  await runTransaction(db, async (transaction) => {
    transaction.set(resolvedIssueRef, {
      ...issueData,
      status: issueData.status || 'open',
      version: 1,
      latestActivity,
      createdAt: issueData.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp()
    })
    transaction.set(activityRef, activityData)
  })

  const issue = {
    id: issueId,
    ...issueData,
    status: issueData.status || 'open',
    version: 1
  }
  await fanOutIssueAlerts({ issue, activity: { id: activityId, ...activityData }, eventType, actorUser })
  return { issueId, activityId }
}

export async function updateIssueStatus({
  issueId,
  expectedIssue,
  nextStatus,
  note,
  actorUser
}) {
  const normalizedStatus = trim(nextStatus).toLowerCase()
  const trimmedNote = trim(note)
  if (!issueId) throw new Error('Issue ID is required.')
  if (!['in_progress', 'resolved', 'voided'].includes(normalizedStatus)) {
    throw new Error('Unsupported issue status.')
  }
  if (!trimmedNote) {
    throw new Error(normalizedStatus === 'resolved' ? 'Resolution note is required.' : 'Note is required.')
  }

  let updatedIssue = null
  let activity = null
  let activityId = ''

  await runTransaction(db, async (transaction) => {
    const issueRef = doc(db, 'eocIssues', issueId)
    const issueSnap = await transaction.get(issueRef)
    if (!issueSnap.exists()) throw new Error('Issue no longer exists.')
    const latest = issueSnap.data()
    if (TERMINAL_STATUSES.has(String(latest.status || '').toLowerCase())) {
      throw new Error('This issue is already closed.')
    }

    const { nextVersion } = assertExpectedVersion({
      expectedVersion: getVersionNumber(expectedIssue || latest),
      currentVersion: getVersionNumber(latest),
      documentId: issueId,
      recordLabel: 'EOC Issue'
    })

    activityId = `v${nextVersion}_${normalizedStatus}`
    activity = buildActivity({
      eventType: normalizedStatus,
      issueId,
      issue: { id: issueId, ...latest },
      actorUser,
      note: trimmedNote,
      nextStatus: normalizedStatus,
      nextVersion
    })

    const latestActivity = {
      id: activityId,
      eventType: normalizedStatus,
      label: activity.label,
      note: trimmedNote,
      actorUserId: activity.actorUserId,
      actorName: activity.actorName,
      createdAt: serverTimestamp()
    }
    const updatePayload = {
      status: normalizedStatus,
      version: nextVersion,
      latestActivity,
      updatedAt: serverTimestamp()
    }
    if (normalizedStatus === 'in_progress') {
      updatePayload.inProgressNotes = trimmedNote
      updatePayload.inProgressAt = serverTimestamp()
      updatePayload.inProgressByUserId = actorUser?.id || null
      updatePayload.inProgressByName = actorUser?.name || null
    }
    if (normalizedStatus === 'resolved') {
      updatePayload.resolvedNotes = trimmedNote
      updatePayload.resolvedAt = serverTimestamp()
      updatePayload.closedAt = serverTimestamp()
      updatePayload.resolvedByUserId = actorUser?.id || null
      updatePayload.resolvedByName = actorUser?.name || null
    }
    if (normalizedStatus === 'voided') {
      updatePayload.voidReason = trimmedNote
      updatePayload.voidedAt = serverTimestamp()
      updatePayload.closedAt = serverTimestamp()
      updatePayload.voidedByUserId = actorUser?.id || null
      updatePayload.voidedByName = actorUser?.name || null
    }

    transaction.update(issueRef, updatePayload)
    transaction.set(doc(db, 'eocIssues', issueId, 'activity', activityId), activity)
    updatedIssue = { id: issueId, ...latest, ...updatePayload, version: nextVersion }
  })

  await fanOutIssueAlerts({
    issue: updatedIssue,
    activity: { id: activityId, ...activity },
    eventType: normalizedStatus,
    actorUser
  })

  await writeAuditLog({
    action: normalizedStatus === 'in_progress' ? 'issue_in_progress' : `issue_${normalizedStatus}`,
    collectionPath: 'eocIssues',
    documentId: issueId,
    reason: trimmedNote,
    actorUser,
    extra: {
      locationId: updatedIssue?.locationId || null,
      activityId
    }
  })

  return { issue: updatedIssue, activityId }
}
