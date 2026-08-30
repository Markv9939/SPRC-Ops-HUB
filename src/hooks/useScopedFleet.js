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
import { collection, query, where } from 'firebase/firestore'
import { parseMileageValue } from '../utils/fleetStatus'
import { normalizeMainLocation } from '../utils/orgModel'
import { subscribeMergedQueryRows } from '../services/scopedSnapshotService'

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
 * @param {string[]|null} params.scopeSites — exact backend sites, or null for admin
 * @param {boolean}  [params.enabled=true]
 */
export default function useScopedFleet({ inComplianceScope, scopeSites = [], isAdmin = false, enabled = true }) {
  const [overdueTasks, setOverdueTasks] = useState([])
  const [upcomingTasks, setUpcomingTasks] = useState([])

  useEffect(() => {
    if (!enabled || !inComplianceScope) return

    const normalizedSites = [...new Set((scopeSites || []).map(normalizeMainLocation).filter(Boolean))]
    const taskQueries = status => isAdmin
      ? [query(collection(db, 'fleetTasks'), where('status', '==', status))]
      : normalizedSites.map(mainLocation => query(
          collection(db, 'fleetTasks'),
          where('status', '==', status),
          where('mainLocation', '==', mainLocation)
        ))
    const applyRows = setter => rows => {
      const scopedRows = rows.filter(task => inComplianceScope(task.mainLocation || task.locationId))
      scopedRows.sort((a, b) => getFleetTaskDueSortValue(a).localeCompare(getFleetTaskDueSortValue(b)))
      setter(scopedRows)
    }
    const unsubOverdue = subscribeMergedQueryRows(taskQueries('overdue'), applyRows(setOverdueTasks))
    const unsubUpcoming = subscribeMergedQueryRows(taskQueries('upcoming'), applyRows(setUpcomingTasks))

    return () => {
      unsubOverdue()
      unsubUpcoming()
    }
  }, [enabled, inComplianceScope, isAdmin, scopeSites])

  return { overdueTasks, upcomingTasks }
}
