import { db } from '../firebase'
import {
  collection,
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
import {
  EOC_TEMPLATE_ITEM_SCHEMA_VERSION,
  findDuplicateEocTrackingIds,
  normalizeEocTemplateItems
} from '../utils/eocTemplateModel'

const ACTIONABLE_STATUSES = ['pending', 'overdue']

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
    templateName: String(assignment.defaultTemplateName || '').trim(),
    templateVersion: Number(assignment.defaultTemplateVersion || 0) || null,
    templateVersionId: String(assignment.defaultTemplateVersionId || '').trim() || null
  }
}

export function buildTemplateVersionDocId(templateId, versionNumber) {
  return `${String(templateId || '').trim()}__v${Number(versionNumber || 0)}`
}

export async function savePublishedTemplateVersion({
  actor,
  templateId = '',
  existingTemplate = null,
  payload,
  cloneMeta = null
}) {
  const normalizedItems = normalizeEocTemplateItems(payload?.items)
  if (!String(payload?.name || '').trim()) throw new Error('Template name is required.')
  if (normalizedItems.length === 0) throw new Error('Add at least one valid template item.')
  if (findDuplicateEocTrackingIds(normalizedItems).length > 0) {
    throw new Error('Template item tracking IDs must be unique.')
  }

  const templateRef = String(templateId || '').trim()
    ? doc(db, 'eocTemplateLibrary', String(templateId || '').trim())
    : doc(collection(db, 'eocTemplateLibrary'))
  const versionNumber = existingTemplate ? getVersionNumber(existingTemplate) + 1 : 1
  const versionId = buildTemplateVersionDocId(templateRef.id, versionNumber)
  const versionRef = doc(db, 'eocTemplateVersions', versionId)
  const ownerUserId = existingTemplate?.ownerUserId ?? actor?.id ?? null
  const ownerName = existingTemplate?.ownerName ?? actor?.name ?? null
  const ownerAuthUid = existingTemplate?.ownerAuthUid ?? actor?.authUid ?? null
  const ownerRole = existingTemplate?.ownerRole ?? actor?.role ?? null
  const normalizedType = String(payload?.eocType || 'house').trim() === 'van' ? 'van' : 'house'
  const normalizedStatus = String(payload?.status || 'active').trim() === 'archived' ? 'archived' : 'active'

  const libraryData = {
    name: String(payload.name || '').trim(),
    eocType: normalizedType,
    status: normalizedStatus,
    items: normalizedItems,
    itemSchemaVersion: EOC_TEMPLATE_ITEM_SCHEMA_VERSION,
    publishedVersion: versionNumber,
    publishedVersionId: versionId,
    ownerUserId,
    ownerName,
    ownerAuthUid,
    ownerRole,
    updatedByUserId: actor?.id || null,
    updatedByName: actor?.name || null,
    updatedByAuthUid: actor?.authUid || null,
    updatedAt: serverTimestamp(),
    version: versionNumber
  }

  const versionData = {
    templateId: templateRef.id,
    templateName: libraryData.name,
    eocType: normalizedType,
    status: normalizedStatus,
    items: normalizedItems,
    itemSchemaVersion: EOC_TEMPLATE_ITEM_SCHEMA_VERSION,
    versionNumber,
    ownerUserId,
    ownerName,
    ownerAuthUid,
    publishedByUserId: actor?.id || null,
    publishedByName: actor?.name || null,
    publishedByAuthUid: actor?.authUid || null,
    publishedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    version: 1,
    ...(cloneMeta ? cloneMeta : {})
  }

  const batch = writeBatch(db)
  if (existingTemplate) {
    batch.update(templateRef, libraryData)
  } else {
    batch.set(templateRef, {
      ...libraryData,
      createdByUserId: actor?.id || null,
      createdByName: actor?.name || null,
      createdByAuthUid: actor?.authUid || null,
      createdAt: serverTimestamp(),
      ...(cloneMeta ? cloneMeta : {})
    })
  }
  batch.set(versionRef, versionData)
  await batch.commit()

  return {
    templateId: templateRef.id,
    templateName: libraryData.name,
    eocType: normalizedType,
    versionNumber,
    versionId,
    items: normalizedItems
  }
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
  templateName,
  templateVersion = null,
  templateVersionId = null
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
    defaultTemplateVersion: Number(templateVersion || 0) || null,
    defaultTemplateVersionId: String(templateVersionId || '').trim() || null,
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

  return {
    assignmentId,
    updatedTasks: 0
  }
}

export async function deleteTemplateAndReassignScopes({ actor, templateId, replacementTemplate }) {
  const normalizedTemplateId = String(templateId || '').trim()
  const normalizedReplacementId = String(replacementTemplate?.id || '').trim()

  if (!normalizedTemplateId || !normalizedReplacementId) {
    throw new Error('Replacement template is required.')
  }
  if (normalizedTemplateId === normalizedReplacementId) {
    throw new Error('Replacement template must be different from the template being archived.')
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
      templateName: replacementTemplate?.name || '',
      templateVersion: replacementTemplate?.publishedVersion || replacementTemplate?.version || null,
      templateVersionId: replacementTemplate?.publishedVersionId || null
    })
  }

  const templateRef = doc(db, 'eocTemplateLibrary', normalizedTemplateId)
  const templateSnap = await getDoc(templateRef)
  if (templateSnap.exists()) {
    await updateDoc(templateRef, {
      status: 'archived',
      archivedByUserId: actor?.id || null,
      archivedByName: actor?.name || null,
      archivedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      version: getVersionNumber(templateSnap.data()) + 1
    })
  }

  return {
    reassignedScopeCount: assignmentsSnap.size
  }
}
