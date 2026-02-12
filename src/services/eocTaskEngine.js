import { db } from '../firebase'
import { SHIFTS } from '../data/eocConstants'
import { getCurrentCycleDueDate, phoenixNow } from '../utils/eocSchedule'
import { collection, query, where, getDocs, doc, getDoc, writeBatch, serverTimestamp } from 'firebase/firestore'

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

function getDesiredStatus(dueDate, currentStatus, todayStr) {
  if (currentStatus === 'completed') return 'completed'
  return dueDate < todayStr ? 'overdue' : 'pending'
}

function createTaskRecord(assignment, taskType, dueDate, shift, vanId = null) {
  const task = {
    taskType,
    locationId: assignment.locationId,
    shiftId: assignment.shiftId,
    assigneeUserId: assignment.bhtUserId,
    assigneeUserName: assignment.bhtUserName || '',
    dueDate,
    status: 'pending',
    cycleKey: '',
    active: true
  }

  if (taskType === 'van') {
    task.vanId = vanId
  }

  task.cycleKey = buildTaskDocId({
    locationId: task.locationId,
    shiftId: task.shiftId,
    taskType: task.taskType,
    dueDate,
    vanId
  })

  task.shiftLabel = shift.label
  return task
}

function buildDesiredTasks(assignments) {
  const tasks = []
  for (const assignment of assignments) {
    const shift = SHIFTS.find(s => s.id === assignment.shiftId)
    if (!shift) continue

    const dueDate = getCurrentCycleDueDate(shift)

    if (assignment.isHousePrimary) {
      tasks.push(createTaskRecord(assignment, 'house', dueDate, shift))
    }

    const vanIds = Array.isArray(assignment.vanIds) ? [...new Set(assignment.vanIds.filter(Boolean))] : []
    for (const vanId of vanIds) {
      tasks.push(createTaskRecord(assignment, 'van', dueDate, shift, vanId))
    }
  }
  return tasks
}

export async function syncEocTasksForUserScope(user) {
  if (!user?.id) return { created: 0, updated: 0, scanned: 0 }

  const todayStr = toPhoenixDateStr()
  const isElevated = user.role === 'supervisor' || user.role === 'admin'

  const assignmentsSnap = await getDocs(
    query(collection(db, 'bhtAssignments'), where('active', '==', true))
  )

  const scopedAssignments = assignmentsSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(a => (isElevated ? true : a.bhtUserId === user.id))

  const desiredTasks = buildDesiredTasks(scopedAssignments)
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
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
      touched.add(taskRef.id)
      created += 1
      continue
    }

    const existing = existingSnap.data()
    const nextStatus = getDesiredStatus(task.dueDate, existing.status, todayStr)
    if (nextStatus !== existing.status) {
      batch.update(taskRef, {
        status: nextStatus,
        updatedAt: serverTimestamp()
      })
      touched.add(taskRef.id)
      updated += 1
    }
  }

  const pendingSnap = await getDocs(query(collection(db, 'eocTasks'), where('status', '==', 'pending')))
  for (const taskDoc of pendingSnap.docs) {
    const data = taskDoc.data()
    if (!isElevated && data.assigneeUserId !== user.id) continue
    if (!data.dueDate || data.dueDate >= todayStr) continue
    if (touched.has(taskDoc.id)) continue

    batch.update(taskDoc.ref, {
      status: 'overdue',
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
