import { db } from '../firebase'
import { getShiftById, getTemplateScopeForShift } from '../data/eocConstants'
import { getCurrentCycleDueDate } from '../utils/eocSchedule'
import { collection, query, where, getDocs, doc, getDoc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { getVersionNumber } from './versioning'
import { loadTemplateAssignmentsByScope, resolveTemplateForScope } from './eocTemplateService'
import { getAvailableMainLocationsForUser, isAdminRole, isBhtRole, isSupervisorRole, locationIdToMainLocation } from '../utils/orgModel'
import {
  formatPhoenixDateKey,
  getNextShiftId,
  getShiftTimingConfig,
  getShiftTimingDetails,
  hasTimestampPassed,
  isOtcTimedShift,
  toDate
} from './shiftTimingService'

function toPhoenixDateStr() {
  return formatPhoenixDateKey(new Date())
}

function buildTaskDocId({ locationId, shiftId, taskType, dueDate, vanId }) {
  if (taskType === 'house') {
    return `task_${locationId}_${shiftId}_house_${dueDate}`
  }
  return `task_${locationId}_${shiftId}_van_${vanId}_${dueDate}`
}

function buildGroupKey(locationId, shiftId) {
  return `${locationId}::${shiftId}`
}

function getDesiredStatus(task, currentStatus, todayStr, now = new Date()) {
  if (currentStatus === 'completed' || currentStatus === 'ignored') return currentStatus
  if (task?.dueAt) return hasTimestampPassed(task.dueAt, now) ? 'overdue' : 'pending'
  return task?.dueDate < todayStr ? 'overdue' : 'pending'
}

function sortUnique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)))
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function normalizeAssignment(raw) {
  const locationId = String(raw?.locationId || '').trim().toLowerCase()
  const shiftId = String(raw?.shiftId || '').trim()
  if (!locationId || !shiftId) return null
  const bhtUserId = String(raw?.bhtUserId || '').trim()
  const bhtUserName = String(raw?.bhtUserName || '').trim()
  const vanIds = sortUnique((Array.isArray(raw?.vanIds) ? raw.vanIds : []).map(v => String(v || '').trim().toLowerCase()))
  return {
    id: raw?.id || '',
    bhtUserId,
    bhtUserName,
    locationId,
    shiftId,
    vanIds,
    active: raw?.active === true
  }
}

function createTaskRecord(group, taskType, vanId = null, templateMeta = null) {
  const eligibleUserIds = sortUnique(group.eligibleUserIds)
  const eligibleUserNames = sortUnique(group.eligibleUserNames)
  const primaryUserId = eligibleUserIds[0] || ''
  const primaryUserName = eligibleUserNames[0] || ''
  const templateScope = getTemplateScopeForShift(group.shiftId)

  const task = {
    taskType,
    locationId: group.locationId,
    shiftId: group.shiftId,
    templateScope,
    assigneeUserId: primaryUserId,
    assigneeUserName: primaryUserName,
    eligibleUserIds,
    eligibleUserNames,
    dueDate: group.dueDate,
    availableAt: group.availableAt || null,
    dueAt: group.dueAt || null,
    shiftStartAt: group.shiftStartAt || null,
    shiftEndAt: group.shiftEndAt || null,
    outgoingDebriefDueAt: group.outgoingDebriefDueAt || null,
    incomingAcknowledgmentLateAt: group.incomingAcknowledgmentLateAt || null,
    timingSource: group.timingSource || 'legacy',
    status: 'pending',
    cycleKey: '',
    active: true,
    scopeKey: buildGroupKey(group.locationId, group.shiftId)
  }

  if (templateMeta?.templateId) {
    task.templateId = templateMeta.templateId
    task.templateName = templateMeta.templateName || ''
  } else {
    task.templateId = null
    task.templateName = ''
  }

  if (taskType === 'van') {
    task.vanId = vanId
  }

  task.cycleKey = buildTaskDocId({
    locationId: task.locationId,
    shiftId: task.shiftId,
    taskType: task.taskType,
    dueDate: group.dueDate,
    vanId
  })

  task.shiftLabel = group.shiftLabel
  return task
}

