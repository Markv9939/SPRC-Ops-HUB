/**
 * Hook: useScopedIssues
 *
 * Real-time listener for EOC issues and overdue EOC tasks,
 * filtered by the user's scope.
 *
 * Replaces the inline listeners in SupervisorDashboard (lines 358-376).
 */

import { useState, useEffect } from 'react'
import { db } from '../firebase'
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore'

/**
 * @param {object} params
 * @param {function} params.inEocScope — (locationId) => boolean
 * @param {boolean}  [params.enabled=true]
 */
export default function useScopedIssues({ inEocScope, enabled = true }) {
  const [issues, setIssues] = useState([])
  const [overdueTasks, setOverdueTasks] = useState([])

  useEffect(() => {
    if (!enabled || !inEocScope) return

    const unsubIssues = onSnapshot(
      query(
        collection(db, 'eocIssues'),
        where('status', 'in', ['open', 'in_progress']),
        orderBy('createdAt', 'desc')
      ),
      (snap) => {
        const rows = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(issue => inEocScope(issue.locationId))
        setIssues(rows)
      }
    )

    const unsubOverdue = onSnapshot(
      query(collection(db, 'eocTasks'), where('status', '==', 'overdue')),
      (snap) => {
        const rows = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(task => inEocScope(task.locationId))
        rows.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
        setOverdueTasks(rows)
      }
    )

    return () => {
      unsubIssues()
      unsubOverdue()
    }
  }, [enabled, inEocScope])

  return { issues, overdueTasks }
}
