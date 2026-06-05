/**
 * DashboardSummaryPanel
 *
 * Extracted from SupervisorDashboard — the "Dashboard" tab content.
 * Owns all queue state, filtering, compliance quick-edit, overdue-task
 * actions, and the transport stats section.
 *
 * Props:
 *   user, isOffline, isMobile,
 *   eocIssues, eocOverdueTasks, fleetOverdueTasks, fleetUpcomingTasks,
 *   eocAlerts, fleetAlerts, debriefAlerts, complianceItems,
 *   inComplianceScope, inTransportScope,
 *   onNavigateTab            — (tabKey) => void
 *   onDrilldownToTransports  — ({ startDate, endDate, site, status, reason, driver }) => void
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import { db } from '../firebase'
import {
  collection, query, where, orderBy, doc, getDocs, updateDoc,
  runTransaction, serverTimestamp, writeBatch, Timestamp
} from 'firebase/firestore'
import { assertExpectedVersion, formatVersionConflictMessage, getVersionNumber } from '../services/versioning'
import { createIssueStatusNotification as sendIssueStatusNotification, writeAuditLog as writeAuditEntry } from '../services/notificationService'
import { notifySuccess } from '../utils/toast'
import { getStatus } from '../utils/complianceStatus'
import { getFleetTaskTypeLabel, parseMileageValue } from '../utils/fleetStatus'
import { LOCATIONS, VANS, getShiftLabel } from '../data/eocConstants'
import {
  MAIN_LOCATIONS,
  locationIdToMainLocation,
  normalizeMainLocation,
  normalizeTransportSite
} from '../utils/orgModel'

// ── Helper functions (moved from SupervisorDashboard top-level scope) ──

const COMPLIANCE_CATEGORY_LABELS = {
  fpcc: 'FPCC',
  tb_test: 'TB Test',
  cpr_first_aid: 'CPR & First Aid',
  food_handlers: 'Food Handlers',
  drivers_license: "Driver's License",
  annual_orientation: 'Annual Orientation',
  performance_evaluation: 'Performance Evaluation',
  education: 'Education Verification',
  resume: 'Resume'
}

function locationScopeAlias(locationId) {
  const normalizedMainLocation = locationIdToMainLocation(locationId)
  if (normalizedMainLocation) return normalizedMainLocation
  const normalized = String(locationId || '').trim().toUpperCase()
  return normalizeMainLocation(normalized) || normalized
}

function normalizeComplianceSite(siteId) {
  return locationScopeAlias(siteId)
}

function formatComplianceCategory(category) {
  const normalized = String(category || '').trim().toLowerCase()
  if (!normalized) return 'Compliance item'
  if (COMPLIANCE_CATEGORY_LABELS[normalized]) return COMPLIANCE_CATEGORY_LABELS[normalized]
  return normalized.split('_').filter(Boolean).map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(' ')
}

function formatComplianceSiteLabel(siteId) {
  const normalized = normalizeComplianceSite(siteId)
  if (!normalized) return 'Unknown Location'
  if (normalized === 'OTC') return 'OTC (Mesquite / Lone Mountain)'
  return normalized
}

function getComplianceItemSite(item) {
  return normalizeComplianceSite(item?.employeeSite || item?.site || item?.locationId)
}

function getComplianceItemDueMs(item) {
  const dueValue = item?.dueDate
  if (!dueValue) return Number.POSITIVE_INFINITY
  const dueDate = dueValue.toDate ? dueValue.toDate() : new Date(dueValue)
  const ms = dueDate.getTime()
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY
}

function formatFleetDueLabel(task) {
  if (task?.triggerMode === 'date') return task?.dueDate ? `Due ${task.dueDate}` : 'Due date not set'
  const dueMileage = parseMileageValue(task?.dueMileage)
  if (dueMileage === null) return 'Due mileage not set'
  return `Due ${dueMileage.toLocaleString('en-US')} mi`
}

function formatFleetCurrentLabel(task) {
  if (task?.triggerMode === 'date') return task?.currentDateSnapshot ? `Current ${task.currentDateSnapshot}` : 'Current date unavailable'
  const parsed = parseMileageValue(task?.currentMileageSnapshot)
  return `Current ${parsed === null ? '--' : parsed.toLocaleString('en-US')} mi`
}

function formatFleetVehicleLabel(task) {
  const name = String(task?.vehicleName || '').trim()
  const vanId = String(task?.vanId || '').trim()
  const location = String(task?.mainLocation || task?.locationId || '').trim()
  const details = [vanId, location].filter(Boolean).join(' | ')
  if (name && details) return `${name} (${details})`
  if (name) return name
  if (details) return details
  return task?.vehicleId || 'Unknown vehicle'
}

function formatAlertTypeLabel(type) {
  if (type === 'shift_debrief_missing') return 'Missing debrief'
  if (type === 'shift_debrief_no_receivers') return 'No receiving BHT'
  if (type === 'shift_debrief_incoming_ack_late') return 'Late handoff acknowledgment'
  if (type === 'shift_debrief_submitted') return 'Shift debrief submitted'
  if (type === 'eoc_issue') return 'EOC issue'
  if (type === 'fleet_overdue') return 'Fleet overdue'
  if (type === 'fleet_upcoming') return 'Fleet upcoming'
  if (type === 'transport_completed') return 'Transport completed'
  return type || 'Alert'
}

function formatTime(timestamp) {
  if (!timestamp) return '--:--'
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

function formatDate(timestamp) {
  if (!timestamp) return '--'
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
  return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
}

function tsToInputDate(ts) {
  if (!ts) return ''
  const dateValue = ts?.toDate ? ts.toDate() : new Date(ts)
  if (Number.isNaN(dateValue.getTime())) return ''
  return dateValue.toISOString().split('T')[0]
}

function toDateInputValue(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isCompletedTransport(transport) {
  const status = String(transport?.status || '').toLowerCase()
  return status === 'returned' || status === 'closed'
}

const selectStyle = {
  padding: '6px 10px',
  border: '2px solid rgba(17,47,82,0.20)',
  borderRadius: '6px',
  fontSize: '13px',
  background: 'rgba(17,47,82,0.10)',
  color: 'var(--text-primary)'
}

// ── Component ──

export default function DashboardSummaryPanel({
  user,
  isOffline = false,
  isMobile = false,
  eocIssues,
  eocOverdueTasks,
  fleetOverdueTasks,
  fleetUpcomingTasks,
  eocAlerts,
  fleetAlerts,
  debriefAlerts = [],
  complianceItems,
  inComplianceScope,
  inTransportScope,
  onNavigateTab,
  onDrilldownToTransports
}) {
  // ── Queue state ──
  const [queueView, setQueueView] = useState('issues')
  const [queueLocationFilter, setQueueLocationFilter] = useState('all')

  // ── Overdue task action state ──
  const [overdueTaskActionId, setOverdueTaskActionId] = useState(null)
  const [overdueTaskActionMode, setOverdueTaskActionMode] = useState(null)
  const [overdueTaskActionReason, setOverdueTaskActionReason] = useState('')
  const [overdueTaskActionSubmitting, setOverdueTaskActionSubmitting] = useState(false)

  // ── Compliance quick-edit state ──
  const [complianceQuickEditId, setComplianceQuickEditId] = useState(null)
  const [complianceQuickEditForm, setComplianceQuickEditForm] = useState({ lastCompleted: '', dueDate: '', notes: '' })
  const [complianceQuickEditSaving, setComplianceQuickEditSaving] = useState(false)

  // ── Issue action notes ──
  const [eocIssueActionNotes, setEocIssueActionNotes] = useState({})

  // ── Dashboard transport stats ──
  const [dashMonth, setDashMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [dashSite, setDashSite] = useState('ALL')
  const [dashTransports, setDashTransports] = useState([])
  const [dashLoading, setDashLoading] = useState(false)

  // ── Reset overdue action when queue changes ──
  useEffect(() => {
    if (queueView === 'overdue') return
    setOverdueTaskActionId(null)
    setOverdueTaskActionMode(null)
    setOverdueTaskActionReason('')
    setOverdueTaskActionSubmitting(false)
  }, [queueView])

  useEffect(() => {
    if (queueView === 'overdue' || queueView === 'upcoming') return
    setComplianceQuickEditId(null)
    setComplianceQuickEditForm({ lastCompleted: '', dueDate: '', notes: '' })
    setComplianceQuickEditSaving(false)
  }, [queueView])

  // ── Thin wrappers for services ──
  const blockIfOffline = (actionLabel) => {
    if (!isOffline) return false
    alert(`Offline mode: ${actionLabel} is unavailable until connection is restored.`)
    return true
  }

  const alertVersionConflict = (error, fallbackMessage) => {
    if (error?.code === 'version-conflict') {
      alert(formatVersionConflictMessage(error))
      return true
    }
    alert(fallbackMessage)
    return false
  }

  const writeAuditLog = async ({ action, collectionPath, documentId, reason, extra = {} }) => {
    await writeAuditEntry({ action, collectionPath, documentId, reason, actorUser: user, extra })
  }

  const createIssueStatusNotification = async ({ issue, nextStatus, note }) => {
    await sendIssueStatusNotification({ issue, nextStatus, note, actorUser: user })
  }

  // ── Issue action note helpers ──
  const getIssueActionNote = (issueId) => String(eocIssueActionNotes[issueId] || '')
  const updateIssueActionNote = (issueId, note) => {
    setEocIssueActionNotes(prev => ({ ...prev, [issueId]: note }))
  }
  const clearIssueActionNote = (issueId) => {
    setEocIssueActionNotes(prev => {
      if (!(issueId in prev)) return prev
      const next = { ...prev }
      delete next[issueId]
      return next
    })
  }

  // ── Overdue task helpers ──
  const resetOverdueTaskActionState = () => {
    setOverdueTaskActionId(null)
    setOverdueTaskActionMode(null)
    setOverdueTaskActionReason('')
    setOverdueTaskActionSubmitting(false)
  }

  const openOverdueTaskIgnore = (task) => {
    setOverdueTaskActionId(task.id)
    setOverdueTaskActionMode('ignore')
    setOverdueTaskActionReason('')
    setOverdueTaskActionSubmitting(false)
  }

  // ── Compliance quick-edit helpers ──
  const openComplianceQuickEdit = (item) => {
    setComplianceQuickEditId(item.id)
    setComplianceQuickEditForm({
      lastCompleted: tsToInputDate(item.lastCompleted),
      dueDate: tsToInputDate(item.dueDate),
      notes: String(item.notes || '')
    })
    setComplianceQuickEditSaving(false)
  }

  const cancelComplianceQuickEdit = () => {
    setComplianceQuickEditId(null)
    setComplianceQuickEditForm({ lastCompleted: '', dueDate: '', notes: '' })
    setComplianceQuickEditSaving(false)
  }

  // ── Handlers ──
  const handleDashStartIssue = async (issueId, progressNote) => {
    if (blockIfOffline('starting issue progress')) return
    const trimmedProgressNote = String(progressNote || '').trim()
    if (!trimmedProgressNote) { alert('Note is required before moving an issue to in progress.'); return }

    const selectedIssue = eocIssues.find(issue => issue.id === issueId)
    if (!selectedIssue) { alert('Issue no longer exists.'); return }
    const expectedVersion = getVersionNumber(selectedIssue)

    try {
      await runTransaction(db, async (transaction) => {
        const issueRef = doc(db, 'eocIssues', issueId)
        const issueSnap = await transaction.get(issueRef)
        if (!issueSnap.exists()) throw new Error('Issue no longer exists.')

        const latestIssue = issueSnap.data()
        const { nextVersion } = assertExpectedVersion({
          expectedVersion, currentVersion: getVersionNumber(latestIssue),
          documentId: issueId, recordLabel: 'EOC Issue'
        })

        transaction.update(issueRef, {
          status: 'in_progress', inProgressNotes: trimmedProgressNote,
          inProgressAt: serverTimestamp(), inProgressByUserId: user?.id || null,
          inProgressByName: user?.name || null, version: nextVersion, updatedAt: serverTimestamp()
        })
      })
      await createIssueStatusNotification({ issue: selectedIssue, nextStatus: 'in_progress', note: trimmedProgressNote })
      await writeAuditLog({ action: 'issue_in_progress', collectionPath: 'eocIssues', documentId: issueId, reason: trimmedProgressNote })
      clearIssueActionNote(issueId)
    } catch (err) {
      console.error('Error moving issue to in_progress:', err)
      alertVersionConflict(err, 'Failed to start issue progress')
    }
  }

  const handleDashResolveIssue = async (issueId, resolveNote) => {
    if (blockIfOffline('resolving issues')) return
    const trimmedResolveNote = String(resolveNote || '').trim()
    if (!trimmedResolveNote) { alert('Resolution note is required.'); return }

    const selectedIssue = eocIssues.find(issue => issue.id === issueId)
    if (!selectedIssue) { alert('Issue no longer exists.'); return }
    const expectedVersion = getVersionNumber(selectedIssue)

    try {
      await runTransaction(db, async (transaction) => {
        const issueRef = doc(db, 'eocIssues', issueId)
        const issueSnap = await transaction.get(issueRef)
        if (!issueSnap.exists()) throw new Error('Issue no longer exists.')

        const latestIssue = issueSnap.data()
        const { nextVersion } = assertExpectedVersion({
          expectedVersion, currentVersion: getVersionNumber(latestIssue),
          documentId: issueId, recordLabel: 'EOC Issue'
        })

        transaction.update(issueRef, {
          status: 'resolved', resolvedNotes: trimmedResolveNote,
          resolvedAt: serverTimestamp(), resolvedByUserId: user?.id || null,
          resolvedByName: user?.name || null, version: nextVersion, updatedAt: serverTimestamp()
        })
      })

      const relatedAlerts = await getDocs(query(collection(db, 'alerts'), where('issueId', '==', issueId)))
      const alertBatch = writeBatch(db)
      let alertMutations = 0
      relatedAlerts.docs.forEach(alertDoc => {
        if (alertDoc.data().type !== 'eoc_issue' || alertDoc.data().read === true) return
        alertBatch.update(alertDoc.ref, {
          read: true, resolvedAt: serverTimestamp(), resolvedByUserId: user?.id || null,
          resolvedByName: user?.name || null, version: getVersionNumber(alertDoc.data()) + 1, updatedAt: serverTimestamp()
        })
        alertMutations += 1
      })
      if (alertMutations > 0) await alertBatch.commit()
      await createIssueStatusNotification({ issue: selectedIssue, nextStatus: 'resolved', note: trimmedResolveNote })
      await writeAuditLog({ action: 'issue_resolved', collectionPath: 'eocIssues', documentId: issueId, reason: trimmedResolveNote })
      clearIssueActionNote(issueId)
    } catch (err) {
      console.error('Error resolving issue:', err)
      alertVersionConflict(err, 'Failed to resolve issue')
    }
  }

  const handleMarkAlertRead = async (alertId) => {
    if (blockIfOffline('marking alerts as read')) return
    const selectedAlert = [...eocAlerts, ...fleetAlerts].find(r => r.id === alertId)
    try {
      await updateDoc(doc(db, 'alerts', alertId), {
        read: true, readAt: serverTimestamp(), readByUserId: user?.id || null,
        readByName: user?.name || null, version: getVersionNumber(selectedAlert) + 1, updatedAt: serverTimestamp()
      })
    } catch (err) {
      console.error('Error marking alert read:', err)
      alert('Failed to mark alert as read')
    }
  }

  const handleOverdueTaskIgnore = async (task) => {
    if (blockIfOffline('ignoring overdue tasks')) return
    if (!task?.id) return
    const reason = String(overdueTaskActionReason || '').trim()
    if (!reason) { alert('Ignore reason is required for audit history.'); return }

    setOverdueTaskActionSubmitting(true)
    try {
      const expectedVersion = getVersionNumber(task)
      await runTransaction(db, async (transaction) => {
        const taskRef = doc(db, 'eocTasks', task.id)
        const taskSnap = await transaction.get(taskRef)
        if (!taskSnap.exists()) throw new Error('Task no longer exists.')

        const latestTask = taskSnap.data()
        if (latestTask.status !== 'overdue') throw new Error('Task is no longer overdue.')

        const { nextVersion } = assertExpectedVersion({
          expectedVersion, currentVersion: getVersionNumber(latestTask),
          documentId: task.id, recordLabel: 'EOC Task'
        })

        transaction.update(taskRef, {
          status: 'ignored', ignoredAt: serverTimestamp(), ignoredByUserId: user?.id || null,
          ignoredByName: user?.name || null, ignoredReason: reason,
          version: nextVersion, updatedAt: serverTimestamp()
        })
      })

      await writeAuditLog({
        action: 'eoc_task_ignore', collectionPath: 'eocTasks', documentId: task.id, reason,
        extra: { locationId: task.locationId || '', shiftId: task.shiftId || '', dueDate: task.dueDate || '' }
      })
      notifySuccess('Overdue task ignored')
      resetOverdueTaskActionState()
    } catch (error) {
      console.error('Failed to ignore overdue task:', error)
      alertVersionConflict(error, error?.message || 'Failed to ignore overdue task')
      setOverdueTaskActionSubmitting(false)
      return
    }
    setOverdueTaskActionSubmitting(false)
  }

  const handleComplianceQuickSave = async (item) => {
    if (blockIfOffline('updating compliance items')) return
    if (!item?.id) return
    const dueDateValue = String(complianceQuickEditForm.dueDate || '').trim()
    if (!dueDateValue) { alert('Next due date is required.'); return }
    const dueDate = new Date(dueDateValue)
    if (Number.isNaN(dueDate.getTime())) { alert('Enter a valid next due date.'); return }

    setComplianceQuickEditSaving(true)
    try {
      const updates = { updatedAt: serverTimestamp() }
      updates.lastCompleted = complianceQuickEditForm.lastCompleted
        ? Timestamp.fromDate(new Date(complianceQuickEditForm.lastCompleted))
        : null
      updates.dueDate = Timestamp.fromDate(dueDate)
      updates.notes = String(complianceQuickEditForm.notes || '').trim()

      await updateDoc(doc(db, 'complianceItems', item.id), updates)
      await writeAuditLog({
        action: 'compliance_item_quick_update', collectionPath: 'complianceItems', documentId: item.id,
        reason: 'Updated directly from dashboard warning card.',
        extra: { category: String(item.category || ''), employeeName: String(item.employeeName || ''),
          site: String(getComplianceItemSite(item) || ''), dueDate: dueDateValue }
      })
      notifySuccess('Compliance item updated')
      cancelComplianceQuickEdit()
    } catch (error) {
      console.error('Failed to update compliance item from warning card:', error)
      alert(error?.message || 'Failed to update compliance item.')
      setComplianceQuickEditSaving(false)
    }
  }

  // ── Dashboard transport stats fetch ──
  useEffect(() => {
    const fetchDashData = async () => {
      setDashLoading(true)
      try {
        const startOfMonth = Timestamp.fromDate(dashMonth)
        const startOfNext = Timestamp.fromDate(new Date(dashMonth.getFullYear(), dashMonth.getMonth() + 1, 1))
        const q = query(collection(db, 'transports'), where('departedAt', '>=', startOfMonth), where('departedAt', '<', startOfNext), orderBy('departedAt', 'desc'))
        const snapshot = await getDocs(q)
        let data = snapshot.docs.map(d => ({ id: d.id, ...d.data() })).map(item => ({ ...item, site: normalizeTransportSite(item.site) }))
        data = data.filter(t => inTransportScope(t.site))
        data = data.filter(t => isCompletedTransport(t))
        if (dashSite !== 'ALL') data = data.filter(t => normalizeTransportSite(t.site) === dashSite)
        setDashTransports(data)
      } catch (error) {
        console.error('Error fetching dashboard data:', error)
        setDashTransports([])
      }
      setDashLoading(false)
    }
    fetchDashData()
  }, [dashMonth, dashSite, inTransportScope])

  const dashStats = useMemo(() => {
    const reasonCounts = {}, techCounts = {}, paperworkCounts = {}
    dashTransports.forEach(t => {
      if (t.reasons && t.reasons.length > 0) t.reasons.forEach(r => { reasonCounts[r] = (reasonCounts[r] || 0) + 1 })
      const bhtName = t.createdByName || 'Unknown'
      techCounts[bhtName] = (techCounts[bhtName] || 0) + 1
      const pw = t.dcPaperworkStatus || 'unknown'
      paperworkCounts[pw] = (paperworkCounts[pw] || 0) + 1
    })
    const sortDesc = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1])
    return { total: dashTransports.length, byReason: sortDesc(reasonCounts), byTech: sortDesc(techCounts), byPaperwork: sortDesc(paperworkCounts) }
  }, [dashTransports])

  // ── Drilldown handler ──
  const getMonthDateRange = useCallback((referenceDate = new Date()) => {
    const startOfMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1)
    const endOfMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0)
    return { startDate: toDateInputValue(startOfMonth), endDate: toDateInputValue(endOfMonth) }
  }, [])

  const handleDashboardDrilldown = (type, value = '') => {
    const { startDate: monthStartDate, endDate: monthEndDate } = getMonthDateRange(dashMonth)
    onDrilldownToTransports({
      startDate: monthStartDate, endDate: monthEndDate,
      site: dashSite, status: 'completed',
      reason: type === 'reason' && value ? value : '',
      driver: type === 'bht' && value ? value : ''
    })
  }

  // ── Scoped compliance ──
  const scopedComplianceItems = useMemo(
    () => complianceItems.filter(item => inComplianceScope(getComplianceItemSite(item))),
    [complianceItems, inComplianceScope]
  )
  const complianceSummary = useMemo(() => {
    const summary = { overdue: 0, upcoming: 0, current: 0, none: 0, total: 0 }
    scopedComplianceItems.forEach(item => {
      const status = getStatus(item.dueDate)
      if (status === 'overdue') summary.overdue += 1
      else if (status === 'upcoming') summary.upcoming += 1
      else if (status === 'current') summary.current += 1
      else summary.none += 1
    })
    summary.total = scopedComplianceItems.length
    return summary
  }, [scopedComplianceItems])

  // ── Queue filtering ──
  const locationMatchesQueueFilter = useCallback((locationId) => {
    if (queueLocationFilter === 'all') return true
    const normalizedFilter = String(queueLocationFilter || '').trim().toUpperCase()
    if (!normalizedFilter) return true
    const normalizedLocation = String(locationId || '').trim().toUpperCase()
    if (!normalizedLocation) return false
    const aliasedLocation = locationScopeAlias(normalizedLocation)
    return normalizedLocation === normalizedFilter || aliasedLocation === normalizedFilter
  }, [queueLocationFilter])

  const complianceMatchesQueueFilter = useCallback((item) => {
    if (queueLocationFilter === 'all') return true
    const normalizedFilter = String(queueLocationFilter || '').trim().toUpperCase()
    if (!normalizedFilter) return true
    const complianceSite = getComplianceItemSite(item)
    if (!complianceSite) return false
    if (complianceSite === normalizedFilter) return true
    const mappedFilterSite = normalizeComplianceSite(queueLocationFilter)
    return complianceSite === mappedFilterSite
  }, [queueLocationFilter])

  const filteredIssueQueue = useMemo(() => eocIssues.filter(issue => locationMatchesQueueFilter(issue.locationId)), [eocIssues, locationMatchesQueueFilter])
  const filteredOverdueTaskQueue = useMemo(() => eocOverdueTasks.filter(task => locationMatchesQueueFilter(task.locationId)), [eocOverdueTasks, locationMatchesQueueFilter])
  const filteredFleetOverdueQueue = useMemo(() => fleetOverdueTasks.filter(task => locationMatchesQueueFilter(task.mainLocation || task.locationId)), [fleetOverdueTasks, locationMatchesQueueFilter])
  const filteredFleetUpcomingQueue = useMemo(() => fleetUpcomingTasks.filter(task => locationMatchesQueueFilter(task.mainLocation || task.locationId)), [fleetUpcomingTasks, locationMatchesQueueFilter])
  const filteredAlertQueue = useMemo(() => [...eocAlerts, ...fleetAlerts, ...debriefAlerts]
    .filter(a => locationMatchesQueueFilter(a.mainLocation || a.locationId))
    .sort((a, b) => { const aMs = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0; const bMs = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0; return bMs - aMs }),
    [debriefAlerts, eocAlerts, fleetAlerts, locationMatchesQueueFilter])
  const filteredComplianceOverdueQueue = useMemo(() => scopedComplianceItems.filter(item => getStatus(item.dueDate) === 'overdue').filter(item => complianceMatchesQueueFilter(item)).sort((a, b) => getComplianceItemDueMs(a) - getComplianceItemDueMs(b)), [complianceMatchesQueueFilter, scopedComplianceItems])
  const filteredComplianceUpcomingQueue = useMemo(() => scopedComplianceItems.filter(item => getStatus(item.dueDate) === 'upcoming').filter(item => complianceMatchesQueueFilter(item)).sort((a, b) => getComplianceItemDueMs(a) - getComplianceItemDueMs(b)), [complianceMatchesQueueFilter, scopedComplianceItems])

  const queueCounts = {
    issues: filteredIssueQueue.length,
    overdue: filteredOverdueTaskQueue.length + filteredComplianceOverdueQueue.length + filteredFleetOverdueQueue.length,
    upcoming: filteredComplianceUpcomingQueue.length + filteredFleetUpcomingQueue.length,
    alerts: filteredAlertQueue.length
  }

  const hasQueueData = (
    eocIssues.length > 0 || eocOverdueTasks.length > 0 || fleetOverdueTasks.length > 0 ||
    fleetUpcomingTasks.length > 0 || eocAlerts.length > 0 || fleetAlerts.length > 0 || debriefAlerts.length > 0 ||
    complianceSummary.overdue > 0 || complianceSummary.upcoming > 0
  )

  const queueLocationOptions = useMemo(() => {
    const options = LOCATIONS.map(loc => ({ value: loc.id, label: loc.label }))
    const seenValues = new Set(options.map(o => String(o.value || '').trim().toUpperCase()))
    const discovered = new Set()
    const addMapped = (id) => { const m = locationScopeAlias(id); if (m) discovered.add(m) }
    eocIssues.forEach(i => addMapped(i.locationId))
    eocOverdueTasks.forEach(t => addMapped(t.locationId))
    eocAlerts.forEach(a => addMapped(a.locationId))
    debriefAlerts.forEach(a => addMapped(a.locationId))
    fleetOverdueTasks.forEach(t => addMapped(t.mainLocation || t.locationId))
    fleetUpcomingTasks.forEach(t => addMapped(t.mainLocation || t.locationId))
    fleetAlerts.forEach(a => addMapped(a.mainLocation || a.locationId))
    scopedComplianceItems.forEach(item => { const s = getComplianceItemSite(item); if (s) discovered.add(s) })
    ;[...discovered].sort().forEach(site => { if (seenValues.has(site)) return; options.push({ value: site, label: `Location: ${site}` }); seenValues.add(site) })
    return options
  }, [debriefAlerts, eocAlerts, eocIssues, eocOverdueTasks, fleetAlerts, fleetOverdueTasks, fleetUpcomingTasks, scopedComplianceItems])

  // ── Render ──
  return (
    <div>
      {/* EOC + Compliance + Fleet Status Queue */}
      {hasQueueData && (
        <div style={{ backgroundColor: '#FFFFFF', borderRadius: '12px', padding: '20px', marginBottom: '20px', border: '1px solid #D8D1C6' }}>
          <h3 style={{ margin: '0 0 14px 0', fontSize: '16px', color: 'var(--text-primary)' }}>EOC + Compliance + Fleet Status</h3>

          {/* KPI cards */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
            <button onClick={() => setQueueView('issues')} style={{ padding: '10px 20px', backgroundColor: 'rgba(255,87,34,0.15)', borderRadius: '8px', textAlign: 'center', border: queueView === 'issues' ? '2px solid #B75E54' : '1px solid rgba(255,87,34,0.3)', cursor: 'pointer', color: 'inherit' }}>
              <div style={{ fontSize: '12px', color: '#B75E54' }}>Open Issues</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#B75E54' }}>{eocIssues.length}</div>
            </button>
            <button onClick={() => setQueueView('overdue')} style={{ padding: '10px 20px', backgroundColor: 'rgba(255,152,0,0.15)', borderRadius: '8px', textAlign: 'center', border: queueView === 'overdue' ? '2px solid #B07A28' : '1px solid rgba(255,152,0,0.3)', cursor: 'pointer', color: 'inherit' }}>
              <div style={{ fontSize: '12px', color: '#B07A28' }}>Overdue Tasks</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#B07A28' }}>{queueCounts.overdue}</div>
            </button>
            <button onClick={() => setQueueView('upcoming')} style={{ padding: '10px 20px', backgroundColor: 'rgba(76,175,80,0.15)', borderRadius: '8px', textAlign: 'center', border: queueView === 'upcoming' ? '2px solid #2F7D57' : '1px solid rgba(76,175,80,0.3)', cursor: 'pointer', color: 'inherit' }}>
              <div style={{ fontSize: '12px', color: '#2F7D57' }}>Upcoming Tasks</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#2F7D57' }}>{queueCounts.upcoming}</div>
            </button>
            <button onClick={() => setQueueView('alerts')} style={{ padding: '10px 20px', backgroundColor: 'rgba(33,150,243,0.15)', borderRadius: '8px', textAlign: 'center', border: queueView === 'alerts' ? '2px solid #2196F3' : '1px solid rgba(33,150,243,0.3)', cursor: 'pointer', color: 'inherit' }}>
              <div style={{ fontSize: '12px', color: '#64B5F6' }}>Unread Alerts</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#64B5F6' }}>{queueCounts.alerts}</div>
            </button>
          </div>

          {/* Queue controls */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px', marginBottom: '12px' }}>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Queue</label>
              <select value={queueView} onChange={(e) => setQueueView(e.target.value)} style={selectStyle}>
                <option value="issues">Active Issues ({queueCounts.issues})</option>
                <option value="overdue">Overdue Tasks ({queueCounts.overdue})</option>
                <option value="upcoming">Upcoming Tasks ({queueCounts.upcoming})</option>
                <option value="alerts">Unread Alerts ({queueCounts.alerts})</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Location</label>
              <select value={queueLocationFilter} onChange={(e) => setQueueLocationFilter(e.target.value)} style={selectStyle}>
                <option value="all">All Locations</option>
                {queueLocationOptions.map(option => (<option key={option.value} value={option.value}>{option.label}</option>))}
              </select>
            </div>
          </div>

          {/* Queue list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* Issues */}
            {queueView === 'issues' && filteredIssueQueue.length === 0 && (<div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>No active issues for this filter.</div>)}
            {queueView === 'issues' && filteredIssueQueue.map(issue => (
              <div key={issue.id} style={{ padding: '12px', borderRadius: '8px', border: issue.severity === 'high' ? '2px solid #B75E54' : '1px solid rgba(17,47,82,0.14)', backgroundColor: 'rgba(17,47,82,0.06)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontWeight: 700, fontSize: '14px' }}>{issue.label}</span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <span className={`chip severity-${issue.severity}`} style={{ fontSize: '11px', textTransform: 'capitalize' }}>{issue.severity}</span>
                    <span className="chip" style={{ fontSize: '11px', textTransform: 'uppercase' }}>{issue.status || 'open'}</span>
                  </div>
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>{issue.description}</div>
                <div style={{ fontSize: '12px', color: '#556677', marginBottom: '8px' }}>
                  {LOCATIONS.find(l => l.id === issue.locationId)?.label || issue.locationId} &bull; {issue.reportedByName}
                  {issue.vanId ? ` · ${VANS.find(v => v.id === issue.vanId)?.label || issue.vanId}` : ''}
                </div>
                {(issue.status === 'open' || issue.status === 'in_progress') && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <input className="input" placeholder="Add action taken, current status, and next step..." value={getIssueActionNote(issue.id)} onChange={e => updateIssueActionNote(issue.id, e.target.value)} style={{ width: '100%', padding: '6px 10px', fontSize: '13px' }} />
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      {issue.status === 'open' && (<button onClick={() => handleDashStartIssue(issue.id, getIssueActionNote(issue.id))} style={{ padding: '6px 14px', backgroundColor: 'rgba(17,47,82,0.10)', color: 'var(--text-primary)', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>In Progress</button>)}
                      <button onClick={() => handleDashResolveIssue(issue.id, getIssueActionNote(issue.id))} style={{ padding: '6px 14px', backgroundColor: '#2F7D57', color: 'white', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Resolve</button>
                      <button onClick={() => clearIssueActionNote(issue.id)} style={{ padding: '6px 14px', backgroundColor: 'rgba(17,47,82,0.10)', color: 'var(--text-secondary)', border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' }}>Clear Note</button>
                    </div>
                  </div>
                )}
                {issue.status === 'in_progress' && issue.inProgressByName && (<div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '6px' }}>In progress by {issue.inProgressByName}</div>)}
              </div>
            ))}

            {/* Overdue EOC tasks */}
            {queueView === 'overdue' && filteredOverdueTaskQueue.length === 0 && filteredComplianceOverdueQueue.length === 0 && filteredFleetOverdueQueue.length === 0 && (<div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>No overdue EOC, compliance, or fleet tasks for this filter.</div>)}
            {queueView === 'overdue' && filteredOverdueTaskQueue.map(task => (
              <div key={task.id} style={{ padding: '12px', borderRadius: '8px', border: '1px solid rgba(17,47,82,0.14)', backgroundColor: 'rgba(17,47,82,0.06)' }}>
                <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px' }}>
                  {task.taskType === 'house' ? 'House EOC' : `Van EOC (${VANS.find(v => v.id === task.vanId)?.label || task.vanId || 'Van'})`}
                </div>
                <div style={{ fontSize: '12px', color: '#556677', marginBottom: '8px' }}>
                  {LOCATIONS.find(l => l.id === task.locationId)?.label || task.locationId} &bull; {getShiftLabel(task.shiftId)} &bull; Due {task.dueDate} &bull; Eligible {Array.isArray(task.eligibleUserIds) ? task.eligibleUserIds.length : (task.assigneeUserId ? 1 : 0)}
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button onClick={() => openOverdueTaskIgnore(task)} style={{ padding: '6px 14px', backgroundColor: 'rgba(255,152,0,0.16)', color: '#FFB74D', border: '1px solid rgba(255,152,0,0.35)', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Ignore Task</button>
                  <button onClick={() => onNavigateTab('users')} style={{ padding: '6px 14px', backgroundColor: 'rgba(33,150,243,0.15)', color: '#90CAF9', border: '1px solid rgba(33,150,243,0.35)', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Manage Users</button>
                </div>
                {overdueTaskActionId === task.id && overdueTaskActionMode === 'ignore' && (
                  <div style={{ marginTop: '10px', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,152,0,0.35)', backgroundColor: 'rgba(255,152,0,0.08)' }}>
                    <div style={{ fontSize: '12px', color: '#FFB74D', marginBottom: '8px', fontWeight: 700 }}>Ignore overdue task (audit reason required)</div>
                    <textarea value={overdueTaskActionReason} onChange={(event) => setOverdueTaskActionReason(event.target.value)} placeholder="Add why this is being ignored and who approved or confirmed it..." rows={2} style={{ width: '100%', padding: '8px 10px', border: '2px solid rgba(17,47,82,0.20)', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box', backgroundColor: 'rgba(17,47,82,0.10)', color: 'var(--text-primary)' }} />
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                      <button onClick={() => handleOverdueTaskIgnore(task)} disabled={overdueTaskActionSubmitting} style={{ padding: '6px 14px', backgroundColor: overdueTaskActionSubmitting ? 'rgba(17,47,82,0.14)' : '#B07A28', color: overdueTaskActionSubmitting ? 'var(--text-secondary)' : '#1f2933', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: overdueTaskActionSubmitting ? 'not-allowed' : 'pointer' }}>Confirm Ignore</button>
                      <button onClick={resetOverdueTaskActionState} disabled={overdueTaskActionSubmitting} style={{ padding: '6px 14px', backgroundColor: 'rgba(17,47,82,0.10)', color: 'var(--text-secondary)', border: 'none', borderRadius: '6px', fontSize: '13px', cursor: overdueTaskActionSubmitting ? 'not-allowed' : 'pointer' }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Overdue compliance items */}
            {queueView === 'overdue' && filteredComplianceOverdueQueue.map(item => (
              <div key={`compliance-overdue-${item.id}`} style={{ padding: '12px', borderRadius: '8px', border: '1px solid rgba(244,67,54,0.35)', backgroundColor: 'rgba(244,67,54,0.08)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ fontWeight: 700, fontSize: '14px' }}>Compliance: {formatComplianceCategory(item.category)}</span>
                  <span className="chip" style={{ fontSize: '11px', color: '#B75E54', border: '1px solid rgba(244,67,54,0.45)', backgroundColor: 'rgba(244,67,54,0.08)' }}>OVERDUE</span>
                </div>
                <div style={{ fontSize: '12px', color: '#556677', marginBottom: '8px' }}>
                  {item.employeeName || 'Unknown employee'} &bull; {formatComplianceSiteLabel(getComplianceItemSite(item))} &bull; Due {formatDate(item.dueDate)}
                </div>
                {item.notes && (<div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Notes: {item.notes}</div>)}
                {complianceQuickEditId === item.id ? (
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(150px, 1fr))', gap: '8px', marginTop: '8px' }}>
                    <div><label style={{ fontSize: '11px', color: '#556677', display: 'block', marginBottom: '4px' }}>Last Completed</label><input type="date" value={complianceQuickEditForm.lastCompleted} onChange={(e) => setComplianceQuickEditForm(prev => ({ ...prev, lastCompleted: e.target.value }))} style={{ width: '100%', padding: '8px', border: '1px solid #C9D3DD', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }} /></div>
                    <div><label style={{ fontSize: '11px', color: '#556677', display: 'block', marginBottom: '4px' }}>Next Due Date *</label><input type="date" value={complianceQuickEditForm.dueDate} onChange={(e) => setComplianceQuickEditForm(prev => ({ ...prev, dueDate: e.target.value }))} style={{ width: '100%', padding: '8px', border: '1px solid #C9D3DD', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }} /></div>
                    <div><label style={{ fontSize: '11px', color: '#556677', display: 'block', marginBottom: '4px' }}>Notes</label><input value={complianceQuickEditForm.notes} onChange={(e) => setComplianceQuickEditForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="Add document/status details or follow-up needed..." style={{ width: '100%', padding: '8px', border: '1px solid #C9D3DD', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }} /></div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button onClick={() => handleComplianceQuickSave(item)} disabled={complianceQuickEditSaving} style={{ padding: '6px 14px', backgroundColor: complianceQuickEditSaving ? '#E6E9ED' : '#2F7D57', color: complianceQuickEditSaving ? '#7A8795' : '#FFFFFF', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: complianceQuickEditSaving ? 'not-allowed' : 'pointer' }}>{complianceQuickEditSaving ? 'Saving...' : 'Save Update'}</button>
                      <button onClick={cancelComplianceQuickEdit} disabled={complianceQuickEditSaving} style={{ padding: '6px 14px', backgroundColor: '#F1EFEA', color: '#1F3A52', border: '1px solid #C9D3DD', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: complianceQuickEditSaving ? 'not-allowed' : 'pointer' }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button onClick={() => openComplianceQuickEdit(item)} style={{ padding: '6px 14px', backgroundColor: '#2F7D57', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>Quick Update</button>
                    <button onClick={() => onNavigateTab('compliance')} style={{ padding: '6px 14px', backgroundColor: '#F1EFEA', color: '#1F3A52', border: '1px solid #C9D3DD', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>Open Compliance Tab</button>
                  </div>
                )}
              </div>
            ))}

            {/* Overdue fleet tasks */}
            {queueView === 'overdue' && filteredFleetOverdueQueue.map(task => (
              <div key={`fleet-overdue-${task.id}`} style={{ padding: '12px', borderRadius: '8px', border: '1px solid rgba(183,94,84,0.38)', backgroundColor: 'rgba(183,94,84,0.08)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontWeight: 700, fontSize: '14px' }}>Fleet: {getFleetTaskTypeLabel(task.taskType)}</span>
                  <span className="chip" style={{ fontSize: '11px', color: '#B75E54', border: '1px solid rgba(183,94,84,0.4)', backgroundColor: 'rgba(183,94,84,0.12)' }}>OVERDUE</span>
                </div>
                <div style={{ fontSize: '12px', color: '#556677', marginBottom: '8px' }}>
                  {formatFleetVehicleLabel(task)} &bull; {task.title || getFleetTaskTypeLabel(task.taskType)} &bull; {formatFleetDueLabel(task)} &bull; {formatFleetCurrentLabel(task)}
                </div>
                <button onClick={() => onNavigateTab('fleet')} style={{ padding: '6px 14px', backgroundColor: '#F1EFEA', color: '#1F3A52', border: '1px solid #C9D3DD', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>Open Fleet Tab</button>
              </div>
            ))}

            {/* Upcoming compliance + fleet */}
            {queueView === 'upcoming' && filteredComplianceUpcomingQueue.length === 0 && filteredFleetUpcomingQueue.length === 0 && (<div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>No upcoming compliance or fleet tasks for this filter.</div>)}
            {queueView === 'upcoming' && filteredComplianceUpcomingQueue.map(item => (
              <div key={`compliance-upcoming-${item.id}`} style={{ padding: '12px', borderRadius: '8px', border: '1px solid rgba(76,175,80,0.35)', backgroundColor: 'rgba(76,175,80,0.08)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ fontWeight: 700, fontSize: '14px' }}>Compliance: {formatComplianceCategory(item.category)}</span>
                  <span className="chip" style={{ fontSize: '11px', color: '#2F7D57', border: '1px solid rgba(76,175,80,0.45)', backgroundColor: 'rgba(76,175,80,0.08)' }}>DUE SOON</span>
                </div>
                <div style={{ fontSize: '12px', color: '#556677', marginBottom: '8px' }}>
                  {item.employeeName || 'Unknown employee'} &bull; {formatComplianceSiteLabel(getComplianceItemSite(item))} &bull; Due {formatDate(item.dueDate)}
                </div>
                {item.notes && (<div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Notes: {item.notes}</div>)}
                {complianceQuickEditId === item.id ? (
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(150px, 1fr))', gap: '8px', marginTop: '8px' }}>
                    <div><label style={{ fontSize: '11px', color: '#556677', display: 'block', marginBottom: '4px' }}>Last Completed</label><input type="date" value={complianceQuickEditForm.lastCompleted} onChange={(e) => setComplianceQuickEditForm(prev => ({ ...prev, lastCompleted: e.target.value }))} style={{ width: '100%', padding: '8px', border: '1px solid #C9D3DD', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }} /></div>
                    <div><label style={{ fontSize: '11px', color: '#556677', display: 'block', marginBottom: '4px' }}>Next Due Date *</label><input type="date" value={complianceQuickEditForm.dueDate} onChange={(e) => setComplianceQuickEditForm(prev => ({ ...prev, dueDate: e.target.value }))} style={{ width: '100%', padding: '8px', border: '1px solid #C9D3DD', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }} /></div>
                    <div><label style={{ fontSize: '11px', color: '#556677', display: 'block', marginBottom: '4px' }}>Notes</label><input value={complianceQuickEditForm.notes} onChange={(e) => setComplianceQuickEditForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="Add document/status details or follow-up needed..." style={{ width: '100%', padding: '8px', border: '1px solid #C9D3DD', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }} /></div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button onClick={() => handleComplianceQuickSave(item)} disabled={complianceQuickEditSaving} style={{ padding: '6px 14px', backgroundColor: complianceQuickEditSaving ? '#E6E9ED' : '#2F7D57', color: complianceQuickEditSaving ? '#7A8795' : '#FFFFFF', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: complianceQuickEditSaving ? 'not-allowed' : 'pointer' }}>{complianceQuickEditSaving ? 'Saving...' : 'Save Update'}</button>
                      <button onClick={cancelComplianceQuickEdit} disabled={complianceQuickEditSaving} style={{ padding: '6px 14px', backgroundColor: '#F1EFEA', color: '#1F3A52', border: '1px solid #C9D3DD', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: complianceQuickEditSaving ? 'not-allowed' : 'pointer' }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button onClick={() => openComplianceQuickEdit(item)} style={{ padding: '6px 14px', backgroundColor: '#2F7D57', color: '#FFFFFF', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>Quick Update</button>
                    <button onClick={() => onNavigateTab('compliance')} style={{ padding: '6px 14px', backgroundColor: '#F1EFEA', color: '#1F3A52', border: '1px solid #C9D3DD', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>Open Compliance Tab</button>
                  </div>
                )}
              </div>
            ))}

            {queueView === 'upcoming' && filteredFleetUpcomingQueue.map(task => (
              <div key={`fleet-upcoming-${task.id}`} style={{ padding: '12px', borderRadius: '8px', border: '1px solid rgba(76,175,80,0.35)', backgroundColor: 'rgba(76,175,80,0.08)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontWeight: 700, fontSize: '14px' }}>Fleet: {getFleetTaskTypeLabel(task.taskType)}</span>
                  <span className="chip" style={{ fontSize: '11px', color: '#2F7D57', border: '1px solid rgba(76,175,80,0.45)', backgroundColor: 'rgba(76,175,80,0.08)' }}>DUE SOON</span>
                </div>
                <div style={{ fontSize: '12px', color: '#556677', marginBottom: '8px' }}>
                  {formatFleetVehicleLabel(task)} &bull; {task.title || getFleetTaskTypeLabel(task.taskType)} &bull; {formatFleetDueLabel(task)} &bull; {formatFleetCurrentLabel(task)}
                </div>
                <button onClick={() => onNavigateTab('fleet')} style={{ padding: '6px 14px', backgroundColor: '#F1EFEA', color: '#1F3A52', border: '1px solid #C9D3DD', borderRadius: '6px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>Open Fleet Tab</button>
              </div>
            ))}

            {/* Alerts */}
            {queueView === 'alerts' && filteredAlertQueue.length === 0 && (<div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>No unread alerts for this filter.</div>)}
            {queueView === 'alerts' && filteredAlertQueue.map(alertItem => (
              <div key={alertItem.id} style={{ padding: '12px', borderRadius: '8px', border: '1px solid rgba(17,47,82,0.14)', backgroundColor: 'rgba(17,47,82,0.06)' }}>
                <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px' }}>{formatAlertTypeLabel(alertItem.type)}</div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px' }}>{alertItem.message || '(no message)'}</div>
                <div style={{ fontSize: '12px', color: '#556677', marginBottom: '8px' }}>
                  {LOCATIONS.find(l => l.id === alertItem.locationId)?.label || alertItem.locationId || 'Unknown location'} &bull; {formatDate(alertItem.createdAt)} {formatTime(alertItem.createdAt)}
                  {(alertItem.bhtName || alertItem.techName) ? ` · ${alertItem.bhtName || alertItem.techName}` : ''}
                </div>
                <button onClick={() => handleMarkAlertRead(alertItem.id)} style={{ padding: '6px 14px', backgroundColor: '#2196F3', color: 'white', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>Mark Read</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transport stats section */}
      <div style={{ backgroundColor: '#FFFFFF', borderRadius: '12px', padding: '20px', marginBottom: '20px', border: '1px solid #D8D1C6' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', alignItems: 'center' }}>
          <div>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Month</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button onClick={() => setDashMonth(new Date(dashMonth.getFullYear(), dashMonth.getMonth() - 1, 1))} style={{ padding: '8px 12px', backgroundColor: '#CD4E42', color: 'white', border: 'none', borderRadius: '6px', fontSize: '16px', cursor: 'pointer' }}>&lt;</button>
              <span style={{ fontSize: '14px', fontWeight: 'bold', minWidth: '140px', textAlign: 'center' }}>{dashMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
              <button onClick={() => setDashMonth(new Date(dashMonth.getFullYear(), dashMonth.getMonth() + 1, 1))} style={{ padding: '8px 12px', backgroundColor: '#CD4E42', color: 'white', border: 'none', borderRadius: '6px', fontSize: '16px', cursor: 'pointer' }}>&gt;</button>
            </div>
          </div>
          <div>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Location</label>
            <select value={dashSite} onChange={(e) => setDashSite(e.target.value)} style={{ width: '100%', padding: '8px', border: '2px solid #eee', borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box' }}>
              <option value="ALL">All Locations</option>
              {MAIN_LOCATIONS.map(locationId => (<option key={locationId} value={locationId}>{locationId}</option>))}
            </select>
          </div>
        </div>
      </div>

      {dashLoading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#556677' }}>Loading stats...</div>
      ) : dashStats.total === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#556677' }}>No transports in this period</div>
      ) : (
        <>
          <button type="button" className="glass-card" onClick={() => handleDashboardDrilldown('total')} style={{ width: '100%', backgroundColor: '#FFFFFF', borderRadius: '12px', padding: '20px', marginBottom: '20px', border: '1px solid #D8D1C6', textAlign: 'center', cursor: 'pointer' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Total Transports</div>
            <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#CD4E42' }}>{dashStats.total}</div>
          </button>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '20px' }}>
            <div className="glass-card" style={{ backgroundColor: '#FFFFFF', borderRadius: '12px', padding: '20px', border: '1px solid #D8D1C6' }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', color: 'var(--text-primary)' }}>By Reason</h3>
              {dashStats.byReason.length === 0 ? (<div style={{ color: '#556677', fontSize: '14px' }}>No reasons recorded</div>) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {dashStats.byReason.map(([reason, count]) => (
                    <button key={reason} type="button" onClick={() => handleDashboardDrilldown('reason', reason)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', backgroundColor: '#F8F5F1', borderRadius: '6px', border: '1px solid #D8D1C6', cursor: 'pointer' }}>
                      <span style={{ fontSize: '14px' }}>{reason}</span>
                      <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#CD4E42' }}>{count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="glass-card" style={{ backgroundColor: '#FFFFFF', borderRadius: '12px', padding: '20px', border: '1px solid #D8D1C6' }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', color: 'var(--text-primary)' }}>By BHT</h3>
              {dashStats.byTech.length === 0 ? (<div style={{ color: '#556677', fontSize: '14px' }}>No BHT activity recorded</div>) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {dashStats.byTech.map(([tech, count]) => (
                    <button key={tech} type="button" onClick={() => handleDashboardDrilldown('bht', tech)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', backgroundColor: '#F8F5F1', borderRadius: '6px', border: '1px solid #D8D1C6', cursor: 'pointer' }}>
                      <span style={{ fontSize: '14px' }}>{tech}</span>
                      <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#CD4E42' }}>{count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="glass-card" style={{ backgroundColor: '#FFFFFF', borderRadius: '12px', padding: '20px', border: '1px solid #D8D1C6' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', color: 'var(--text-primary)' }}>DC Paperwork</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
              {dashStats.byPaperwork.map(([status, count]) => (
                <div key={status} style={{ padding: '10px 20px', backgroundColor: status === 'collected' ? 'rgba(76,175,80,0.15)' : status === 'N/A' ? 'rgba(17,47,82,0.06)' : status === 'unknown' ? 'rgba(255,152,0,0.15)' : 'rgba(229,57,53,0.15)', borderRadius: '8px', textAlign: 'center' }}>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{status}</div>
                  <div style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--text-primary)' }}>{count}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
