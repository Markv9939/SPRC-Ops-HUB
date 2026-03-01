import { db } from '../firebase'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore'
import { getVersionNumber } from './versioning'

const ACTIONABLE_STATUSES = ['pending', 'overdue']
const BATCH_LIMIT = 400

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeEocType(value) {
  const normalized = normalizeToken(value)
  return normalized === 'van' ? 'van' : 'house'
}

function buildAssignmentKey(locationId, shiftId, eocType) {
  return `${normalizeToken(locationId)}::${String(shiftId || '').trim()}::${normalizeEocType(eocType)}`
}

function buildTaskScopeQueries(locationId, shiftId, eocType) {
  return ACTIONABLE_STATUSES.map(status => query(
    collection(db, 'eocTasks'),
    where('locationId', '==', normalizeToken(locationId)),
    where('shiftId', '==', String(shiftId || '').trim()),
    where('taskType', '==', normalizeEocType(eocType)),
    where('status', '==', status)
  ))
}

export function buildTemplateAssignmentDocId(locationId, shiftId, eocType) {
  return `asg_${normalizeToken(locationId)}_${String(shiftId || '').trim()}_${normalizeEocType(eocType)}`
}

export function getTemplateAssignmentMapKey(locationId, shiftId, eocType) {
  return buildAssignmentKey(locationId, shiftId, eocType)
}

export async function loadTemplateAssignmentsByScope() {
  const snap = await getDocs(collection(db, 'eocTemplateAssignments'))
  const byScope = new Map()

  snap.docs.forEach((assignmentDoc) => {
    const data = assignmentDoc.data() || {}
    const key = buildAssignmentKey(data.locationId, data.shiftId, data.eocType)
    byScope.set(key, {
      id: assignmentDoc.id,
      ...data
    })
  })

  return byScope
}

export function resolveTemplateForScope(assignmentsByScope, { locationId, shiftId, eocType }) {
  const key = buildAssignmentKey(locationId, shiftId, eocType)
  const assignment = assignmentsByScope instanceof Map ? assignmentsByScope.get(key) : null
  if (!assignment?.defaultTemplateId) {
    return {
      templateId: null,
      templateName: ''
    }
  }
  return {
    templateId: String(assignment.defaultTemplateId || '').trim() || null,
    templateName: String(assignment.defaultTemplateName || '').trim()
  }
}

async function updateIncompleteTasksForScope({ locationId, shiftId, eocType, templateId, templateName }) {
  const taskQueries = buildTaskScopeQueries(locationId, shiftId, eocType)

  const taskSnaps = await Promise.all(taskQueries.map(taskQuery => getDocs(taskQuery)))
  const taskDocs = taskSnaps.flatMap(snap => snap.docs)

  const docsNeedingUpdate = taskDocs.filter((taskDoc) => {
    const data = taskDoc.data() || {}
    return String(data.templateId || '').trim() !== String(templateId || '').trim()
      || String(data.templateName || '').trim() !== String(templateName || '').trim()
  })

  if (docsNeedingUpdate.length === 0) {
    return 0
  }

  let updatedCount = 0
  for (let index = 0; index < docsNeedingUpdate.length; index += BATCH_LIMIT) {
    const chunk = docsNeedingUpdate.slice(index, index + BATCH_LIMIT)
    const batch = writeBatch(db)

    chunk.forEach((taskDoc) => {
      const data = taskDoc.data() || {}
      batch.update(taskDoc.ref, {
        templateId: String(templateId || '').trim() || null,
        templateName: String(templateName || '').trim(),
        version: getVersionNumber(data) + 1,
        updatedAt: serverTimestamp()
      })
      updatedCount += 1
    })

    await batch.commit()
  }

  return updatedCount
}

