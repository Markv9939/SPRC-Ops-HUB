import { useState, useEffect } from 'react'
import { db } from '../firebase'
import { collection, query, where, onSnapshot } from 'firebase/firestore'

const STATUS_PRIORITY = { overdue: 0, pending: 1, completed: 2, ignored: 3 }

function sortTasks(items) {
  return [...items].sort((a, b) => {
    const aPriority = STATUS_PRIORITY[a.status] ?? 99
    const bPriority = STATUS_PRIORITY[b.status] ?? 99
    if (aPriority !== bPriority) return aPriority - bPriority

    const aDueAt = a.dueAt?.toDate ? a.dueAt.toDate().getTime() : (a.dueAt ? new Date(a.dueAt).getTime() : 0)
    const bDueAt = b.dueAt?.toDate ? b.dueAt.toDate().getTime() : (b.dueAt ? new Date(b.dueAt).getTime() : 0)
    if (aDueAt || bDueAt) {
      return (aDueAt || 0) - (bDueAt || 0)
    }

    if (a.dueDate !== b.dueDate) {
      return (a.dueDate || '').localeCompare(b.dueDate || '')
    }

    return (a.taskType || '').localeCompare(b.taskType || '')
  })
}

export default function useEocTasks(user, assignment) {
  const hasUserId = Boolean(user?.id)
  const normalizedUserId = String(user?.id || '').trim()
  const hasAssignmentScope = Boolean(assignment?.locationId && assignment?.shiftId)
  const scopeKey = hasAssignmentScope ? `${assignment.locationId}::${assignment.shiftId}` : ''
  const assignmentVanKey = Array.isArray(assignment?.vanIds)
    ? assignment.vanIds.map(v => String(v || '').trim().toLowerCase()).filter(Boolean).sort().join('|')
    : ''
  const [tasks, setTasks] = useState([])
  const [loadedUserId, setLoadedUserId] = useState(null)
  const [loadedScopeKey, setLoadedScopeKey] = useState('')

  useEffect(() => {
    if (!hasUserId) return
    if (!hasAssignmentScope) return

    const q = query(
      collection(db, 'eocTasks'),
      where('locationId', '==', assignment.locationId),
      where('shiftId', '==', assignment.shiftId)
    )
    const assignedVanIds = new Set(assignmentVanKey ? assignmentVanKey.split('|') : [])
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const scoped = snapshot.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter((taskRow) => {
            if (String(taskRow.taskType || '').trim().toLowerCase() === 'van') {
              const taskVanId = String(taskRow.vanId || '').trim().toLowerCase()
              if (!taskVanId || !assignedVanIds.has(taskVanId)) return false
            }
            const eligibleUserIds = Array.isArray(taskRow.eligibleUserIds) ? taskRow.eligibleUserIds : []
            if (eligibleUserIds.length === 0) {
              return String(taskRow.assigneeUserId || '').trim() === normalizedUserId
            }
            return eligibleUserIds.map(v => String(v || '').trim()).includes(normalizedUserId)
          })
        setTasks(sortTasks(scoped))
        setLoadedUserId(normalizedUserId)
        setLoadedScopeKey(scopeKey)
      },
      (err) => {
        console.error('Error loading EOC tasks:', err)
        setTasks([])
        setLoadedUserId(normalizedUserId)
        setLoadedScopeKey(scopeKey)
      }
    )

    return () => unsubscribe()
  }, [assignment?.locationId, assignment?.shiftId, assignmentVanKey, hasAssignmentScope, hasUserId, normalizedUserId, scopeKey, user?.id])

  return {
    tasks: hasUserId && hasAssignmentScope && loadedUserId === normalizedUserId && loadedScopeKey === scopeKey ? tasks : [],
    loading: hasUserId && hasAssignmentScope ? !(loadedUserId === normalizedUserId && loadedScopeKey === scopeKey) : false
  }
}
