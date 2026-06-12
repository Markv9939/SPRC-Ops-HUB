/**
 * Centralized notification and alert service.
 *
 * All alert writes to Firestore `alerts` collection should flow through
 * this service so that every role-to-role notification uses a consistent
 * schema, and future push-notification hooks have a single integration point.
 *
 * Alert types:
 *   - eoc_issue          BHT → Supervisor  (new issue reported from EOC checklist)
 *   - eoc_issue_update   Supervisor → BHT  (issue status changed)
 *   - fleet_upcoming     System → Supervisor  (fleet task approaching due)
 *   - fleet_overdue      System → Supervisor  (fleet task past due)
 *   - transport_completed BHT → Supervisor  (transport closed/returned)
 */

import { db } from '../firebase'
import { addDoc, collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trimOrNull(value) {
  const trimmed = String(value || '').trim()
  return trimmed || null
}

function basePayload() {
  return {
    read: false,
    version: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }
}

function safeIdPart(value) {
  return String(value || 'unknown').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || 'unknown'
}

// ---------------------------------------------------------------------------
// BHT → Supervisor: EOC issue reported
// ---------------------------------------------------------------------------

/**
 * Build an alert payload for a newly reported EOC issue.
 * Designed to be called inside a Firestore transaction — returns the data
 * object so the caller can do `transaction.set(alertRef, data)`.
 *
 * @param {{ issueRefId, task, issue, userName }} params
 * @returns {object} Firestore document data
 */
export function buildEocIssueAlertPayload({ issueRefId, task, issue, userName }) {
  const fromBhtHome = issue?.source === 'bht_home'
  const prefix = fromBhtHome ? 'Issue report' : 'EOC issue'

  return {
    audience: 'supervisor',
    type: 'eoc_issue',
    issueId: issueRefId,
    taskId: issue?.taskId || task?.id || null,
    locationId: issue?.locationId || task?.locationId || null,
    eocType: issue?.eocType || task?.eocType || null,
    severity: issue?.severity || 'medium',
    source: issue?.source || null,
    issueType: issue?.issueType || null,
    message: `${prefix}: ${issue?.label || 'Issue'} - ${issue?.description || ''}`,
    bhtName: userName || null,
    techName: userName || null,
    ...basePayload()
  }
}

export async function getIssueNotificationRecipients(issue) {
  if (!issue?.locationId) return []

  const recipients = new Map()
  const assignmentSnap = await getDocs(query(
    collection(db, 'shiftAssignments'),
    where('locationId', '==', issue.locationId),
    where('active', '==', true)
  ))

  assignmentSnap.docs.forEach((docSnap) => {
    const assignment = docSnap.data()
    const targetUserId = trimOrNull(assignment.bhtUserId)
    if (!targetUserId) return
    recipients.set(targetUserId, {
      targetUserId,
      targetUserName: trimOrNull(assignment.bhtUserName),
      recipientSource: 'assignment'
    })
  })

  const reporterUserId = trimOrNull(issue.reportedByUserId)
  if (reporterUserId) {
    const existing = recipients.get(reporterUserId)
    recipients.set(reporterUserId, {
      targetUserId: reporterUserId,
      targetUserName: trimOrNull(issue.reportedByName) || existing?.targetUserName || null,
      recipientSource: existing ? 'assignment_and_reporter' : 'reporter'
    })
  }

  return Array.from(recipients.values())
}

export function buildIssueAlertPayload({
  issue,
  activity,
  eventType,
  target,
  actorUser
}) {
  const statusLabel = issue?.status === 'resolved'
    ? 'resolved'
    : issue?.status === 'voided'
      ? 'voided'
      : issue?.status === 'in_progress'
        ? 'in progress'
        : 'updated'
  const actorName = actorUser?.name || activity?.actorName || 'Ops Hub'
  const type = eventType === 'reported' ? 'eoc_issue' : 'eoc_issue_update'

  return {
    audience: target?.targetUserId ? 'bht' : 'supervisor',
    type,
    issueId: issue.id,
    activityId: activity.id || null,
    eventType,
    locationId: issue.locationId,
    eocType: issue.eocType || null,
    severity: issue.severity || 'medium',
    issueVersion: issue.version || 1,
    targetUserId: target?.targetUserId || null,
    targetUserName: target?.targetUserName || null,
    recipientSource: target?.recipientSource || null,
    status: issue.status || 'open',
    statusNote: activity?.note || '',
    actorUserId: trimOrNull(actorUser?.id || activity?.actorUserId),
    actorName,
    message: eventType === 'reported'
      ? `Location issue reported: ${issue.label || 'Issue'} - ${issue.description || ''}`
      : `${actorName} marked "${issue.label || 'Issue'}" as ${statusLabel}.`,
    ...basePayload()
  }
}

export async function fanOutIssueAlerts({ issue, activity, eventType, actorUser }) {
  if (!issue?.id || !activity?.id) return { written: 0 }

  const recipients = eventType === 'reported'
    ? [{ targetUserId: null, targetUserName: null, recipientSource: 'supervisor_location' }]
    : await getIssueNotificationRecipients(issue)

  const batch = writeBatch(db)
  let written = 0
  recipients.forEach((target) => {
    const alertId = [
      'issue',
      safeIdPart(issue.id),
      safeIdPart(activity.id),
      safeIdPart(eventType),
      safeIdPart(target?.targetUserId || 'supervisor')
    ].join('__')
    batch.set(doc(db, 'alerts', alertId), buildIssueAlertPayload({
      issue,
      activity,
      eventType,
      target,
      actorUser
    }), { merge: true })
    written += 1
  })

  if (written > 0) await batch.commit()
  return { written }
}

// ---------------------------------------------------------------------------
// Supervisor → BHT: Issue status update (in_progress / resolved)
// ---------------------------------------------------------------------------

/**
 * Write an `eoc_issue_update` alert so the originating BHT sees feedback.
 *
 * @param {{ issue, nextStatus, note, actorUser }} params
 *   - issue: the eocIssues document data (must include id, locationId, reportedByUserId)
 *   - nextStatus: 'in_progress' | 'resolved'
 *   - note: status note / resolution note (string)
 *   - actorUser: { id, name } of the supervisor performing the action
 */
export async function createIssueStatusNotification({ issue, nextStatus, note, actorUser }) {
  if (!issue?.locationId || !issue?.reportedByUserId) return

  const actorName = actorUser?.name || 'Supervisor'
  const statusLabel = nextStatus === 'resolved' ? 'resolved' : 'in progress'

  await addDoc(collection(db, 'alerts'), {
    audience: 'bht',
    type: 'eoc_issue_update',
    issueId: issue.id,
    taskId: issue.taskId || null,
    locationId: issue.locationId,
    eocType: issue.eocType || null,
    severity: issue.severity || 'medium',
    targetUserId: issue.reportedByUserId,
    targetUserName: issue.reportedByName || null,
    status: nextStatus,
    statusNote: String(note || '').trim(),
    actorUserId: trimOrNull(actorUser?.id),
    actorName,
    message: `${actorName} marked "${issue.label || 'Issue'}" as ${statusLabel}.`,
    ...basePayload()
  })
}

// ---------------------------------------------------------------------------
// System → Supervisor: Fleet task alert (upcoming / overdue)
// ---------------------------------------------------------------------------

/**
 * Build a fleet alert payload for a task that just transitioned to
 * `upcoming` or `overdue`. Returns the data object for batch writes.
 *
 * @param {string} taskDocId
 * @param {object} descriptor  — fleet task descriptor from fleetTaskEngine
 * @param {string} status      — 'upcoming' | 'overdue'
 * @returns {object} Firestore document data
 */
export function buildFleetAlertPayload(taskDocId, descriptor, status) {
  const isOverdue = status === 'overdue'
  const typeSuffix = isOverdue ? 'overdue' : 'upcoming'
  const statusLabel = isOverdue ? 'overdue' : 'upcoming'

  const dueLabel = descriptor.triggerMode === 'mileage'
    ? `due at ${descriptor.dueMileage} mi`
    : `due on ${descriptor.dueDate}`
  const currentLabel = descriptor.triggerMode === 'mileage'
    ? `current mileage ${descriptor.currentMileageSnapshot ?? '--'}`
    : `current date ${descriptor.currentDateSnapshot || '--'}`
  const vanLabel = String(descriptor.vanId || '').trim()
    ? ` (${descriptor.vanId})`
    : ''

  return {
    audience: 'supervisor',
    type: `fleet_${typeSuffix}`,
    taskId: taskDocId,
    taskType: descriptor.taskType,
    vehicleId: descriptor.vehicleId,
    mainLocation: descriptor.mainLocation || null,
    locationId: descriptor.locationId || descriptor.mainLocation || null,
    vanId: descriptor.vanId || null,
    severity: isOverdue ? 'high' : 'medium',
    message: `Fleet ${statusLabel}: ${descriptor.title}${vanLabel}, ${dueLabel}, ${currentLabel}.`,
    ...basePayload()
  }
}

// ---------------------------------------------------------------------------
// BHT → Supervisor: Transport lifecycle
// ---------------------------------------------------------------------------

/**
 * Write a transport-completed alert visible to supervisors.
 *
 * @param {{ transport, userName }} params
 *   - transport: { id, site, clients, status }
 *   - userName: name of the BHT who completed the transport
 */
export async function createTransportCompletedAlert({ transport, userName }) {
  if (!transport?.id) return

  const clientCount = Array.isArray(transport.clients) ? transport.clients.length : 0
  const site = transport.site || ''
  const clientLabel = `${clientCount} client${clientCount !== 1 ? 's' : ''}`

  await addDoc(collection(db, 'alerts'), {
    audience: 'supervisor',
    type: 'transport_completed',
    transportId: transport.id,
    site,
    locationId: site,
    severity: 'low',
    message: `${userName || 'BHT'} completed transport - ${clientLabel}, ${site}.`,
    bhtName: userName || null,
    ...basePayload()
  })
}

// ---------------------------------------------------------------------------
// Audit log helper (extracted from SupervisorDashboard)
// ---------------------------------------------------------------------------

/**
 * Write an audit log entry.
 *
 * @param {{ action, collectionPath, documentId, reason, actorUser, extra }} params
 */
export async function writeAuditLog({ action, collectionPath, documentId, reason, actorUser, extra = {} }) {
  if (!actorUser?.id || !actorUser?.name) return

  await addDoc(collection(db, 'auditLogs'), {
    action,
    collectionPath,
    documentId,
    performedByUserId: actorUser.id,
    performedByName: actorUser.name,
    reason,
    createdAt: serverTimestamp(),
    ...extra
  })
}
