/**
 * Hook: useScopedIssues
 *
 * Real-time listener for EOC issues and overdue EOC tasks,
 * filtered by the user's scope.
 *
 * Replaces the inline listeners in SupervisorDashboard (lines 358-376).
 */

import { useState, useEffect, useMemo } from 'react'
import { db } from '../firebase'
import { collection, query, where, orderBy, onSnapshot, limit } from 'firebase/firestore'
import { isAdminRole } from '../utils/orgModel'
import { ACTIVE_ISSUE_STATUSES, CLOSED_ISSUE_STATUSES } from '../utils/issueModel'

const ACTIVE_STATUSES = ACTIVE_ISSUE_STATUSES
const RESOLVED_STATUSES = CLOSED_ISSUE_STATUSES

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
  const [resolvedLimit, setResolvedLimit] = useState(50)
  const exactLocations = useMemo(() => [...new Set((Array.isArray(issueLocationIds) ? issueLocationIds : [])
    .map(value => String(value || '').trim().toLowerCase())
    .filter(Boolean))], [issueLocationIds])
  const admin = isAdminRole(user?.role)
  const waitingForVerifiedScope = user?.authScopeEnforced === true && !admin && exactLocations.length === 0
  useEffect(() => {
    if (!enabled || !inEocScope) return

    const canUseExactIssueQuery = exactLocations.length > 0 && !admin
    const issueUnsubs = []

    if (waitingForVerifiedScope) {
      // Do not start a broad listener while signed scope is still hydrating.
    } else if (canUseExactIssueQuery) {
      const updateBuckets = []
      exactLocations.forEach((locationId, index) => {
        const unsub = onSnapshot(
          query(
            collection(db, 'eocIssues'),
            where('locationId', '==', locationId),
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
          },
          (err) => {
            console.error('Scoped issue listener failed:', err)
            updateBuckets[index] = []
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
        },
        (err) => {
          console.error('Scoped issue listener failed:', err)
          setIssues([])
        }
      ))
    }

    const resolvedUnsubs = []
    if (includeResolved && !waitingForVerifiedScope) {
      const resolvedQueryLocations = canUseExactIssueQuery ? exactLocations : [null]
      const resolvedBuckets = []
      resolvedQueryLocations.forEach((locationId, index) => {
        const constraints = [
          where('status', 'in', RESOLVED_STATUSES),
          orderBy('closedAt', 'desc'),
          limit(resolvedLimit)
        ]
        if (locationId) constraints.unshift(where('locationId', '==', locationId))
        const unsub = onSnapshot(
          query(collection(db, 'eocIssues'), ...constraints),
          (snap) => {
            resolvedBuckets[index] = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            const merged = new Map()
            resolvedBuckets.flat().filter(Boolean).forEach(issue => {
              if (!inIssueScope || inIssueScope(issue.locationId)) merged.set(issue.id, issue)
            })
            setResolvedIssues(Array.from(merged.values()).sort((a, b) => tsMs(b.closedAt || b.updatedAt) - tsMs(a.closedAt || a.updatedAt)))
          },
          (err) => {
            console.error('Scoped resolved issue listener failed:', err)
            resolvedBuckets[index] = []
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

    const overdueUnsubs = []
    if (!waitingForVerifiedScope) {
      const overdueQueryLocations = canUseExactIssueQuery ? exactLocations : [null]
      const overdueBuckets = []
      overdueQueryLocations.forEach((locationId, index) => {
        const constraints = [where('status', '==', 'overdue')]
        if (locationId) constraints.unshift(where('locationId', '==', locationId))
        const unsub = onSnapshot(
          query(collection(db, 'eocTasks'), ...constraints),
          (snap) => {
            overdueBuckets[index] = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            const merged = new Map()
            overdueBuckets.flat().filter(Boolean).forEach(task => {
              if (inEocScope(task.locationId)) merged.set(task.id, task)
            })
            setOverdueTasks(Array.from(merged.values()).sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '')))
          },
          (err) => {
            console.error('Scoped overdue EOC task listener failed:', err)
            overdueBuckets[index] = []
            const merged = new Map()
            overdueBuckets.flat().filter(Boolean).forEach(task => {
              if (inEocScope(task.locationId)) merged.set(task.id, task)
            })
            setOverdueTasks(Array.from(merged.values()).sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '')))
          }
        )
        overdueUnsubs.push(unsub)
      })
    }

    return () => {
      issueUnsubs.forEach(unsub => unsub())
      resolvedUnsubs.forEach(unsub => unsub())
      overdueUnsubs.forEach(unsub => unsub())
    }
  }, [admin, enabled, exactLocations, includeResolved, inEocScope, inIssueScope, resolvedLimit, waitingForVerifiedScope])

  return {
    issues: waitingForVerifiedScope ? [] : issues,
    resolvedIssues: waitingForVerifiedScope ? [] : resolvedIssues,
    overdueTasks,
    resolvedLimit,
    loadMoreResolved: () => setResolvedLimit(value => value + 50)
  }
}
