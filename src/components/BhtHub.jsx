import { getShiftById } from '../data/eocConstants'
import useEocAssignments from '../hooks/useEocAssignments'
import useEocTasks from '../hooks/useEocTasks'
import { getCurrentCycleDueDate } from '../utils/eocSchedule'

function BhtHub({ user, transports, issueUpdates = [], onNewTransport, onContinueTransport, onStartEoc }) {
  const { assignment, loading: assignmentLoading } = useEocAssignments(user)
  const { tasks, loading: tasksLoading } = useEocTasks(user, assignment)

  const hasAssignment = !!assignment

  const formatDateTime = (timestamp) => {
    if (!timestamp) return 'Unknown time'
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
    return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

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

  const renderIssueUpdatesCard = () => issueUpdates.length > 0 && (
    <div className="glass-card" style={{ marginBottom: '16px', padding: '14px 16px' }}>
      <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '10px' }}>
        Issue Updates
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {issueUpdates.map(update => (
          <div key={update.id} style={{
            border: '1px solid rgba(17,47,82,0.14)',
            borderRadius: '8px',
            padding: '10px',
            backgroundColor: 'rgba(17,47,82,0.05)'
          }}>
            <div style={{ fontSize: '12px', color: '#cfd8dc', marginBottom: '4px', textTransform: 'uppercase' }}>
              {update.status === 'resolved' ? 'Resolved' : 'In Progress'}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-primary)', marginBottom: '4px' }}>
              {update.message || 'Issue status updated.'}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Note: {update.statusNote || 'No note provided.'}
            </div>
            <div style={{ fontSize: '11px', color: '#556677', marginTop: '4px' }}>
              {formatDateTime(update.createdAt)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  const currentTransport = transports.find(isActiveTransport) || null
  const hasCurrentTransport = !!currentTransport

  const handlePrimaryTransportAction = () => {
    if (hasCurrentTransport) {
      onContinueTransport(currentTransport.id)
      return
    }
    onNewTransport()
  }
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

  const today = new Date()
  const completedTodayTransports = transports
    .filter(isEndedTransport)
    .map((transport) => ({ ...transport, __endedAt: getTransportEndedAt(transport) }))
    .filter((transport) => transport.__endedAt && isSameDay(transport.__endedAt, today))
    .sort((a, b) => b.__endedAt.getTime() - a.__endedAt.getTime())

  const statusStyles = {
    green: { backgroundColor: '#dcfce7', color: '#166534' },
    red: { backgroundColor: '#fee2e2', color: '#991b1b' },
    yellow: { backgroundColor: '#fef3c7', color: '#92400e' },
    grey: { backgroundColor: '#f3f4f6', color: '#6b7280' }
  }

  const getEocPillStatus = (taskList) => {
    if (taskList.some(t => t.status === 'overdue')) return { text: 'Overdue', tone: 'red' }
    if (taskList.some(t => t.status === 'pending')) return { text: 'Due Today', tone: 'yellow' }
    if (taskList.some(t => t.status === 'completed')) return { text: 'Done', tone: 'green' }
    return { text: 'None', tone: 'grey' }
  }

  const housePillStatus = getEocPillStatus(currentCycleHouseTasks)
  const vanPillStatus = getEocPillStatus(currentCycleVanTasks)
  const transportPillStatus = hasCurrentTransport
    ? { text: 'Open', tone: 'green' }
    : (completedTodayTransports.length > 0
        ? { text: `Completed (${completedTodayTransports.length})`, tone: 'yellow' }
        : { text: 'None', tone: 'grey' })

  const formatActivityTime = (value) => {
    const date = toDate(value)
    if (!date) return '--:--'
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  const renderEocActionButton = ({ label, task, completed, onClick }) => {
    const overdue = task?.status === 'overdue'
    const disabled = !task
    let text = label
    if (overdue) text = `${label} - OVERDUE`
    if (!task && completed) text = `${label} \u2713`

    const style = overdue
      ? {
          width: '100%',
          fontSize: '16px',
          marginBottom: '0',
          borderRadius: 'var(--radius)',
          backgroundColor: '#FFFFFF',
          border: '2px solid #AF291D',
          color: '#AF291D'
        }
      : {
          width: '100%',
          fontSize: '16px',
          marginBottom: '0',
          borderRadius: 'var(--radius)'
        }

    return (
      <button
        className={`btn ${overdue ? '' : 'btn-eoc'} hub-action-btn`}
        onClick={onClick}
        disabled={disabled}
        style={{
          ...style,
          opacity: disabled ? 0.6 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer'
        }}
      >
        {text}
      </button>
    )
  }

  if (assignmentLoading || tasksLoading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#556677' }}>
        Loading...
      </div>
    )
  }

  if (!hasAssignment) {
    return (
      <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
        {renderIssueUpdatesCard()}

        <div className="glass-card no-assignment-card" style={{
          textAlign: 'center',
          padding: '40px 20px',
          marginBottom: '20px',
          border: '2px solid rgba(255,152,0,0.3)'
        }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>!</div>
          <h3 style={{ color: '#B07A28', marginBottom: '8px', fontSize: '18px' }}>No Active Assignment</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: '1.5' }}>
            You don't have an active assignment. Contact your supervisor to get assigned to a location, shift, and van(s).
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
      {renderIssueUpdatesCard()}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px', marginBottom: '16px' }}>
        <div style={{
          borderRadius: '12px',
          padding: '12px 8px',
          textAlign: 'center',
          ...statusStyles[housePillStatus.tone]
        }}>
          <div style={{ fontSize: '18px', lineHeight: 1, marginBottom: '6px' }}>{'\u{1F3E0}'}</div>
          <div style={{ fontSize: '13px', marginBottom: '4px' }}>House EOC</div>
          <div style={{ fontSize: '18px', fontWeight: 700 }}>{housePillStatus.text}</div>
        </div>
        <div style={{
          borderRadius: '12px',
          padding: '12px 8px',
          textAlign: 'center',
          ...statusStyles[vanPillStatus.tone]
        }}>
          <div style={{ fontSize: '18px', lineHeight: 1, marginBottom: '6px' }}>{'\u{1F690}'}</div>
          <div style={{ fontSize: '13px', marginBottom: '4px' }}>Van EOC</div>
          <div style={{ fontSize: '18px', fontWeight: 700 }}>{vanPillStatus.text}</div>
        </div>
        <div style={{
          borderRadius: '12px',
          padding: '12px 8px',
          textAlign: 'center',
          ...statusStyles[transportPillStatus.tone]
        }}>
          <div style={{ fontSize: '18px', lineHeight: 1, marginBottom: '6px' }}>{'\u{1F697}'}</div>
          <div style={{ fontSize: '13px', marginBottom: '4px' }}>Transport</div>
          <div style={{ fontSize: '18px', fontWeight: 700 }}>{transportPillStatus.text}</div>
        </div>
      </div>

      {/* Transport button */}
      <button
        className="btn btn-primary hub-action-btn"
        onClick={handlePrimaryTransportAction}
        style={{ width: '100%', fontSize: '18px', marginBottom: '10px', borderRadius: 'var(--radius)' }}
      >
        {hasCurrentTransport ? 'Continue Open Transport' : '+ Start New Transport'}
      </button>

      {/* Assignment-driven EOC actions */}
      {hasAssignment && (
        <div className="glass-card" style={{ marginBottom: '20px', padding: '16px' }}>
          <div className="section-label" style={{ marginBottom: '10px' }}>EOCs</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {renderEocActionButton({
              label: 'Complete Van EOC',
              task: vanTask,
              completed: vanCompleted,
              onClick: () => vanTask && onStartEoc(vanTask.id)
            })}
            {renderEocActionButton({
              label: 'Complete House EOC',
              task: houseTask,
              completed: houseCompleted,
              onClick: () => houseTask && onStartEoc(houseTask.id)
            })}
          </div>
        </div>
      )}

      <div className="section-label" style={{ marginBottom: '10px' }}>Today&apos;s Activity</div>
      {completedTodayTransports.length === 0 ? (
        <div className="glass-card" style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            No completed transports yet today.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
          {completedTodayTransports.map((transport) => {
            const clientLabel = transport.clients?.[0] || 'No client'
            const destinationLabel = transport.destinations?.[0]?.name
              || transport.destinations?.[0]?.address
              || 'No destination'
            const reasonLabel = transport.reasons?.[0] || 'No reason'
            const closedLabel = String(transport.status || '').toLowerCase() === 'returned' ? 'Returned' : 'Closed'

            return (
              <button
                key={transport.id}
                className="glass-card"
                onClick={() => onContinueTransport(transport.id)}
                style={{
                  textAlign: 'left',
                  border: '1px solid rgba(17,47,82,0.12)',
                  cursor: 'pointer'
                }}
              >
                <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
                  Transport - {clientLabel}
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                  {destinationLabel} - {reasonLabel}
                </div>
                <span className="badge badge-closed">
                  {closedLabel} {formatActivityTime(transport.__endedAt)}
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


