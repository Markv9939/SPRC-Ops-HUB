function TransportList({ transports, onNewTransport }) {
  const formatTime = (timestamp) => {
    if (!timestamp) return '--:--'
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getClientDisplay = (transport) => {
    if (!transport.clients || transport.clients.length === 0) {
      return 'No client entered'
    }
    return transport.clients.join(', ')
  }

  const getDestinationDisplay = (transport) => {
    if (!transport.stops || transport.stops.length === 0) {
      return 'No destination entered'
    }
    return transport.stops[0].destinationAddress || transport.stops[0].destinationName || 'No destination'
  }

  const isOverdue = (transport) => {
    if (transport.status === 'closed' || transport.status === 'returned') {
      return false
    }

    if (!transport.departedAt) return false

    const departedDate = transport.departedAt.toDate ? transport.departedAt.toDate() : new Date(transport.departedAt)
    const hoursSinceDeparted = (Date.now() - departedDate.getTime()) / (1000 * 60 * 60)

    // Consider overdue if more than 8 hours since departure and not returned
    return hoursSinceDeparted > 8
  }

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>

      <button
        onClick={onNewTransport}
        style={{
          width: '100%',
          padding: '16px',
          backgroundColor: '#C94A3F',
          color: 'white',
          border: 'none',
          borderRadius: '12px',
          fontSize: '18px',
          fontWeight: 'bold',
          cursor: 'pointer',
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px'
        }}
      >
        + New Transport
      </button>

      <h2 style={{
        fontSize: '16px',
        color: '#888',
        marginBottom: '12px',
        fontWeight: 'normal'
      }}>
        Today's Transports
      </h2>

      {transports.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '40px 20px',
          color: '#aaa',
          backgroundColor: 'white',
          borderRadius: '12px',
          border: '1px solid #eee'
        }}>
          <p style={{ fontSize: '16px', marginBottom: '4px' }}>
            No transports yet
          </p>
          <p style={{ fontSize: '13px' }}>
            Tap "+ New Transport" to get started
          </p>
        </div>
      ) : (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '10px'
        }}>
          {transports.map((t) => (
            <div
              key={t.id}
              style={{
                backgroundColor: 'white',
                borderRadius: '12px',
                padding: '16px',
                border: isOverdue(t) ? '2px solid #FF5722' : '1px solid #eee',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                position: 'relative'
              }}
            >
              {isOverdue(t) && (
                <div style={{
                  position: 'absolute',
                  top: '-8px',
                  right: '12px',
                  backgroundColor: '#FF5722',
                  color: 'white',
                  padding: '4px 12px',
                  borderRadius: '12px',
                  fontSize: '11px',
                  fontWeight: 'bold'
                }}>
                  OVERDUE
                </div>
              )}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px',
                marginTop: isOverdue(t) ? '12px' : '0'
              }}>
                <span style={{
                  fontWeight: 'bold',
                  fontSize: '15px',
                  color: '#333'
                }}>
                  {getClientDisplay(t)}
                </span>
                <span style={{
                  fontSize: '12px',
                  padding: '3px 10px',
                  borderRadius: '20px',
                  fontWeight: 'bold',
                  backgroundColor:
                    t.status === 'open' ? '#FFF3CD' :
                    t.status === 'arrived' ? '#D1ECF1' :
                    t.status === 'returned' ? '#D4EDDA' :
                    t.status === 'closed' ? '#E8F5E9' :
                    '#f0f0f0',
                  color:
                    t.status === 'open' ? '#856404' :
                    t.status === 'arrived' ? '#0C5460' :
                    t.status === 'returned' ? '#155724' :
                    t.status === 'closed' ? '#2E7D32' :
                    '#666'
                }}>
                  {t.status || 'open'}
                </span>
              </div>

              <div style={{ fontSize: '13px', color: '#666' }}>
                {getDestinationDisplay(t)}
              </div>

              <div style={{
                fontSize: '12px',
                color: '#999',
                marginTop: '6px'
              }}>
                Departed: {formatTime(t.departedAt)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default TransportList
