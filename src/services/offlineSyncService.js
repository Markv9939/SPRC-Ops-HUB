import { db } from '../firebase'
import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where
} from 'firebase/firestore'
import { TEMPLATE_SCOPE_OTC_SHARED, getTemplateScopeForShift } from '../data/eocConstants'
import { assertExpectedVersion, getVersionNumber } from './versioning'
import { updateFleetRuntimeFromEocSubmission } from './fleetRuntimeService'
import { syncFleetTasksForVehicle } from './fleetTaskEngine'
import { createTransportCompletedAlert, fanOutIssueAlerts, writeAuditLog } from './notificationService'
import { submitShiftDebrief } from './shiftDebriefService'
import { submitBhtIssueReportOnline } from './bhtIssueReportService'
import { parseMileageValue } from '../utils/fleetStatus'
import {
  deleteOfflineDraft,
  listOfflineActions,
  markOfflineActionFailed,
  markOfflineActionNeedsReview,
  markOfflineActionSynced,
  queueOfflineAction,
  updateOfflineAction
} from './offlineStore'

export const OFFLINE_ACTION_TYPES = {
  EOC_SUBMISSION: 'eocSubmission',
  SHIFT_DEBRIEF_SUBMISSION: 'shiftDebriefSubmission',
  BHT_ISSUE_REPORT: 'bhtIssueReport',
  TRANSPORT_CREATE: 'transportCreate',
  TRANSPORT_UPDATE: 'transportUpdate',
  TRANSPORT_CLOSE: 'transportClose'
}

export function getEocDraftId(taskId, userId) {
  return `eoc:${String(taskId || '').trim()}__${String(userId || '').trim()}`
}

export function getDebriefDraftId(contextId) {
  return `debrief:${String(contextId || '').trim()}`
}

export function getTransportDraftId(transportId) {
  return `transport:${String(transportId || '').trim()}`
}

export function isLocalTransportId(transportId) {
  return String(transportId || '').startsWith('local_transport_')
}

export function makeLocalTransportId() {
  const suffix = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`
  return `local_transport_${suffix}`
}

export function makeLocalBhtIssueReportId() {
  const suffix = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`
  return `local_bht_issue_${suffix}`
}

export function getTransportCreateActionId(localTransportId) {
  return `transport-create:${String(localTransportId || '').trim()}`
}

export function queueEocSubmission(payload) {
  return queueOfflineAction({
    id: `eoc-submit:${payload?.task?.id || ''}:${payload?.normalizedUserId || payload?.user?.id || ''}`,
    type: OFFLINE_ACTION_TYPES.EOC_SUBMISSION,
    payload
  })
}

export function queueShiftDebriefSubmission(payload) {
  return queueOfflineAction({
    id: `debrief-submit:${payload?.context?.id || ''}`,
    type: OFFLINE_ACTION_TYPES.SHIFT_DEBRIEF_SUBMISSION,
    payload
  })
}

export function queueBhtIssueReport(payload) {
  const localReportId = payload?.localReportId || makeLocalBhtIssueReportId()
  return queueOfflineAction({
    id: `bht-issue:${localReportId}`,
    type: OFFLINE_ACTION_TYPES.BHT_ISSUE_REPORT,
    payload: { ...payload, localReportId }
  })
}

export function queueTransportCreate(payload) {
  return queueOfflineAction({
    id: getTransportCreateActionId(payload?.localTransportId),
    type: OFFLINE_ACTION_TYPES.TRANSPORT_CREATE,
    payload
  })
}

export function queueTransportUpdate(payload) {
  return queueOfflineAction({
    id: `transport-update:${payload?.transportId || ''}`,
    type: OFFLINE_ACTION_TYPES.TRANSPORT_UPDATE,
    payload
  })
}

export function queueTransportClose(payload) {
  return queueOfflineAction({
    id: `transport-close:${payload?.transportId || ''}`,
    type: OFFLINE_ACTION_TYPES.TRANSPORT_CLOSE,
    payload
  })
}

function getDraftDocId(taskId, userId) {
  return `${String(taskId || '').trim()}__${String(userId || '').trim()}`
}

