import { useState, useEffect } from 'react'
import { db } from '../firebase'
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore'

function CloseChecklist({ transportId, onClose, onComplete }) {
  const [loading, setLoading] = useState(true)
  const [transport, setTransport] = useState(null)
  const [errors, setErrors] = useState([])

  useEffect(() => {
    async function loadTransport() {
      try {
        const docRef = doc(db, 'transports', transportId)
        const docSnap = await getDoc(docRef)

        if (docSnap.exists()) {
          setTransport(docSnap.data())
          validateTransport(docSnap.data())
        }
      } catch (error) {
        console.error('Error loading transport:', error)
      } finally {
        setLoading(false)
      }
    }

    loadTransport()
  }, [transportId])

  const validateTransport = (data) => {
    const validationErrors = []

    if (!data.clients || data.clients.length === 0) {
      validationErrors.push('At least one client is required')
    }

    if (!data.stops || data.stops.length === 0) {
      validationErrors.push('At least one stop with address is required')
    } else {
      const hasValidStop = data.stops.some(
        stop => stop.destinationAddress && stop.destinationAddress.trim()
      )
      if (!hasValidStop) {
        validationErrors.push('At least one stop must have an address')
      }
    }

    setErrors(validationErrors)
  }

  const handleCloseTransport = async () => {
    if (errors.length > 0) {
      return
    }

    try {
      await updateDoc(doc(db, 'transports', transportId), {
        status: 'closed',
        closedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
      onComplete()
    } catch (error) {
      console.error('Error closing transport:', error)
      alert('Failed to close transport. Please try again.')
    }
  }

  if (loading) {
    return (
      <div style={{
        padding: '20px',
        textAlign: 'center',
        minHeight: '100vh',
        backgroundColor: '#f5f5f5',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <p>Loading checklist...</p>
      </div>
    )
  }

  return (
    <div style={{
      padding: '20px',
      maxWidth: '600px',
      margin: '0 auto',
      minHeight: '100vh',
      backgroundColor: '#f5f5f5'
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '16px',
        padding: '24px',
        marginBottom: '20px'
      }}>
        <h2 style={{
          margin: '0 0 20px 0',
          fontSize: '24px',
          color: '#333',
          textAlign: 'center'
        }}>
          Close Checklist
        </h2>

        <p style={{
          fontSize: '14px',
          color: '#666',
          textAlign: 'center',
          marginBottom: '24px'
        }}>
          Please review before closing this transport
        </p>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          marginBottom: '24px'
        }}>
          <div style={{
            padding: '16px',
            borderRadius: '10px',
            border: '2px solid ' + (transport?.clients?.length > 0 ? '#4CAF50' : '#C94A3F'),
            backgroundColor: transport?.clients?.length > 0 ? '#E8F5E9' : '#FFEBEE'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}>
              <span style={{ fontSize: '20px' }}>
                {transport?.clients?.length > 0 ? '✓' : '✗'}
              </span>
              <div>
                <div style={{
                  fontWeight: 'bold',
                  color: '#333',
                  marginBottom: '4px'
                }}>
                  Client(s)
                </div>
                <div style={{ fontSize: '13px', color: '#666' }}>
                  {transport?.clients?.length > 0
                    ? `${transport.clients.length} client(s): ${transport.clients.join(', ')}`
                    : 'No clients entered'}
                </div>
              </div>
            </div>
          </div>

          <div style={{
            padding: '16px',
            borderRadius: '10px',
            border: '2px solid ' + (transport?.stops?.length > 0 ? '#4CAF50' : '#C94A3F'),
            backgroundColor: transport?.stops?.length > 0 ? '#E8F5E9' : '#FFEBEE'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}>
              <span style={{ fontSize: '20px' }}>
                {transport?.stops?.length > 0 ? '✓' : '✗'}
              </span>
              <div>
                <div style={{
                  fontWeight: 'bold',
                  color: '#333',
                  marginBottom: '4px'
                }}>
                  Stop(s) with Address
                </div>
                <div style={{ fontSize: '13px', color: '#666' }}>
                  {transport?.stops?.length > 0
                    ? `${transport.stops.length} stop(s) recorded`
                    : 'No stops recorded'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {errors.length > 0 && (
          <div style={{
            padding: '16px',
            borderRadius: '10px',
            backgroundColor: '#FFEBEE',
            border: '2px solid #C94A3F',
            marginBottom: '20px'
          }}>
            <div style={{
              fontWeight: 'bold',
              color: '#C94A3F',
              marginBottom: '8px'
            }}>
              Cannot close transport:
            </div>
            <ul style={{
              margin: 0,
              paddingLeft: '20px',
              color: '#C94A3F',
              fontSize: '14px'
            }}>
              {errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        <div style={{
          display: 'flex',
          gap: '10px'
        }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: '16px',
              backgroundColor: '#e8e8e8',
              color: '#666',
              border: 'none',
              borderRadius: '12px',
              fontSize: '18px',
              fontWeight: 'bold',
              cursor: 'pointer'
            }}
          >
            Go Back
          </button>
          <button
            onClick={handleCloseTransport}
            disabled={errors.length > 0}
            style={{
              flex: 1,
              padding: '16px',
              backgroundColor: errors.length > 0 ? '#e8e8e8' : '#4CAF50',
              color: errors.length > 0 ? '#999' : 'white',
              border: 'none',
              borderRadius: '12px',
              fontSize: '18px',
              fontWeight: 'bold',
              cursor: errors.length > 0 ? 'not-allowed' : 'pointer',
              opacity: errors.length > 0 ? 0.6 : 1
            }}
          >
            Close Transport
          </button>
        </div>
      </div>
    </div>
  )
}

export default CloseChecklist
