import { collection, doc, runTransaction, serverTimestamp, Timestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { fanOutIssueAlerts, writeAuditLog } from './notificationService'
import { getVersionNumber } from './versioning'
import { validateFollowUpRelationship } from '../utils/issueRecurrence'
import { shouldUseProtectedOperationalMutation, submitProtectedIssueMutation } from './protectedOperationalMutationService'

function trim(value) {
  return String(value || '').trim()
}

const PHOTO_RETENTION_MS = 90 * 24 * 60 * 60 * 1000

function activityData({ issue, issueId, eventType, label, note, actorUser, status, issueVersion }) {
  return {
    issueId,
    eventType,
    label,
    status: status || issue.status || 'open',
    note: trim(note),
    actorUserId: trim(actorUser?.id),
    actorName: trim(actorUser?.name) || 'Unknown',
    locationId: issue.locationId,
    issueVersion,
    relationshipAudit: true,
    immutable: true,
    version: 1,
    createdAt: serverTimestamp()
  }
}

export async function keepIssueSeparate({ issueId, expectedIssue, reason, actorUser }) {
  const note = trim(reason) || 'Supervisor reviewed the report and kept it separate.'
  if (await shouldUseProtectedOperationalMutation('issues_feedback_audit')) {
    return submitProtectedIssueMutation({ action: 'keep_separate', issueId, expectedVersion: getVersionNumber(expectedIssue), note })
  }
  const issueRef = doc(db, 'eocIssues', issueId)
  const activityRef = doc(collection(db, 'eocIssues', issueId, 'activity'))
  let issue = null
  let activity = null
  await runTransaction(db, async transaction => {
    const snap = await transaction.get(issueRef)
    if (!snap.exists()) throw new Error('Issue no longer exists.')
    issue = { id: snap.id, ...snap.data() }
    const nextVersion = getVersionNumber(issue) + 1
    activity = activityData({ issue, issueId, eventType: 'kept_separate', label: 'Kept as separate report', note, actorUser, issueVersion: nextVersion })
    transaction.update(issueRef, {
      relationshipDecision: 'kept_separate',
      relationshipReviewedAt: serverTimestamp(),
      relationshipReviewedByUserId: actorUser?.id || null,
      relationshipReviewedByName: actorUser?.name || null,
      version: nextVersion,
      updatedAt: serverTimestamp()
    })
    transaction.set(activityRef, activity)
  })
  await fanOutIssueAlerts({ issue, activity: { id: activityRef.id, ...activity }, eventType: 'kept_separate', actorUser })
  await writeAuditLog({ action: 'issue_kept_separate', collectionPath: 'eocIssues', documentId: issueId, reason: note, actorUser, extra: { locationId: issue?.locationId, activityId: activityRef.id } })
  return { issueId, activityId: activityRef.id }
}

export async function linkIssueAsFollowUp({ childIssueId, parentIssueId, expectedIssue, reason, reopenParent = false, actorUser }) {
  const note = trim(reason)
  if (!note) throw new Error('Explain why these reports should be linked.')
  if (await shouldUseProtectedOperationalMutation('issues_feedback_audit')) {
    return submitProtectedIssueMutation({ action: 'link_follow_up', issueId: childIssueId, parentIssueId, expectedVersion: getVersionNumber(expectedIssue), note, reopenParent })
  }
  const childRef = doc(db, 'eocIssues', childIssueId)
  const parentRef = doc(db, 'eocIssues', parentIssueId)
  const childActivityRef = doc(collection(db, 'eocIssues', childIssueId, 'activity'))
  const parentActivityRef = doc(collection(db, 'eocIssues', parentIssueId, 'activity'))
  let child = null
  let parent = null
  let childActivity = null
  let parentActivity = null

  await runTransaction(db, async transaction => {
    const [childSnap, parentSnap] = await Promise.all([transaction.get(childRef), transaction.get(parentRef)])
    if (!childSnap.exists() || !parentSnap.exists()) throw new Error('One of the selected issues no longer exists.')
    child = { id: childSnap.id, ...childSnap.data() }
    parent = { id: parentSnap.id, ...parentSnap.data() }
    validateFollowUpRelationship({ child, parent, reopenParent, reason: note })
    const childVersion = getVersionNumber(child) + 1
    const parentVersion = getVersionNumber(parent) + 1
    const parentWasResolved = String(parent.status || '').toLowerCase() === 'resolved'
    const parentStatus = parentWasResolved ? 'open' : parent.status
    childActivity = activityData({ issue: child, issueId: childIssueId, eventType: 'linked_as_follow_up', label: 'Linked as follow-up', note, actorUser, status: 'resolved', issueVersion: childVersion })
    parentActivity = activityData({ issue: parent, issueId: parentIssueId, eventType: parentWasResolved ? 'reopened_with_follow_up' : 'follow_up_linked', label: parentWasResolved ? 'Reopened and follow-up added' : 'Follow-up added', note, actorUser, status: parentStatus, issueVersion: parentVersion })

    transaction.update(childRef, {
      status: 'resolved',
      resolutionType: 'linked_followup',
      parentIssueId,
      relationshipDecision: 'linked_followup',
      relationshipReason: note,
      relationshipReviewedAt: serverTimestamp(),
      relationshipReviewedByUserId: actorUser?.id || null,
      relationshipReviewedByName: actorUser?.name || null,
      linkedAt: serverTimestamp(),
      closedAt: serverTimestamp(),
      photoDeletionDueAt: Timestamp.fromMillis(Date.now() + PHOTO_RETENTION_MS),
      resolvedAt: serverTimestamp(),
      resolvedNotes: note,
      version: childVersion,
      updatedAt: serverTimestamp()
    })
    transaction.set(childActivityRef, childActivity)
    transaction.update(parentRef, {
      status: parentStatus,
      linkedFollowUpCount: Number(parent.linkedFollowUpCount || 0) + 1,
      lastLinkedFollowUpId: childIssueId,
      ...(parentWasResolved ? { closedAt: null, photoDeletionDueAt: null, reopenedAt: serverTimestamp(), reopenNotes: note } : {}),
      version: parentVersion,
      updatedAt: serverTimestamp()
    })
    transaction.set(parentActivityRef, parentActivity)
  })

  await Promise.all([
    fanOutIssueAlerts({ issue: { ...child, status: 'resolved', parentIssueId }, activity: { id: childActivityRef.id, ...childActivity }, eventType: 'linked_as_follow_up', actorUser }),
    fanOutIssueAlerts({ issue: parent, activity: { id: parentActivityRef.id, ...parentActivity }, eventType: parentActivity.eventType, actorUser })
  ])
  await writeAuditLog({ action: 'issue_linked_follow_up', collectionPath: 'eocIssues', documentId: childIssueId, reason: note, actorUser, extra: { locationId: child?.locationId, parentIssueId, childActivityId: childActivityRef.id, parentActivityId: parentActivityRef.id } })
  return { childIssueId, parentIssueId }
}

export async function classifyQuickReport({ issueId, expectedIssue, trackingId, checklistLabel, categoryLabel, reason, actorUser }) {
  const note = trim(reason) || `Linked to checklist item: ${trim(checklistLabel)}`
  if (!trim(trackingId)) throw new Error('Choose a checklist item.')
  if (await shouldUseProtectedOperationalMutation('issues_feedback_audit')) {
    return submitProtectedIssueMutation({ action: 'classify_report', issueId, expectedVersion: getVersionNumber(expectedIssue), trackingId, checklistLabel, categoryLabel, note })
  }
  const issueRef = doc(db, 'eocIssues', issueId)
  const activityRef = doc(collection(db, 'eocIssues', issueId, 'activity'))
  let issue = null
  let activity = null
  await runTransaction(db, async transaction => {
    const snap = await transaction.get(issueRef)
    if (!snap.exists()) throw new Error('Issue no longer exists.')
    issue = { id: snap.id, ...snap.data() }
    if (issue.source === 'eoc_checklist') throw new Error('An EOC issue keeps its original checklist tracking.')
    const nextVersion = getVersionNumber(issue) + 1
    activity = activityData({ issue, issueId, eventType: 'checklist_classified', label: 'Checklist item linked', note, actorUser, issueVersion: nextVersion })
    transaction.update(issueRef, {
      linkedTrackingId: trim(trackingId),
      linkedChecklistLabel: trim(checklistLabel),
      linkedChecklistCategory: trim(categoryLabel),
      relationshipDecision: 'checklist_classified',
      relationshipReason: note,
      relationshipReviewedAt: serverTimestamp(),
      relationshipReviewedByUserId: actorUser?.id || null,
      relationshipReviewedByName: actorUser?.name || null,
      version: nextVersion,
      updatedAt: serverTimestamp()
    })
    transaction.set(activityRef, activity)
  })
  await fanOutIssueAlerts({ issue, activity: { id: activityRef.id, ...activity }, eventType: 'checklist_classified', actorUser })
  await writeAuditLog({ action: 'issue_checklist_classified', collectionPath: 'eocIssues', documentId: issueId, reason: note, actorUser, extra: { locationId: issue?.locationId, trackingId, activityId: activityRef.id } })
  return { issueId, trackingId }
}

export async function unlinkIssueRelationship({ issueId, expectedIssue, reason, actorUser }) {
  const note = trim(reason)
  if (String(actorUser?.role || '').toLowerCase() !== 'admin') throw new Error('Admin access is required.')
  if (!note) throw new Error('A reason is required to unlink this record.')
  if (await shouldUseProtectedOperationalMutation('issues_feedback_audit')) {
    return submitProtectedIssueMutation({ action: 'unlink_relationship', issueId, expectedVersion: getVersionNumber(expectedIssue), note })
  }
  const issueRef = doc(db, 'eocIssues', issueId)
  const activityRef = doc(collection(db, 'eocIssues', issueId, 'activity'))
  let issue = null
  let activity = null
  await runTransaction(db, async transaction => {
    const snap = await transaction.get(issueRef)
    if (!snap.exists()) throw new Error('Issue no longer exists.')
    issue = { id: snap.id, ...snap.data() }
    if (!issue.parentIssueId && !issue.linkedTrackingId) throw new Error('This issue has no removable relationship.')
    const nextVersion = getVersionNumber(issue) + 1
    const restoreChild = !!issue.parentIssueId
    activity = activityData({ issue, issueId, eventType: 'relationship_unlinked', label: 'Relationship unlinked', note, actorUser, status: restoreChild ? 'open' : issue.status, issueVersion: nextVersion })
    transaction.update(issueRef, {
      ...(restoreChild ? { status: 'open', closedAt: null, photoDeletionDueAt: null, resolvedAt: null, resolvedNotes: null, resolutionType: null } : {}),
      parentIssueId: null,
      linkedTrackingId: issue.source === 'eoc_checklist' ? issue.linkedTrackingId || null : null,
      linkedChecklistLabel: null,
      linkedChecklistCategory: null,
      relationshipDecision: 'unlinked',
      relationshipReason: note,
      relationshipReviewedAt: serverTimestamp(),
      relationshipReviewedByUserId: actorUser?.id || null,
      relationshipReviewedByName: actorUser?.name || null,
      version: nextVersion,
      updatedAt: serverTimestamp()
    })
    transaction.set(activityRef, activity)
  })
  await fanOutIssueAlerts({ issue, activity: { id: activityRef.id, ...activity }, eventType: 'relationship_unlinked', actorUser })
  await writeAuditLog({ action: 'issue_relationship_unlinked', collectionPath: 'eocIssues', documentId: issueId, reason: note, actorUser, extra: { locationId: issue?.locationId, previousParentIssueId: issue?.parentIssueId || null, previousLinkedTrackingId: issue?.linkedTrackingId || null, activityId: activityRef.id } })
  return { issueId }
}
