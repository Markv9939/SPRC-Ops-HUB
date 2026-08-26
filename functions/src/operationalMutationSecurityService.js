import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { derivePrivateIdentifier } from './staffPinCredentialModel.js'
import { loadMappedActor, StaffAccountSecurityError } from './staffAccountSecurityService.js'
import { workflowSecurityEnabled } from './workflowSecurityModel.js'
import {
  actorCanCompleteEocTask,
  actorCanPerformIssueAction,
  assertExpectedOperationalVersion,
  cleanOperationalOperationId,
  isSupportedIssueAction,
  operationalActorCanAccessLocation,
  sanitizeOperationalText
} from './operationalMutationSecurityModel.js'

const PHOTO_RETENTION_MS = 90 * 24 * 60 * 60 * 1000
const TERMINAL_STATUSES = new Set(['resolved', 'voided'])

function cleanId(value, label = 'ID') {
  const normalized = String(value || '').trim()
  if (!/^[a-zA-Z0-9_-]{1,180}$/.test(normalized)) {
    throw new StaffAccountSecurityError('invalid-argument', `${label} is invalid.`)
  }
  return normalized
}

function error(code, message) {
  throw new StaffAccountSecurityError(code, message)
}

async function requireWorkflow(db, workflowId) {
  const snapshot = await db.doc('appSettings/securityWorkflows').get()
  if (!snapshot.exists || !workflowSecurityEnabled(snapshot.data(), workflowId)) {
    error('failed-precondition', `Protected ${workflowId} mutations are not enabled.`)
  }
}

function operationHash(value, namespace, secret) {
  try {
    return derivePrivateIdentifier(cleanOperationalOperationId(value), namespace, secret)
  } catch (cause) {
    error('invalid-argument', cause.message)
  }
}

function activityLabel(eventType) {
  return ({
    reported: 'Reported', in_progress: 'Marked in progress', resolved: 'Resolved', voided: 'Voided',
    reopened: 'Reopened', note_added: 'Note added', bht_follow_up: 'Staff follow-up',
    problem_returned: 'Problem returned', resolution_submitted: 'Submitted for supervisor review',
    resolution_approved: 'Resolution approved', resolution_returned: 'Returned to active',
    kept_separate: 'Kept separate', linked_as_follow_up: 'Linked as follow-up',
    follow_up_linked: 'Follow-up added', reopened_with_follow_up: 'Reopened with follow-up',
    checklist_classified: 'Linked to checklist item', relationship_unlinked: 'Relationship removed'
  })[eventType] || 'Updated'
}

function activityRecord({ issueId, issue, actor, eventType, status, note, version, now }) {
  return {
    issueId,
    eventType,
    label: activityLabel(eventType),
    status: status || issue.status || 'open',
    note: sanitizeOperationalText(note, 2000),
    actorUserId: actor.id,
    actorName: String(actor.name || 'Unknown').trim(),
    locationId: issue.locationId,
    issueVersion: version,
    version: 1,
    immutable: true,
    createdAt: now
  }
}

function latestActivity(activityId, activity) {
  return {
    id: activityId,
    eventType: activity.eventType,
    label: activity.label,
    note: activity.note,
    actorUserId: activity.actorUserId,
    actorName: activity.actorName,
    createdAt: activity.createdAt
  }
}

function safePart(value, maximum = 100) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, maximum) || 'unknown'
}

