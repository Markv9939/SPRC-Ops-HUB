import { db } from '../firebase'
import { collection, doc, getDoc, increment, runTransaction, serverTimestamp, updateDoc } from 'firebase/firestore'
import { TEMPLATE_SCOPE_OTC_SHARED, getTemplateScopeForShift } from '../data/eocConstants'
import { assertExpectedVersion, getVersionNumber } from './versioning'
import { updateFleetRuntimeFromEocSubmission } from './fleetRuntimeService'
import { syncFleetTasksForVehicle } from './fleetTaskEngine'
import { buildEocIssueAlertPayload, createTransportCompletedAlert, writeAuditLog } from './notificationService'
import { submitShiftDebrief } from './shiftDebriefService'
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

  await runTransaction(db, async (transaction) => {
    const taskRef = doc(db, 'eocTasks', task.id)
    const taskSnap = await transaction.get(taskRef)
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

    if (normalizedAuthUid) {
      const draftRef = doc(db, 'eocSubmissionDrafts', getDraftDocId(task.id, normalizedUserId))
      const draftSnap = await transaction.get(draftRef)
      if (draftSnap.exists()) {
        const draftData = draftSnap.data()
        if (String(draftData?.draftByAuthUid || '').trim() === normalizedAuthUid) {
          transaction.delete(draftRef)
        }
      }
    }

    for (const issue of issueItems) {
      const issueRef = doc(collection(db, 'eocIssues'))
      transaction.set(issueRef, {
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
        version: 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })

      const alertRef = doc(collection(db, 'alerts'))
      transaction.set(alertRef, buildEocIssueAlertPayload({
        issueRefId: issueRef.id,
        task,
        issue: { ...issue, eocType, severity: 'medium' },
        userName: user?.name || ''
      }))
    }
  })

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
      transport: { ...(payload.closedTransport || {}), site: payload.user?.site || payload.user?.location || '' },
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
    if (action.type === OFFLINE_ACTION_TYPES.EOC_SUBMISSION) {
      await submitEocSubmissionOnline(action.payload)
    } else if (action.type === OFFLINE_ACTION_TYPES.SHIFT_DEBRIEF_SUBMISSION) {
      await submitShiftDebriefOnline(action.payload)
    } else if (action.type === OFFLINE_ACTION_TYPES.TRANSPORT_UPDATE) {
      await applyTransportUpdateOnline(action.payload)
    } else if (action.type === OFFLINE_ACTION_TYPES.TRANSPORT_CLOSE) {
      await applyTransportCloseOnline(action.payload)
    } else {
      throw new Error(`Unsupported offline action: ${action.type}`)
    }
    await markOfflineActionSynced(action.id)
    return { id: action.id, status: 'synced' }
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