function buildDesiredTasks(assignments, templateAssignmentsByScope, timingConfig) {
  const groups = new Map()

  for (const assignment of assignments) {
    const shift = getShiftById(assignment.shiftId)
    if (!shift) continue

    const groupKey = buildGroupKey(assignment.locationId, assignment.shiftId)
    const timingDetails = getShiftTimingDetails(assignment.shiftId, new Date(), timingConfig)
    const existingGroup = groups.get(groupKey) || {
      locationId: assignment.locationId,
      shiftId: assignment.shiftId,
      shiftLabel: shift.label,
      dueDate: timingDetails?.eocDueDate || getCurrentCycleDueDate(shift),
      availableAt: timingDetails?.eocAvailableAt || null,
      dueAt: timingDetails?.eocDueAt || null,
      shiftStartAt: timingDetails?.shiftStartAt || null,
      shiftEndAt: timingDetails?.shiftEndAt || null,
      outgoingDebriefDueAt: timingDetails?.outgoingDebriefDueAt || null,
      incomingAcknowledgmentLateAt: timingDetails?.incomingAcknowledgmentLateAt || null,
      timingSource: timingDetails ? 'appSettings/shiftTiming' : 'legacy',
      eligibleUserIds: [],
      eligibleUserNames: [],
      vanAssigneesByVanId: new Map()
    }

    if (assignment.bhtUserId) {
      existingGroup.eligibleUserIds.push(assignment.bhtUserId)
    }
    if (assignment.bhtUserName) {
      existingGroup.eligibleUserNames.push(assignment.bhtUserName)
    }

    for (const vanId of assignment.vanIds) {
      const vanAssignees = existingGroup.vanAssigneesByVanId.get(vanId) || {
        eligibleUserIds: [],
        eligibleUserNames: []
      }
      if (assignment.bhtUserId) vanAssignees.eligibleUserIds.push(assignment.bhtUserId)
      if (assignment.bhtUserName) vanAssignees.eligibleUserNames.push(assignment.bhtUserName)
      existingGroup.vanAssigneesByVanId.set(vanId, vanAssignees)
    }

    groups.set(groupKey, existingGroup)
  }

  const tasks = []
  for (const group of groups.values()) {
    group.eligibleUserIds = sortUnique(group.eligibleUserIds)
    group.eligibleUserNames = sortUnique(group.eligibleUserNames)
    if (group.eligibleUserIds.length === 0) continue

    const houseTemplateMeta = resolveTemplateForScope(templateAssignmentsByScope, {
      locationId: group.locationId,
      shiftId: group.shiftId,
      eocType: 'house'
    })
    tasks.push(createTaskRecord(group, 'house', null, houseTemplateMeta))

    for (const [vanId, vanAssignees] of group.vanAssigneesByVanId.entries()) {
      const eligibleUserIds = sortUnique(vanAssignees.eligibleUserIds)
      if (eligibleUserIds.length === 0) continue
      const eligibleUserNames = sortUnique(vanAssignees.eligibleUserNames)
      const vanTemplateMeta = resolveTemplateForScope(templateAssignmentsByScope, {
        locationId: group.locationId,
        shiftId: group.shiftId,
        eocType: 'van'
      })
      tasks.push(createTaskRecord({
        ...group,
        eligibleUserIds,
        eligibleUserNames
      }, 'van', vanId, vanTemplateMeta))
    }
  }

  return tasks.sort((a, b) => String(a.cycleKey || '').localeCompare(String(b.cycleKey || '')))
}

function cleanIdPart(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_')
}

function buildDebriefId({ userId, dateKey, locationId, shiftId }) {
  return [
    String(userId || '').trim(),
    String(dateKey || '').trim(),
    String(locationId || '').trim().toLowerCase(),
    String(shiftId || '').trim()
  ].join('_')
}

function isAcknowledgedBy(debrief, userId) {
  const normalizedUserId = String(userId || '').trim()
  if (!normalizedUserId) return false
  const acknowledgments = debrief?.confirmation?.acknowledgments || {}
  if (acknowledgments?.[normalizedUserId]?.confirmed === true) return true
  return debrief?.confirmed === true && String(debrief?.confirmation?.confirmedByUserId || '').trim() === normalizedUserId
}

