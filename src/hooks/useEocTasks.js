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

export default function useEocTasks(user) {
  const hasUserId = Boolean(user?.id)
  const [tasks, setTasks] = useState([])
  const [loadedUserId, setLoadedUserId] = useState(null)

  useEffect(() => {
    if (!hasUserId) return

    const q = query(collection(db, 'eocTasks'), where('assigneeUserId', '==', user.id))
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const all = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
        setTasks(sortTasks(all))
        setLoadedUserId(user.id)
      },
      (err) => {
        console.error('Error loading EOC tasks:', err)
        setTasks([])
        setLoadedUserId(user.id)
      }
    )

    return () => unsubscribe()
  }, [hasUserId, user?.id])

  return {
    tasks: hasUserId && loadedUserId === user.id ? tasks : [],
    loading: hasUserId ? loadedUserId !== user.id : false
  }
}
