/**
 * NotificationCenter
 *
 * Slide-out panel showing all alerts grouped by type with filter tabs.
 * Triggered from the header bell/badge. Supports:
 *  - Filter tabs: All | EOC | Fleet | Updates
 *  - Notification cards with severity badges, timestamps, action buttons
 *  - Mark all read / dismiss individual
 *  - Click-through to relevant dashboard tab
 *
 * Designed for both Supervisor/Admin and BHT roles.
 */

import { useState, useEffect, useRef } from 'react'
import { db } from '../firebase'
import { doc, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(ts) {
  if (!ts) return ''
  const date = ts.toDate ? ts.toDate() : new Date(ts)
  const now = Date.now()
  const diff = now - date.getTime()
  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`
  return date.toLocaleDateString()
}

function severityColor(severity) {
  switch (severity) {
    case 'high': return '#CD4E42'
    case 'medium': return '#B07A28'
    case 'low': return '#2F7D57'
    default: return '#465367'
  }
}

function severityLabel(severity) {
  switch (severity) {
    case 'high': return 'High'
    case 'medium': return 'Medium'
    case 'low': return 'Low'
    default: return 'Info'
  }
}

function alertTypeIcon(type) {
  if (String(type || '').startsWith('shift_debrief_')) return 'D'
  if (type === 'eoc_issue') return '⚠️'
  if (type === 'eoc_issue_update') return '📋'
  if (type?.startsWith('fleet_')) return '🚐'
  if (type === 'transport_completed') return '✅'
  return '🔔'
}

function alertTypeLabel(type) {
  if (type === 'shift_debrief_submitted') return 'Shift Debrief'
  if (type === 'shift_debrief_missing') return 'Missing Debrief'
  if (type === 'shift_debrief_no_receivers') return 'No Receiver'
  if (type === 'shift_debrief_incoming_ack_late') return 'Late Handoff Ack'
  if (type === 'eoc_issue') return 'EOC Issue'
  if (type === 'eoc_issue_update') return 'Issue Update'
  if (type === 'fleet_overdue') return 'Fleet Overdue'
  if (type === 'fleet_upcoming') return 'Fleet Upcoming'
  if (type === 'transport_completed') return 'Transport Done'
  return 'Alert'
}

// ---------------------------------------------------------------------------
// Filter tabs
// ---------------------------------------------------------------------------

const FILTER_TABS = [
  { key: 'all', label: 'All' },
  { key: 'eoc', label: 'EOC' },
  { key: 'debriefs', label: 'Debriefs' },
  { key: 'fleet', label: 'Fleet' },
  { key: 'updates', label: 'Updates' }
]

function filterAlerts(alerts, filterKey) {
  if (filterKey === 'all') return alerts
  if (filterKey === 'eoc') return alerts.filter(a => a.type === 'eoc_issue')
  if (filterKey === 'debriefs') return alerts.filter(a => String(a.type || '').startsWith('shift_debrief_'))
  if (filterKey === 'fleet') return alerts.filter(a => a.type?.startsWith('fleet_') || a.type === 'transport_completed')
  if (filterKey === 'updates') return alerts.filter(a => a.type === 'eoc_issue_update')
  return alerts
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NotificationCenter({
  isOpen,
  onClose,
  eocAlerts = [],
  fleetAlerts = [],
  debriefAlerts = [],
  issueUpdates = [],
  isOffline = false,
  onNavigateToIssue,
  onNavigateToFleet,
  onNavigateToDebrief,
  isMobile = false
}) {
  const [activeFilter, setActiveFilter] = useState('all')
  const [dismissing, setDismissing] = useState(new Set())
  const panelRef = useRef(null)

  // Combine all alerts into a single sorted list
  const allAlerts = [...eocAlerts, ...fleetAlerts, ...debriefAlerts, ...issueUpdates]
    .sort((a, b) => {
      const tsA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0
      const tsB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0
      return tsB - tsA
    })

  const filteredAlerts = filterAlerts(allAlerts, activeFilter)

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return
    const handleClick = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        onClose()
      }
    }
    // Delay to avoid catching the opening click
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick)
      document.addEventListener('touchstart', handleClick)
    }, 100)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('touchstart', handleClick)
    }
  }, [isOpen, onClose])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  // Dismiss (mark read) single alert
  const handleDismiss = async (alertId) => {
    if (isOffline) return
    const selectedAlert = allAlerts.find(alert => alert.id === alertId)
    setDismissing(prev => new Set(prev).add(alertId))
    try {
      await updateDoc(doc(db, 'alerts', alertId), {
        read: true,
        readAt: serverTimestamp(),
        readByUserId: selectedAlert?.targetUserId || null,
        readByName: selectedAlert?.targetUserName || null,
        version: Number(selectedAlert?.version || 0) + 1,
        updatedAt: serverTimestamp()
      })
    } catch (err) {
      console.error('Failed to dismiss alert:', err)
    }
    setDismissing(prev => {
      const next = new Set(prev)
      next.delete(alertId)
      return next
    })
  }

  // Mark all as read
  const handleMarkAllRead = async () => {
    if (isOffline) return
    const batch = writeBatch(db)
    const toDismiss = filteredAlerts.filter(a => !a.read)
    if (toDismiss.length === 0) return

    toDismiss.forEach(alert => {
      batch.update(doc(db, 'alerts', alert.id), {
        read: true,
        readAt: serverTimestamp(),
        readByUserId: alert.targetUserId || null,
        readByName: alert.targetUserName || null,
        version: Number(alert.version || 0) + 1,
        updatedAt: serverTimestamp()
      })
    })

    try {
      await batch.commit()
    } catch (err) {
      console.error('Failed to mark all read:', err)
    }
  }

  // Handle navigation from alert card
  const handleAlertAction = (alert) => {
    if (alert.type === 'eoc_issue' || alert.type === 'eoc_issue_update') {
      onNavigateToIssue?.(alert)
    } else if (String(alert.type || '').startsWith('shift_debrief_')) {
      onNavigateToDebrief?.(alert)
    } else if (alert.type?.startsWith('fleet_') || alert.type === 'transport_completed') {
      onNavigateToFleet?.(alert)
    }
    onClose()
  }

  if (!isOpen) return null

  return (
    <div style={styles.overlay}>
      <div ref={panelRef} style={{
        ...styles.panel,
        ...(isMobile ? styles.panelMobile : {})
      }}>
        {/* Header */}
        <div style={styles.panelHeader}>
          <h2 style={styles.panelTitle}>Notifications</h2>
          <div style={styles.panelHeaderRight}>
            {filteredAlerts.length > 0 && (
              <button
                onClick={handleMarkAllRead}
                disabled={isOffline}
                title={isOffline ? 'Reconnect to mark notifications read' : undefined}
                style={styles.markAllBtn}
              >
                Mark all read
              </button>
            )}
            <button onClick={onClose} style={styles.closeBtn} aria-label="Close">
              ✕
            </button>
          </div>
        </div>

        {/* Filter tabs */}
        <div style={styles.filterRow}>
          {FILTER_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveFilter(tab.key)}
              style={{
                ...styles.filterTab,
                ...(activeFilter === tab.key ? styles.filterTabActive : {})
              }}
            >
              {tab.label}
              {tab.key === 'all' && allAlerts.length > 0 && (
                <span style={styles.tabBadge}>{allAlerts.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* Alert list */}
        <div style={styles.alertList}>
          {filteredAlerts.length === 0 ? (
            <div style={styles.emptyState}>
              <span style={{ fontSize: '32px' }}>🔔</span>
              <p style={styles.emptyText}>No notifications</p>
              <p style={styles.emptySubtext}>
                {activeFilter === 'all'
                  ? "You're all caught up!"
                  : `No ${activeFilter} notifications right now.`}
              </p>
            </div>
          ) : (
            filteredAlerts.map(alert => (
              <div
                key={alert.id}
                style={{
                  ...styles.alertCard,
                  opacity: dismissing.has(alert.id) ? 0.5 : 1
                }}
              >
                <div style={styles.alertCardTop}>
                  <span style={styles.alertIcon}>{alertTypeIcon(alert.type)}</span>
                  <div style={styles.alertMeta}>
                    <span style={styles.alertTypeTag}>{alertTypeLabel(alert.type)}</span>
                    <span style={{
                      ...styles.severityBadge,
                      backgroundColor: `${severityColor(alert.severity)}18`,
                      color: severityColor(alert.severity),
                      borderColor: `${severityColor(alert.severity)}40`
                    }}>
                      {severityLabel(alert.severity)}
                    </span>
                  </div>
                  <span style={styles.alertTime}>{timeAgo(alert.createdAt)}</span>
                </div>

                <p style={styles.alertMessage}>{alert.message}</p>

                {alert.bhtName && (
                  <p style={styles.alertSubtext}>Reported by: {alert.bhtName}</p>
                )}
                {alert.actorName && alert.type === 'eoc_issue_update' && (
                  <p style={styles.alertSubtext}>By: {alert.actorName}</p>
                )}

                <div style={styles.alertActions}>
                  <button
                    onClick={() => handleAlertAction(alert)}
                    style={styles.viewBtn}
                  >
                    {alert.type === 'eoc_issue' || alert.type === 'eoc_issue_update'
                      ? 'View Issue'
                      : String(alert.type || '').startsWith('shift_debrief_')
                        ? 'View Debrief'
                        : 'View Details'}
                  </button>
                  <button
                    onClick={() => handleDismiss(alert.id)}
                    disabled={isOffline || dismissing.has(alert.id)}
                    title={isOffline ? 'Reconnect to dismiss this notification' : undefined}
                    style={styles.dismissBtn}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline styles (Healthcare Calm Theme)
// ---------------------------------------------------------------------------

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 1100,
    backgroundColor: 'rgba(17, 47, 82, 0.3)',
    backdropFilter: 'blur(2px)',
    display: 'flex',
    justifyContent: 'flex-end'
  },
  panel: {
    width: '380px',
    maxWidth: '100vw',
    height: '100vh',
    backgroundColor: '#F8F5F1',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '-8px 0 30px rgba(17,47,82,0.16)',
    animation: 'slideInRight 0.2s ease-out'
  },
  panelMobile: {
    width: '100vw'
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: '1px solid #D8D1C6',
    backgroundColor: '#FFFFFF',
    flexShrink: 0
  },
  panelTitle: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 600,
    color: '#1F2C3A'
  },
  panelHeaderRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  markAllBtn: {
    background: 'none',
    border: 'none',
    color: '#112F52',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: '6px',
    transition: 'background 0.15s'
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: '18px',
    color: '#465367',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: '6px',
    lineHeight: 1
  },
  filterRow: {
    display: 'flex',
    gap: '4px',
    padding: '12px 20px',
    borderBottom: '1px solid #D8D1C6',
    backgroundColor: '#FFFFFF',
    flexShrink: 0
  },
  filterTab: {
    border: 'none',
    background: 'transparent',
    padding: '6px 14px',
    borderRadius: '20px',
    fontSize: '13px',
    fontWeight: 500,
    color: '#465367',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    transition: 'all 0.15s'
  },
  filterTabActive: {
    backgroundColor: '#112F52',
    color: '#FFFFFF'
  },
  tabBadge: {
    fontSize: '11px',
    fontWeight: 700,
    backgroundColor: 'rgba(205,78,66,0.15)',
    color: '#CD4E42',
    borderRadius: '10px',
    padding: '1px 6px',
    minWidth: '18px',
    textAlign: 'center'
  },
  alertList: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 20px',
    textAlign: 'center'
  },
  emptyText: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#1F2C3A',
    margin: '12px 0 4px'
  },
  emptySubtext: {
    fontSize: '13px',
    color: '#465367',
    margin: 0
  },
  alertCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: '12px',
    padding: '14px 16px',
    border: '1px solid #D8D1C6',
    transition: 'opacity 0.2s'
  },
  alertCardTop: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px'
  },
  alertIcon: {
    fontSize: '16px',
    flexShrink: 0
  },
  alertMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flex: 1
  },
  alertTypeTag: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#112F52'
  },
  severityBadge: {
    fontSize: '10px',
    fontWeight: 700,
    padding: '2px 7px',
    borderRadius: '10px',
    border: '1px solid',
    textTransform: 'uppercase',
    letterSpacing: '0.3px'
  },
  alertTime: {
    fontSize: '11px',
    color: '#5E6B7C',
    flexShrink: 0
  },
  alertMessage: {
    margin: '0 0 6px',
    fontSize: '13px',
    lineHeight: 1.4,
    color: '#1F2C3A'
  },
  alertSubtext: {
    margin: '0 0 6px',
    fontSize: '12px',
    color: '#5E6B7C'
  },
  alertActions: {
    display: 'flex',
    gap: '8px',
    marginTop: '10px'
  },
  viewBtn: {
    border: 'none',
    background: '#112F52',
    color: '#FFFFFF',
    fontSize: '12px',
    fontWeight: 500,
    padding: '6px 14px',
    borderRadius: '8px',
    cursor: 'pointer'
  },
  dismissBtn: {
    border: '1px solid #D8D1C6',
    background: 'transparent',
    color: '#465367',
    fontSize: '12px',
    fontWeight: 500,
    padding: '6px 14px',
    borderRadius: '8px',
    cursor: 'pointer'
  }
}