export async function previewDefaultAssignmentImpact({
  locationId,
  shiftId,
  eocType,
  templateId,
  templateName
}) {
  const normalizedTemplateId = String(templateId || '').trim()
  const normalizedTemplateName = String(templateName || '').trim()
  if (!normalizedTemplateId) {
    return {
      pendingCount: 0,
      overdueCount: 0,
      totalCount: 0
    }
  }

  const taskQueries = buildTaskScopeQueries(locationId, shiftId, eocType)
  const taskSnaps = await Promise.all(taskQueries.map(taskQuery => getDocs(taskQuery)))

  const counters = {
    pendingCount: 0,
    overdueCount: 0,
    totalCount: 0
  }

  taskSnaps.forEach((snap) => {
    snap.docs.forEach((taskDoc) => {
      const data = taskDoc.data() || {}
      const needsUpdate = String(data.templateId || '').trim() !== normalizedTemplateId
        || String(data.templateName || '').trim() !== normalizedTemplateName
      if (!needsUpdate) return

      const status = String(data.status || '').trim().toLowerCase()
      if (status === 'pending') counters.pendingCount += 1
      if (status === 'overdue') counters.overdueCount += 1
      counters.totalCount += 1
    })
  })

  return counters
}

export async function assignDefaultTemplateForScope({
  actor,
  locationId,
  shiftId,
  eocType,
  templateId,
  templateName
}) {
  const normalizedLocationId = normalizeToken(locationId)
  const normalizedShiftId = String(shiftId || '').trim()
  const normalizedType = normalizeEocType(eocType)
  const normalizedTemplateId = String(templateId || '').trim()

  if (!normalizedLocationId || !normalizedShiftId || !normalizedTemplateId) {
    throw new Error('Location, shift, and template are required.')
  }

  const assignmentId = buildTemplateAssignmentDocId(normalizedLocationId, normalizedShiftId, normalizedType)
  const assignmentRef = doc(db, 'eocTemplateAssignments', assignmentId)
  const assignmentSnap = await getDoc(assignmentRef)

  const payload = {
    locationId: normalizedLocationId,
    shiftId: normalizedShiftId,
    eocType: normalizedType,
    defaultTemplateId: normalizedTemplateId,
    defaultTemplateName: String(templateName || '').trim(),
    updatedByUserId: actor?.id || null,
    updatedByName: actor?.name || null,
    updatedByAuthUid: actor?.authUid || null,
    updatedAt: serverTimestamp(),
    version: assignmentSnap.exists() ? getVersionNumber(assignmentSnap.data()) + 1 : 1
  }

  if (assignmentSnap.exists()) {
    await updateDoc(assignmentRef, payload)
  } else {
    await setDoc(assignmentRef, {
      ...payload,
      createdAt: serverTimestamp(),
      createdByUserId: actor?.id || null,
      createdByName: actor?.name || null,
      createdByAuthUid: actor?.authUid || null
    })
  }

  const updatedTasks = await updateIncompleteTasksForScope({
    locationId: normalizedLocationId,
    shiftId: normalizedShiftId,
    eocType: normalizedType,
    templateId: normalizedTemplateId,
    templateName
  })

  return {
    assignmentId,
    updatedTasks
  }
}

export async function deleteTemplateAndReassignScopes({ actor, templateId, replacementTemplate }) {
  const normalizedTemplateId = String(templateId || '').trim()
  const normalizedReplacementId = String(replacementTemplate?.id || '').trim()

  if (!normalizedTemplateId || !normalizedReplacementId) {
    throw new Error('Replacement template is required.')
  }
  if (normalizedTemplateId === normalizedReplacementId) {
    throw new Error('Replacement template must be different from the template being deleted.')
  }

  const assignmentsSnap = await getDocs(query(
    collection(db, 'eocTemplateAssignments'),
    where('defaultTemplateId', '==', normalizedTemplateId)
  ))

  for (const assignmentDoc of assignmentsSnap.docs) {
    const assignmentData = assignmentDoc.data() || {}
    await assignDefaultTemplateForScope({
      actor,
      locationId: assignmentData.locationId,
      shiftId: assignmentData.shiftId,
      eocType: assignmentData.eocType,
      templateId: normalizedReplacementId,
      templateName: replacementTemplate?.name || ''
    })
  }

  await deleteDoc(doc(db, 'eocTemplateLibrary', normalizedTemplateId))

  return {
    reassignedScopeCount: assignmentsSnap.size
  }
}
