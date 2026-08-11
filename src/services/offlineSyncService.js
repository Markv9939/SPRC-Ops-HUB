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
import { appendExtraDebriefNote, saveDebriefConfirmation, saveQuickDebriefNote, submitShiftDebrief } from './shiftDebriefService'
import { DEBRIEF_SCHEMA_VERSION, isCurrentDebriefPayload } from './shiftDebriefModel'
import { submitBhtIssueReportOnline } from './bhtIssueReportService'
import { parseMileageValue } from '../utils/fleetStatus'
import {
  deleteOfflineDraft,
  deleteOfflineAction,
  listOfflineActions,
  markOfflineActionFailed,
  markOfflineActionNeedsReview,
  markOfflineActionSynced,
  mutateOfflineDraft,
  queueOfflineAction,
  queueOfflineActionWithAttachments,
  listOfflineAttachments,
  updateOfflineAttachment,
  deleteOfflineAttachment,
  updateOfflineAction
} from './offlineStore'
import { toTransportRecordDate } from '../utils/transportRecord'
import { buildIssueRecord } from '../utils/issueModel'
import { addPatternObservation, buildIssuePatternId } from '../utils/issueRecurrence'
import { uploadIssuePhotos } from './issueAttachmentService'

export const OFFLINE_ACTION_TYPES = {
  EOC_SUBMISSION: 'eocSubmission',
  SHIFT_DEBRIEF_QUICK_NOTE: 'shiftDebriefQuickNote',
  SHIFT_DEBRIEF_SUBMISSION: 'shiftDebriefSubmission',
  SHIFT_DEBRIEF_EXTRA_NOTE: 'shiftDebriefExtraNote',
  SHIFT_DEBRIEF_CONFIRMATION: 'shiftDebriefConfirmation',
  BHT_ISSUE_REPORT: 'bhtIssueReport',
  ISSUE_ATTACHMENT_UPLOAD: 'issueAttachmentUpload',
  TRANSPORT_CREATE: 'transportCreate',
  TRANSPORT_UPDATE: 'transportUpdate',
  TRANSPORT_CLOSE: 'transportClose'
}

export function getEocDraftId(taskId, userId) {
  return `eoc:${String(taskId || '').trim()}__${String(userId || '').trim()}`
}

export function getDebriefDraftId(contextId) {
  return `debrief-v${DEBRIEF_SCHEMA_VERSION}:${String(contextId || '').trim()}`
}

export function getDebriefQuickDraftId(contextId) {
  return `debrief-quick-v${DEBRIEF_SCHEMA_VERSION}:${String(contextId || '').trim()}`
}

export function getShiftDebriefQuickActionId(contextId, itemId) {
  return `debrief-quick-v${DEBRIEF_SCHEMA_VERSION}:${String(contextId || '').trim()}:${String(itemId || '').trim()}`
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
  const actionId = `eoc-submit:${payload?.task?.id || ''}:${payload?.normalizedUserId || payload?.user?.id || ''}`
  const { cleanPayload, attachments } = detachPayloadPhotos(OFFLINE_ACTION_TYPES.EOC_SUBMISSION, payload, actionId)
  return queueOfflineActionWithAttachments({ id: actionId, type: OFFLINE_ACTION_TYPES.EOC_SUBMISSION, payload: cleanPayload, attachments })
}

export function queueShiftDebriefSubmission(payload) {
  return queueOfflineAction({
    id: `debrief-submit-v${DEBRIEF_SCHEMA_VERSION}:${payload?.context?.id || ''}`,
    type: OFFLINE_ACTION_TYPES.SHIFT_DEBRIEF_SUBMISSION,
    payload: { ...payload, schemaVersion: DEBRIEF_SCHEMA_VERSION }
  })
}

function safeIdPart(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'unknown'
}

export function queueShiftDebriefExtraNote(payload) {
  return queueOfflineAction({
    id: `debrief-extra-v${DEBRIEF_SCHEMA_VERSION}:${payload?.debriefId || ''}:${payload?.extraNote?.id || ''}`,
    type: OFFLINE_ACTION_TYPES.SHIFT_DEBRIEF_EXTRA_NOTE,
    payload: { ...payload, schemaVersion: DEBRIEF_SCHEMA_VERSION }
  })
}

export function queueShiftDebriefConfirmation(payload) {
  return queueOfflineAction({
    id: `debrief-confirmation-v${DEBRIEF_SCHEMA_VERSION}:${payload?.debriefId || ''}:${payload?.user?.id || ''}`,
    type: OFFLINE_ACTION_TYPES.SHIFT_DEBRIEF_CONFIRMATION,
    payload: { ...payload, schemaVersion: DEBRIEF_SCHEMA_VERSION }
  })
}

