import { createElement, useEffect, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Bus,
  Car,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Home,
  MapPin,
  Pencil
} from 'lucide-react'
import { getShiftById, LOCATIONS, VANS } from '../data/eocConstants'
import { BHT_HOME_ISSUE_TYPES } from '../services/bhtIssueReportService'
import useEocAssignments from '../hooks/useEocAssignments'
import useEocTasks from '../hooks/useEocTasks'
import { getCurrentCycleDueDate } from '../utils/eocSchedule'
import { notifyWarning } from '../utils/toast'
import AppModal from './AppModal'
import useUserScope from '../hooks/useUserScope'
import useScopedIssues from '../hooks/useScopedIssues'
import { toTransportRecordDate } from '../utils/transportRecord'
import IssuePhotoPicker from './IssuePhotoPicker'
import useEocIssueFeatures from '../hooks/useEocIssueFeatures'
import useOfflinePhotoQueue from '../hooks/useOfflinePhotoQueue'

const LOCAL_REMINDER_INTERVAL_MS = 60 * 60 * 1000

function BhtHub({
  user,
  transports,
  isOffline = false,
  pendingEocTaskIds = [],
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
  onNavigateToDebrief,
  onNavigateToIssues
}) {
  const { assignment, loading: assignmentLoading } = useEocAssignments(user)
  const { tasks, loading: tasksLoading } = useEocTasks(user, assignment)
  const { exactIssueLocationIds, inIssueScope } = useUserScope(user)
  const { issues: locationIssues } = useScopedIssues({
    user,
    inEocScope: inIssueScope,
    inIssueScope,
    issueLocationIds: exactIssueLocationIds,
    enabled: !!user && exactIssueLocationIds.length > 0
  })
  const [issueModalOpen, setIssueModalOpen] = useState(false)
  const [issueReportStage, setIssueReportStage] = useState('form')
  const [issueForm, setIssueForm] = useState({
    issueType: BHT_HOME_ISSUE_TYPES[0].value,
    description: '',
    vanId: ''
  })
  const [issueError, setIssueError] = useState('')
  const [issueSubmitting, setIssueSubmitting] = useState(false)
  const [issuePhotos, setIssuePhotos] = useState([])
  const { enabledForLocation } = useEocIssueFeatures()
  const pendingPhotos = useOfflinePhotoQueue(user)

  const hasAssignment = !!assignment

  useEffect(() => {
    onDebriefAssignmentChange?.(assignment || null)
  }, [assignment, onDebriefAssignmentChange])

  const toDate = (value) => {
    return toTransportRecordDate(value)
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
  const pendingEocTaskIdSet = new Set(pendingEocTaskIds)

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

  const pendingHouseCompletion = currentCycleHouseTasks.some(task => pendingEocTaskIdSet.has(task.id))
  const pendingVanCompletion = currentCycleVanTasks.some(task => pendingEocTaskIdSet.has(task.id))
  const houseTask = getPriorityTask(currentCycleHouseTasks.filter(task => !pendingEocTaskIdSet.has(task.id)))
  const vanTask = getPriorityTask(currentCycleVanTasks.filter(task => !pendingEocTaskIdSet.has(task.id)))
  const houseCompleted = !houseTask && (pendingHouseCompletion || currentCycleHouseTasks.some(t => t.status === 'completed'))
  const vanCompleted = !vanTask && (pendingVanCompletion || currentCycleVanTasks.some(t => t.status === 'completed'))

  // --- Completed transports today ---
  const today = new Date()
  const completedTodayTransports = transports
    .filter(isEndedTransport)
    .map((transport) => ({ ...transport, __endedAt: getTransportEndedAt(transport) }))
    .filter((transport) => transport.__endedAt && isSameDay(transport.__endedAt, today))
    .sort((a, b) => b.__endedAt.getTime() - a.__endedAt.getTime())

  // --- Helpers for action row status ---
  const getEocStatus = (task, completed, pendingCompletion) => {
    if (pendingCompletion) return { label: 'Completed - pending sync', className: 'hub-action-subtitle-warning', rowClass: 'hub-action-row-warning' }
    if (task?.status === 'overdue') return { label: 'Overdue - tap to complete', className: 'hub-action-subtitle-urgent', rowClass: 'hub-action-row-urgent' }
    if (task?.status === 'pending') return { label: 'Due today', className: 'hub-action-subtitle-warning', rowClass: 'hub-action-row-ready' }
    if (completed) return { label: 'Completed', className: 'hub-action-subtitle-done', rowClass: 'hub-action-row-done' }
    return { label: 'No tasks', className: '', rowClass: '' }
  }

  const vanStatus = getEocStatus(vanTask, vanCompleted, pendingVanCompletion)
  const houseStatus = getEocStatus(houseTask, houseCompleted, pendingHouseCompletion)
  const pendingIncomingHandoffs = debriefAlerts
    .filter(alert => alert.type === 'shift_debrief_submitted')
    .filter(alert => alert.targetUserId === user?.id)
  const debriefAvailable = debriefSummary?.available === true
  const debriefSubmitted = debriefSummary?.status === 'submitted'
  const debriefPendingSubmission = debriefSummary?.status === 'pendingSubmission'
  const debriefHasDraft = debriefSummary?.status === 'draft'
  const debriefItemCount = debriefSummary?.itemCount || 0
  const pendingQuickItemCount = debriefSummary?.pendingQuickItemCount || 0
  const openIssueCount = locationIssues.filter(issue => String(issue.status || 'open').toLowerCase() === 'open').length
  const inProgressIssueCount = locationIssues.filter(issue => String(issue.status || '').toLowerCase() === 'in_progress').length

  const locationLabel = hasAssignment
    ? (LOCATIONS.find(l => l.id === assignment.locationId)?.label || assignment.locationId || '')
    : ''
  const issuePhotosEnabled = enabledForLocation('photos', assignment?.locationId || user?.locationId)

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
    setIssuePhotos([])
  }

  const openIssueReport = () => {
    resetIssueForm()
    setIssueReportStage(locationIssues.length > 0 ? 'existing' : 'form')
    setIssueModalOpen(true)
  }

  const closeIssueReport = () => {
    if (issueSubmitting) return
    setIssueModalOpen(false)
    setIssueReportStage('form')
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
        assignment,
        photos: issuePhotos
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

  const renderSection = (title, children) => (
    <section className="hub-section">
      <div className="hub-section-title">{title}</div>
      <div className="hub-section-stack">{children}</div>
    </section>
  )

  const renderActionRow = ({
    icon: RowIcon,
    iconClassName = '',
    rowClassName = '',
    title,
    titleBadge = null,
    subtitle,
    subtitleClassName = '',
    onClick,
    disabled = false,
    complete = false
  }) => (
    <button
      className={`hub-action-row ${rowClassName}`}
      onClick={onClick}
      disabled={disabled}
    >
      <div className={`hub-action-icon ${iconClassName}`}>
        {createElement(RowIcon, { size: 20, strokeWidth: 2.25 })}
      </div>
      <div className="hub-action-info">
        <div className="hub-action-title">
          {title}
          {titleBadge}
        </div>
        <div className={`hub-action-subtitle ${subtitleClassName}`}>
          {subtitle}
        </div>
      </div>
      <div className="hub-action-chevron">
        {complete ? <CheckCircle2 size={19} strokeWidth={2.25} /> : <ChevronRight size={20} strokeWidth={2.25} />}
      </div>
    </button>
  )

  const renderQuickAction = ({ icon: QuickIcon, iconClassName, title, onClick }) => (
    <button className="hub-quick-action" onClick={onClick}>
      <div className={`hub-quick-icon ${iconClassName}`}>
        {createElement(QuickIcon, { size: 16, strokeWidth: 2.4 })}
      </div>
      <div className="hub-quick-title">{title}</div>
    </button>
  )

  return (
    <div className="hub-home">
      <div className="hub-greeting">Hi, {firstName}</div>
      <div className="hub-context">
        <MapPin size={15} strokeWidth={2.2} />
        {locationLabel}
      </div>

      {pendingPhotos.total > 0 && (
        <div className="pending-photo-banner">
          <div><strong>{pendingPhotos.total} photo{pendingPhotos.total === 1 ? '' : 's'} pending</strong><span>{pendingPhotos.failed > 0 ? `${pendingPhotos.failed} failed. ` : ''}Do not clear browser data until uploads finish.</span></div>
          <button type="button" onClick={pendingPhotos.retry} disabled={pendingPhotos.retrying || isOffline}>{pendingPhotos.retrying ? 'Retrying...' : 'Retry'}</button>
        </div>
      )}

      {renderIssueUpdates()}

      {renderSection('Right now', (
        <>
          {renderActionRow({
            icon: Car,
            iconClassName: 'hub-action-icon-transport',
            rowClassName: hasCurrentTransport ? 'hub-action-row-urgent' : 'hub-action-row-ready',
            title: hasCurrentTransport ? 'Continue transport' : 'Start transport',
            subtitle: hasCurrentTransport
              ? `${currentTransport.clients?.[0] || 'In progress'} - tap to continue`
              : 'No active transport',
            subtitleClassName: hasCurrentTransport ? 'hub-action-subtitle-urgent' : '',
            onClick: handlePrimaryTransportAction
          })}

          {renderActionRow({
            icon: AlertTriangle,
            iconClassName: 'hub-action-icon-issue',
            rowClassName: locationIssues.length > 0 ? 'hub-action-row-warning' : 'hub-action-row-ready',
            title: 'Issues',
            titleBadge: locationIssues.length > 0
              ? <span className="badge badge-urgent hub-title-badge">{locationIssues.length}</span>
              : null,
            subtitle: locationIssues.length > 0
              ? `${openIssueCount} open - ${inProgressIssueCount} in progress - tap to view updates`
              : 'No active issues',
            onClick: onNavigateToIssues,
            disabled: !onNavigateToIssues
          })}
        </>
      ))}

      {renderSection('Shift tasks', (
        <>
          {pendingIncomingHandoffs.length > 0 && renderActionRow({
            icon: ClipboardList,
            iconClassName: 'hub-action-icon-debrief',
            rowClassName: 'hub-action-row-debrief',
            title: 'Incoming debrief',
            subtitle: pendingIncomingHandoffs.length === 1
              ? 'From previous shift - initials needed'
              : `${pendingIncomingHandoffs.length} incoming handoffs - initials needed`,
            onClick: () => onNavigateToDebrief?.(pendingIncomingHandoffs[0])
          })}

          {renderActionRow({
            icon: Bus,
            iconClassName: 'hub-action-icon-van',
            rowClassName: vanStatus.rowClass,
            title: 'Van EOC',
            subtitle: vanStatus.label,
            subtitleClassName: vanStatus.className,
            onClick: () => vanTask && onStartEoc(vanTask.id),
            disabled: !vanTask,
            complete: vanCompleted && !vanTask
          })}

          {renderActionRow({
            icon: Home,
            iconClassName: 'hub-action-icon-house',
            rowClassName: houseStatus.rowClass,
            title: 'House EOC',
            subtitle: houseStatus.label,
            subtitleClassName: houseStatus.className,
            onClick: () => houseTask && onStartEoc(houseTask.id),
            disabled: !houseTask,
            complete: houseCompleted && !houseTask
          })}

          {debriefAvailable && renderActionRow({
            icon: ClipboardList,
            iconClassName: 'hub-action-icon-notes',
            rowClassName: debriefPendingSubmission
              ? 'hub-action-row-warning'
              : pendingQuickItemCount > 0
              ? 'hub-action-row-warning'
              : debriefSubmitted
                ? 'hub-action-row-done'
                : (debriefHasDraft ? 'hub-action-row-warning' : 'hub-action-row-ready'),
            title: debriefPendingSubmission ? 'Shift debrief' : (debriefSubmitted ? 'View shift debrief' : 'Edit shift debrief'),
            subtitle: debriefPendingSubmission
              ? 'Submitted - pending sync'
              : pendingQuickItemCount > 0
              ? `${pendingQuickItemCount} offline note${pendingQuickItemCount === 1 ? '' : 's'} pending sync`
              : debriefSubmitted
                ? 'Submitted and locked'
              : debriefHasDraft
                ? `${debriefItemCount} draft note${debriefItemCount === 1 ? '' : 's'} - tap to review and submit`
                : 'No draft notes yet',
            subtitleClassName: debriefPendingSubmission
              ? 'hub-action-subtitle-warning'
              : pendingQuickItemCount > 0
              ? 'hub-action-subtitle-warning'
              : debriefSubmitted
                ? 'hub-action-subtitle-done'
                : (debriefHasDraft ? 'hub-action-subtitle-warning' : ''),
            onClick: onEditDebrief,
            disabled: debriefPendingSubmission
          })}
        </>
      ))}

      {renderSection('Quick actions', (
        <div className="hub-quick-grid">
          {debriefAvailable && renderQuickAction({
            icon: Pencil,
            iconClassName: 'hub-quick-icon-note',
            title: 'Add debrief note',
            onClick: onAddDebriefNote
          })}
          {renderQuickAction({
            icon: AlertCircle,
            iconClassName: 'hub-quick-icon-issue',
            title: isOffline ? 'Report issue offline' : 'Report issue',
            onClick: openIssueReport
          })}
        </div>
      ))}

      <div hidden>
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

        <button
          className="hub-action-row hub-action-row-ready"
          onClick={onNavigateToIssues}
          disabled={!onNavigateToIssues}
        >
          <div className="hub-action-icon hub-action-icon-house">
            {'!'}
          </div>
          <div className="hub-action-info">
            <div className="hub-action-title">
              Issues
              {locationIssues.length > 0 && <span className="badge badge-urgent" style={{ marginLeft: '8px' }}>{locationIssues.length}</span>}
            </div>
            <div className="hub-action-subtitle">
              {locationIssues.length > 0
                ? `${openIssueCount} open - ${inProgressIssueCount} in progress - tap to view updates`
                : 'No active issues'}
            </div>
          </div>
          <div className="hub-action-chevron">&gt;</div>
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
            className={`hub-action-row ${debriefSubmitted ? 'hub-action-row-done' : ((debriefHasDraft || debriefPendingSubmission) ? 'hub-action-row-ready' : '')}`}
            onClick={onEditDebrief}
            disabled={debriefPendingSubmission}
          >
            <div className="hub-action-icon hub-action-icon-house">
              {'D'}
            </div>
            <div className="hub-action-info">
              <div className="hub-action-title">
                {debriefPendingSubmission ? 'Shift Debrief' : (debriefSubmitted ? 'View Shift Debrief' : 'Edit Shift Debrief')}
              </div>
              <div className={`hub-action-subtitle ${debriefSubmitted ? 'hub-action-subtitle-done' : ''}`}>
                {debriefPendingSubmission
                  ? 'Submitted - pending sync'
                  : debriefSubmitted
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

      {renderSection('Completed today', (
        <>
          <div className="hub-completed-summary">
            <span>Completed today</span>
            <span className="badge badge-closed">{completedTodayTransports.length}</span>
          </div>
          {completedTodayTransports.length === 0 ? (
            <div className="hub-empty-note">No completed transports yet today.</div>
          ) : (
            <div className="hub-completed-list">
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
        </>
      ))}

      <AppModal
        isOpen={issueModalOpen}
        title={issueReportStage === 'existing' ? 'Check Active Issues' : 'Report Issue'}
        tone="warning"
        maxWidth="520px"
        footer={issueReportStage === 'existing' ? (
          <>
            <button
              type="button"
              className="btn"
              onClick={closeIssueReport}
              style={{ flex: 1, background: '#F1EFEA', color: 'var(--text-secondary)', border: '1px solid #D8D1C6' }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-finish"
              onClick={() => setIssueReportStage('form')}
              style={{ flex: 1 }}
            >
              Report new issue
            </button>
          </>
        ) : (
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
        {issueReportStage === 'existing' ? (
          <div className="quick-issue-existing">
            <p>Review the active issues for this house before creating another report.</p>
            <div className="quick-issue-existing-list">
              {locationIssues.slice(0, 4).map(issue => (
                <div className="quick-issue-existing-row" key={issue.id}>
                  <strong>{issue.label || 'Issue'}</strong>
                  <span>{issue.description || 'No details provided.'}</span>
                </div>
              ))}
            </div>
            {onNavigateToIssues && (
              <button
                type="button"
                className="quick-issue-view-all"
                onClick={() => {
                  closeIssueReport()
                  onNavigateToIssues()
                }}
              >
                View all active issues <ChevronRight size={16} />
              </button>
            )}
          </div>
        ) : (
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

          {issueForm.issueType === 'safety_concern' && (
            <div className="location-report-safety-warning" role="alert">
              If anyone is in immediate danger, follow emergency procedures and contact a supervisor before submitting this report.
            </div>
          )}

          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px' }}>
            Describe the issue
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
            placeholder="Include any details staff or supervisors should know."
            style={{ width: '100%', resize: 'vertical', boxSizing: 'border-box' }}
          />

          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px' }}>
            Provide all relevant details so the issue can be understood and addressed. Location and staff name are attached automatically.
          </div>

          {issuePhotosEnabled && <IssuePhotoPicker value={issuePhotos} onChange={setIssuePhotos} disabled={issueSubmitting} />}

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
        )}
      </AppModal>
    </div>
  )
}

export default BhtHub