function hashText(value) {
  let hash = 2166136261
  const input = String(value || '').trim()
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function issuePatternId(locationId, trackingId) {
  const location = String(locationId || '').trim()
  const tracking = String(trackingId || '').trim()
  return `${safePart(location.toLowerCase(), 45)}__${safePart(tracking.toLowerCase(), 45)}__${hashText(`${location}\u0000${tracking}`)}`
}

function addPatternObservation(summary = {}, issueId, observedAtMs) {
  const minimumMs = observedAtMs - (90 * 24 * 60 * 60 * 1000)
  const existing = (Array.isArray(summary.observations) ? summary.observations : [])
    .filter(item => item?.issueId && Number(item.observedAtMs) >= minimumMs && item.issueId !== issueId)
  const observations = [...existing, { issueId, observedAtMs }].sort((a, b) => a.observedAtMs - b.observedAtMs)
  const recentCount = observations.length
  return {
    observations,
    recentCount,
    lifetimeCount: Math.max(Number(summary.lifetimeCount || 0) + 1, recentCount),
    reportedBefore: recentCount > 1,
    recurringIssue: recentCount >= 3
  }
}

function removePatternObservation(summary = {}, issueId, nowMs) {
  const minimumMs = nowMs - (90 * 24 * 60 * 60 * 1000)
  const observations = (Array.isArray(summary.observations) ? summary.observations : [])
    .filter(item => item?.issueId && item.issueId !== issueId && Number(item.observedAtMs) >= minimumMs)
    .sort((a, b) => a.observedAtMs - b.observedAtMs)
  return {
    observations,
    recentCount: observations.length,
    lifetimeCount: Math.max(0, Number(summary.lifetimeCount || 0) - 1),
    reportedBefore: observations.length > 1,
    recurringIssue: observations.length >= 3
  }
}

function issueTypeMeta(value, eocType) {
  const types = {
    house_property: ['House/property', 'house'], van_vehicle: ['Van/vehicle', 'van'],
    safety_concern: ['Safety concern', 'house'], other: ['Other', 'house']
  }
  const key = Object.hasOwn(types, value) ? value : (eocType === 'van' ? 'van_vehicle' : 'house_property')
  return { value: key, label: types[key][0], eocType: eocType === 'van' ? 'van' : types[key][1] }
}

function quickIssueRecord(payload, actor) {
  const meta = issueTypeMeta(payload.issueType, payload.eocType)
  const description = sanitizeOperationalText(payload.description, 2000)
  const locationId = String(payload.locationId || '').trim().toLowerCase()
  if (!description || !locationId) error('invalid-argument', 'Location and issue description are required.')
  return {
    schemaVersion: 3,
    source: 'quick_report',
    issueType: meta.value,
    issueTypeLabel: meta.label,
    eocType: meta.eocType,
    locationId,
    shiftId: sanitizeOperationalText(payload.shiftId, 80),
    vanId: meta.eocType === 'van' ? sanitizeOperationalText(payload.vanId, 80) || null : null,
    taskId: null, submissionId: null, templateId: null, templateVersion: null, templateVersionId: null,
    itemId: null, trackingId: null, sourceTrackingId: null, linkedTrackingId: null,
    parentIssueId: null, relationshipDecision: null, recurrenceEligible: false,
    reportedBefore: false, recurringIssue: false, recurrenceCountAtReport: 0,
    label: sanitizeOperationalText(payload.label, 300) || meta.label,
    category: sanitizeOperationalText(payload.category, 300) || 'Staff report',
    description,
    requiresPhotoOnIssue: false,
    status: 'open',
    reportedByUserId: actor.id,
    reportedByName: String(actor.name || '').trim(),
    version: 1
  }
}

async function writeIssueAlerts({ db, issue, activity, actor, eventType, now }) {
  const assignments = await db.collection('shiftAssignments').where('locationId', '==', issue.locationId).get()
  const recipients = new Map()
  for (const row of assignments.docs) {
    const data = row.data()
    if (data.active !== true || !data.bhtUserId) continue
    recipients.set(String(data.bhtUserId), { id: String(data.bhtUserId), name: data.bhtUserName || null })
  }
  if (issue.reportedByUserId) recipients.set(String(issue.reportedByUserId), { id: String(issue.reportedByUserId), name: issue.reportedByName || null })
  recipients.delete(String(actor.id))
  const targets = [{ id: '', name: null }, ...recipients.values()]
  const batch = db.batch()
  for (const target of targets) {
    const audience = target.id ? 'bht' : 'supervisor'
    const alertId = ['issue', safePart(issue.id), safePart(activity.id), safePart(eventType), safePart(target.id || 'supervisor')].join('__')
    batch.set(db.doc(`alerts/${alertId}`), {
      audience,
      type: target.id ? 'eoc_issue_update' : 'eoc_issue',
      issueId: issue.id,
      activityId: activity.id,
      eventType,
      locationId: issue.locationId,
      eocType: issue.eocType || null,
      source: issue.source || null,
      issueType: issue.issueType || null,
      issueVersion: Number(issue.version || 1),
      targetUserId: target.id || null,
      targetUserName: target.name,
      status: issue.status || 'open',
      statusNote: activity.note || '',
      actorUserId: actor.id,
      actorName: String(actor.name || 'Ops Hub'),
      message: `${String(actor.name || 'Ops Hub')} ${eventType.replaceAll('_', ' ')}: ${issue.label || 'Issue'}.`,
      read: false,
      version: 1,
      createdAt: now,
      updatedAt: now
    }, { merge: true })
  }
  await batch.commit()
  return targets.length
}

export async function submitProtectedEoc({ db, secret, requestAuth, requestData = {}, appCheckPresent = false, nowMs = Date.now() }) {
  await requireWorkflow(db, 'eoc')
  const actor = await loadMappedActor({ db, requestAuth, nowMs, requireCurrentSession: true })
  const taskId = cleanId(requestData.taskId, 'Task ID')
  const hash = operationHash(requestData.operationId, 'eoc-submit-v9', secret)
  const operationRef = db.doc(`securityWorkflowAudit/eoc_submit_${hash}`)
  const taskRef = db.doc(`eocTasks/${taskId}`)
  const timestamp = Timestamp.fromMillis(nowMs)
  const answers = Array.isArray(requestData.answers) ? requestData.answers.slice(0, 300) : []
  if (answers.length === 0) error('invalid-argument', 'EOC answers are required.')

  const result = await db.runTransaction(async transaction => {
    const [operationSnapshot, taskSnapshot] = await Promise.all([
      transaction.get(operationRef), transaction.get(taskRef)
    ])
    if (operationSnapshot.exists) return operationSnapshot.data().result
    if (!taskSnapshot.exists) error('not-found', 'The EOC task no longer exists.')
    const task = taskSnapshot.data()
    if (!actorCanCompleteEocTask(actor, task)) error('permission-denied', 'You are not eligible to complete this EOC task.')
    if (!['pending', 'overdue'].includes(String(task.status || ''))) error('failed-precondition', `This EOC task is already ${task.status}.`)
    let nextVersion
    try {
      nextVersion = assertExpectedOperationalVersion(requestData.expectedTaskVersion, Number(task.version || 1), 'EOC task')
    } catch (cause) {
      error('aborted', cause.message)
    }
    const submissionId = `eoc_${safePart(taskId, 80)}_${safePart(actor.id, 80)}`
    const submissionRef = db.doc(`eocSubmissions/${submissionId}`)
    const issueResults = []
    const issueAnswers = answers.filter(answer => answer?.status === 'repair')
    if (issueAnswers.length > 100) error('invalid-argument', 'Too many issues were included in one EOC submission.')
    const issuePlans = []
    for (const answer of issueAnswers) {
      const trackingId = cleanId(answer.trackingId || answer.itemId, 'Question tracking ID')
      const issueId = `eoc_${safePart(taskId, 80)}_${safePart(trackingId, 80)}`
      const patternId = issuePatternId(task.locationId, trackingId)
      const patternRef = db.doc(`eocIssuePatterns/${patternId}`)
      const patternSnapshot = await transaction.get(patternRef)
      issuePlans.push({ answer, trackingId, issueId, patternId, patternRef, patternSnapshot })
    }
    transaction.create(submissionRef, {
      taskId,
      locationId: task.locationId,
      shiftId: task.shiftId,
      templateScope: task.templateScope || 'otc_shared',
      templateId: task.templateId || null,
      templateName: task.templateName || '',
      templateVersion: Number(task.templateVersion || 0) || null,
      templateVersionId: task.templateVersionId || null,
      vanId: task.vanId || null,
      dueDate: task.dueDate || null,
      staffCompleting: String(actor.name || ''),
      eocType: task.taskType || task.eocType || requestData.eocType || 'house',
      vehicleId: sanitizeOperationalText(requestData.vehicleId, 160) || null,
      vehicleName: sanitizeOperationalText(requestData.vehicleName, 200),
      vinNumber: sanitizeOperationalText(requestData.vinNumber, 100),
      odometerReading: sanitizeOperationalText(requestData.odometerReading, 30),
      odometerMileage: Number.isFinite(Number(requestData.odometerMileage)) ? Number(requestData.odometerMileage) : null,
      answers,
      issueCount: issueAnswers.length,
      totalQuestionCount: answers.length,
      answeredQuestionCount: answers.filter(answer => String(answer?.status ?? '').trim() || (Array.isArray(answer?.responsePhotoAttachmentIds) && answer.responsePhotoAttachmentIds.length)).length,
      photoCount: answers.reduce((count, answer) => count + (Array.isArray(answer?.responsePhotoAttachmentIds) ? answer.responsePhotoAttachmentIds.length : 0) + (Array.isArray(answer?.photoAttachmentIds) ? answer.photoAttachmentIds.length : 0), 0),
      issueSectionNames: [...new Set(issueAnswers.map(answer => sanitizeOperationalText(answer.category, 200)).filter(Boolean))],
      submittedByUserId: actor.id,
      submittedByName: String(actor.name || ''),
      ...(requestData.offlineReplayAuthorization ? { offlineReplayAuthorization: requestData.offlineReplayAuthorization } : {}),
      securityMutationVersion: 9,
      version: 1,
      submittedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    })
    transaction.update(taskRef, {
      status: 'completed', submissionId, completedAt: timestamp,
      completedByUserId: actor.id, completedByName: String(actor.name || ''),
      securityMutationVersion: 9, version: nextVersion, updatedAt: timestamp
    })
    const draftId = String(requestData.draftId || '').trim()
    if (draftId) transaction.delete(db.doc(`eocSubmissionDrafts/${cleanId(draftId, 'Draft ID')}`))
    for (const plan of issuePlans) {
      const { answer, trackingId, issueId, patternId, patternRef, patternSnapshot } = plan
      const issueRef = db.doc(`eocIssues/${issueId}`)
      const activityId = 'v1_reported'
      const pattern = addPatternObservation(patternSnapshot.exists ? patternSnapshot.data() : {}, issueId, nowMs)
      const issue = {
        id: issueId, schemaVersion: 3, source: 'eoc_checklist',
        issueType: (task.taskType || task.eocType) === 'van' ? 'van_vehicle' : 'house_property',
        issueTypeLabel: (task.taskType || task.eocType) === 'van' ? 'Van/vehicle' : 'House/property',
        eocType: task.taskType || task.eocType || 'house', locationId: task.locationId, shiftId: task.shiftId,
        vanId: task.vanId || null, taskId, submissionId, templateId: task.templateId || null,
        templateVersion: Number(task.templateVersion || 0) || null, templateVersionId: task.templateVersionId || null,
        itemId: sanitizeOperationalText(answer.itemId, 160) || trackingId, trackingId, sourceTrackingId: trackingId,
        linkedTrackingId: null, parentIssueId: null, relationshipDecision: null, recurrenceEligible: true,
        patternId, reportedBefore: pattern.reportedBefore, recurringIssue: pattern.recurringIssue,
        recurrenceCountAtReport: pattern.recentCount, recurrenceObservedAtMs: nowMs,
        label: sanitizeOperationalText(answer.label, 300) || 'EOC issue',
        category: sanitizeOperationalText(answer.category, 300) || 'EOC checklist',
        description: sanitizeOperationalText(answer.description, 2000),
        requiresPhotoOnIssue: answer.requiresPhotoOnIssue === true, status: 'open',
        reportedByUserId: actor.id, reportedByName: String(actor.name || ''), version: 1
      }
      const activity = activityRecord({ issueId, issue, actor, eventType: 'reported', status: 'open', note: issue.description, version: 1, now: timestamp })
      transaction.create(issueRef, { ...issue, latestActivity: latestActivity(activityId, activity), createdAt: timestamp, updatedAt: timestamp, securityMutationVersion: 9 })
      transaction.create(db.doc(`eocIssues/${issueId}/activity/${activityId}`), activity)
      transaction.set(patternRef, {
        schemaVersion: 1, patternId, locationId: task.locationId, trackingId,
        observations: pattern.observations, recentCount: pattern.recentCount,
        lifetimeCount: pattern.lifetimeCount, reportedBefore: pattern.reportedBefore,
        recurringIssue: pattern.recurringIssue,
        firstObservedAtMs: pattern.observations[0]?.observedAtMs || nowMs,
        lastObservedAtMs: nowMs, lastIssueId: issueId, updatedAt: timestamp,
        ...(patternSnapshot.exists ? {} : { createdAt: timestamp }),
        version: Number(patternSnapshot.data()?.version || 0) + 1
      }, { merge: true })
      issueResults.push({ issueId, activityId, issue, activity: { id: activityId, ...activity } })
    }
    const publicResult = { submissionId, issueIds: issueResults.map(item => item.issueId), alreadySubmitted: false }
    transaction.create(operationRef, {
      schemaVersion: 9, action: 'protected_eoc_submitted', actorProfileId: actor.id,
      actorAuthUid: actor.authUid, sessionId: actor.sessionId, taskId,
      locationId: task.locationId, appCheckPresent: appCheckPresent === true,
      result: publicResult, immutable: true, createdAt: timestamp
    })
    return { ...publicResult, issueResults }
  })
  let issueResults = result.issueResults || []
  if (issueResults.length === 0 && Array.isArray(result.issueIds) && result.issueIds.length > 0) {
    issueResults = await Promise.all(result.issueIds.map(async issueId => {
      const [issueSnapshot, activitySnapshot] = await Promise.all([
        db.doc(`eocIssues/${issueId}`).get(),
        db.doc(`eocIssues/${issueId}/activity/v1_reported`).get()
      ])
      if (!issueSnapshot.exists || !activitySnapshot.exists) return null
      return {
        issue: { id: issueSnapshot.id, ...issueSnapshot.data() },
        activity: { id: activitySnapshot.id, ...activitySnapshot.data() }
      }
    }))
    issueResults = issueResults.filter(Boolean)
  }
  for (const item of issueResults) {
    await writeIssueAlerts({ db, issue: item.issue, activity: item.activity, actor, eventType: 'reported', now: timestamp })
  }
  return { submissionId: result.submissionId, issueIds: result.issueIds || [], alreadySubmitted: result.alreadySubmitted === true }
}

function issueUpdateForAction({ action, issue, actor, requestData, nextVersion, timestamp, nowMs }) {
  const note = sanitizeOperationalText(requestData.note, 2000)
  const currentStatus = String(issue.status || 'open').toLowerCase()
  let eventType = ''
  let nextStatus = currentStatus
  const update = { version: nextVersion, updatedAt: timestamp, securityMutationVersion: 9 }
  if (action === 'status_update') {
    nextStatus = String(requestData.nextStatus || '').trim().toLowerCase()
    if (!['open', 'in_progress', 'resolved', 'voided'].includes(nextStatus) || !note) error('invalid-argument', 'A valid status and note are required.')
    if (nextStatus === 'open' && !TERMINAL_STATUSES.has(currentStatus)) error('failed-precondition', 'Only a closed issue can be reopened.')
    if (nextStatus !== 'open' && TERMINAL_STATUSES.has(currentStatus)) error('failed-precondition', 'This issue is already closed.')
    if (nextStatus !== 'open' && nextStatus === currentStatus) error('failed-precondition', `This issue is already ${nextStatus.replace('_', ' ')}.`)
    eventType = nextStatus === 'open' ? 'reopened' : nextStatus
    update.status = nextStatus
    if (nextStatus === 'in_progress') Object.assign(update, { inProgressNotes: note, inProgressAt: timestamp, inProgressByUserId: actor.id, inProgressByName: actor.name })
    if (nextStatus === 'resolved') Object.assign(update, { resolvedNotes: note, resolvedAt: timestamp, closedAt: timestamp, resolvedByUserId: actor.id, resolvedByName: actor.name, photoDeletionDueAt: Timestamp.fromMillis(nowMs + PHOTO_RETENTION_MS) })
    if (nextStatus === 'voided') Object.assign(update, { voidReason: note, voidedAt: timestamp, closedAt: timestamp, voidedByUserId: actor.id, voidedByName: actor.name, photoDeletionDueAt: Timestamp.fromMillis(nowMs + PHOTO_RETENTION_MS) })
    if (nextStatus === 'open') Object.assign(update, { closedAt: null, photoDeletionDueAt: null, reopenedAt: timestamp, reopenedByUserId: actor.id, reopenedByName: actor.name, reopenNotes: note })
  } else if (action === 'add_note') {
    if (!note) error('invalid-argument', 'A note is required.')
    eventType = 'note_added'
  } else if (action === 'bht_follow_up') {
    if (!note || TERMINAL_STATUSES.has(currentStatus)) error('failed-precondition', 'An active issue and update are required.')
    eventType = 'bht_follow_up'
  } else if (action === 'request_reopen') {
    if (!note || !TERMINAL_STATUSES.has(currentStatus)) error('failed-precondition', 'A closed issue and explanation are required.')
    eventType = 'problem_returned'
  } else if (action === 'submit_resolution') {
    if (!note || !['open', 'in_progress'].includes(currentStatus)) error('failed-precondition', 'Only an active issue can be submitted for supervisor review.')
    eventType = 'resolution_submitted'
    nextStatus = 'pending_supervisor_review'
    Object.assign(update, { status: nextStatus, resolutionSubmittedNotes: note, resolutionSubmittedAt: timestamp, resolutionSubmittedByUserId: actor.id, resolutionSubmittedByName: actor.name })
  } else if (action === 'review_resolution') {
    const decision = String(requestData.decision || '').trim().toLowerCase()
    if (currentStatus !== 'pending_supervisor_review' || !['approve', 'return'].includes(decision)) error('failed-precondition', 'This issue is not available for that review.')
    if (decision === 'return' && !note) error('invalid-argument', 'Explain why this issue is being returned.')
    const approved = decision === 'approve'
    eventType = approved ? 'resolution_approved' : 'resolution_returned'
    nextStatus = approved ? 'resolved' : 'in_progress'
    const activityNote = note || sanitizeOperationalText(issue.resolutionSubmittedNotes, 2000) || 'Resolution reviewed and approved.'
    Object.assign(update, { status: nextStatus, resolutionReviewedAt: timestamp, resolutionReviewedByUserId: actor.id, resolutionReviewedByName: actor.name, resolutionReviewDecision: decision, resolutionReviewNotes: note || null })
    if (approved) Object.assign(update, { resolvedNotes: sanitizeOperationalText(issue.resolutionSubmittedNotes, 2000) || activityNote, resolvedAt: timestamp, closedAt: timestamp, resolvedByUserId: actor.id, resolvedByName: actor.name, photoDeletionDueAt: Timestamp.fromMillis(nowMs + PHOTO_RETENTION_MS) })
    else Object.assign(update, { inProgressNotes: note, inProgressAt: timestamp, inProgressByUserId: actor.id, inProgressByName: actor.name, closedAt: null, photoDeletionDueAt: null })
    return { eventType, nextStatus, note: activityNote, update }
  } else if (action === 'keep_separate') {
    eventType = 'kept_separate'
    Object.assign(update, { relationshipDecision: 'kept_separate', relationshipReason: note, relationshipReviewedAt: timestamp, relationshipReviewedByUserId: actor.id, relationshipReviewedByName: actor.name })
  } else if (action === 'classify_report') {
    const trackingId = cleanId(requestData.trackingId, 'Tracking ID')
    if (issue.source === 'eoc_checklist') error('failed-precondition', 'An EOC issue keeps its original checklist tracking.')
    eventType = 'checklist_classified'
    Object.assign(update, { linkedTrackingId: trackingId, linkedChecklistLabel: sanitizeOperationalText(requestData.checklistLabel, 300), linkedChecklistCategory: sanitizeOperationalText(requestData.categoryLabel, 300), relationshipDecision: 'checklist_classified', relationshipReason: note, relationshipReviewedAt: timestamp, relationshipReviewedByUserId: actor.id, relationshipReviewedByName: actor.name })
  } else if (action === 'unlink_relationship') {
    if (!note) error('invalid-argument', 'A reason is required to unlink this record.')
    if (!issue.parentIssueId && !issue.linkedTrackingId) error('failed-precondition', 'This issue has no removable relationship.')
    eventType = 'relationship_unlinked'
    Object.assign(update, {
      ...(issue.parentIssueId ? { status: 'open', closedAt: null, photoDeletionDueAt: null, resolvedAt: null, resolvedNotes: null, resolutionType: null } : {}),
      parentIssueId: null,
      linkedTrackingId: issue.source === 'eoc_checklist' ? issue.linkedTrackingId || null : null,
      linkedChecklistLabel: null,
      linkedChecklistCategory: null,
      relationshipDecision: 'unlinked', relationshipReason: note,
      relationshipUnlinkedAt: timestamp, relationshipUnlinkedByUserId: actor.id, relationshipUnlinkedByName: actor.name
    })
  } else {
    error('invalid-argument', 'Unsupported issue action.')
  }
  return { eventType, nextStatus, note, update }
}

export async function mutateProtectedIssue({ db, secret, requestAuth, requestData = {}, appCheckPresent = false, nowMs = Date.now() }) {
  await requireWorkflow(db, 'issues_feedback_audit')
  const actor = await loadMappedActor({ db, requestAuth, nowMs, requireCurrentSession: true })
  const action = String(requestData.action || '').trim()
  if (!isSupportedIssueAction(action)) error('invalid-argument', 'Unsupported issue action.')
  const hash = operationHash(requestData.operationId, `issue-${action}-v9`, secret)
  const operationRef = db.doc(`securityWorkflowAudit/issue_${action}_${hash}`)
  const timestamp = Timestamp.fromMillis(nowMs)

  if (action === 'create_report') {
    const issue = quickIssueRecord(requestData.issue || {}, actor)
    if (!actorCanPerformIssueAction(actor, issue, action)) error('permission-denied', 'You cannot report an issue for that location.')
    const issueId = `bht_${hash}`
    const issueRef = db.doc(`eocIssues/${issueId}`)
    const activityId = 'v1_reported'
    const activity = activityRecord({ issueId, issue, actor, eventType: 'reported', status: 'open', note: issue.description, version: 1, now: timestamp })
    const result = await db.runTransaction(async transaction => {
      const [operationSnapshot, issueSnapshot] = await Promise.all([transaction.get(operationRef), transaction.get(issueRef)])
      if (operationSnapshot.exists) return operationSnapshot.data().result
      if (issueSnapshot.exists) error('already-exists', 'This issue report already exists.')
      const record = { id: issueId, ...issue, latestActivity: latestActivity(activityId, activity), createdAt: timestamp, updatedAt: timestamp, securityMutationVersion: 9 }
      transaction.create(issueRef, record)
      transaction.create(db.doc(`eocIssues/${issueId}/activity/${activityId}`), activity)
      const publicResult = { issueId, activityId, issue: record }
      transaction.create(operationRef, { schemaVersion: 9, action: 'protected_issue_reported', actorProfileId: actor.id, actorAuthUid: actor.authUid, sessionId: actor.sessionId, issueId, locationId: issue.locationId, appCheckPresent: appCheckPresent === true, result: publicResult, immutable: true, createdAt: timestamp })
      return publicResult
    })
    await writeIssueAlerts({ db, issue: result.issue, activity: { id: result.activityId, ...activity }, actor, eventType: 'reported', now: timestamp })
    return result
  }

  if (action === 'link_follow_up') return linkProtectedIssues({ db, actor, requestData, operationRef, timestamp, appCheckPresent })

  const issueId = cleanId(requestData.issueId, 'Issue ID')
  const issueRef = db.doc(`eocIssues/${issueId}`)
  const result = await db.runTransaction(async transaction => {
    const [operationSnapshot, issueSnapshot] = await Promise.all([transaction.get(operationRef), transaction.get(issueRef)])
    if (operationSnapshot.exists) return operationSnapshot.data().result
    if (!issueSnapshot.exists) error('not-found', 'The issue no longer exists.')
    const issue = { id: issueId, ...issueSnapshot.data() }
    if (!actorCanPerformIssueAction(actor, issue, action)) error('permission-denied', 'You cannot perform that issue action.')
    let nextVersion
    try {
      nextVersion = assertExpectedOperationalVersion(requestData.expectedVersion, Number(issue.version || 1), 'Issue')
    } catch (cause) {
      error('aborted', cause.message)
    }
    const requestedStatus = action === 'status_update' ? String(requestData.nextStatus || '').trim().toLowerCase() : ''
    const trackingId = String(issue.sourceTrackingId || issue.trackingId || '').trim()
    const shouldInvalidatePattern = requestedStatus === 'voided' && issue.source === 'eoc_checklist' && issue.recurrenceInvalidated !== true && trackingId
    const shouldRestorePattern = requestedStatus === 'open' && issue.status === 'voided' && issue.source === 'eoc_checklist' && issue.recurrenceInvalidated === true && trackingId
    const patternRef = (shouldInvalidatePattern || shouldRestorePattern)
      ? db.doc(`eocIssuePatterns/${issue.patternId || issuePatternId(issue.locationId, trackingId)}`)
      : null
    const patternSnapshot = patternRef ? await transaction.get(patternRef) : null
    const mutation = issueUpdateForAction({ action, issue, actor, requestData, nextVersion, timestamp, nowMs })
    const activityId = `v${nextVersion}_${mutation.eventType}`
    const activity = activityRecord({ issueId, issue, actor, eventType: mutation.eventType, status: mutation.nextStatus, note: mutation.note, version: nextVersion, now: timestamp })
    const update = {
      ...mutation.update,
      latestActivity: latestActivity(activityId, activity),
      ...(shouldInvalidatePattern ? { recurrenceInvalidated: true, recurrenceInvalidatedAt: timestamp, recurrenceInvalidatedReason: mutation.note } : {}),
      ...(shouldRestorePattern ? { recurrenceInvalidated: false } : {})
    }
    transaction.update(issueRef, update)
    transaction.create(db.doc(`eocIssues/${issueId}/activity/${activityId}`), { ...activity, ...(action === 'unlink_relationship' ? { relationshipAudit: true } : {}) })
    if (patternRef && patternSnapshot?.exists) {
      const pattern = shouldInvalidatePattern
        ? removePatternObservation(patternSnapshot.data(), issueId, nowMs)
        : addPatternObservation(patternSnapshot.data(), issueId, Number(issue.recurrenceObservedAtMs || nowMs))
      transaction.set(patternRef, {
        observations: pattern.observations, recentCount: pattern.recentCount,
        lifetimeCount: pattern.lifetimeCount, reportedBefore: pattern.reportedBefore,
        recurringIssue: pattern.recurringIssue, lastIssueId: issueId,
        updatedAt: timestamp, version: Number(patternSnapshot.data()?.version || 0) + 1
      }, { merge: true })
    }
    const updatedIssue = { ...issue, ...update }
    const publicResult = { issueId, activityId, issue: updatedIssue }
    transaction.create(operationRef, { schemaVersion: 9, action: `protected_issue_${action}`, actorProfileId: actor.id, actorAuthUid: actor.authUid, sessionId: actor.sessionId, issueId, locationId: issue.locationId, appCheckPresent: appCheckPresent === true, result: publicResult, immutable: true, createdAt: timestamp })
    transaction.create(db.doc(`auditLogs/secure_issue_${hash}`), {
      action: `issue_${action}`, collectionPath: 'eocIssues', documentId: issueId,
      performedByUserId: actor.id, performedByName: String(actor.name || ''),
      reason: mutation.note || action, locationId: issue.locationId, activityId,
      securityMutationVersion: 9, immutable: true, version: 1, createdAt: timestamp
    })
    return publicResult
  })
  await writeIssueAlerts({ db, issue: result.issue, activity: { id: result.activityId, eventType: result.issue.latestActivity.eventType, note: result.issue.latestActivity.note }, actor, eventType: result.issue.latestActivity.eventType, now: timestamp })
  return result
}

async function linkProtectedIssues({ db, actor, requestData, operationRef, timestamp, appCheckPresent }) {
  const childIssueId = cleanId(requestData.issueId || requestData.childIssueId, 'Child issue ID')
  const parentIssueId = cleanId(requestData.parentIssueId, 'Parent issue ID')
  if (childIssueId === parentIssueId) error('invalid-argument', 'An issue cannot be linked to itself.')
  const note = sanitizeOperationalText(requestData.note || requestData.reason, 2000)
  if (!note) error('invalid-argument', 'Explain why these reports should be linked.')
  const childRef = db.doc(`eocIssues/${childIssueId}`)
  const parentRef = db.doc(`eocIssues/${parentIssueId}`)
  const result = await db.runTransaction(async transaction => {
    const [operationSnapshot, childSnapshot, parentSnapshot] = await Promise.all([
      transaction.get(operationRef), transaction.get(childRef), transaction.get(parentRef)
    ])
    if (operationSnapshot.exists) return operationSnapshot.data().result
    if (!childSnapshot.exists || !parentSnapshot.exists) error('not-found', 'One of the issues no longer exists.')
    const child = { id: childIssueId, ...childSnapshot.data() }
    const parent = { id: parentIssueId, ...parentSnapshot.data() }
    if (!actorCanPerformIssueAction(actor, child, 'link_follow_up') || !operationalActorCanAccessLocation(actor, parent.locationId)) error('permission-denied', 'You cannot link those issues.')
    if (child.locationId !== parent.locationId || child.parentIssueId || TERMINAL_STATUSES.has(String(child.status || ''))) error('failed-precondition', 'Those issues cannot be linked.')
    const reopenParent = requestData.reopenParent === true
    if (parent.status === 'voided' || (parent.status === 'resolved' && !reopenParent)) error('failed-precondition', 'The selected parent issue is not active.')
    const childVersion = assertExpectedOperationalVersion(requestData.expectedVersion, Number(child.version || 1), 'Issue')
    const parentVersion = Number(parent.version || 1) + 1
    const childActivityId = `v${childVersion}_linked_as_follow_up`
    const parentEvent = parent.status === 'resolved' ? 'reopened_with_follow_up' : 'follow_up_linked'
    const parentActivityId = `v${parentVersion}_${parentEvent}`
    const childActivity = activityRecord({ issueId: childIssueId, issue: child, actor, eventType: 'linked_as_follow_up', status: 'resolved', note, version: childVersion, now: timestamp })
    const parentStatus = parent.status === 'resolved' ? 'open' : parent.status
    const parentActivity = activityRecord({ issueId: parentIssueId, issue: parent, actor, eventType: parentEvent, status: parentStatus, note, version: parentVersion, now: timestamp })
    transaction.update(childRef, { status: 'resolved', parentIssueId, relationshipDecision: 'linked_as_follow_up', resolvedAt: timestamp, closedAt: timestamp, resolvedNotes: note, resolvedByUserId: actor.id, resolvedByName: actor.name, photoDeletionDueAt: Timestamp.fromMillis(timestamp.toMillis() + PHOTO_RETENTION_MS), version: childVersion, latestActivity: latestActivity(childActivityId, childActivity), updatedAt: timestamp, securityMutationVersion: 9 })
    transaction.update(parentRef, { status: parentStatus, ...(parent.status === 'resolved' ? { closedAt: null, photoDeletionDueAt: null, reopenedAt: timestamp, reopenNotes: note } : {}), version: parentVersion, latestActivity: latestActivity(parentActivityId, parentActivity), updatedAt: timestamp, securityMutationVersion: 9 })
    transaction.create(db.doc(`eocIssues/${childIssueId}/activity/${childActivityId}`), { ...childActivity, relationshipAudit: true, relatedIssueId: parentIssueId })
    transaction.create(db.doc(`eocIssues/${parentIssueId}/activity/${parentActivityId}`), { ...parentActivity, relationshipAudit: true, relatedIssueId: childIssueId })
    const publicResult = {
      childIssueId, parentIssueId, childActivityId, parentActivityId,
      childIssue: { ...child, status: 'resolved', parentIssueId, version: childVersion },
      parentIssue: { ...parent, status: parentStatus, version: parentVersion },
      childActivity: { id: childActivityId, ...childActivity },
      parentActivity: { id: parentActivityId, ...parentActivity }
    }
    transaction.create(operationRef, { schemaVersion: 9, action: 'protected_issue_link_follow_up', actorProfileId: actor.id, actorAuthUid: actor.authUid, sessionId: actor.sessionId, issueId: childIssueId, relatedIssueId: parentIssueId, locationId: child.locationId, appCheckPresent: appCheckPresent === true, result: publicResult, immutable: true, createdAt: timestamp })
    transaction.create(db.collection('auditLogs').doc(), {
      action: 'issue_linked_follow_up', collectionPath: 'eocIssues', documentId: childIssueId,
      performedByUserId: actor.id, performedByName: String(actor.name || ''), reason: note,
      locationId: child.locationId, parentIssueId, childActivityId, parentActivityId,
      securityMutationVersion: 9, immutable: true, version: 1, createdAt: timestamp
    })
    return publicResult
  })
  await Promise.all([
    writeIssueAlerts({ db, issue: result.childIssue, activity: result.childActivity, actor, eventType: 'linked_as_follow_up', now: timestamp }),
    writeIssueAlerts({ db, issue: result.parentIssue, activity: result.parentActivity, actor, eventType: result.parentActivity.eventType, now: timestamp })
  ])
  return {
    childIssueId: result.childIssueId,
    parentIssueId: result.parentIssueId,
    childActivityId: result.childActivityId,
    parentActivityId: result.parentActivityId
  }
}
