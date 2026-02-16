import { useState } from 'react'
import { LOCATIONS, SHIFTS, VANS } from '../data/eocConstants'
import useEocAssignments from '../hooks/useEocAssignments'
import useEocTasks from '../hooks/useEocTasks'
import { getCurrentCycleDueDate } from '../utils/eocSchedule'

function BhtHub({ user, transports, issueUpdates = [], onNewTransport, onContinueTransport, onStartEoc }) {
  const { assignment, loading: assignmentLoading } = useEocAssignments(user)
  const { tasks, loading: tasksLoading } = useEocTasks(user, assignment)
  const [selectedVanTaskId, setSelectedVanTaskId] = useState('')

  const hasAssignment = !!assignment
  const locationLabel = hasAssignment ? LOCATIONS.find(l => l.id === assignment.locationId)?.label : null
  const shiftLabel = hasAssignment ? SHIFTS.find(s => s.id === assignment.shiftId)?.label : null
  const vanLabels = hasAssignment && assignment.vanIds?.length > 0
    ? assignment.vanIds.map(vid => VANS.find(v => v.id === vid)?.label || vid)
    : []

  const actionableTasks = hasAssignment
    ? tasks.filter(t => t.status === 'pending' || t.status === 'overdue')
    : []
  const houseTask = actionableTasks.find(t => t.taskType === 'house') || null
  const vanTasks = actionableTasks.filter(t => t.taskType === 'van')
  const effectiveSelectedVanTaskId = vanTasks.some(t => t.id === selectedVanTaskId)
    ? selectedVanTaskId
    : (vanTasks[0]?.id || '')
  const selectedVanTask = vanTasks.find(t => t.id === effectiveSelectedVanTaskId) || null

  const actionableByLocation = actionableTasks.reduce((acc, task) => {
    const key = task.locationId || 'unknown'
    if (!acc[key]) acc[key] = []
    acc[key].push(task)
    return acc
  }, {})

  const formatDateTime = (timestamp) => {
    if (!timestamp) return 'Unknown time'
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
    return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

  const renderIssueUpdatesCard = () => issueUpdates.length > 0 && (
    <div className="glass-card" style={{ marginBottom: '16px', padding: '14px 16px' }}>
      <div style={{ fontSize: '14px', fontWeight: 700, color: '#e8e8e8', marginBottom: '10px' }}>
        Issue Updates
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {issueUpdates.map(update => (
          <div key={update.id} style={{
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '8px',
            padding: '10px',
            backgroundColor: 'rgba(255,255,255,0.03)'
          }}>
            <div style={{ fontSize: '12px', color: '#cfd8dc', marginBottom: '4px', textTransform: 'uppercase' }}>
              {update.status === 'resolved' ? 'Resolved' : 'In Progress'}
            </div>
            <div style={{ fontSize: '13px', color: '#e8e8e8', marginBottom: '4px' }}>
              {update.message || 'Issue status updated.'}
            </div>
            <div style={{ fontSize: '12px', color: '#8899aa' }}>
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

  const taskTitle = (task) => {
    if (task.taskType === 'house') return 'House EOC'
    const vanLabel = VANS.find(v => v.id === task.vanId)?.label || task.vanId || 'Van'
    return `Van EOC - ${vanLabel}`
  }

  const taskSubtitle = (task) => {
    const shift = SHIFTS.find(s => s.id === task.shiftId)?.label || task.shiftId
    return `${shift} - Due ${task.dueDate}`
  }

  const currentTransport = transports.find(t => {
    const status = String(t?.status || '').trim().toLowerCase()
    return status === 'open' || status === 'arrived'
  }) || null
  const hasCurrentTransport = !!currentTransport

  const handlePrimaryTransportAction = () => {
    if (hasCurrentTransport) {
      onContinueTransport(currentTransport.id)
      return
    }
    onNewTransport()
  }
  const shiftConfig = hasAssignment ? SHIFTS.find(s => s.id === assignment.shiftId) : null
  const currentCycleDueDate = shiftConfig ? getCurrentCycleDueDate(shiftConfig) : null
  const currentCycleTasks = hasAssignment
    ? tasks.filter(t =>
      t.locationId === assignment.locationId &&
      t.shiftId === assignment.shiftId &&
      (!currentCycleDueDate || t.dueDate === currentCycleDueDate))
    : []
  const dueCount = currentCycleTasks.filter(t => t.status === 'pending').length
  const overdueCount = currentCycleTasks.filter(t => t.status === 'overdue').length
  const completedCount = currentCycleTasks.filter(t => t.status === 'completed').length

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
          <h3 style={{ color: '#FF9800', marginBottom: '8px', fontSize: '18px' }}>No Active Assignment</h3>
          <p style={{ color: '#8899aa', fontSize: '14px', lineHeight: '1.5' }}>
            You don't have an active assignment. Contact your supervisor to get assigned to a location, shift, and van(s).
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>

      {/* Context bar */}
      <div className="glass-card" style={{ marginBottom: '16px', padding: '14px 18px' }}>
        <div style={{ fontSize: '15px', fontWeight: 700, color: '#e8e8e8', marginBottom: '4px' }}>
          {user.name}
        </div>
        <div style={{ fontSize: '13px', color: '#8899aa' }}>
          {locationLabel} - {shiftLabel}
          {vanLabels.length > 0 ? ` - ${vanLabels.join(', ')}` : ''}
        </div>
      </div>

      {renderIssueUpdatesCard()}

      {/* Transport button */}
      <button
        className="btn btn-primary hub-action-btn"
        onClick={handlePrimaryTransportAction}
        style={{ width: '100%', fontSize: '18px', marginBottom: '10px', borderRadius: 'var(--radius)' }}
      >
        {hasCurrentTransport ? 'Continue Current Transport' : '+ New Transport'}
      </button>

      {/* Assignment-driven EOC tasks */}
      {hasAssignment && (
        <div className="glass-card" style={{ marginBottom: '20px', padding: '16px' }}>
          <div className="section-label" style={{ marginBottom: '8px' }}>EOCs</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
            <button className="chip chip-due" disabled>Due ({dueCount})</button>
            <button className="chip chip-overdue" disabled>Overdue ({overdueCount})</button>
            <button className="chip chip-ok" disabled>Completed ({completedCount})</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: actionableTasks.length > 0 ? '8px' : '0' }}>
            {houseTask && (
              <button
                className="btn btn-eoc hub-action-btn"
                onClick={() => onStartEoc(houseTask.id)}
                style={{ width: '100%', fontSize: '16px', marginBottom: '0', borderRadius: 'var(--radius)' }}
              >
                Complete House EOC
              </button>
            )}
            {vanTasks.length === 1 && (
              <button
                className="btn btn-eoc hub-action-btn"
                onClick={() => onStartEoc(vanTasks[0].id)}
                style={{ width: '100%', fontSize: '16px', marginBottom: '0', borderRadius: 'var(--radius)' }}
              >
                Complete Van EOC
              </button>
            )}
            {vanTasks.length > 1 && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: '8px',
                alignItems: 'center',
                backgroundColor: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '10px',
                padding: '10px'
              }}>
                <select
                  value={effectiveSelectedVanTaskId}
                  onChange={(e) => setSelectedVanTaskId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.12)',
                    backgroundColor: 'rgba(255,255,255,0.06)',
                    color: '#e8e8e8',
                    fontSize: '14px'
                  }}
                >
                  {vanTasks.map(task => {
                    const location = LOCATIONS.find(l => l.id === task.locationId)?.label || task.locationId
                    const shift = SHIFTS.find(s => s.id === task.shiftId)?.label || task.shiftId
                    const van = VANS.find(v => v.id === task.vanId)?.label || task.vanId || 'Van'
                    return (
                      <option key={task.id} value={task.id}>
                        {`${van} - ${location} - ${shift} - ${task.status.toUpperCase()}`}
                      </option>
                    )
                  })}
                </select>
                <button
                  className="btn btn-eoc"
                  onClick={() => selectedVanTask && onStartEoc(selectedVanTask.id)}
                  disabled={!selectedVanTask}
                  style={{
                    padding: '10px 14px',
                    fontSize: '14px',
                    borderRadius: '8px',
                    opacity: selectedVanTask ? 1 : 0.7
                  }}
                >
                  Van Picker
                </button>
              </div>
            )}
          </div>

          {actionableTasks.length === 0 ? (
            <div style={{ fontSize: '13px', color: '#8899aa' }}>
              No pending or overdue EOC tasks.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {Object.entries(actionableByLocation).map(([locationId, locationTasks]) => (
                <div key={locationId}>
                  <div style={{ fontSize: '12px', color: '#8899aa', marginBottom: '6px' }}>
                    {LOCATIONS.find(l => l.id === locationId)?.label || locationId}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {locationTasks.map(task => (
                      <button
                        key={task.id}
                        className="btn btn-eoc hub-action-btn"
                        onClick={() => onStartEoc(task.id)}
                        style={{
                          width: '100%',
                          fontSize: '15px',
                          marginBottom: '0',
                          borderRadius: 'var(--radius)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '10px'
                        }}
                      >
                        <span style={{ textAlign: 'left' }}>
                          <div style={{ fontWeight: 700 }}>{taskTitle(task)}</div>
                          <div style={{ fontSize: '12px', opacity: 0.9 }}>{taskSubtitle(task)}</div>
                        </span>
                        <span
                          className={`badge ${task.status === 'overdue' ? 'badge-overdue' : 'badge-eoc-pending'}`}
                          style={{ whiteSpace: 'nowrap' }}
                        >
                          {task.status.toUpperCase()}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default BhtHub
