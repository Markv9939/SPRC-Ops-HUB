import { collection, doc, runTransaction, serverTimestamp, Timestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { assertExpectedVersion, getVersionNumber } from './versioning'
import { fanOutIssueAlerts, writeAuditLog } from './notificationService'
import { addPatternObservation, buildIssuePatternId, removePatternObservation } from '../utils/issueRecurrence'
import { CLOSED_ISSUE_STATUSES, ISSUE_STATUS } from '../utils/issueModel'

const TERMINAL_STATUSES = new Set(CLOSED_ISSUE_STATUSES)
const PHOTO_RETENTION_MS = 90 * 24 * 60 * 60 * 1000

function trim(value) {
  return String(value || '').trim()
}

function activityLabel(eventType) {
  if (eventType === 'reported') return 'Reported'
  if (eventType === 'in_progress') return 'Marked in progress'
  if (eventType === 'resolved') return 'Resolved'
  if (eventType === 'voided') return 'Voided'
  if (eventType === 'reopened') return 'Reopened'
  if (eventType === 'note_added') return 'Note added'
  if (eventType === 'bht_follow_up') return 'Staff follow-up'
  if (eventType === 'problem_returned') return 'Problem returned'
  if (eventType === 'resolution_submitted') return 'Submitted for supervisor review'
  if (eventType === 'resolution_approved') return 'Resolution approved'
  if (eventType === 'resolution_returned') return 'Returned to active'
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
  if (!['open', 'in_progress', 'resolved', 'voided'].includes(normalizedStatus)) {
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
    const currentStatus = String(latest.status || 'open').toLowerCase()
    const reopening = normalizedStatus === 'open'
    if (reopening && !TERMINAL_STATUSES.has(currentStatus)) {
      throw new Error('Only a closed issue can be reopened.')
    }
    if (!reopening && TERMINAL_STATUSES.has(currentStatus)) {
      throw new Error('This issue is already closed.')
    }
    if (!reopening && normalizedStatus === currentStatus) {
      throw new Error(`This issue is already ${normalizedStatus.replace('_', ' ')}.`)
    }

    const recurrenceTrackingId = trim(latest.sourceTrackingId || latest.trackingId)
    const shouldInvalidateRecurrence = normalizedStatus === 'voided'
      && latest.source === 'eoc_checklist'
      && latest.recurrenceEligible !== false
      && !!recurrenceTrackingId
      && latest.recurrenceInvalidated !== true
    const shouldRestoreRecurrence = reopening
      && currentStatus === 'voided'
      && latest.source === 'eoc_checklist'
      && latest.recurrenceInvalidated === true
      && !!recurrenceTrackingId
    const patternId = (shouldInvalidateRecurrence || shouldRestoreRecurrence)
      ? (latest.patternId || buildIssuePatternId(latest.locationId, recurrenceTrackingId))
      : ''
    const patternRef = patternId ? doc(db, 'eocIssuePatterns', patternId) : null
    const patternSnap = patternRef ? await transaction.get(patternRef) : null

    const { nextVersion } = assertExpectedVersion({
      expectedVersion: getVersionNumber(expectedIssue || latest),
      currentVersion: getVersionNumber(latest),
      documentId: issueId,
      recordLabel: 'EOC Issue'
    })

    const eventType = reopening ? 'reopened' : normalizedStatus
    activityId = `v${nextVersion}_${eventType}`
    activity = buildActivity({
      eventType,
      issueId,
      issue: { id: issueId, ...latest },
      actorUser,
      note: trimmedNote,
      nextStatus: normalizedStatus,
      nextVersion
    })

    const latestActivity = {
      id: activityId,
      eventType,
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
    if (reopening) {
      updatePayload.closedAt = null
      updatePayload.photoDeletionDueAt = null
      updatePayload.reopenedAt = serverTimestamp()
      updatePayload.reopenedByUserId = actorUser?.id || null
      updatePayload.reopenedByName = actorUser?.name || null
      updatePayload.reopenNotes = trimmedNote
      if (shouldRestoreRecurrence) updatePayload.recurrenceInvalidated = false
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
      updatePayload.photoDeletionDueAt = Timestamp.fromMillis(Date.now() + PHOTO_RETENTION_MS)
    }
    if (normalizedStatus === 'voided') {
      updatePayload.voidReason = trimmedNote
      updatePayload.voidedAt = serverTimestamp()
      updatePayload.closedAt = serverTimestamp()
      updatePayload.voidedByUserId = actorUser?.id || null
      updatePayload.voidedByName = actorUser?.name || null
      updatePayload.photoDeletionDueAt = Timestamp.fromMillis(Date.now() + PHOTO_RETENTION_MS)
      if (shouldInvalidateRecurrence) {
        updatePayload.recurrenceInvalidated = true
        updatePayload.recurrenceInvalidatedAt = serverTimestamp()
        updatePayload.recurrenceInvalidatedReason = trimmedNote
      }
    }

    transaction.update(issueRef, updatePayload)
    transaction.set(doc(db, 'eocIssues', issueId, 'activity', activityId), activity)
    if (patternRef && patternSnap?.exists()) {
      const patternUpdate = shouldInvalidateRecurrence
        ? removePatternObservation(patternSnap.data(), issueId)
        : addPatternObservation(patternSnap.data(), {
            issueId,
            observedAtMs: Number(latest.recurrenceObservedAtMs || Date.now())
          })
      transaction.set(patternRef, {
        observations: patternUpdate.observations,
        recentCount: patternUpdate.recentCount,
        lifetimeCount: patternUpdate.lifetimeCount,
        reportedBefore: patternUpdate.reportedBefore,
        recurringIssue: patternUpdate.recurringIssue,
        lastIssueId: issueId,
        updatedAt: serverTimestamp(),
        version: Number(patternSnap.data()?.version || 0) + 1
      }, { merge: true })
    }
    updatedIssue = { id: issueId, ...latest, ...updatePayload, version: nextVersion }
  })

  await fanOutIssueAlerts({
    issue: updatedIssue,
    activity: { id: activityId, ...activity },
    eventType: normalizedStatus === 'open' ? 'reopened' : normalizedStatus,
    actorUser
  })

  await writeAuditLog({
    action: normalizedStatus === 'open'
      ? 'issue_reopened'
      : (normalizedStatus === 'in_progress' ? 'issue_in_progress' : `issue_${normalizedStatus}`),
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

export async function addIssueNote({ issueId, expectedIssue, note, actorUser }) {
  const trimmedNote = trim(note)
  if (!issueId) throw new Error('Issue ID is required.')
  if (!trimmedNote) throw new Error('Note is required.')

  let updatedIssue = null
  let activity = null
  let activityId = ''

  await runTransaction(db, async (transaction) => {
    const issueRef = doc(db, 'eocIssues', issueId)
    const issueSnap = await transaction.get(issueRef)
    if (!issueSnap.exists()) throw new Error('Issue no longer exists.')
    const latest = issueSnap.data()
    const { nextVersion } = assertExpectedVersion({
      expectedVersion: getVersionNumber(expectedIssue || latest),
      currentVersion: getVersionNumber(latest),
      documentId: issueId,
      recordLabel: 'EOC Issue'
    })

    activityId = `v${nextVersion}_note_added`
    activity = buildActivity({
      eventType: 'note_added',
      issueId,
      issue: { id: issueId, ...latest },
      actorUser,
      note: trimmedNote,
      nextStatus: latest.status || 'open',
      nextVersion
    })
    const latestActivity = {
      id: activityId,
      eventType: 'note_added',
      label: activity.label,
      note: trimmedNote,
      actorUserId: activity.actorUserId,
      actorName: activity.actorName,
      createdAt: serverTimestamp()
    }
    const updatePayload = {
      version: nextVersion,
      latestActivity,
      updatedAt: serverTimestamp()
    }

    transaction.update(issueRef, updatePayload)
    transaction.set(doc(db, 'eocIssues', issueId, 'activity', activityId), activity)
    updatedIssue = { id: issueId, ...latest, ...updatePayload, version: nextVersion }
  })

  await fanOutIssueAlerts({
    issue: updatedIssue,
    activity: { id: activityId, ...activity },
    eventType: 'note_added',
    actorUser
  })
  await writeAuditLog({
    action: 'issue_note_added',
    collectionPath: 'eocIssues',
    documentId: issueId,
    reason: trimmedNote,
    actorUser,
    extra: { locationId: updatedIssue?.locationId || null, activityId }
  })

  return { issue: updatedIssue, activityId }
}

export async function addBhtIssueFollowUp({ issueId, expectedIssue, note, actorUser }) {
  const trimmedNote = trim(note)
  if (!issueId) throw new Error('Issue ID is required.')
  if (!trimmedNote) throw new Error('Describe the update before submitting.')

  const issueRef = doc(db, 'eocIssues', issueId)
  const activityRef = doc(collection(db, 'eocIssues', issueId, 'activity'))
  let latestIssue = null
  let activity = null

  await runTransaction(db, async (transaction) => {
    const issueSnap = await transaction.get(issueRef)
    if (!issueSnap.exists()) throw new Error('Issue no longer exists.')
    latestIssue = { id: issueSnap.id, ...issueSnap.data() }
    if (TERMINAL_STATUSES.has(String(latestIssue.status || '').toLowerCase())) {
      throw new Error('This issue is closed. Use Problem Returned when appropriate.')
    }
    if (expectedIssue && getVersionNumber(expectedIssue) !== getVersionNumber(latestIssue)) {
      throw new Error('This issue changed. Review the latest activity and try again.')
    }
    activity = buildActivity({
      eventType: 'bht_follow_up',
      issueId,
      issue: latestIssue,
      actorUser,
      note: trimmedNote,
      nextStatus: latestIssue.status || 'open',
      nextVersion: getVersionNumber(latestIssue)
    })
    transaction.set(activityRef, activity)
  })

  await fanOutIssueAlerts({
    issue: latestIssue,
    activity: { id: activityRef.id, ...activity },
    eventType: 'bht_follow_up',
    actorUser
  })
  await writeAuditLog({
    action: 'issue_bht_follow_up',
    collectionPath: 'eocIssues',
    documentId: issueId,
    reason: trimmedNote,
    actorUser,
    extra: { locationId: latestIssue?.locationId || null, activityId: activityRef.id }
  })

  return { issue: latestIssue, activityId: activityRef.id }
}

export async function requestIssueReopen({ issueId, issue, note, actorUser }) {
  const trimmedNote = trim(note)
  if (!issueId) throw new Error('Issue ID is required.')
  if (!trimmedNote) throw new Error('Describe what returned before submitting.')

  const issueRef = doc(db, 'eocIssues', issueId)
  const activityRef = doc(collection(db, 'eocIssues', issueId, 'activity'))
  let latestIssue = null
  let activity = null

  await runTransaction(db, async (transaction) => {
    const issueSnap = await transaction.get(issueRef)
    if (!issueSnap.exists()) throw new Error('Issue no longer exists.')
    latestIssue = { id: issueSnap.id, ...issueSnap.data() }
    if (!TERMINAL_STATUSES.has(String(latestIssue.status || '').toLowerCase())) {
      throw new Error('This issue is already active.')
    }
    if (issue && getVersionNumber(issue) !== getVersionNumber(latestIssue)) {
      throw new Error('This issue changed. Review the latest activity and try again.')
    }

    activity = buildActivity({
      eventType: 'problem_returned',
      issueId,
      issue: latestIssue,
      actorUser,
      note: trimmedNote,
      nextStatus: latestIssue.status,
      nextVersion: getVersionNumber(latestIssue)
    })
    transaction.set(activityRef, activity)
  })

  await fanOutIssueAlerts({
    issue: latestIssue,
    activity: { id: activityRef.id, ...activity },
    eventType: 'problem_returned',
    actorUser
  })

  return { activityId: activityRef.id }
}

export async function submitIssueResolutionForReview({ issueId, expectedIssue, note, actorUser }) {
  const trimmedNote = trim(note)
  if (!issueId) throw new Error('Issue ID is required.')
  if (!trimmedNote) throw new Error('Describe what was completed before submitting for review.')

  let updatedIssue = null
  let activity = null
  let activityId = ''

  await runTransaction(db, async (transaction) => {
    const issueRef = doc(db, 'eocIssues', issueId)
    const issueSnap = await transaction.get(issueRef)
    if (!issueSnap.exists()) throw new Error('Issue no longer exists.')
    const latest = issueSnap.data()
    const currentStatus = String(latest.status || ISSUE_STATUS.OPEN).toLowerCase()
    if (![ISSUE_STATUS.OPEN, ISSUE_STATUS.IN_PROGRESS].includes(currentStatus)) {
      throw new Error(currentStatus === ISSUE_STATUS.PENDING_SUPERVISOR_REVIEW
        ? 'This issue is already pending supervisor review.'
        : 'Only an active issue can be submitted for supervisor review.')
    }
    const { nextVersion } = assertExpectedVersion({
      expectedVersion: getVersionNumber(expectedIssue || latest),
      currentVersion: getVersionNumber(latest),
      documentId: issueId,
      recordLabel: 'EOC Issue'
    })
    activityId = `v${nextVersion}_resolution_submitted`
    activity = buildActivity({
      eventType: 'resolution_submitted',
      issueId,
      issue: { id: issueId, ...latest },
      actorUser,
      note: trimmedNote,
      nextStatus: ISSUE_STATUS.PENDING_SUPERVISOR_REVIEW,
      nextVersion
    })
    const latestActivity = {
      id: activityId,
      eventType: 'resolution_submitted',
      label: activity.label,
      note: trimmedNote,
      actorUserId: activity.actorUserId,
      actorName: activity.actorName,
      createdAt: serverTimestamp()
    }
    const updatePayload = {
      status: ISSUE_STATUS.PENDING_SUPERVISOR_REVIEW,
      version: nextVersion,
      latestActivity,
      resolutionSubmittedNotes: trimmedNote,
      resolutionSubmittedAt: serverTimestamp(),
      resolutionSubmittedByUserId: trim(actorUser?.id),
      resolutionSubmittedByName: trim(actorUser?.name),
      updatedAt: serverTimestamp()
    }
    transaction.update(issueRef, updatePayload)
    transaction.set(doc(db, 'eocIssues', issueId, 'activity', activityId), activity)
    updatedIssue = { id: issueId, ...latest, ...updatePayload, version: nextVersion }
  })

  await fanOutIssueAlerts({ issue: updatedIssue, activity: { id: activityId, ...activity }, eventType: 'resolution_submitted', actorUser })
  await writeAuditLog({
    action: 'issue_resolution_submitted',
    collectionPath: 'eocIssues',
    documentId: issueId,
    reason: trimmedNote,
    actorUser,
    extra: { locationId: updatedIssue?.locationId || null, activityId }
  })
  return { issue: updatedIssue, activityId }
}

export async function reviewIssueResolution({ issueId, expectedIssue, decision, note, actorUser }) {
  const normalizedDecision = trim(decision).toLowerCase()
  const trimmedNote = trim(note)
  if (!issueId) throw new Error('Issue ID is required.')
  if (!['approve', 'return'].includes(normalizedDecision)) throw new Error('Choose approve or return to active.')
  if (normalizedDecision === 'return' && !trimmedNote) throw new Error('Explain why this issue is being returned to active.')

  let updatedIssue = null
  let activity = null
  let activityId = ''

  await runTransaction(db, async (transaction) => {
    const issueRef = doc(db, 'eocIssues', issueId)
    const issueSnap = await transaction.get(issueRef)
    if (!issueSnap.exists()) throw new Error('Issue no longer exists.')
    const latest = issueSnap.data()
    if (String(latest.status || '').toLowerCase() !== ISSUE_STATUS.PENDING_SUPERVISOR_REVIEW) {
      throw new Error('This issue is no longer pending supervisor review.')
    }
    const { nextVersion } = assertExpectedVersion({
      expectedVersion: getVersionNumber(expectedIssue || latest),
      currentVersion: getVersionNumber(latest),
      documentId: issueId,
      recordLabel: 'EOC Issue'
    })
    const approved = normalizedDecision === 'approve'
    const eventType = approved ? 'resolution_approved' : 'resolution_returned'
    const nextStatus = approved ? ISSUE_STATUS.RESOLVED : ISSUE_STATUS.IN_PROGRESS
    const activityNote = trimmedNote || trim(latest.resolutionSubmittedNotes) || 'Resolution reviewed and approved.'
    activityId = `v${nextVersion}_${eventType}`
    activity = buildActivity({
      eventType,
      issueId,
      issue: { id: issueId, ...latest },
      actorUser,
      note: activityNote,
      nextStatus,
      nextVersion
    })
    const latestActivity = {
      id: activityId,
      eventType,
      label: activity.label,
      note: activityNote,
      actorUserId: activity.actorUserId,
      actorName: activity.actorName,
      createdAt: serverTimestamp()
    }
    const updatePayload = {
      status: nextStatus,
      version: nextVersion,
      latestActivity,
      resolutionReviewedAt: serverTimestamp(),
      resolutionReviewedByUserId: trim(actorUser?.id),
      resolutionReviewedByName: trim(actorUser?.name),
      resolutionReviewDecision: normalizedDecision,
      resolutionReviewNotes: trimmedNote || null,
      updatedAt: serverTimestamp()
    }
    if (approved) {
      updatePayload.resolvedNotes = trim(latest.resolutionSubmittedNotes) || activityNote
      updatePayload.resolvedAt = serverTimestamp()
      updatePayload.closedAt = serverTimestamp()
      updatePayload.resolvedByUserId = trim(actorUser?.id)
      updatePayload.resolvedByName = trim(actorUser?.name)
      updatePayload.photoDeletionDueAt = Timestamp.fromMillis(Date.now() + PHOTO_RETENTION_MS)
    } else {
      updatePayload.inProgressNotes = trimmedNote
      updatePayload.inProgressAt = serverTimestamp()
      updatePayload.inProgressByUserId = trim(actorUser?.id)
      updatePayload.inProgressByName = trim(actorUser?.name)
      updatePayload.closedAt = null
      updatePayload.photoDeletionDueAt = null
    }
    transaction.update(issueRef, updatePayload)
    transaction.set(doc(db, 'eocIssues', issueId, 'activity', activityId), activity)
    updatedIssue = { id: issueId, ...latest, ...updatePayload, version: nextVersion }
  })

  await fanOutIssueAlerts({
    issue: updatedIssue,
    activity: { id: activityId, ...activity },
    eventType: normalizedDecision === 'approve' ? 'resolution_approved' : 'resolution_returned',
    actorUser
  })
  await writeAuditLog({
    action: normalizedDecision === 'approve' ? 'issue_resolution_approved' : 'issue_resolution_returned',
    collectionPath: 'eocIssues',
    documentId: issueId,
    reason: trimmedNote || trim(updatedIssue?.resolutionSubmittedNotes),
    actorUser,
    extra: { locationId: updatedIssue?.locationId || null, activityId }
  })
  return { issue: updatedIssue, activityId }
}
