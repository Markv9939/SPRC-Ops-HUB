import { useEffect, useMemo, useState } from 'react'
import { collection, limit, onSnapshot, orderBy, query, Timestamp, where } from 'firebase/firestore'
import { db } from '../firebase'
import { ACTIVE_ISSUE_STATUSES, ISSUE_STATUS } from '../utils/issueModel'

const EMPTY_ISSUES = Object.freeze([])

function timeMs(value) {
  if (!value) return 0
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value.toDate === 'function') return value.toDate().getTime()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

export default function useHandoffIssues(locationId, enabled = true) {
  const [activeState, setActiveState] = useState({ locationId: '', rows: [], error: null })
  const [resolvedState, setResolvedState] = useState({ locationId: '', rows: [], error: null })

  useEffect(() => {
    if (!enabled || !locationId) {
      return undefined
    }
    const activeUnsub = onSnapshot(query(
      collection(db, 'eocIssues'),
      where('locationId', '==', locationId),
      where('status', 'in', ACTIVE_ISSUE_STATUSES),
      orderBy('createdAt', 'desc'),
      limit(50)
    ), snap => {
      setActiveState({ locationId, rows: snap.docs.map(row => ({ id: row.id, ...row.data() })), error: null })
    }, nextError => {
      setActiveState({ locationId, rows: [], error: nextError })
    })
    const resolvedUnsub = onSnapshot(query(
      collection(db, 'eocIssues'),
      where('locationId', '==', locationId),
      where('status', '==', ISSUE_STATUS.RESOLVED),
      where('closedAt', '>=', Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000)),
      orderBy('closedAt', 'desc'),
      limit(25)
    ), snap => {
      setResolvedState({ locationId, rows: snap.docs.map(row => ({ id: row.id, ...row.data() })), error: null })
    }, nextError => {
      setResolvedState({ locationId, rows: [], error: nextError })
    })
    return () => {
      activeUnsub()
      resolvedUnsub()
    }
  }, [enabled, locationId])

  const active = activeState.locationId === locationId ? activeState.rows : EMPTY_ISSUES
  const recentlyResolved = resolvedState.locationId === locationId ? resolvedState.rows : EMPTY_ISSUES
  const issues = useMemo(() => [...active, ...recentlyResolved].sort((left, right) => (
    timeMs(right.updatedAt || right.closedAt || right.createdAt) - timeMs(left.updatedAt || left.closedAt || left.createdAt)
  )), [active, recentlyResolved])
  const loading = Boolean(enabled && locationId && (
    activeState.locationId !== locationId || resolvedState.locationId !== locationId
  ))
  const error = activeState.locationId === locationId && activeState.error
    ? activeState.error
    : (resolvedState.locationId === locationId ? resolvedState.error : null)

  return {
    issues: enabled ? issues : [],
    active: enabled ? active : [],
    recentlyResolved: enabled ? recentlyResolved : [],
    loading: enabled ? loading : false,
    error: enabled ? error : null
  }
}
