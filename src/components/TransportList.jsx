function TransportList({ transports, onNewTransport }) {
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
                border: '1px solid #eee',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
              }}
            >
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px'
              }}>
                <span style={{
                  fontWeight: 'bold',
                  fontSize: '15px',
                  color: '#333'
                }}>
                  {t.clients || 'No client entered'}
                </span>
                <span style={{
                  fontSize: '12px',
                  padding: '3px 10px',
                  borderRadius: '20px',
                  fontWeight: 'bold',
                  backgroundColor:
                    t.status === 'departed' ? '#FFF3CD' :
                    t.status === 'arrived' ? '#D1ECF1' :
                    t.status === 'returned' ? '#D4EDDA' :
                    '#f0f0f0',
                  color:
                    t.status === 'departed' ? '#856404' :
                    t.status === 'arrived' ? '#0C5460' :
                    t.status === 'returned' ? '#155724' :
                    '#666'
                }}>
                  {t.status || 'started'}
                </span>
              </div>

              <div style={{ fontSize: '13px', color: '#666' }}>
                {t.destination || 'No destination entered'}
              </div>

              <div style={{
                fontSize: '12px',
                color: '#999',
                marginTop: '6px'
              }}>
                Departed: {t.departTime || '--:--'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default TransportList
