import { LOCATIONS, SHIFTS, VANS } from '../data/eocConstants'
import useEocAssignments from '../hooks/useEocAssignments'

function BhtHub({ user, transports, onNewTransport, onContinueTransport, onStartEoc }) {
  const { houseAssignment, vanAssignment, loading: eocLoading } = useEocAssignments(user)

  const hasEocProfile = user.locationId && user.shiftId
  const locationLabel = LOCATIONS.find(l => l.id === user.locationId)?.label
  const shiftLabel = SHIFTS.find(s => s.id === user.shiftId)?.label
  const vanLabel = VANS.find(v => v.id === user.vanId)?.label

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

  const getEocStatusBadge = (assignment) => {
    if (eocLoading) return <span className="badge" style={{ background: 'rgba(255,255,255,0.06)', color: '#556677' }}>Loading...</span>
    if (!assignment) return null
    if (assignment.status === 'completed') return <span className="badge badge-eoc-completed">Completed</span>
    if (assignment.status === 'missed') return <span className="badge badge-eoc-missed">Missed</span>
    return <span className="badge badge-eoc-pending">Due {assignment.dueDate}</span>
  }

  const openTransports = transports.filter(t => t.status !== 'closed')
  const canStartHouse = hasEocProfile && ['pending', 'missed'].includes(houseAssignment?.status)
  const canStartVan = hasEocProfile && ['pending', 'missed'].includes(vanAssignment?.status)

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>

      {/* Context bar */}
      <div className="glass-card" style={{ marginBottom: '16px', padding: '14px 18px' }}>
        <div style={{ fontSize: '15px', fontWeight: 700, color: '#e8e8e8', marginBottom: '4px' }}>
          {user.name}
        </div>
        {hasEocProfile ? (
          <div style={{ fontSize: '13px', color: '#8899aa' }}>
            {locationLabel} &bull; {shiftLabel} {vanLabel ? `\u00B7 ${vanLabel}` : ''}
          </div>
        ) : (
          <div style={{ fontSize: '13px', color: '#FF9800' }}>
            No EOC location assigned — contact a supervisor
          </div>
        )}
      </div>

      {/* Action buttons */}
      <button
        className="btn btn-primary hub-action-btn"
        onClick={onNewTransport}
        style={{ width: '100%', fontSize: '18px', marginBottom: '10px', borderRadius: 'var(--radius)' }}
      >
        + New Transport
      </button>

      <button
        className={`btn hub-action-btn ${canStartHouse ? 'btn-eoc' : 'btn-disabled'}`}
        onClick={() => canStartHouse && onStartEoc(houseAssignment.id)}
        disabled={!canStartHouse}
        style={{ width: '100%', fontSize: '18px', marginBottom: '10px', borderRadius: 'var(--radius)' }}
      >
        Complete House EOC
      </button>
      <button
        className={`btn hub-action-btn ${canStartVan ? 'btn-eoc' : 'btn-disabled'}`}
        onClick={() => canStartVan && onStartEoc(vanAssignment.id)}
        disabled={!canStartVan}
        style={{ width: '100%', fontSize: '18px', marginBottom: '20px', borderRadius: 'var(--radius)' }}
      >
        Complete Van EOC
      </button>

      {/* Status cards */}
      <div className="hub-status-grid" style={{ marginBottom: '20px' }}>
        <div className="glass-card" style={{ padding: '14px' }}>
          <div className="section-label" style={{ marginBottom: '6px' }}>House EOC</div>
          {hasEocProfile ? getEocStatusBadge(houseAssignment) : (
            <span style={{ fontSize: '13px', color: '#556677' }}>Not assigned</span>
          )}
        </div>
        <div className="glass-card" style={{ padding: '14px' }}>
          <div className="section-label" style={{ marginBottom: '6px' }}>Van EOC</div>
          {hasEocProfile ? getEocStatusBadge(vanAssignment) : (
            <span style={{ fontSize: '13px', color: '#556677' }}>Not assigned</span>
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