async function queueUniqueAlert(batch, alertId, payload) {
  const alertRef = doc(db, 'alerts', alertId)
  const existingSnap = await getDoc(alertRef)
  if (existingSnap.exists()) return false
  batch.set(alertRef, {
    ...payload,
    alertKey: alertId,
    read: false,
    version: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  })
  return true
}

async function syncDebriefTimingAlerts({ user, assignments, timingConfig, batch }) {
  if (!isSupervisorRole(user?.role) && !isAdminRole(user?.role)) return 0

  const now = new Date()
  let alerts = 0
  const activeAssignments = assignments
    .filter(assignment => assignment.active)
    .filter(assignment => isOtcTimedShift(assignment.shiftId, timingConfig))
    .filter(assignment => assignment.bhtUserId)

  const seenMissingKeys = new Set()
  for (const assignment of activeAssignments) {
    const timing = getShiftTimingDetails(assignment.shiftId, now, timingConfig)
    if (!timing?.outgoingDebriefDueAt || timing.outgoingDebriefDueAt.getTime() > now.getTime()) continue

    const debriefId = buildDebriefId({
      userId: assignment.bhtUserId,
      dateKey: timing.shiftStartDateKey,
      locationId: assignment.locationId,
      shiftId: assignment.shiftId
    })
    if (seenMissingKeys.has(debriefId)) continue
    seenMissingKeys.add(debriefId)

    const debriefSnap = await getDoc(doc(db, 'shiftDebriefs', debriefId))
    if (debriefSnap.exists()) continue

    const alertId = [
      'shift_debrief_missing',
      cleanIdPart(assignment.locationId),
      cleanIdPart(assignment.shiftId),
      cleanIdPart(assignment.bhtUserId),
      cleanIdPart(timing.shiftStartDateKey)
    ].join('__')
    const queued = await queueUniqueAlert(batch, alertId, {
      type: 'shift_debrief_missing',
      debriefId,
      locationId: assignment.locationId,
      shiftId: assignment.shiftId,
      audience: 'supervisor',
      severity: 'high',
      bhtName: assignment.bhtUserName || null,
      dueAt: timing.outgoingDebriefDueAt,
      message: `${assignment.bhtUserName || 'BHT'} has not submitted the outgoing debrief due for ${assignment.locationId} ${timing.shiftLabel}.`
    })
    if (queued) alerts += 1
  }

  const debriefsSnap = await getDocs(query(collection(db, 'shiftDebriefs'), where('status', '==', 'submitted')))
  for (const debriefDoc of debriefsSnap.docs) {
    const debrief = { id: debriefDoc.id, ...debriefDoc.data() }
    if (!isOtcTimedShift(debrief.receivingShiftId || getNextShiftId(debrief.shiftId), timingConfig)) continue
    if (!hasTimestampPassed(debrief.incomingAcknowledgmentLateAt, now)) continue

    const receivingUserIds = Array.isArray(debrief.receivingUserIds) ? debrief.receivingUserIds : []
    for (const receivingUserId of receivingUserIds) {
      if (isAcknowledgedBy(debrief, receivingUserId)) continue
      const alertId = [
        'shift_debrief_incoming_ack_late',
        cleanIdPart(debrief.id),
        cleanIdPart(receivingUserId)
      ].join('__')
      const receivingNames = debrief.receivingUserNames || {}
      const queued = await queueUniqueAlert(batch, alertId, {
        type: 'shift_debrief_incoming_ack_late',
        debriefId: debrief.id,
        locationId: debrief.locationId,
        shiftId: debrief.receivingShiftId || getNextShiftId(debrief.shiftId),
        audience: 'supervisor',
        severity: 'high',
        targetUserId: receivingUserId,
        targetUserName: receivingNames[receivingUserId] || null,
        dueAt: toDate(debrief.incomingAcknowledgmentLateAt) || null,
        message: `${receivingNames[receivingUserId] || 'Receiving BHT'} has not acknowledged the incoming handoff for ${debrief.locationLabel || debrief.locationId}.`
      })
      if (queued) alerts += 1
    }
  }

  return alerts
}

