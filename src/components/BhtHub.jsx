import { getShiftById, LOCATIONS } from '../data/eocConstants'
import useEocAssignments from '../hooks/useEocAssignments'
import useEocTasks from '../hooks/useEocTasks'
import { getCurrentCycleDueDate } from '../utils/eocSchedule'

function BhtHub({ user, transports, issueUpdates = [], onNewTransport, onContinueTransport, onStartEoc }) {
  const { assignment, loading: assignmentLoading } = useEocAssignments(user)
  const { tasks, loading: tasksLoading } = useEocTasks(user, assignment)

  const hasAssignment = !!assignment

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

  const locationLabel = hasAssignment
    ? (LOCATIONS.find(l => l.id === assignment.locationId)?.label || assignment.locationId || '')
    : ''

  const firstName = String(user?.name || '').split(' ')[0]

  if (assignmentLoading || tasksLoading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#556677' }}>
        Loading...
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
            <div key={update.id} className="issue-update-card">
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
    </div>
  )
}

export default BhtHub
