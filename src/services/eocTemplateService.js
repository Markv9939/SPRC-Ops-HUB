import { db, functions } from '../firebase'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { getVersionNumber } from './versioning'
import {
  normalizeEocTemplateDefinition
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

function makeOperationId(prefix) {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`
  return `${prefix}_${suffix}`
}

export async function savePublishedTemplateVersion({
  templateId = '',
  existingTemplate = null,
  payload,
  cloneMeta = null
}) {
  const template = normalizeEocTemplateDefinition(payload)
  const call = httpsCallable(functions, 'publishEocTemplate')
  const response = await call({
    operationId: makeOperationId('publish'),
    templateId: String(templateId || '').trim() || null,
    expectedVersion: existingTemplate ? getVersionNumber(existingTemplate) : 0,
    template,
    cloneMeta
  })
  return response.data
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
  const assignmentSnap = await getDoc(doc(db, 'eocTemplateAssignments', assignmentId))
  const call = httpsCallable(functions, 'assignEocTemplate')
  const response = await call({
    operationId: makeOperationId('assign'),
    locationId: normalizedLocationId,
    shiftId: normalizedShiftId,
    eocType: normalizedType,
    templateId: normalizedTemplateId,
    templateName: String(templateName || '').trim(),
    templateVersion: Number(templateVersion || 0) || null,
    templateVersionId: String(templateVersionId || '').trim() || null,
    expectedVersion: assignmentSnap.exists() ? getVersionNumber(assignmentSnap.data()) : 0
  })
  return response.data
}

export async function saveEocSectionToLibrary({ section, eocType = 'house', existingSection = null }) {
  const normalizedSection = normalizeEocTemplateDefinition({
    name: section?.title || 'Saved section',
    eocType,
    sections: [section]
  }, { includeIncomplete: true }).sections[0]
  const call = httpsCallable(functions, 'saveEocSection')
  const response = await call({
    operationId: makeOperationId('section'),
    sectionId: existingSection?.id || null,
    expectedVersion: existingSection ? getVersionNumber(existingSection) : 0,
    eocType,
    section: normalizedSection
  })
  return response.data
}

export async function deleteTemplateAndReassignScopes({ templateId, replacementTemplate, reason = '', archiveRequestId = '' }) {
  const normalizedTemplateId = String(templateId || '').trim()
  const normalizedReplacementId = String(replacementTemplate?.id || '').trim()

  if (!normalizedTemplateId) throw new Error('Template is required.')
  if (normalizedTemplateId === normalizedReplacementId) {
    throw new Error('Replacement template must be different from the template being archived.')
  }
  const call = httpsCallable(functions, 'archiveEocTemplate')
  const response = await call({
    operationId: makeOperationId('archive'),
    templateId: normalizedTemplateId,
    replacementTemplateId: normalizedReplacementId || null,
    archiveRequestId: String(archiveRequestId || '').trim() || null,
    reason: String(reason || '').trim() || 'Template archived by admin'
  })
  return response.data
}

export async function requestTemplateArchive({ templateId, reason }) {
  const call = httpsCallable(functions, 'requestEocTemplateArchive')
  const response = await call({ templateId: String(templateId || '').trim(), reason: String(reason || '').trim() })
  return response.data
}

export async function rejectTemplateArchiveRequest({ archiveRequestId, reason }) {
  const call = httpsCallable(functions, 'rejectEocTemplateArchiveRequest')
  const response = await call({
    archiveRequestId: String(archiveRequestId || '').trim(),
    reason: String(reason || '').trim() || 'Archive request declined by admin'
  })
  return response.data
}

export async function previewTemplatePurge(templateId) {
  const call = httpsCallable(functions, 'previewEocTemplatePurge')
  const response = await call({ templateId: String(templateId || '').trim() })
  return response.data
}

export async function purgeUnusedTemplate({ templateId, adminProfileId, pin, reason }) {
  const call = httpsCallable(functions, 'purgeEocTemplate')
  const response = await call({
    operationId: makeOperationId('purge'),
    templateId: String(templateId || '').trim(),
    adminProfileId: String(adminProfileId || '').trim(),
    currentPin: String(pin || '').trim(),
    reason: String(reason || '').trim()
  })
  return response.data
}