function buildEocAnswersData(templateItems, answers, repairDetails) {
  return (Array.isArray(templateItems) ? templateItems : []).map(item => ({
    itemId: item.id,
    label: item.label,
    category: item.category,
    status: answers?.[item.id],
    ...(answers?.[item.id] === 'repair'
      ? { description: repairDetails?.[item.id]?.description || '' }
      : {})
  }))
}

export async function submitEocSubmissionOnline(payload) {
  const task = payload?.task
  const user = payload?.user
  const normalizedUserId = String(payload?.normalizedUserId || user?.id || '').trim()
  const normalizedAuthUid = String(payload?.normalizedAuthUid || user?.authUid || '').trim()
  const eocType = payload?.eocType || task?.taskType || task?.eocType || ''
  const activeTemplate = Array.isArray(payload?.activeTemplate) ? payload.activeTemplate : []
  const answers = payload?.answers || {}
  const repairDetails = payload?.repairDetails || {}
  const vehicleId = payload?.vehicleId || ''
  const vehicleName = String(payload?.vehicleName || '').trim()
  const vinNumber = String(payload?.vinNumber || '').trim()
  const odometerReading = String(payload?.odometerReading || '')

  if (!task?.id) throw new Error('Task not available.')
  if (!normalizedUserId) throw new Error('Missing staff ID for EOC submission.')

  const normalizedOdometerMileage = eocType === 'van' ? parseMileageValue(odometerReading) : null
  if (eocType === 'van' && normalizedOdometerMileage === null) {
    throw new Error('Odometer reading must be a valid number.')
  }

  const answersData = buildEocAnswersData(activeTemplate, answers, repairDetails)
  const issueItems = answersData.filter(a => a.status === 'repair')
  let submittedEocSubmissionId = ''
  const issuesToNotify = []

  await runTransaction(db, async (transaction) => {
    const taskRef = doc(db, 'eocTasks', task.id)
    const taskSnap = await transaction.get(taskRef)
    const draftRef = normalizedAuthUid
      ? doc(db, 'eocSubmissionDrafts', getDraftDocId(task.id, normalizedUserId))
      : null
    const draftSnap = draftRef ? await transaction.get(draftRef) : null
    if (!taskSnap.exists()) throw new Error('Task no longer exists.')

    const latestTask = taskSnap.data()
    if (latestTask.status !== 'pending' && latestTask.status !== 'overdue') {
      throw new Error(`This EOC task is already ${latestTask.status}.`)
    }

    const latestEligibleUserIds = Array.isArray(latestTask.eligibleUserIds) ? latestTask.eligibleUserIds : []
    const canCurrentUserComplete = latestEligibleUserIds.length > 0
      ? latestEligibleUserIds.map(v => String(v || '').trim()).includes(normalizedUserId)
      : (!latestTask.assigneeUserId || String(latestTask.assigneeUserId || '').trim() === normalizedUserId)
    if (!canCurrentUserComplete) throw new Error('You are not eligible to complete this EOC task.')

    const { nextVersion } = assertExpectedVersion({
      expectedVersion: getVersionNumber(task),
      currentVersion: getVersionNumber(latestTask),
      documentId: task.id,
      recordLabel: 'EOC Task'
    })

    const submissionRef = doc(collection(db, 'eocSubmissions'))
    submittedEocSubmissionId = submissionRef.id
    transaction.set(submissionRef, {
      taskId: task.id,
      locationId: task.locationId,
      shiftId: task.shiftId,
      templateScope: task.templateScope || getTemplateScopeForShift(task.shiftId) || TEMPLATE_SCOPE_OTC_SHARED,
      templateId: task.templateId || null,
      templateName: task.templateName || '',
      vanId: task.vanId || null,
      dueDate: task.dueDate,
      staffCompleting: user?.name || '',
      eocType,
      vehicleId: vehicleId || null,
      vehicleName,
      vinNumber,
      odometerReading: eocType === 'van' ? odometerReading.trim() : '',
      odometerMileage: normalizedOdometerMileage,
      answers: answersData,
      issueCount: issueItems.length,
      submittedByUserId: normalizedUserId,
      submittedByName: user?.name || '',
      version: 1,
      submittedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    })

    transaction.update(taskRef, {
      status: 'completed',
      submissionId: submissionRef.id,
      completedAt: serverTimestamp(),
      completedByUserId: normalizedUserId,
      completedByName: user?.name || '',
      version: nextVersion,
      updatedAt: serverTimestamp()
    })

    if (draftRef && draftSnap?.exists()) {
      const draftData = draftSnap.data()
      if (String(draftData?.draftByAuthUid || '').trim() === normalizedAuthUid) {
        transaction.delete(draftRef)
      }
    }

    for (const issue of issueItems) {
      const issueRef = doc(collection(db, 'eocIssues'))
      const activityId = 'v1_reported'
      const activityRef = doc(db, 'eocIssues', issueRef.id, 'activity', activityId)
      const activity = {
        issueId: issueRef.id,
        eventType: 'reported',
        label: 'Reported',
        status: 'open',
        note: issue.description || '',
        actorUserId: normalizedUserId,
        actorName: user?.name || '',
        locationId: task.locationId,
        issueVersion: 1,
        version: 1,
        immutable: true,
        createdAt: serverTimestamp()
      }
      const issueData = {
        id: issueRef.id,
        taskId: task.id,
        submissionId: submissionRef.id,
        locationId: task.locationId,
        shiftId: task.shiftId,
        vanId: task.vanId || null,
        eocType,
        itemId: issue.itemId,
        label: issue.label,
        category: issue.category,
        description: issue.description,
        severity: 'medium',
        status: 'open',
        reportedByUserId: normalizedUserId,
        reportedByName: user?.name || '',
        version: 1
      }
      const issueDocumentData = { ...issueData }
      delete issueDocumentData.id
      transaction.set(issueRef, {
        ...issueDocumentData,
        latestActivity: {
          id: activityId,
          eventType: 'reported',
          label: 'Reported',
          note: issue.description || '',
          actorUserId: normalizedUserId,
          actorName: user?.name || '',
          createdAt: serverTimestamp()
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
      transaction.set(activityRef, activity)
      issuesToNotify.push({
        issue: issueData,
        activity: { id: activityId, ...activity }
      })
    }
  })

  for (const item of issuesToNotify) {
    await fanOutIssueAlerts({
      issue: item.issue,
      activity: item.activity,
      eventType: 'reported',
      actorUser: user
    })
  }

  if (eocType === 'van' && submittedEocSubmissionId) {
    try {
      const runtimeResult = await updateFleetRuntimeFromEocSubmission({
        submissionId: submittedEocSubmissionId,
        vehicleId: vehicleId || task.vehicleId || null,
        vanId: task.vanId || null,
        locationId: task.locationId || null,
        odometerReading: String(normalizedOdometerMileage)
      })
      if (runtimeResult?.updated && runtimeResult.vehicleId) {
        await syncFleetTasksForVehicle({ vehicleId: runtimeResult.vehicleId })
      }
    } catch (runtimeErr) {
      console.warn('Fleet runtime update after EOC submit failed:', runtimeErr)
    }
  }

  await deleteOfflineDraft(getEocDraftId(task.id, normalizedUserId))
  return { submissionId: submittedEocSubmissionId }
}

async function submitShiftDebriefOnline(payload) {
  await submitShiftDebrief(payload.context, payload.items, payload.user)
  await deleteOfflineDraft(getDebriefDraftId(payload?.context?.id))
}

async function submitBhtIssueReportActionOnline(payload) {
  const result = await submitBhtIssueReportOnline(payload)
  return { syncedDocumentId: result?.issueId || '' }
}

function toDate(value, fallback = new Date()) {
  if (!value) return fallback
  if (typeof value?.toDate === 'function') return value.toDate()
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? fallback : value
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? fallback : date
}

function toTimestamp(value, fallback = new Date()) {
  return Timestamp.fromDate(toDate(value, fallback))
}

function normalizeTransportCreateData(payload) {
  const snapshot = payload?.snapshot || payload?.transport || {}
  const user = payload?.user || {}
  const departedAtDate = toDate(snapshot.departedAt || snapshot.createdAt)
  const createdAtDate = toDate(snapshot.createdAt || snapshot.departedAt, departedAtDate)
  const status = String(snapshot.status || 'open').trim().toLowerCase()
  const closedAtValue = snapshot.closedAt || snapshot.returnedAt || snapshot.updatedAt
  const updatedAtDate = toDate(snapshot.updatedAt || closedAtValue || createdAtDate)

  const data = {
    site: snapshot.site || user.site || user.location || '',
    locationId: snapshot.locationId || user.locationId || '',
    createdByUserId: snapshot.createdByUserId || user.id || '',
    createdByName: snapshot.createdByName || user.name || '',
    status,
    version: 1,
    departedAt: toTimestamp(snapshot.departedAt, departedAtDate),
    clients: Array.isArray(snapshot.clients) ? snapshot.clients : [],
    reasons: Array.isArray(snapshot.reasons) ? snapshot.reasons : [],
    stops: Array.isArray(snapshot.stops) ? snapshot.stops : [],
    destinations: Array.isArray(snapshot.destinations) ? snapshot.destinations : [],
    notes: typeof snapshot.notes === 'string' ? snapshot.notes : '',
    createdAt: toTimestamp(snapshot.createdAt, createdAtDate),
    updatedAt: toTimestamp(snapshot.updatedAt, updatedAtDate)
  }

  if (status === 'closed' || status === 'returned') {
    data.returnedAt = toTimestamp(snapshot.returnedAt || snapshot.closedAt, updatedAtDate)
    data.closedAt = toTimestamp(snapshot.closedAt || snapshot.returnedAt, updatedAtDate)
    data.dcPaperworkStatus = snapshot.dcPaperworkStatus || null
    data.dcPaperworkOtherNote = snapshot.dcPaperworkOtherNote || ''
  }

  return data
}

async function applyTransportCreateOnline(payload) {
  const localTransportId = payload?.localTransportId
  if (!localTransportId) throw new Error('Missing local transport ID.')

  const data = normalizeTransportCreateData(payload)
  if (!data.createdByUserId) throw new Error('Missing BHT user for transport sync.')
  if (!data.site) throw new Error('Missing transport site for transport sync.')

  if (data.status === 'open' || data.status === 'arrived') {
    const userTransportSnapshot = await getDocs(
      query(
        collection(db, 'transports'),
        where('createdByUserId', '==', data.createdByUserId)
      )
    )
    const existingActive = userTransportSnapshot.docs.find((docSnap) => {
      const status = String(docSnap.data()?.status || '').trim().toLowerCase()
      return status === 'open' || status === 'arrived'
    })
    if (existingActive) {
      throw new Error('Active transport already exists and needs supervisor review.')
    }
  }

  const docRef = await addDoc(collection(db, 'transports'), data)

  if (data.status === 'closed' || data.status === 'returned') {
    try {
      await createTransportCompletedAlert({
        transport: { ...data, id: docRef.id, site: data.site, locationId: data.locationId },
        userName: payload?.user?.name || data.createdByName
      })
      await writeAuditLog({
        action: 'transport_closed',
        collectionPath: 'transports',
        documentId: docRef.id,
        reason: payload?.auditReason || 'Offline-created transport synced closed',
        actorUser: payload?.user,
        extra: { dcPaperworkStatus: data.dcPaperworkStatus || null, offlineSynced: true, localTransportId }
      })
    } catch (notificationError) {
      console.warn('Offline-created transport synced, but follow-up alert/audit write failed:', notificationError)
    }
  }

  await deleteOfflineDraft(getTransportDraftId(localTransportId))
  return { syncedDocumentId: docRef.id }
}

async function applyTransportUpdateOnline(payload) {
  const transportId = payload?.transportId
  if (!transportId) throw new Error('Missing transport ID.')
  const snap = await getDoc(doc(db, 'transports', transportId))
  if (!snap.exists()) throw new Error('Transport no longer exists.')
  const latest = snap.data()
  const latestVersion = Number(latest.version || 1)
  const expectedVersion = Number(payload.expectedVersion || latestVersion)
  if (latestVersion > expectedVersion && String(latest.status || '').toLowerCase() !== 'open') {
    throw new Error('Transport changed while offline and needs supervisor review.')
  }
  await updateDoc(doc(db, 'transports', transportId), {
    ...(payload.updates || {}),
    version: increment(1),
    updatedAt: serverTimestamp()
  })
  await deleteOfflineDraft(getTransportDraftId(transportId))
}

async function applyTransportCloseOnline(payload) {
  const transportId = payload?.transportId
  if (!transportId) throw new Error('Missing transport ID.')
  const snap = await getDoc(doc(db, 'transports', transportId))
  if (!snap.exists()) throw new Error('Transport no longer exists.')
  const latest = snap.data()
  if (String(latest.status || '').toLowerCase() === 'closed') {
    throw new Error('Transport was already closed while this device was offline.')
  }

  await updateDoc(doc(db, 'transports', transportId), {
    ...(payload.updates || {}),
    status: 'closed',
    returnedAt: serverTimestamp(),
    closedAt: serverTimestamp(),
    version: increment(1),
    updatedAt: serverTimestamp()
  })

  try {
    await createTransportCompletedAlert({
      transport: {
        ...(payload.closedTransport || {}),
        site: payload.closedTransport?.site || payload.user?.site || payload.user?.location || '',
        locationId: payload.closedTransport?.locationId || payload.user?.locationId || ''
      },
      userName: payload.user?.name
    })
    await writeAuditLog({
      action: 'transport_closed',
      collectionPath: 'transports',
      documentId: transportId,
      reason: payload.auditReason || 'Offline transport close synced',
      actorUser: payload.user,
      extra: { dcPaperworkStatus: payload?.updates?.dcPaperworkStatus || null, offlineSynced: true }
    })
  } catch (notificationError) {
    console.warn('Offline transport close synced, but follow-up alert/audit write failed:', notificationError)
  }

  await deleteOfflineDraft(getTransportDraftId(transportId))
}

function needsReviewError(error) {
  return /already|no longer|not eligible|version|changed while offline|needs supervisor review/i.test(String(error?.message || ''))
}

async function processAction(action) {
  await updateOfflineAction(action.id, { status: 'syncing', attempts: Number(action.attempts || 0) + 1 })
  try {
    let syncResult = null
    if (action.type === OFFLINE_ACTION_TYPES.EOC_SUBMISSION) {
      syncResult = await submitEocSubmissionOnline(action.payload)
    } else if (action.type === OFFLINE_ACTION_TYPES.SHIFT_DEBRIEF_SUBMISSION) {
      syncResult = await submitShiftDebriefOnline(action.payload)
    } else if (action.type === OFFLINE_ACTION_TYPES.BHT_ISSUE_REPORT) {
      syncResult = await submitBhtIssueReportActionOnline(action.payload)
    } else if (action.type === OFFLINE_ACTION_TYPES.TRANSPORT_CREATE) {
      syncResult = await applyTransportCreateOnline(action.payload)
    } else if (action.type === OFFLINE_ACTION_TYPES.TRANSPORT_UPDATE) {
      syncResult = await applyTransportUpdateOnline(action.payload)
    } else if (action.type === OFFLINE_ACTION_TYPES.TRANSPORT_CLOSE) {
      syncResult = await applyTransportCloseOnline(action.payload)
    } else {
      throw new Error(`Unsupported offline action: ${action.type}`)
    }
    await markOfflineActionSynced(action.id, syncResult?.syncedDocumentId ? { syncedDocumentId: syncResult.syncedDocumentId } : {})
    return { id: action.id, status: 'synced', ...(syncResult || {}) }
  } catch (error) {
    if (needsReviewError(error)) {
      await markOfflineActionNeedsReview(action.id, error?.message || 'Needs supervisor review.')
      return { id: action.id, status: 'needsReview', error }
    }
    await markOfflineActionFailed(action.id, error?.message || 'Sync failed.', Number(action.attempts || 0) + 1)
    return { id: action.id, status: 'failed', error }
  }
}

let syncRunning = false

export async function syncOfflineOutbox() {
  if (syncRunning || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return { synced: 0, failed: 0, needsReview: 0 }
  }
  syncRunning = true
  try {
    const actions = await listOfflineActions(['pending', 'failed', 'syncing'])
    const results = []
    for (const action of actions) {
      results.push(await processAction(action))
    }
    return results.reduce((acc, result) => {
      if (result.status === 'synced') acc.synced += 1
      if (result.status === 'failed') acc.failed += 1
      if (result.status === 'needsReview') acc.needsReview += 1
      return acc
    }, { synced: 0, failed: 0, needsReview: 0 })
  } finally {
    syncRunning = false
  }
}
