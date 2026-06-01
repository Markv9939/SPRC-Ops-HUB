import { db } from '../firebase'
import { getShiftById, getTemplateScopeForShift } from '../data/eocConstants'
import { getCurrentCycleDueDate, phoenixNow } from '../utils/eocSchedule'
import { collection, query, where, getDocs, doc, getDoc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { getVersionNumber } from './versioning'
import { loadTemplateAssignmentsByScope, resolveTemplateForScope } from './eocTemplateService'
import { getAvailableMainLocationsForUser, isAdminRole, isBhtRole, locationIdToMainLocation } from '../utils/orgModel'

function toPhoenixDateStr() {
  const now = phoenixNow()
  return `${now.year}-${String(now.month).padStart(2, '0')}-${String(now.day).padStart(2, '0')}`
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

function getDesiredStatus(dueDate, currentStatus, todayStr) {
  if (currentStatus === 'completed' || currentStatus === 'ignored') return currentStatus
  return dueDate < todayStr ? 'overdue' : 'pending'
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

function buildDesiredTasks(assignments, templateAssignmentsByScope) {
  const groups = new Map()

  for (const assignment of assignments) {
    const shift = getShiftById(assignment.shiftId)
    if (!shift) continue

    const groupKey = buildGroupKey(assignment.locationId, assignment.shiftId)
    const existingGroup = groups.get(groupKey) || {
      locationId: assignment.locationId,
      shiftId: assignment.shiftId,
      shiftLabel: shift.label,
      dueDate: getCurrentCycleDueDate(shift),
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
  if (!user?.id) return { created: 0, updated: 0, scanned: 0 }

  const todayStr = toPhoenixDateStr()

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
  const desiredTasks = buildDesiredTasks(assignmentsForScope, templateAssignmentsByScope)
  const desiredTaskIds = new Set(desiredTasks.map(task => task.cycleKey))
  const batch = writeBatch(db)
  const touched = new Set()

  let created = 0
  let updated = 0

  for (const task of desiredTasks) {
    const taskRef = doc(db, 'eocTasks', task.cycleKey)
    const existingSnap = await getDoc(taskRef)

    if (!existingSnap.exists()) {
      const initialStatus = getDesiredStatus(task.dueDate, 'pending', todayStr)
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
    const nextStatus = getDesiredStatus(task.dueDate, existing.status, todayStr)
    const needsTaskShapeUpdate =
      existing.taskType !== task.taskType
      || existing.locationId !== task.locationId
      || existing.shiftId !== task.shiftId
      || existing.templateScope !== task.templateScope
      || existing.vanId !== (task.vanId || null)
      || existing.dueDate !== task.dueDate
      || existing.shiftLabel !== task.shiftLabel
      || existing.scopeKey !== scopeKey
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
    if (!data.dueDate || data.dueDate >= todayStr) continue
    if (touched.has(taskDoc.id)) continue

    batch.update(taskDoc.ref, {
      status: 'overdue',
      version: getVersionNumber(data) + 1,
      updatedAt: serverTimestamp()
    })
    touched.add(taskDoc.id)
    updated += 1
  }

  if (created > 0 || updated > 0) {
    await batch.commit()
  }

  return {
    created,
    updated,
    scanned: desiredTasks.length
  }
}

