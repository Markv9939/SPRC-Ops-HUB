import { useEffect, useState } from 'react'

function TransportList({ transports, onNewTransport, onContinueTransport }) {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const intervalId = setInterval(() => {
      setNowMs(Date.now())
    }, 60000)
    return () => clearInterval(intervalId)
  }, [])

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
    // Check new destinations array first, then fall back to stops
    if (t.destinations && t.destinations.length > 0) {
      return t.destinations.map(d => d.name || d.address).join(', ')
    }
    if (t.stops && t.stops.length > 0) {
      return t.stops[0].destinationAddress || t.stops[0].destinationName || 'No destination'
    }
    return 'No destination entered'
  }

  const isOverdue = (t) => {
    if (t.status === 'closed' || t.status === 'returned') return false
    if (!t.departedAt) return false
    const dep = t.departedAt.toDate ? t.departedAt.toDate() : new Date(t.departedAt)
    return (nowMs - dep.getTime()) / (1000 * 60 * 60) > 8
  }

  const badgeClass = (status) => {
    if (status === 'open') return 'badge badge-open'
    if (status === 'arrived') return 'badge badge-arrived'
    if (status === 'returned') return 'badge badge-returned'
    if (status === 'closed') return 'badge badge-closed'
    return 'badge'
  }

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>

      <button className="btn btn-primary" onClick={onNewTransport} style={{ width: '100%', fontSize: '18px', marginBottom: '24px', borderRadius: 'var(--radius)' }}>
        + New Transport
      </button>

      <div className="section-label" style={{ marginBottom: '12px' }}>Today's Transports</div>

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
                className={`transport-item animate-in ${isOverdue(t) ? 'transport-item-overdue' : ''}`}
                onClick={() => isClickable && onContinueTransport && onContinueTransport(t.id)}
                style={{
                  cursor: isClickable ? 'pointer' : 'default',
                  transition: 'all 0.2s ease',
                  ...(isClickable && {
                    ':hover': {
                      transform: 'translateY(-2px)',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                    }
                  })
                }}
                onMouseEnter={(e) => {
                  if (isClickable) {
                    e.currentTarget.style.transform = 'translateY(-2px)'
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (isClickable) {
                    e.currentTarget.style.transform = 'translateY(0)'
                    e.currentTarget.style.boxShadow = ''
                  }
                }}
              >
                {isOverdue(t) && (
                  <div style={{ position: 'absolute', top: '-8px', right: '12px' }}>
                    <span className="badge badge-overdue">OVERDUE</span>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', marginTop: isOverdue(t) ? '8px' : '0' }}>
                  <span style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)' }}>
                    {getClientDisplay(t)}
                  </span>
                  <span className={badgeClass(t.status)}>
                    {t.status || 'open'}
                  </span>
                </div>

                <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  {getDestinationDisplay(t)}
                </div>

                <div style={{ fontSize: '12px', color: '#556677', marginTop: '6px' }}>
                  Departed: {formatTime(t.departedAt)}
                </div>

                {isClickable && (
                  <div style={{ fontSize: '11px', color: '#CD4E42', marginTop: '8px', fontWeight: 600 }}>
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

export default TransportList


