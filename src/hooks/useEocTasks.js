import { useState, useEffect } from 'react'
import { db } from '../firebase'
import { collection, query, where, onSnapshot } from 'firebase/firestore'

const STATUS_PRIORITY = { overdue: 0, pending: 1, completed: 2 }

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
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.id) {
      setTasks([])
      setLoading(false)
      return
    }

    const q = query(collection(db, 'eocTasks'), where('assigneeUserId', '==', user.id))
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const all = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
        setTasks(sortTasks(all))
        setLoading(false)
      },
      (err) => {
        console.error('Error loading EOC tasks:', err)
        setTasks([])
        setLoading(false)
      }
    )

    return () => unsubscribe()
  }, [user?.id])

  return { tasks, loading }
}
