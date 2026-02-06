import { useState } from 'react'

function TransportCard({ onSave, onClose, startTime }) {
  const [status, setStatus] = useState('departed')
  const [departTime] = useState(startTime)
  const [arriveTime, setArriveTime] = useState(null)
  const [returnTime, setReturnTime] = useState(null)
  const [clients, setClients] = useState('')
  const [destination, setDestination] = useState('')
  const [reasons, setReasons] = useState([])
  const [notes, setNotes] = useState('')

  const reasonOptions = [
    'Medical Appointment',
    'Outside Provider',
    'Court',
    'Job Interview',
    'Pharmacy',
    'Lab Work',
    'Dental',
    'Other'
  ]

  const now = () => {
    return new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const handleArrive = () => {
    setArriveTime(now())
    setStatus('arrived')
  }

  const handleReturn = () => {
    setReturnTime(now())
    setStatus('returned')
  }

  const toggleReason = (reason) => {
    if (reasons.includes(reason)) {
      setReasons(reasons.filter((r) => r !== reason))
    } else {
      setReasons([...reasons, reason])
    }
  }

  const handleClose = () => {
    const transport = {
      id: Date.now(),
      clients,
      destination,
      reasons,
      notes,
      departTime,
      arriveTime,
      returnTime,
      status
    }
    onSave(transport)
  }

  return (
    <div style={{
      padding: '20px',
      maxWidth: '600px',
      margin: '0 auto'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px'
      }}>
        <h2 style={{ margin: 0, color: '#333' }}>
          Transport
        </h2>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '24px',
            cursor: 'pointer',
            color: '#999'
          }}
        >
          X
        </button>
      </div>

      <div style={{
        backgroundColor: 'white',
        borderRadius: '10px',
        padding: '10px 16px',
        border: '1px solid #eee',
        marginBottom: '16px',
        fontSize: '13px',
        color: '#888'
      }}>
        Departed at <span style={{
          fontWeight: 'bold',
          color: '#C94A3F'
        }}>{departTime}</span>
      </div>

      <div style={{
        display: 'flex',
        gap: '10px',
        marginBottom: '24px'
      }}>
        <button
          onClick={handleArrive}
          disabled={status !== 'departed'}
          style={{
            flex: 1,
            padding: '16px',
            fontSize: '16px',
            fontWeight: 'bold',
            borderRadius: '10px',
            border: 'none',
            cursor: status === 'departed'
              ? 'pointer' : 'default',
            backgroundColor:
              status === 'departed' ? '#2196F3' :
              '#e8e8e8',
            color:
              status === 'departed' ? 'white' : '#999'
          }}
        >
          ARRIVE
          {arriveTime && (
            <div style={{
              fontSize: '12px',
              fontWeight: 'normal',
              marginTop: '4px'
            }}>
              {arriveTime}
            </div>
          )}
        </button>

        <button
          onClick={handleReturn}
          disabled={status !== 'arrived'}
          style={{
            flex: 1,
            padding: '16px',
            fontSize: '16px',
            fontWeight: 'bold',
            borderRadius: '10px',
            border: 'none',
            cursor: status === 'arrived'
              ? 'pointer' : 'default',
            backgroundColor:
              status === 'arrived' ? '#4CAF50' :
              '#e8e8e8',
            color:
              status === 'arrived' ? 'white' : '#999'
          }}
        >
          RETURN
          {returnTime && (
            <div style={{
              fontSize: '12px',
              fontWeight: 'normal',
              marginTop: '4px'
            }}>
              {returnTime}
            </div>
          )}
        </button>
      </div>

      <div style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        padding: '20px',
        border: '1px solid #eee',
        marginBottom: '16px'
      }}>
        <label style={{
          fontSize: '13px',
          color: '#888',
          display: 'block',
          marginBottom: '6px'
        }}>
          Client(s)
        </label>
        <input
          type="text"
          value={clients}
          onChange={(e) => setClients(e.target.value)}
          placeholder="e.g. John D, Sarah M"
          style={{
            width: '100%',
            padding: '12px',
            border: '2px solid #eee',
            borderRadius: '8px',
            fontSize: '15px',
            outline: 'none',
            boxSizing: 'border-box'
          }}
        />
      </div>

      <div style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        padding: '20px',
        border: '1px solid #eee',
        marginBottom: '16px'
      }}>
        <label style={{
          fontSize: '13px',
          color: '#888',
          display: 'block',
          marginBottom: '6px'
        }}>
          Destination
        </label>
        <input
          type="text"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="Name or address"
          style={{
            width: '100%',
            padding: '12px',
            border: '2px solid #eee',
            borderRadius: '8px',
            fontSize: '15px',
            outline: 'none',
            boxSizing: 'border-box'
          }}
        />
      </div>

      <div style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        padding: '20px',
        border: '1px solid #eee',
        marginBottom: '16px'
      }}>
        <label style={{
          fontSize: '13px',
          color: '#888',
          display: 'block',
          marginBottom: '10px'
        }}>
          Reason(s)
        </label>
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px'
        }}>
          {reasonOptions.map((reason) => (
            <button
              key={reason}
              onClick={() => toggleReason(reason)}
              style={{
                padding: '8px 14px',
                borderRadius: '20px',
                fontSize: '13px',
                cursor: 'pointer',
                border: reasons.includes(reason)
                  ? '2px solid #C94A3F'
                  : '2px solid #ddd',
                backgroundColor: reasons.includes(reason)
                  ? '#FDE8E7'
                  : 'white',
                color: reasons.includes(reason)
                  ? '#C94A3F'
                  : '#666'
              }}
            >
              {reason}
            </button>
          ))}
        </div>
      </div>

      <div style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        padding: '20px',
        border: '1px solid #eee',
        marginBottom: '16px'
      }}>
        <label style={{
          fontSize: '13px',
          color: '#888',
          display: 'block',
          marginBottom: '6px'
        }}>
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any additional notes..."
          rows={3}
          style={{
            width: '100%',
            padding: '12px',
            border: '2px solid #eee',
            borderRadius: '8px',
            fontSize: '15px',
            outline: 'none',
            boxSizing: 'border-box',
            resize: 'vertical',
            fontFamily: 'inherit'
          }}
        />
      </div>

      {status === 'returned' && (
        <button
          onClick={handleClose}
          style={{
            width: '100%',
            padding: '16px',
            backgroundColor: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '12px',
            fontSize: '18px',
            fontWeight: 'bold',
            cursor: 'pointer'
          }}
        >
          Close Transport
        </button>
      )}
    </div>
  )
}

export default TransportCard