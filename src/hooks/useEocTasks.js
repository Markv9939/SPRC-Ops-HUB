import { useState, useEffect } from 'react'
import { db } from '../firebase'
import { collection, query, where, onSnapshot } from 'firebase/firestore'

const STATUS_PRIORITY = { overdue: 0, pending: 1, completed: 2, ignored: 3 }

function sortTasks(items) {
  return [...items].sort((a, b) => {
    const aPriority = STATUS_PRIORITY[a.status] ?? 99
    const bPriority = STATUS_PRIORITY[b.status] ?? 99
    if (aPriority !== bPriority) return aPriority - bPriority

    if (a.dueDate !== b.dueDate) {
      return (a.dueDate || '').localeCompare(b.dueDate || '')
    }

    return (a.taskType || '').localeCompare(b.taskType || '')
  })
}

export default function useEocTasks(user, assignment) {
  const hasUserId = Boolean(user?.id)
  const hasAssignmentScope = Boolean(assignment?.locationId && assignment?.shiftId)
  const scopeKey = hasAssignmentScope ? `${assignment.locationId}::${assignment.shiftId}` : ''
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
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const scoped = snapshot.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter((taskRow) => {
            const eligibleUserIds = Array.isArray(taskRow.eligibleUserIds) ? taskRow.eligibleUserIds : []
            if (eligibleUserIds.length === 0) {
              return taskRow.assigneeUserId === user.id
            }
            return eligibleUserIds.includes(user.id)
          })
        setTasks(sortTasks(scoped))
        setLoadedUserId(user.id)
        setLoadedScopeKey(scopeKey)
      },
      (err) => {
        console.error('Error loading EOC tasks:', err)
        setTasks([])
        setLoadedUserId(user.id)
        setLoadedScopeKey(scopeKey)
      }
    )

    return () => unsubscribe()
  }, [assignment?.locationId, assignment?.shiftId, hasAssignmentScope, hasUserId, scopeKey, user?.id])

  return {
    tasks: hasUserId && hasAssignmentScope && loadedUserId === user.id && loadedScopeKey === scopeKey ? tasks : [],
    loading: hasUserId && hasAssignmentScope ? !(loadedUserId === user.id && loadedScopeKey === scopeKey) : false
  }
}