function getAccessibleGroupKeys(user, normalizedAssignments) {
  const normalizedUserId = String(user?.id || '').trim()
  if (!normalizedUserId) return new Set()

  if (isBhtRole(user.role)) {
    return new Set(
      normalizedAssignments
        .filter(assignment => assignment.active && String(assignment.bhtUserId || '').trim() === normalizedUserId)
        .map(assignment => buildGroupKey(assignment.locationId, assignment.shiftId))
    )
  }

  if (isAdminRole(user.role)) {
    return new Set(normalizedAssignments.map(assignment => buildGroupKey(assignment.locationId, assignment.shiftId)))
  }

  const allowedMainLocations = new Set(getAvailableMainLocationsForUser(user))
  if (allowedMainLocations.size === 0) return new Set()

  return new Set(
    normalizedAssignments
      .filter((assignment) => allowedMainLocations.has(locationIdToMainLocation(assignment.locationId)))
      .map(assignment => buildGroupKey(assignment.locationId, assignment.shiftId))
  )
}

function taskInScope(task, scopedGroupKeys) {
  return scopedGroupKeys.has(buildGroupKey(String(task?.locationId || '').trim().toLowerCase(), String(task?.shiftId || '').trim()))
}

export async function syncEocTasksForUserScope(user) {
  if (!user?.id) return { created: 0, updated: 0, scanned: 0, alerts: 0 }

  const todayStr = toPhoenixDateStr()
  const now = new Date()
  const timingConfig = await getShiftTimingConfig()

  const assignmentsSnap = await getDocs(
    query(collection(db, 'shiftAssignments'), where('active', '==', true))
  )

  const normalizedAssignments = assignmentsSnap.docs
    .map(d => normalizeAssignment({ id: d.id, ...d.data() }))
    .filter(Boolean)
    .filter(assignment => assignment.active)

  const scopedGroupKeys = getAccessibleGroupKeys(user, normalizedAssignments)
  if (scopedGroupKeys.size === 0) {
    return { created: 0, updated: 0, scanned: 0 }
  }

  const assignmentsForScope = normalizedAssignments
    .filter(assignment => scopedGroupKeys.has(buildGroupKey(assignment.locationId, assignment.shiftId)))

  const templateAssignmentsByScope = await loadTemplateAssignmentsByScope()
  const desiredTasks = buildDesiredTasks(assignmentsForScope, templateAssignmentsByScope, timingConfig)
  const desiredTaskIds = new Set(desiredTasks.map(task => task.cycleKey))
  const batch = writeBatch(db)
  const touched = new Set()

  let created = 0
  let updated = 0

  for (const task of desiredTasks) {
    const taskRef = doc(db, 'eocTasks', task.cycleKey)
    const existingSnap = await getDoc(taskRef)

    if (!existingSnap.exists()) {
      const initialStatus = getDesiredStatus(task, 'pending', todayStr, now)
      batch.set(taskRef, {
        ...task,
        status: initialStatus,
        version: 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
      touched.add(taskRef.id)
      created += 1
      continue
    }

    const existing = existingSnap.data()
    const nextEligibleUserIds = sortUnique(Array.isArray(task.eligibleUserIds) ? task.eligibleUserIds : [])
    const nextEligibleUserNames = sortUnique(Array.isArray(task.eligibleUserNames) ? task.eligibleUserNames : [])
    const currentEligibleUserIds = sortUnique(Array.isArray(existing.eligibleUserIds) ? existing.eligibleUserIds : [])
    const currentEligibleUserNames = sortUnique(Array.isArray(existing.eligibleUserNames) ? existing.eligibleUserNames : [])
    const scopeKey = buildGroupKey(task.locationId, task.shiftId)
    const nextStatus = getDesiredStatus(task, existing.status, todayStr, now)
    const needsTaskShapeUpdate =
      existing.taskType !== task.taskType
      || existing.locationId !== task.locationId
      || existing.shiftId !== task.shiftId
      || existing.templateScope !== task.templateScope
      || existing.vanId !== (task.vanId || null)
      || existing.dueDate !== task.dueDate
      || existing.shiftLabel !== task.shiftLabel
      || existing.scopeKey !== scopeKey
      || toDate(existing.availableAt)?.getTime() !== toDate(task.availableAt)?.getTime()
      || toDate(existing.dueAt)?.getTime() !== toDate(task.dueAt)?.getTime()
      || toDate(existing.shiftStartAt)?.getTime() !== toDate(task.shiftStartAt)?.getTime()
      || toDate(existing.shiftEndAt)?.getTime() !== toDate(task.shiftEndAt)?.getTime()
      || toDate(existing.outgoingDebriefDueAt)?.getTime() !== toDate(task.outgoingDebriefDueAt)?.getTime()
      || toDate(existing.incomingAcknowledgmentLateAt)?.getTime() !== toDate(task.incomingAcknowledgmentLateAt)?.getTime()
      || existing.timingSource !== task.timingSource
      || String(existing.templateId || '').trim() !== String(task.templateId || '').trim()
      || String(existing.templateName || '').trim() !== String(task.templateName || '').trim()
      || !arraysEqual(currentEligibleUserIds, nextEligibleUserIds)
      || !arraysEqual(currentEligibleUserNames, nextEligibleUserNames)
      || existing.assigneeUserId !== (task.assigneeUserId || '')
      || existing.assigneeUserName !== (task.assigneeUserName || '')
      || existing.active !== true

    if (nextStatus !== existing.status || needsTaskShapeUpdate) {
      batch.update(taskRef, {
        taskType: task.taskType,
        locationId: task.locationId,
        shiftId: task.shiftId,
        templateScope: task.templateScope,
        vanId: task.vanId || null,
        dueDate: task.dueDate,
        availableAt: task.availableAt || null,
        dueAt: task.dueAt || null,
        shiftStartAt: task.shiftStartAt || null,
        shiftEndAt: task.shiftEndAt || null,
        outgoingDebriefDueAt: task.outgoingDebriefDueAt || null,
        incomingAcknowledgmentLateAt: task.incomingAcknowledgmentLateAt || null,
        timingSource: task.timingSource || 'legacy',
        shiftLabel: task.shiftLabel,
        scopeKey,
        templateId: task.templateId || null,
        templateName: task.templateName || '',
        eligibleUserIds: nextEligibleUserIds,
        eligibleUserNames: nextEligibleUserNames,
        assigneeUserId: task.assigneeUserId || '',
        assigneeUserName: task.assigneeUserName || '',
        active: true,
        status: nextStatus,
        version: getVersionNumber(existing) + 1,
        updatedAt: serverTimestamp()
      })
      touched.add(taskRef.id)
      updated += 1
    }
  }

  // Deactivate stale actionable tasks in scope so old van membership does not linger.
  const pendingSnap = await getDocs(query(collection(db, 'eocTasks'), where('status', '==', 'pending')))
  const overdueSnap = await getDocs(query(collection(db, 'eocTasks'), where('status', '==', 'overdue')))
  const staleActionableDocs = [...pendingSnap.docs, ...overdueSnap.docs]
  for (const taskDoc of staleActionableDocs) {
    const data = taskDoc.data()
    if (!taskInScope(data, scopedGroupKeys)) continue
    if (desiredTaskIds.has(taskDoc.id)) continue

    batch.update(taskDoc.ref, {
      active: false,
      status: 'ignored',
      ignoredReason: 'Task no longer matches the current assignment scope.',
      version: getVersionNumber(data) + 1,
      updatedAt: serverTimestamp()
    })
    touched.add(taskDoc.id)
    updated += 1
  }

  for (const taskDoc of pendingSnap.docs) {
    const data = taskDoc.data()
    if (!taskInScope(data, scopedGroupKeys)) continue
    if (data.dueAt && !hasTimestampPassed(data.dueAt, now)) continue
    if (!data.dueAt && (!data.dueDate || data.dueDate >= todayStr)) continue
    if (touched.has(taskDoc.id)) continue

    batch.update(taskDoc.ref, {
      status: 'overdue',
      version: getVersionNumber(data) + 1,
      updatedAt: serverTimestamp()
    })
    touched.add(taskDoc.id)
    updated += 1
  }

  const alerts = await syncDebriefTimingAlerts({
    user,
    assignments: assignmentsForScope,
    timingConfig,
    batch
  })

  if (created > 0 || updated > 0 || alerts > 0) {
    await batch.commit()
  }

  return {
    created,
    updated,
    alerts,
    scanned: desiredTasks.length
  }
}

