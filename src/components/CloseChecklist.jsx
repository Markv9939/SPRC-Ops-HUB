import { useState, useEffect } from 'react'
import { db } from '../firebase'
import { doc, getDoc, serverTimestamp, collection, runTransaction } from 'firebase/firestore'
import { assertExpectedVersion, formatVersionConflictMessage, getVersionNumber } from '../services/versioning'
import { notifySuccess } from '../utils/toast'

function CloseChecklist({ transportId, onClose, onComplete, user, isOffline = false }) {
  const [loading, setLoading] = useState(true)
  const [transport, setTransport] = useState(null)
  const [errors, setErrors] = useState([])

  useEffect(() => {
    async function loadTransport() {
      try {
        const docRef = doc(db, 'transports', transportId)
        const docSnap = await getDoc(docRef)

        if (docSnap.exists()) {
          const transportData = { id: docSnap.id, ...docSnap.data(), version: getVersionNumber(docSnap.data()) }
          setTransport(transportData)
          validateTransport(transportData)
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

    if (data.status !== 'returned') {
      validationErrors.push('Transport must be in returned status before closing')
    }

    if (!data.clients || data.clients.length === 0) {
      validationErrors.push('At least one client is required')
    }

    // Check destinations array (new model) or fall back to stops
    const dests = data.destinations || []
    const stopsWithAddr = (data.stops || []).filter(s => s.destinationAddress?.trim())

    if (dests.length === 0 && stopsWithAddr.length === 0) {
      validationErrors.push('At least one destination is required')
    }

    setErrors(validationErrors)
  }

  const handleCloseTransport = async () => {
    if (isOffline) {
      alert('Offline mode: closing transport is unavailable until connection is restored.')
      return
    }

    if (errors.length > 0) {
      return
    }

    if (!transport || transport.status !== 'returned') {
      alert('Only returned transports can be closed.')
      return
    }

    try {
      const expectedVersion = getVersionNumber(transport)
      await runTransaction(db, async (transaction) => {
        const transportRef = doc(db, 'transports', transportId)
        const transportSnap = await transaction.get(transportRef)
        if (!transportSnap.exists()) {
          throw new Error('Transport no longer exists.')
        }

        const latest = transportSnap.data()
        if (latest.status !== 'returned') {
          throw new Error('Transport is no longer in returned status.')
        }

        const { nextVersion } = assertExpectedVersion({
          expectedVersion,
          currentVersion: getVersionNumber(latest),
          documentId: transportId,
          recordLabel: 'Transport'
        })

        transaction.update(transportRef, {
          status: 'closed',
          closedAt: serverTimestamp(),
          version: nextVersion,
          updatedAt: serverTimestamp()
        })

        if (user?.id && user?.name) {
          const auditRef = doc(collection(db, 'auditLogs'))
          transaction.set(auditRef, {
            action: 'transport_close',
            collectionPath: 'transports',
            documentId: transportId,
            performedByUserId: user.id,
            performedByName: user.name,
            reason: 'Transport closed via close checklist',
            version: 1,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          })
        }
      })
      notifySuccess('Transport closed')
      onComplete()
    } catch (error) {
      console.error('Error closing transport:', error)
      if (error?.code === 'version-conflict') {
        alert(formatVersionConflictMessage(error))
      } else {
        alert(error?.message || 'Failed to close transport. Please try again.')
      }
    }
  }

  if (loading) {
    return (
      <div style={{
        padding: '20px',
        textAlign: 'center',
        minHeight: '100vh',
        backgroundColor: 'var(--bg)',
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
      backgroundColor: 'var(--bg)'
    }}>
      <div style={{
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderRadius: '16px',
        padding: '24px',
        marginBottom: '20px'
      }}>
        <h2 style={{
          margin: '0 0 20px 0',
          fontSize: '24px',
          color: '#e8e8e8',
          textAlign: 'center'
        }}>
          Close Checklist
        </h2>

        <p style={{
          fontSize: '14px',
          color: '#8899aa',
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
            backgroundColor: transport?.clients?.length > 0 ? 'rgba(76,175,80,0.15)' : 'rgba(229,57,53,0.15)'
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
                  color: '#e8e8e8',
                  marginBottom: '4px'
                }}>
                  Client(s)
                </div>
                <div style={{ fontSize: '13px', color: '#8899aa' }}>
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
            backgroundColor: transport?.stops?.length > 0 ? 'rgba(76,175,80,0.15)' : 'rgba(229,57,53,0.15)'
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
                  color: '#e8e8e8',
                  marginBottom: '4px'
                }}>
                  Stop(s) with Address
                </div>
                <div style={{ fontSize: '13px', color: '#8899aa' }}>
                  {transport?.stops?.length > 0
                    ? `${transport.stops.length} stop(s) recorded`
                    : 'No stops recorded'}
                </div>
              </div>
            </div>
          </div>

          {transport?.dcPaperworkStatus && (
            <div style={{
              padding: '16px',
              borderRadius: '10px',
              border: '2px solid #4CAF50',
              backgroundColor: 'rgba(76,175,80,0.15)'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}>
                <span style={{ fontSize: '20px' }}>✓</span>
                <div>
                  <div style={{
                    fontWeight: 'bold',
                    color: '#e8e8e8',
                    marginBottom: '4px'
                  }}>
                    DC paperwork
                  </div>
                  <div style={{ fontSize: '13px', color: '#8899aa' }}>
                    {transport.dcPaperworkStatus === 'collected' && 'Collected'}
                    {transport.dcPaperworkStatus === 'na' && 'N/A'}
                    {transport.dcPaperworkStatus === 'other' && (
                      <>Other{transport.dcPaperworkOtherNote ? ` — ${transport.dcPaperworkOtherNote}` : ''}</>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {errors.length > 0 && (
          <div style={{
            padding: '16px',
            borderRadius: '10px',
            backgroundColor: 'rgba(229,57,53,0.15)',
            border: '2px solid #E53935',
            marginBottom: '20px'
          }}>
            <div style={{
              fontWeight: 'bold',
              color: '#E53935',
              marginBottom: '8px'
            }}>
              Cannot close transport:
            </div>
            <ul style={{
              margin: 0,
              paddingLeft: '20px',
              color: '#E53935',
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
              backgroundColor: 'rgba(255,255,255,0.06)',
              color: '#8899aa',
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
            disabled={errors.length > 0 || isOffline}
            style={{
              flex: 1,
              padding: '16px',
              backgroundColor: (errors.length > 0 || isOffline) ? '#e8e8e8' : '#4CAF50',
              color: (errors.length > 0 || isOffline) ? '#999' : 'white',
              border: 'none',
              borderRadius: '12px',
              fontSize: '18px',
              fontWeight: 'bold',
              cursor: (errors.length > 0 || isOffline) ? 'not-allowed' : 'pointer',
              opacity: (errors.length > 0 || isOffline) ? 0.6 : 1
            }}
          >
            Close Transport
          </button>
        </div>
        {isOffline && (
          <div style={{ marginTop: '10px', fontSize: '12px', color: '#FF9800', textAlign: 'center' }}>
            Offline mode is active. Close transport is disabled until connection is restored.
          </div>
        )}
      </div>
    </div>
  )
}

export default CloseChecklist
