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
import { isAdminRole } from '../utils/orgModel'

const ACTIVE_STATUSES = ['open', 'in_progress']
const RESOLVED_STATUSES = ['resolved', 'voided']

function chunk(values, size) {
  const chunks = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

function tsMs(ts) {
  if (!ts) return 0
  if (typeof ts?.toDate === 'function') return ts.toDate().getTime()
  const date = new Date(ts)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

/**
 * @param {object} params
 * @param {function} params.inEocScope — (locationId) => boolean
 * @param {boolean}  [params.enabled=true]
 */
export default function useScopedIssues({
  user = null,
  inEocScope,
  inIssueScope,
  issueLocationIds,
  includeResolved = false,
  enabled = true
}) {
  const [issues, setIssues] = useState([])
  const [resolvedIssues, setResolvedIssues] = useState([])
  const [overdueTasks, setOverdueTasks] = useState([])
  useEffect(() => {
    if (!enabled || !inEocScope) return

    const exactLocations = [...new Set((Array.isArray(issueLocationIds) ? issueLocationIds : [])
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean))]
    const canUseExactIssueQuery = exactLocations.length > 0 && !isAdminRole(user?.role)
    const issueUnsubs = []

    if (canUseExactIssueQuery) {
      const updateBuckets = []
      chunk(exactLocations, 10).forEach((locations, index) => {
        const unsub = onSnapshot(
          query(
            collection(db, 'eocIssues'),
            where('locationId', 'in', locations),
            where('status', 'in', ACTIVE_STATUSES),
            orderBy('createdAt', 'desc')
          ),
          (snap) => {
            updateBuckets[index] = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            const merged = new Map()
            updateBuckets.flat().filter(Boolean).forEach(issue => {
              if (!inIssueScope || inIssueScope(issue.locationId)) merged.set(issue.id, issue)
            })
            setIssues(Array.from(merged.values()).sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt)))
          }
        )
        issueUnsubs.push(unsub)
      })
    } else {
      issueUnsubs.push(onSnapshot(
        query(
          collection(db, 'eocIssues'),
          where('status', 'in', ACTIVE_STATUSES),
          orderBy('createdAt', 'desc')
        ),
        (snap) => {
          const rows = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(issue => inIssueScope ? inIssueScope(issue.locationId) : inEocScope(issue.locationId))
          setIssues(rows)
        }
      ))
    }

    const resolvedUnsubs = []
    if (includeResolved) {
      const resolvedQueryLocations = canUseExactIssueQuery ? chunk(exactLocations, 10) : [null]
      const resolvedBuckets = []
      resolvedQueryLocations.forEach((locations, index) => {
        const constraints = [
          where('status', 'in', RESOLVED_STATUSES),
          orderBy('closedAt', 'desc')
        ]
        if (locations) constraints.unshift(where('locationId', 'in', locations))
        const unsub = onSnapshot(
          query(collection(db, 'eocIssues'), ...constraints),
          (snap) => {
            resolvedBuckets[index] = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            const merged = new Map()
            resolvedBuckets.flat().filter(Boolean).forEach(issue => {
              if (!inIssueScope || inIssueScope(issue.locationId)) merged.set(issue.id, issue)
            })
            setResolvedIssues(Array.from(merged.values()).sort((a, b) => tsMs(b.closedAt || b.updatedAt) - tsMs(a.closedAt || a.updatedAt)))
          }
        )
        resolvedUnsubs.push(unsub)
      })
    }

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
      issueUnsubs.forEach(unsub => unsub())
      resolvedUnsubs.forEach(unsub => unsub())
      unsubOverdue()
    }
  }, [enabled, includeResolved, inEocScope, inIssueScope, issueLocationIds, user?.role])

  return { issues, resolvedIssues, overdueTasks }
}
