/**
 * Hook: useScopedFleet
 *
 * Real-time listener for fleet tasks (overdue + upcoming),
 * filtered by the user's compliance scope.
 *
 * Replaces the inline listeners in SupervisorDashboard (lines 377-396).
 */

import { useState, useEffect } from 'react'
import { db } from '../firebase'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { parseMileageValue } from '../utils/fleetStatus'

function getFleetTaskDueSortValue(task) {
  if (task?.triggerMode === 'date') {
    const dueDate = String(task?.dueDate || '').trim()
    return dueDate || '9999-12-31'
  }
  const dueMileage = parseMileageValue(task?.dueMileage)
  if (dueMileage === null) return '999999999'
  return String(dueMileage).padStart(9, '0')
}

/**
 * @param {object} params
 * @param {function} params.inComplianceScope — (site) => boolean
 * @param {boolean}  [params.enabled=true]
 */
export default function useScopedFleet({ inComplianceScope, enabled = true }) {
  const [overdueTasks, setOverdueTasks] = useState([])
  const [upcomingTasks, setUpcomingTasks] = useState([])

  useEffect(() => {
    if (!enabled || !inComplianceScope) return

    const unsubOverdue = onSnapshot(
      query(collection(db, 'fleetTasks'), where('status', '==', 'overdue')),
      (snap) => {
        const rows = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(task => inComplianceScope(task.mainLocation || task.locationId))
        rows.sort((a, b) => getFleetTaskDueSortValue(a).localeCompare(getFleetTaskDueSortValue(b)))
        setOverdueTasks(rows)
      }
    )

    const unsubUpcoming = onSnapshot(
      query(collection(db, 'fleetTasks'), where('status', '==', 'upcoming')),
      (snap) => {
        const rows = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(task => inComplianceScope(task.mainLocation || task.locationId))
        rows.sort((a, b) => getFleetTaskDueSortValue(a).localeCompare(getFleetTaskDueSortValue(b)))
        setUpcomingTasks(rows)
      }
    )

    return () => {
      unsubOverdue()
      unsubUpcoming()
    }
  }, [enabled, inComplianceScope])

  return { overdueTasks, upcomingTasks }
}
