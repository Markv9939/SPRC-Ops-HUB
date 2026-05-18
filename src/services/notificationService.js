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
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'

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
  return {
    type: 'eoc_issue',
    issueId: issueRefId,
    taskId: task?.id || null,
    locationId: task?.locationId || null,
    eocType: issue?.eocType || task?.eocType || null,
    severity: issue?.severity || 'medium',
    message: `EOC issue: ${issue?.label || 'Issue'} - ${issue?.description || ''}`,
    bhtName: userName || null,
    techName: userName || null,
    ...basePayload()
  }
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
 *   - transport: { id, site, clients, stops, status }
 *   - userName: name of the BHT who completed the transport
 */
export async function createTransportCompletedAlert({ transport, userName }) {
  if (!transport?.id) return

  const clientCount = Array.isArray(transport.clients) ? transport.clients.length : 0
  const stopCount = Array.isArray(transport.stops) ? transport.stops.length : 0
  const site = transport.site || ''

  await addDoc(collection(db, 'alerts'), {
    type: 'transport_completed',
    transportId: transport.id,
    site,
    locationId: site,
    severity: 'low',
    message: `${userName || 'BHT'} completed transport — ${clientCount} client${clientCount !== 1 ? 's' : ''}, ${stopCount} stop${stopCount !== 1 ? 's' : ''}, ${site}.`,
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