export function queueBhtIssueReport(payload) {
  const localReportId = payload?.localReportId || makeLocalBhtIssueReportId()
  const actionId = `bht-issue:${localReportId}`
  const payloadWithId = { ...payload, localReportId }
  const { cleanPayload, attachments } = detachPayloadPhotos(OFFLINE_ACTION_TYPES.BHT_ISSUE_REPORT, payloadWithId, actionId)
  return queueOfflineActionWithAttachments({ id: actionId, type: OFFLINE_ACTION_TYPES.BHT_ISSUE_REPORT, payload: cleanPayload, attachments })
}

export function queueIssuePhotoRetry({ issueId, locationId, photos, kind = 'report', user }) {
  const retryPhotos = Array.isArray(photos) ? photos.filter(photo => photo?.blob && photo?.id) : []
  if (!issueId || !locationId || retryPhotos.length === 0) return Promise.resolve(null)
  const actionId = `issue-photos:${safeIdPart(issueId)}:${kind}:${retryPhotos.map(photo => safeIdPart(photo.id)).sort().join('_')}`
  const ownerProfileId = String(user?.id || '')
  const payload = {
    issueId,
    locationId,
    kind,
    user,
    photos: retryPhotos.map(photoDescriptor)
  }
  const attachments = retryPhotos.map(photo => attachmentRecord(photo, {
    actionId,
    ownerProfileId,
    kind,
    locationId,
    issueId
  }))
  return queueOfflineActionWithAttachments({ id: actionId, type: OFFLINE_ACTION_TYPES.ISSUE_ATTACHMENT_UPLOAD, payload, attachments })
}

function photoDescriptor(photo) {
  return { id: photo.id, width: photo.width, height: photo.height, size: photo.size, type: 'image/jpeg', state: 'waiting' }
}

function attachmentRecord(photo, { actionId, ownerProfileId, itemId = '', kind = 'report', locationId = '', issueId = '' }) {
  return {
    id: photo.id,
    actionId,
    ownerProfileId,
    itemId,
    kind,
    locationId,
    issueId,
    width: photo.width,
    height: photo.height,
    size: photo.size,
    type: 'image/jpeg',
    blob: photo.blob,
    state: 'waiting'
  }
}

function detachPayloadPhotos(type, payload, actionId) {
  const ownerProfileId = String(payload?.user?.id || payload?.normalizedUserId || '')
  const locationId = String(payload?.task?.locationId || payload?.assignment?.locationId || payload?.user?.locationId || '')
  if (type === OFFLINE_ACTION_TYPES.BHT_ISSUE_REPORT) {
    const photos = Array.isArray(payload?.photos) ? payload.photos : []
    return {
      cleanPayload: { ...payload, photos: photos.map(photoDescriptor) },
      attachments: photos.map(photo => attachmentRecord(photo, { actionId, ownerProfileId, locationId }))
    }
  }
  const attachments = []
  const repairDetails = Object.fromEntries(Object.entries(payload?.repairDetails || {}).map(([itemId, details]) => {
    const photos = Array.isArray(details?.photos) ? details.photos : []
    photos.forEach(photo => attachments.push(attachmentRecord(photo, { actionId, ownerProfileId, itemId, locationId })))
    return [itemId, { ...details, photos: photos.map(photoDescriptor) }]
  }))
  return { cleanPayload: { ...payload, repairDetails }, attachments }
}

function hydratePayloadPhotos(type, payload, records) {
  const toPhoto = record => ({ id: record.id, blob: record.blob, width: record.width, height: record.height, size: record.size, type: 'image/jpeg', state: record.state })
  if (type === OFFLINE_ACTION_TYPES.BHT_ISSUE_REPORT || type === OFFLINE_ACTION_TYPES.ISSUE_ATTACHMENT_UPLOAD) {
    return { ...payload, photos: records.map(toPhoto) }
  }
  if (type !== OFFLINE_ACTION_TYPES.EOC_SUBMISSION) return payload
  const repairDetails = Object.fromEntries(Object.entries(payload?.repairDetails || {}).map(([itemId, details]) => [
    itemId,
    { ...details, photos: records.filter(record => record.itemId === itemId).map(toPhoto) }
  ]))
  return { ...payload, repairDetails }
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
    trackingId: item.trackingId || item.id,
    label: item.label,
    category: item.category,
    helpText: item.helpText || '',
    requiresPhotoOnIssue: item.requiresPhotoOnIssue === true,
    status: answers?.[item.id],
    ...(answers?.[item.id] === 'repair'
      ? {
          description: repairDetails?.[item.id]?.description || '',
          photoAttachmentIds: (repairDetails?.[item.id]?.photos || []).map(photo => photo.id),
          unableToTakePhoto: repairDetails?.[item.id]?.unableToTakePhoto === true,
          unablePhotoReason: repairDetails?.[item.id]?.unableReason || ''
        }
      : {})
  }))
}

