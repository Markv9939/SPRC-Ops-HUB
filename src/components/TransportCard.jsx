import { useState, useEffect } from 'react'
import { db } from '../firebase'
import { doc, getDoc, serverTimestamp } from 'firebase/firestore'

function TransportCard({ transportId, onSave, onClose }) {
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('open')
  const [departedAt, setDepartedAt] = useState(null)
  const [arriveTime, setArriveTime] = useState(null)
  const [returnedAt, setReturnedAt] = useState(null)
  const [clients, setClients] = useState('')
  const [destination, setDestination] = useState('')
  const [reasons, setReasons] = useState([])
  const [notes, setNotes] = useState('')

  useEffect(() => {
    async function loadTransport() {
      if (!transportId) {
        setLoading(false)
        return
      }

      try {
        const docRef = doc(db, 'transports', transportId)
        const docSnap = await getDoc(docRef)

        if (docSnap.exists()) {
          const data = docSnap.data()
          setStatus(data.status || 'open')
          setDepartedAt(data.departedAt)
          setArriveTime(data.arriveTime || null)
          setReturnedAt(data.returnedAt || null)
          setClients(data.clients?.join(', ') || '')
          setDestination(data.stops?.[0]?.destinationAddress || '')
          setReasons(data.reasons || [])
          setNotes(data.notes || '')
        }
      } catch (error) {
        console.error('Error loading transport:', error)
      } finally {
        setLoading(false)
      }
    }

    loadTransport()
  }, [transportId])

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

  const formatTime = (timestamp) => {
    if (!timestamp) return '--:--'
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }

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
    setReturnedAt(serverTimestamp())
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
    const clientsArray = clients.split(',').map(c => c.trim()).filter(c => c)
    const stops = destination ? [{
      destinationName: '',
      destinationAddress: destination,
      arrivedAt: arriveTime ? new Date() : null,
      dcCheck: null
    }] : []

    const transportData = {
      clients: clientsArray,
      reasons,
      notes,
      stops,
      returnedAt: returnedAt || serverTimestamp(),
      status: 'returned'
    }
    onSave(transportData)
  }

  if (loading) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <p>Loading transport...</p>
      </div>
    )
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
        }}>{formatTime(departedAt)}</span>
      </div>

      <div style={{
        display: 'flex',
        gap: '10px',
        marginBottom: '24px'
      }}>
        <button
          onClick={handleArrive}
          disabled={status !== 'open'}
          style={{
            flex: 1,
            padding: '16px',
            fontSize: '16px',
            fontWeight: 'bold',
            borderRadius: '10px',
            border: 'none',
            cursor: status === 'open'
              ? 'pointer' : 'default',
            backgroundColor:
              status === 'open' ? '#2196F3' :
              '#e8e8e8',
            color:
              status === 'open' ? 'white' : '#999'
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
          {returnedAt && (
            <div style={{
              fontSize: '12px',
              fontWeight: 'normal',
              marginTop: '4px'
            }}>
              {formatTime(returnedAt)}
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