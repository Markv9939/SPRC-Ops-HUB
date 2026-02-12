import { LOCATIONS, SHIFTS, VANS } from '../data/eocConstants'
import useEocAssignments from '../hooks/useEocAssignments'

function BhtHub({ user, transports, onNewTransport, onContinueTransport, onStartEoc }) {
  const { assignment, loading: assignmentLoading } = useEocAssignments(user)

  const hasAssignment = !!assignment
  const locationLabel = hasAssignment ? LOCATIONS.find(l => l.id === assignment.locationId)?.label : null
  const shiftLabel = hasAssignment ? SHIFTS.find(s => s.id === assignment.shiftId)?.label : null
  const vanLabels = hasAssignment && assignment.vanIds?.length > 0
    ? assignment.vanIds.map(vid => VANS.find(v => v.id === vid)?.label || vid)
    : []

  const formatTime = (timestamp) => {
    if (!timestamp) return '--:--'
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  const getClientDisplay = (t) => {
    if (!t.clients || t.clients.length === 0) return 'No client entered'
    return t.clients.join(', ')
  }

  const getDestinationDisplay = (t) => {
    if (t.destinations && t.destinations.length > 0) {
      return t.destinations.map(d => d.name || d.address).join(', ')
    }
    if (t.stops && t.stops.length > 0) {
      return t.stops[0].destinationAddress || t.stops[0].destinationName || 'No destination'
    }
    return 'No destination entered'
  }

  const badgeClass = (status) => {
    const map = { open: 'badge-open', arrived: 'badge-arrived', returned: 'badge-returned', closed: 'badge-closed' }
    return `badge ${map[status] || ''}`
  }

  const openTransports = transports.filter(t => t.status !== 'closed')

  if (assignmentLoading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#556677' }}>
        Loading...
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
        {hasAssignment ? (
          <div style={{ fontSize: '13px', color: '#8899aa' }}>
            {locationLabel} &bull; {shiftLabel}
            {vanLabels.length > 0 ? ` \u00B7 ${vanLabels.join(', ')}` : ''}
            {assignment.isHousePrimary && <span style={{ color: '#4CAF50', marginLeft: '8px' }}>House Primary</span>}
          </div>
        ) : (
          <div style={{ fontSize: '13px', color: '#FF9800' }}>
            No active assignment — contact a supervisor
          </div>
        )}
      </div>

      {/* No Assignment Blocked Screen */}
      {!hasAssignment && (
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
      )}

      {/* Transport button — always available */}
      <button
        className="btn btn-primary hub-action-btn"
        onClick={onNewTransport}
        style={{ width: '100%', fontSize: '18px', marginBottom: '10px', borderRadius: 'var(--radius)' }}
      >
        + New Transport
      </button>

      {/* EOC buttons — only when assigned */}
      {hasAssignment && assignment.isHousePrimary && (
        <button
          className="btn btn-eoc hub-action-btn"
          onClick={() => onStartEoc(null, null)}
          style={{ width: '100%', fontSize: '18px', marginBottom: '10px', borderRadius: 'var(--radius)' }}
        >
          Complete House EOC
        </button>
      )}
      {hasAssignment && assignment.vanIds?.length > 0 && (
        <button
          className="btn btn-eoc hub-action-btn"
          onClick={() => onStartEoc(null, assignment.vanIds.length === 1 ? assignment.vanIds[0] : null)}
          style={{ width: '100%', fontSize: '18px', marginBottom: '20px', borderRadius: 'var(--radius)' }}
        >
          Complete Van EOC
        </button>
      )}

      {/* Status cards */}
      <div className="hub-status-grid" style={{ marginBottom: '20px' }}>
        <div className="glass-card" style={{ padding: '14px' }}>
          <div className="section-label" style={{ marginBottom: '6px' }}>Assignment</div>
          {hasAssignment ? (
            <span className="badge badge-eoc-completed">Active</span>
          ) : (
            <span className="badge badge-eoc-missed">None</span>
          )}
        </div>
        <div className="glass-card" style={{ padding: '14px' }}>
          <div className="section-label" style={{ marginBottom: '6px' }}>Active Transports</div>
          <span style={{ fontSize: '22px', fontWeight: 700, color: openTransports.length > 0 ? '#E53935' : '#556677' }}>
            {openTransports.length}
          </span>
        </div>
      </div>

      {/* Recent transports */}
      <div className="section-label" style={{ marginBottom: '12px' }}>Recent Transports</div>

      {transports.length === 0 ? (
        <div className="glass-card" style={{ textAlign: 'center', padding: '40px 20px', color: '#556677' }}>
          <p style={{ fontSize: '16px', marginBottom: '4px' }}>No transports yet</p>
          <p style={{ fontSize: '13px' }}>Tap "+ New Transport" to get started</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {transports.map((t) => {
            const isClickable = t.status !== 'closed'
            return (
              <div
                key={t.id}
                className={`transport-item animate-in`}
                onClick={() => isClickable && onContinueTransport(t.id)}
                style={{ cursor: isClickable ? 'pointer' : 'default' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontWeight: 700, fontSize: '15px', color: '#e8e8e8' }}>
                    {getClientDisplay(t)}
                  </span>
                  <span className={badgeClass(t.status)}>
                    {t.status || 'open'}
                  </span>
                </div>
                <div style={{ fontSize: '13px', color: '#8899aa' }}>
                  {getDestinationDisplay(t)}
                </div>
                <div style={{ fontSize: '12px', color: '#556677', marginTop: '6px' }}>
                  Departed: {formatTime(t.departedAt)}
                </div>
                {isClickable && (
                  <div style={{ fontSize: '11px', color: '#E53935', marginTop: '8px', fontWeight: 600 }}>
                    Tap to continue →
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default BhtHub
