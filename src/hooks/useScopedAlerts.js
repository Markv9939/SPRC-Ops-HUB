/**
 * Hook: useScopedAlerts
 *
 * Real-time listener for the `alerts` collection, filtered by user scope.
 * Returns alerts split by type (eoc, fleet, issueUpdates) plus a total
 * unread count suitable for the header badge.
 *
 * Replaces the duplicated alert listeners in App.jsx and SupervisorDashboard.
 */

import { useState, useEffect } from 'react'
import { db } from '../firebase'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { isFleetAlertType } from '../utils/fleetStatus'
import { isAdminRole, isBhtRole, isSupervisorRole } from '../utils/orgModel'

const DEBRIEF_ALERT_TYPES = new Set([
  'shift_debrief_submitted',
  'shift_debrief_missing',
  'shift_debrief_no_receivers',
  'shift_debrief_incoming_ack_late'
])

function tsMs(ts) {
  if (!ts) return 0
  return ts.toDate ? ts.toDate().getTime() : 0
}

/**
 * @param {object} params
 * @param {object} params.user              — session user
 * @param {function} params.inEocScope      — (locationId) => boolean
 * @param {function} params.inComplianceScope — (site) => boolean
 * @param {boolean}  [params.enabled=true]  — set to false to skip listener
 */
export default function useScopedAlerts({ user, inEocScope, inComplianceScope, enabled = true }) {
  const [eocAlerts, setEocAlerts] = useState([])
  const [fleetAlerts, setFleetAlerts] = useState([])
  const [debriefAlerts, setDebriefAlerts] = useState([])
  const [issueUpdates, setIssueUpdates] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)

  // Supervisor/admin: scoped eoc + fleet alerts
  useEffect(() => {
    if (!enabled || !user || !inEocScope || !inComplianceScope) return
    if (!isSupervisorRole(user.role) && !isAdminRole(user.role)) return

    const q = query(
      collection(db, 'alerts'),
      where('audience', '==', 'supervisor'),
      where('read', '==', false)
    )

    const unsubscribe = onSnapshot(q, (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))

      // EOC issue alerts
      const scopedEoc = rows
        .filter(a => a.type === 'eoc_issue')
        .filter(a => inEocScope(a.locationId))
      scopedEoc.sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt))
      setEocAlerts(scopedEoc)

      // Fleet alerts
      const scopedFleet = rows
        .filter(a => isFleetAlertType(a.type))
        .filter(a => inComplianceScope(a.mainLocation || a.locationId || ''))
      scopedFleet.sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt))
      setFleetAlerts(scopedFleet)

      // Shift debrief alerts
      const scopedDebriefs = rows
        .filter(a => DEBRIEF_ALERT_TYPES.has(a.type))
        .filter(a => (
          inEocScope(a.locationId)
          && (
            isBhtRole(user.role)
              ? a.targetUserId === user.id
              : !a.targetUserId
          )
        ))
      scopedDebriefs.sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt))
      setDebriefAlerts(scopedDebriefs)

      // Total badge count (eoc issues + fleet)
      const count = rows.reduce((acc, alertDoc) => {
        const type = String(alertDoc.type || '')
        if (type === 'eoc_issue' && inEocScope(alertDoc.locationId)) return acc + 1
        if (isFleetAlertType(type) && inComplianceScope(alertDoc.mainLocation || alertDoc.locationId || '')) return acc + 1
        if (
          DEBRIEF_ALERT_TYPES.has(type)
          && inEocScope(alertDoc.locationId)
          && (
            isBhtRole(user.role)
              ? alertDoc.targetUserId === user.id
              : !alertDoc.targetUserId
          )
        ) return acc + 1
        return acc
      }, 0)
      setUnreadCount(count)
    })

    return () => unsubscribe()
  }, [enabled, user, inEocScope, inComplianceScope])

  // BHT: issue status updates targeted at this user
  useEffect(() => {
    if (!enabled || !user?.id) return
    if (!isBhtRole(user.role)) return

    const q = query(
      collection(db, 'alerts'),
      where('audience', '==', 'bht'),
      where('targetUserId', '==', user.id),
      where('read', '==', false)
    )

    const unsubscribe = onSnapshot(q, (snap) => {
      const rows = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(item => item.type === 'eoc_issue_update' || item.type === 'shift_debrief_submitted')
      rows.sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt))
      setIssueUpdates(rows.filter(item => item.type === 'eoc_issue_update').slice(0, 8))
      setDebriefAlerts(rows.filter(item => item.type === 'shift_debrief_submitted'))
      setUnreadCount(rows.length)
    })

    return () => unsubscribe()
  }, [enabled, user?.id, user?.role])

  return {
    eocAlerts,
    fleetAlerts,
    debriefAlerts,
    issueUpdates,
    unreadCount
  }
}
