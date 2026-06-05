import { useEffect, useState } from 'react'
import { getShiftById, LOCATIONS, VANS } from '../data/eocConstants'
import { BHT_HOME_ISSUE_TYPES } from '../services/bhtIssueReportService'
import useEocAssignments from '../hooks/useEocAssignments'
import useEocTasks from '../hooks/useEocTasks'
import { getCurrentCycleDueDate } from '../utils/eocSchedule'
import { notifyWarning } from '../utils/toast'
import AppModal from './AppModal'

const LOCAL_REMINDER_INTERVAL_MS = 60 * 60 * 1000

function BhtHub({
  user,
  transports,
  isOffline = false,
  issueUpdates = [],
  focusedIssueUpdateId = null,
  onNewTransport,
  onContinueTransport,
  onStartEoc,
  onReportIssue,
  onAddDebriefNote,
  onEditDebrief,
  onDebriefAssignmentChange,
  debriefSummary = { available: false, status: 'none', itemCount: 0 },
  debriefAlerts = [],
  onNavigateToDebrief
}) {
  const { assignment, loading: assignmentLoading } = useEocAssignments(user)
  const { tasks, loading: tasksLoading } = useEocTasks(user, assignment)
  const [issueModalOpen, setIssueModalOpen] = useState(false)
  const [issueForm, setIssueForm] = useState({
    issueType: BHT_HOME_ISSUE_TYPES[0].value,
    description: '',
    vanId: ''
  })
  const [issueError, setIssueError] = useState('')
  const [issueSubmitting, setIssueSubmitting] = useState(false)

  const hasAssignment = !!assignment

  useEffect(() => {
    onDebriefAssignmentChange?.(assignment || null)
  }, [assignment, onDebriefAssignmentChange])

  const toDate = (value) => {
    if (!value) return null
    if (typeof value?.toDate === 'function') return value.toDate()
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }

  const isSameDay = (a, b) => (
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  )

  const isActiveTransport = (transport) => {
    const status = String(transport?.status || '').trim().toLowerCase()
    return status === 'open' || status === 'arrived'
  }

  const isEndedTransport = (transport) => {
    const status = String(transport?.status || '').trim().toLowerCase()
    return status === 'closed' || status === 'returned'
  }

  const getTransportEndedAt = (transport) => (
    toDate(transport?.closedAt)
    || toDate(transport?.returnedAt)
    || toDate(transport?.updatedAt)
    || toDate(transport?.departedAt)
  )

  const formatActivityTime = (value) => {
    const date = toDate(value)
    if (!date) return '--:--'
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  const formatDateTime = (timestamp) => {
    if (!timestamp) return 'Unknown time'
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
    return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

  // --- Compute transport state ---
  const currentTransport = transports.find(isActiveTransport) || null
  const hasCurrentTransport = !!currentTransport

  const handlePrimaryTransportAction = () => {
    if (hasCurrentTransport) {
      onContinueTransport(currentTransport.id)
      return
    }
    onNewTransport()
  }

  // --- Compute EOC state ---
  const shiftConfig = hasAssignment ? getShiftById(assignment.shiftId) : null
  const currentCycleDueDate = shiftConfig ? getCurrentCycleDueDate(shiftConfig) : null
  const currentCycleTasks = hasAssignment
    ? tasks.filter(t =>
      t.locationId === assignment.locationId &&
      t.shiftId === assignment.shiftId &&
      (!currentCycleDueDate || t.dueDate === currentCycleDueDate))
    : []

  const currentCycleHouseTasks = currentCycleTasks.filter(t => t.taskType === 'house')
  const currentCycleVanTasks = currentCycleTasks.filter(t => t.taskType === 'van')

  const getPriorityTask = (taskList) => {
    const actionable = taskList.filter(t => t.status === 'pending' || t.status === 'overdue')
    if (actionable.length === 0) return null
    const priority = (task) => (task.status === 'overdue' ? 0 : 1)
    return [...actionable].sort((a, b) => {
      const pDelta = priority(a) - priority(b)
      if (pDelta !== 0) return pDelta
      return String(a.dueDate || '').localeCompare(String(b.dueDate || ''))
    })[0]
  }

  const houseTask = getPriorityTask(currentCycleHouseTasks)
  const vanTask = getPriorityTask(currentCycleVanTasks)
  const houseCompleted = !houseTask && currentCycleHouseTasks.some(t => t.status === 'completed')
  const vanCompleted = !vanTask && currentCycleVanTasks.some(t => t.status === 'completed')

  // --- Completed transports today ---
  const today = new Date()
  const completedTodayTransports = transports
    .filter(isEndedTransport)
    .map((transport) => ({ ...transport, __endedAt: getTransportEndedAt(transport) }))
    .filter((transport) => transport.__endedAt && isSameDay(transport.__endedAt, today))
    .sort((a, b) => b.__endedAt.getTime() - a.__endedAt.getTime())

  // --- Helpers for action row status ---
  const getEocStatus = (task, completed) => {
    if (task?.status === 'overdue') return { label: 'Overdue - tap to complete', className: 'hub-action-subtitle-urgent', rowClass: 'hub-action-row-urgent' }
    if (task?.status === 'pending') return { label: 'Due today', className: 'hub-action-subtitle-warning', rowClass: 'hub-action-row-ready' }
    if (completed) return { label: 'Completed', className: 'hub-action-subtitle-done', rowClass: 'hub-action-row-done' }
    return { label: 'No tasks', className: '', rowClass: '' }
  }

  const vanStatus = getEocStatus(vanTask, vanCompleted)
  const houseStatus = getEocStatus(houseTask, houseCompleted)
  const pendingIncomingHandoffs = debriefAlerts
    .filter(alert => alert.type === 'shift_debrief_submitted')
    .filter(alert => alert.targetUserId === user?.id)
  const debriefAvailable = debriefSummary?.available === true
  const debriefSubmitted = debriefSummary?.status === 'submitted'
  const debriefHasDraft = debriefSummary?.status === 'draft'
  const debriefItemCount = debriefSummary?.itemCount || 0

  const locationLabel = hasAssignment
    ? (LOCATIONS.find(l => l.id === assignment.locationId)?.label || assignment.locationId || '')
    : ''

  const firstName = String(user?.name || '').split(' ')[0]
  const assignedVanIds = [
    ...(Array.isArray(assignment?.vanIds) ? assignment.vanIds : []),
    ...(Array.isArray(user?.vanIds) ? user.vanIds : []),
    assignment?.vanId,
    user?.vanId
  ]
    .map(vanId => String(vanId || '').trim())
    .filter(Boolean)
    .filter((vanId, index, all) => all.indexOf(vanId) === index)
  const issueIsVan = issueForm.issueType === 'van_vehicle'
  const selectedIssueVanId = issueForm.vanId || (assignedVanIds.length === 1 ? assignedVanIds[0] : '')

  const resetIssueForm = () => {
    setIssueForm({
      issueType: BHT_HOME_ISSUE_TYPES[0].value,
      description: '',
      vanId: assignedVanIds.length === 1 ? assignedVanIds[0] : ''
    })
    setIssueError('')
    setIssueSubmitting(false)
  }

  const openIssueReport = () => {
    resetIssueForm()
    setIssueModalOpen(true)
  }

  const closeIssueReport = () => {
    if (issueSubmitting) return
    setIssueModalOpen(false)
    setIssueError('')
  }

  const updateIssueType = (issueType) => {
    const nextIsVan = issueType === 'van_vehicle'
    setIssueError('')
    setIssueForm(prev => ({
      ...prev,
      issueType,
      vanId: nextIsVan
        ? (assignedVanIds.length === 1 ? assignedVanIds[0] : '')
        : ''
    }))
  }

  const submitIssueReport = async (event) => {
    event?.preventDefault()
    const description = String(issueForm.description || '').trim()
    const vanId = issueIsVan ? selectedIssueVanId : ''

    if (!issueForm.issueType) {
      setIssueError('Choose the issue type.')
      return
    }
    if (issueIsVan && !vanId) {
      setIssueError('Choose the van for this issue.')
      return
    }
    if (!description) {
      setIssueError('Describe the issue before submitting.')
      return
    }
    if (!onReportIssue) {
      setIssueError('Issue reporting is not available right now.')
      return
    }

    setIssueSubmitting(true)
    setIssueError('')
    try {
      await onReportIssue({
        issueType: issueForm.issueType,
        description,
        vanId,
        assignment
      })
      setIssueModalOpen(false)
      resetIssueForm()
    } catch (err) {
      console.error('Issue report failed:', err)
      setIssueError(err?.message || 'Failed to submit issue. Please try again.')
    } finally {
      setIssueSubmitting(false)
    }
  }

  useEffect(() => {
    if (!focusedIssueUpdateId) return
    const timerId = setTimeout(() => {
      const updateEl = document.getElementById(`issue-update-${focusedIssueUpdateId}`)
      updateEl?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
    return () => clearTimeout(timerId)
  }, [focusedIssueUpdateId])

  useEffect(() => {
    const remindIfDue = () => {
      const nowMs = Date.now()
      const reminderItems = [
        ...tasks
          .filter(task => task.status === 'overdue')
          .map(task => ({
            key: `eoc:${task.id}`,
            message: `${task.taskType === 'van' ? 'Van' : 'House'} EOC is overdue. Please complete it when safe.`
          })),
        ...pendingIncomingHandoffs.map(alert => ({
          key: `handoff:${alert.id}`,
          message: 'Incoming shift handoff is waiting for your review and initials.'
        }))
      ]

      reminderItems.forEach(item => {
        const storageKey = `sprc:bht-reminder:${item.key}`
        const lastShownMs = Number(localStorage.getItem(storageKey) || 0)
        if (lastShownMs && nowMs - lastShownMs < LOCAL_REMINDER_INTERVAL_MS) return
        localStorage.setItem(storageKey, String(nowMs))
        notifyWarning(item.message, 5200)
      })
    }

    remindIfDue()
    const intervalId = window.setInterval(remindIfDue, 60 * 1000)
    return () => window.clearInterval(intervalId)
  }, [pendingIncomingHandoffs, tasks])

  if (assignmentLoading || tasksLoading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#556677' }}>
        <div style={{ fontSize: '28px', marginBottom: '12px', opacity: 0.5 }}>⏳</div>
        <div style={{ fontSize: '15px', fontWeight: 600 }}>Loading your shift...</div>
        <div style={{ fontSize: '13px', marginTop: '6px', opacity: 0.7 }}>Checking assignments and tasks</div>
      </div>
    )
  }

  if (!hasAssignment) {
    return (
      <div style={{ padding: '16px', maxWidth: '600px', margin: '0 auto' }}>
        {renderIssueUpdates()}
        <div className="glass-card" style={{
          textAlign: 'center',
          padding: '40px 20px',
          border: '2px solid rgba(255,152,0,0.3)'
        }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>!</div>
          <h3 style={{ color: '#B07A28', marginBottom: '8px', fontSize: '18px' }}>No active assignment</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '15px', lineHeight: '1.5' }}>
            Contact your supervisor to get assigned to a location, shift, and van.
          </p>
        </div>
      </div>
    )
  }

  function renderIssueUpdates() {
    if (issueUpdates.length === 0) return null
    return (
      <div className="glass-card" style={{ marginBottom: '16px', padding: '14px 16px' }}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '10px' }}>
          Issue updates
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {issueUpdates.map(update => (
            <div
              key={update.id}
              id={`issue-update-${update.id}`}
              className="issue-update-card"
              style={focusedIssueUpdateId === update.id ? { border: '3px solid #CD4E42' } : undefined}
            >
              <div className={`issue-update-status ${update.status === 'resolved' ? 'issue-update-status-resolved' : 'issue-update-status-progress'}`}>
                {update.status === 'resolved' ? 'Resolved' : 'In progress'}
              </div>
              <div style={{ fontSize: '14px', color: 'var(--text-primary)', marginBottom: '4px' }}>
                {update.message || 'Issue status updated.'}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                {update.statusNote || 'No note provided.'}
              </div>
              <div style={{ fontSize: '11px', color: '#556677', marginTop: '4px' }}>
                {formatDateTime(update.createdAt)}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '16px', maxWidth: '600px', margin: '0 auto' }}>
      {/* Greeting */}
      <div className="hub-greeting">Hi, {firstName}</div>
      <div className="hub-context">{locationLabel}</div>

      {/* Issue updates */}
      {renderIssueUpdates()}

      {pendingIncomingHandoffs.length > 0 && (
        <div className="glass-card" style={{ marginBottom: '16px', padding: '14px 16px', border: '2px solid rgba(176,122,40,0.34)' }}>
          <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '8px' }}>
            Incoming handoff pending
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {pendingIncomingHandoffs.map(alert => (
              <button
                key={alert.id}
                className="hub-action-row hub-action-row-ready"
                onClick={() => onNavigateToDebrief?.(alert)}
                style={{ margin: 0 }}
              >
                <div className="hub-action-icon hub-action-icon-house">D</div>
                <div className="hub-action-info">
                  <div className="hub-action-title">Review handoff</div>
                  <div className="hub-action-subtitle">
                    Complete your checklist and initials.
                  </div>
                </div>
                <div className="hub-action-chevron">&gt;</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main action rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
        {/* Transport action */}
        <button
          className={`hub-action-row ${hasCurrentTransport ? 'hub-action-row-urgent' : 'hub-action-row-ready'}`}
          onClick={handlePrimaryTransportAction}
        >
          <div className="hub-action-icon hub-action-icon-transport">
            {'\u{1F697}'}
          </div>
          <div className="hub-action-info">
            <div className="hub-action-title">
              {hasCurrentTransport ? 'Continue transport' : 'Start transport'}
            </div>
            <div className={`hub-action-subtitle ${hasCurrentTransport ? 'hub-action-subtitle-urgent' : ''}`}>
              {hasCurrentTransport
                ? `${currentTransport.clients?.[0] || 'In progress'} - tap to continue`
                : 'No active transport'}
            </div>
          </div>
          <div className="hub-action-chevron">›</div>
        </button>

        {/* Quick issue report */}
        <button
          className="hub-action-row hub-action-row-ready"
          onClick={openIssueReport}
        >
          <div className="hub-action-icon hub-action-icon-house">
            {'!'}
          </div>
          <div className="hub-action-info">
            <div className="hub-action-title">
              Report issue
            </div>
            <div className="hub-action-subtitle">
              {isOffline ? 'Saves on this device until online' : 'Notify supervisor/admin'}
            </div>
          </div>
          <div className="hub-action-chevron">&gt;</div>
        </button>

        {/* Shift Debrief quick note */}
        {debriefAvailable && (
          <button
            className="hub-action-row hub-action-row-ready"
            onClick={onAddDebriefNote}
          >
            <div className="hub-action-icon hub-action-icon-house">
              {'+'}
            </div>
            <div className="hub-action-info">
              <div className="hub-action-title">
                Add Debrief Note
              </div>
              <div className="hub-action-subtitle">
                Quick client or handoff note
              </div>
            </div>
            <div className="hub-action-chevron">&gt;</div>
          </button>
        )}

        {/* Shift Debrief editor/viewer */}
        {debriefAvailable && (
          <button
            className={`hub-action-row ${debriefSubmitted ? 'hub-action-row-done' : (debriefHasDraft ? 'hub-action-row-ready' : '')}`}
            onClick={onEditDebrief}
          >
            <div className="hub-action-icon hub-action-icon-house">
              {'D'}
            </div>
            <div className="hub-action-info">
              <div className="hub-action-title">
                {debriefSubmitted ? 'View Shift Debrief' : 'Edit Shift Debrief'}
              </div>
              <div className={`hub-action-subtitle ${debriefSubmitted ? 'hub-action-subtitle-done' : ''}`}>
                {debriefSubmitted
                  ? 'Submitted and locked'
                  : debriefHasDraft
                    ? `${debriefItemCount} draft item${debriefItemCount === 1 ? '' : 's'}`
                    : 'No draft notes yet'}
              </div>
            </div>
            <div className="hub-action-chevron">&gt;</div>
          </button>
        )}

        {/* Van EOC action */}
        {hasAssignment && (
          <button
            className={`hub-action-row ${vanStatus.rowClass}`}
            onClick={() => vanTask && onStartEoc(vanTask.id)}
            disabled={!vanTask}
            style={{ opacity: vanTask ? 1 : (vanCompleted ? 0.7 : 0.5) }}
          >
            <div className="hub-action-icon hub-action-icon-van">
              {'\u{1F690}'}
            </div>
            <div className="hub-action-info">
              <div className="hub-action-title">
                Van EOC {vanCompleted && !vanTask ? '✓' : ''}
              </div>
              <div className={`hub-action-subtitle ${vanStatus.className}`}>
                {vanStatus.label}
              </div>
            </div>
            <div className="hub-action-chevron">›</div>
          </button>
        )}

        {/* House EOC action */}
        {hasAssignment && (
          <button
            className={`hub-action-row ${houseStatus.rowClass}`}
            onClick={() => houseTask && onStartEoc(houseTask.id)}
            disabled={!houseTask}
            style={{ opacity: houseTask ? 1 : (houseCompleted ? 0.7 : 0.5) }}
          >
            <div className="hub-action-icon hub-action-icon-house">
              {'\u{1F3E0}'}
            </div>
            <div className="hub-action-info">
              <div className="hub-action-title">
                House EOC {houseCompleted && !houseTask ? '✓' : ''}
              </div>
              <div className={`hub-action-subtitle ${houseStatus.className}`}>
                {houseStatus.label}
              </div>
            </div>
            <div className="hub-action-chevron">›</div>
          </button>
        )}
      </div>

      {/* Today's completed transports */}
      <div className="section-label" style={{ marginBottom: '8px' }}>Completed today</div>
      {completedTodayTransports.length === 0 ? (
        <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '20px', padding: '12px 0' }}>
          No completed transports yet today.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
          {completedTodayTransports.map((transport) => {
            const clientLabel = transport.clients?.[0] || 'No client'
            const extra = transport.clients?.length > 1 ? ` +${transport.clients.length - 1}` : ''
            const destinationLabel = transport.destinations?.[0]?.name
              || transport.destinations?.[0]?.address
              || 'No destination'

            return (
              <button
                key={transport.id}
                className="activity-item"
                onClick={() => onContinueTransport(transport.id)}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {clientLabel}{extra}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {destinationLabel}
                  </div>
                </div>
                <span className="badge badge-closed" style={{ flexShrink: 0 }}>
                  {formatActivityTime(transport.__endedAt)}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <AppModal
        isOpen={issueModalOpen}
        title="Report Issue"
        tone="warning"
        maxWidth="520px"
        footer={(
          <>
            <button
              type="button"
              className="btn"
              onClick={closeIssueReport}
              disabled={issueSubmitting}
              style={{ flex: 1, background: '#F1EFEA', color: 'var(--text-secondary)', border: '1px solid #D8D1C6' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-finish"
              onClick={submitIssueReport}
              disabled={issueSubmitting}
              style={{ flex: 1 }}
            >
              {issueSubmitting ? 'Submitting...' : 'Submit Issue'}
            </button>
          </>
        )}
      >
        <form onSubmit={submitIssueReport}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px' }}>
            Issue type
          </label>
          <select
            className="input"
            value={issueForm.issueType}
            onChange={(event) => updateIssueType(event.target.value)}
            disabled={issueSubmitting}
            style={{ width: '100%', marginBottom: '12px' }}
          >
            {BHT_HOME_ISSUE_TYPES.map(type => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>

          {issueIsVan && assignedVanIds.length > 1 && (
            <>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px' }}>
                Van
              </label>
              <select
                className="input"
                value={issueForm.vanId}
                onChange={(event) => {
                  setIssueError('')
                  setIssueForm(prev => ({ ...prev, vanId: event.target.value }))
                }}
                disabled={issueSubmitting}
                style={{ width: '100%', marginBottom: '12px' }}
              >
                <option value="">Choose van</option>
                {assignedVanIds.map(vanId => (
                  <option key={vanId} value={vanId}>
                    {VANS.find(van => van.id === vanId)?.label || vanId}
                  </option>
                ))}
              </select>
            </>
          )}

          {issueIsVan && assignedVanIds.length === 1 && (
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
              Van: {VANS.find(van => van.id === selectedIssueVanId)?.label || selectedIssueVanId}
            </div>
          )}

          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px' }}>
            What happened?
          </label>
          <textarea
            className="input"
            rows={4}
            value={issueForm.description}
            onChange={(event) => {
              setIssueError('')
              setIssueForm(prev => ({ ...prev, description: event.target.value }))
            }}
            disabled={issueSubmitting}
            placeholder="Example: Hall bathroom sink is leaking under the cabinet."
            style={{ width: '100%', resize: 'vertical', boxSizing: 'border-box' }}
          />

          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px' }}>
            Location and staff name will be attached automatically.
          </div>

          {isOffline && (
            <div style={{ color: '#B07A28', fontSize: '13px', marginTop: '10px', padding: '8px', background: 'rgba(176,122,40,0.08)', borderRadius: '8px' }}>
              Offline mode: this report will save on this device and send when internet returns.
            </div>
          )}

          {issueError && (
            <div style={{ color: '#C94A3F', fontSize: '13px', marginTop: '10px', padding: '8px', background: 'rgba(205,78,66,0.06)', borderRadius: '8px' }}>
              {issueError}
            </div>
          )}
        </form>
      </AppModal>
    </div>
  )
}

export default BhtHub