export async function submitEocSubmissionOnline(payload) {
  const task = payload?.task
  const user = payload?.user
  const normalizedUserId = String(payload?.normalizedUserId || user?.id || '').trim()
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
  const observedAtMs = Date.now()
  const issuePlans = issueItems.map(issue => {
    const issueRef = doc(db, 'eocIssues', `eoc_${safeIdPart(task?.id)}_${safeIdPart(issue.trackingId)}`)
    const patternId = buildIssuePatternId(task?.locationId, issue.trackingId)
    return {
      issue,
      photos: Array.isArray(repairDetails?.[issue.itemId]?.photos) ? repairDetails[issue.itemId].photos : [],
      issueRef,
      patternId,
      patternRef: doc(db, 'eocIssuePatterns', patternId)
    }
  })
  let submittedEocSubmissionId = ''
  const issuesToNotify = []
  const photoResults = []
  const submissionRef = doc(db, 'eocSubmissions', `eoc_${safeIdPart(task?.id)}_${safeIdPart(normalizedUserId)}`)
  submittedEocSubmissionId = submissionRef.id
  let alreadySubmitted = false

  await runTransaction(db, async (transaction) => {
    const taskRef = doc(db, 'eocTasks', task.id)
    const taskSnap = await transaction.get(taskRef)
    const draftRef = doc(db, 'eocSubmissionDrafts', getDraftDocId(task.id, normalizedUserId))
    const draftSnap = await transaction.get(draftRef)
    const patternSnapshots = new Map()
    for (const plan of issuePlans) {
      patternSnapshots.set(plan.patternId, await transaction.get(plan.patternRef))
    }
    if (!taskSnap.exists()) throw new Error('Task no longer exists.')

    const latestTask = taskSnap.data()
    if (latestTask.status === 'completed' && latestTask.submissionId === submissionRef.id) {
      alreadySubmitted = true
      return
    }
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

    transaction.set(submissionRef, {
      taskId: task.id,
      locationId: task.locationId,
      shiftId: task.shiftId,
      templateScope: task.templateScope || getTemplateScopeForShift(task.shiftId) || TEMPLATE_SCOPE_OTC_SHARED,
      templateId: task.templateId || null,
      templateName: task.templateName || '',
      templateVersion: Number(task.templateVersion || 0) || null,
      templateVersionId: task.templateVersionId || null,
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

    if (draftSnap.exists() && String(draftSnap.data()?.draftByUserId || '').trim() === normalizedUserId) {
      transaction.delete(draftRef)
    }

    for (const plan of issuePlans) {
      const { issue, issueRef, patternId, patternRef } = plan
      const patternSnap = patternSnapshots.get(patternId)
      const patternUpdate = addPatternObservation(patternSnap?.exists() ? patternSnap.data() : null, {
        issueId: issueRef.id,
        observedAtMs
      })
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
        ...buildIssueRecord({
          source: 'eoc_checklist',
          eocType,
          locationId: task.locationId,
          shiftId: task.shiftId,
          vanId: task.vanId,
          taskId: task.id,
          submissionId: submissionRef.id,
          templateId: task.templateId,
          templateVersion: task.templateVersion,
          templateVersionId: task.templateVersionId,
          itemId: issue.itemId,
          trackingId: issue.trackingId,
          label: issue.label,
          category: issue.category,
          description: issue.description,
          requiresPhotoOnIssue: issue.requiresPhotoOnIssue,
          reportedByUserId: normalizedUserId,
          reportedByName: user?.name
        }),
        patternId,
        reportedBefore: patternUpdate.reportedBefore,
        recurringIssue: patternUpdate.recurringIssue,
        recurrenceCountAtReport: patternUpdate.recentCount,
        recurrenceObservedAtMs: observedAtMs,
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
      transaction.set(patternRef, {
        schemaVersion: 1,
        patternId,
        locationId: task.locationId,
        trackingId: issue.trackingId,
        observations: patternUpdate.observations,
        recentCount: patternUpdate.recentCount,
        lifetimeCount: patternUpdate.lifetimeCount,
        reportedBefore: patternUpdate.reportedBefore,
        recurringIssue: patternUpdate.recurringIssue,
        firstObservedAtMs: patternUpdate.observations[0]?.observedAtMs || observedAtMs,
        lastObservedAtMs: observedAtMs,
        lastIssueId: issueRef.id,
        updatedAt: serverTimestamp(),
        ...(patternSnap?.exists() ? {} : { createdAt: serverTimestamp() }),
        version: Number(patternSnap?.data()?.version || 0) + 1
      }, { merge: true })
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
  for (const plan of issuePlans) {
    if (plan.photos.length) {
      const results = await uploadIssuePhotos({
        issueId: plan.issueRef.id,
        locationId: task.locationId,
        photos: plan.photos,
        kind: 'report',
        uploader: user
      })
      photoResults.push(...results)
    }
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
  return { submissionId: submittedEocSubmissionId, photoResults, alreadySubmitted }
}

async function submitShiftDebriefOnline(payload) {
  await submitShiftDebrief(payload.context, payload.items, payload.user)
  await deleteOfflineDraft(getDebriefDraftId(payload?.context?.id))
}

async function syncShiftDebriefQuickNoteOnline(payload) {
  const contextId = String(payload?.context?.id || '').trim()
  const itemId = String(payload?.item?.id || '').trim()
  if (!contextId || !itemId) throw new Error('Missing offline debrief note details.')

  const result = await saveQuickDebriefNote(payload.context, payload.item, payload.user)
  const draftId = getDebriefQuickDraftId(contextId)
  await mutateOfflineDraft(draftId, 'debriefQuick', localPayload => {
    const remainingItems = (Array.isArray(localPayload?.items) ? localPayload.items : [])
      .filter(item => String(item?.id || '').trim() !== itemId)
    return remainingItems.length > 0
      ? {
          ...localPayload,
          schemaVersion: DEBRIEF_SCHEMA_VERSION,
          context: localPayload?.context || payload.context,
          items: remainingItems
        }
      : null
  })

  return result
}

async function submitBhtIssueReportActionOnline(payload) {
  const result = await submitBhtIssueReportOnline(payload)
  return { syncedDocumentId: result?.issueId || '', photoResults: result?.photoResults || [] }
}

function toDate(value, fallback = new Date()) {
  return toTransportRecordDate(value) || fallback
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
  const queuedActions = await listOfflineActions(['pending', 'failed', 'syncing', 'needsReview'])
  const hasQueuedClose = queuedActions.some(action => (
    action.type === OFFLINE_ACTION_TYPES.TRANSPORT_CLOSE
    && String(action.payload?.transportId || '') === String(transportId)
  ))
  if (!hasQueuedClose) await deleteOfflineDraft(getTransportDraftId(transportId))
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

const SHIFT_DEBRIEF_ACTIONS = new Set([
  OFFLINE_ACTION_TYPES.SHIFT_DEBRIEF_QUICK_NOTE,
  OFFLINE_ACTION_TYPES.SHIFT_DEBRIEF_SUBMISSION,
  OFFLINE_ACTION_TYPES.SHIFT_DEBRIEF_EXTRA_NOTE,
  OFFLINE_ACTION_TYPES.SHIFT_DEBRIEF_CONFIRMATION
])

async function processAction(action) {
  if (SHIFT_DEBRIEF_ACTIONS.has(action.type) && !isCurrentDebriefPayload(action.payload)) {
    await deleteOfflineAction(action.id)
    return { id: action.id, status: 'discarded' }
  }

  await updateOfflineAction(action.id, { status: 'syncing', attempts: Number(action.attempts || 0) + 1 })
  let attachmentRecords = []
  try {
    attachmentRecords = await listOfflineAttachments({ ownerProfileId: action.ownerProfileId, actionId: action.id, states: ['waiting', 'failed', 'uploading'] })
    for (const record of attachmentRecords) await updateOfflineAttachment(record.id, { state: 'uploading', attempts: Number(record.attempts || 0) + 1 })
    const hydratedPayload = hydratePayloadPhotos(action.type, action.payload, attachmentRecords.map(record => ({ ...record, state: 'uploading' })))
    let syncResult = null
    if (action.type === OFFLINE_ACTION_TYPES.EOC_SUBMISSION) {
      syncResult = await submitEocSubmissionOnline(hydratedPayload)
    } else if (action.type === OFFLINE_ACTION_TYPES.SHIFT_DEBRIEF_QUICK_NOTE) {
      syncResult = await syncShiftDebriefQuickNoteOnline(action.payload)
    } else if (action.type === OFFLINE_ACTION_TYPES.SHIFT_DEBRIEF_SUBMISSION) {
      syncResult = await submitShiftDebriefOnline(action.payload)
    } else if (action.type === OFFLINE_ACTION_TYPES.SHIFT_DEBRIEF_EXTRA_NOTE) {
      await appendExtraDebriefNote(action.payload.debriefId, action.payload.extraNote)
    } else if (action.type === OFFLINE_ACTION_TYPES.SHIFT_DEBRIEF_CONFIRMATION) {
      await saveDebriefConfirmation(action.payload.debriefId, action.payload.confirmation, action.payload.user)
    } else if (action.type === OFFLINE_ACTION_TYPES.BHT_ISSUE_REPORT) {
      syncResult = await submitBhtIssueReportActionOnline(hydratedPayload)
    } else if (action.type === OFFLINE_ACTION_TYPES.ISSUE_ATTACHMENT_UPLOAD) {
      const photoResults = await uploadIssuePhotos({
        issueId: hydratedPayload.issueId,
        locationId: hydratedPayload.locationId,
        photos: hydratedPayload.photos,
        kind: hydratedPayload.kind,
        uploader: hydratedPayload.user
      })
      syncResult = { syncedDocumentId: hydratedPayload.issueId, photoResults }
    } else if (action.type === OFFLINE_ACTION_TYPES.TRANSPORT_CREATE) {
      syncResult = await applyTransportCreateOnline(action.payload)
    } else if (action.type === OFFLINE_ACTION_TYPES.TRANSPORT_UPDATE) {
      syncResult = await applyTransportUpdateOnline(action.payload)
    } else if (action.type === OFFLINE_ACTION_TYPES.TRANSPORT_CLOSE) {
      syncResult = await applyTransportCloseOnline(action.payload)
    } else {
      throw new Error(`Unsupported offline action: ${action.type}`)
    }
    for (const result of syncResult?.photoResults || []) {
      if (result.state === 'uploaded') await deleteOfflineAttachment(result.attachmentId)
      else await updateOfflineAttachment(result.attachmentId, { state: 'failed', issueId: result.issueId || '', lastError: result.error || 'Upload failed.' })
    }
    if ((syncResult?.photoResults || []).some(result => result.state !== 'uploaded')) {
      throw new Error('One or more photos are still waiting to upload.')
    }
    await markOfflineActionSynced(action.id, syncResult?.syncedDocumentId ? { syncedDocumentId: syncResult.syncedDocumentId } : {})
    return { id: action.id, status: 'synced', ...(syncResult || {}) }
  } catch (error) {
    for (const record of attachmentRecords) {
      await updateOfflineAttachment(record.id, { state: 'failed', lastError: error?.message || 'Sync failed.' })
    }
    if (needsReviewError(error)) {
      await markOfflineActionNeedsReview(action.id, error?.message || 'Needs supervisor review.')
      return { id: action.id, status: 'needsReview', error }
    }
    await markOfflineActionFailed(action.id, error?.message || 'Sync failed.', Number(action.attempts || 0) + 1)
    return { id: action.id, status: 'failed', error }
  }
}

export async function retryOfflinePhotoUploads({ ownerProfileId, uploader }) {
  if (!ownerProfileId) return { uploaded: 0, failed: 0 }
  const records = await listOfflineAttachments({ ownerProfileId, states: ['waiting', 'failed'] })
  let uploaded = 0
  let failed = 0
  for (const record of records) {
    if (!record.issueId || !record.locationId || !record.blob) {
      failed += 1
      continue
    }
    await updateOfflineAttachment(record.id, { state: 'uploading', attempts: Number(record.attempts || 0) + 1 })
    const results = await uploadIssuePhotos({
      issueId: record.issueId,
      locationId: record.locationId,
      photos: [{ id: record.id, blob: record.blob, width: record.width, height: record.height, size: record.size, type: 'image/jpeg' }],
      kind: record.kind || 'report',
      uploader
    })
    if (results[0]?.state === 'uploaded') {
      await deleteOfflineAttachment(record.id)
      uploaded += 1
    } else {
      await updateOfflineAttachment(record.id, { state: 'failed', lastError: results[0]?.error || 'Upload failed.' })
      failed += 1
    }
  }
  return { uploaded, failed }
}

let syncRunning = false

export async function syncOfflineOutbox(ownerProfileId = '') {
  if (syncRunning || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return { synced: 0, failed: 0, needsReview: 0 }
  }
  syncRunning = true
  try {
    const actions = await listOfflineActions(['pending', 'failed', 'syncing'], ownerProfileId)
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
