import { useState, useEffect } from 'react'
import { db } from '../firebase'
import { doc, getDoc, updateDoc, serverTimestamp, collection, query, getDocs, setDoc, orderBy, limit } from 'firebase/firestore'
import DCCheckModal from './DCCheckModal'

function TransportCard({ transportId, onReturn, onClose }) {
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('open')
  const [departedAt, setDepartedAt] = useState(null)
  const [clients, setClients] = useState([])
  const [reasons, setReasons] = useState([])
  const [stops, setStops] = useState([])
  const [notes, setNotes] = useState('')
  const [showDCCheck, setShowDCCheck] = useState(false)
  const [pendingStopIndex, setPendingStopIndex] = useState(null)

  // Client input
  const [newClient, setNewClient] = useState('')
  const [clientSuggestions, setClientSuggestions] = useState([])
  const [showClientSuggestions, setShowClientSuggestions] = useState(false)

  // Destination suggestions
  const [destinationSuggestions, setDestinationSuggestions] = useState([])
  const [showDestSuggestionsFor, setShowDestSuggestionsFor] = useState(null)

  const reasonOptions = [
    'Medical X appointment',
    'Outside Provider',
    'Job interview',
    'Court',
    'Pharmacy',
    'Lab Work',
    'Dental',
    'Other'
  ]

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
          setClients(data.clients || [])
          setReasons(data.reasons || [])
          setStops(data.stops || [])
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

  const formatTime = (timestamp) => {
    if (!timestamp) return '--:--'
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const normalizeText = (text) => {
    return text.toLowerCase().trim().replace(/\s+/g, ' ')
  }

  // --- Suggestions ---

  const searchClientSuggestions = async (searchTerm) => {
    if (!searchTerm.trim()) {
      setClientSuggestions([])
      return
    }

    try {
      const clientsRef = collection(db, 'clients')
      const q = query(clientsRef, orderBy('label'), limit(20))
      const snapshot = await getDocs(q)

      const results = snapshot.docs
        .map(d => d.data())
        .filter(client =>
          client.normalizedLabel.includes(normalizeText(searchTerm))
        )
        .slice(0, 5)

      setClientSuggestions(results)
    } catch (error) {
      console.error('Error searching clients:', error)
    }
  }

  const searchDestinationSuggestions = async (searchTerm) => {
    if (!searchTerm.trim()) {
      setDestinationSuggestions([])
      return
    }

    try {
      const destRef = collection(db, 'destinations')
      const q = query(destRef, orderBy('name'), limit(20))
      const snapshot = await getDocs(q)

      const results = snapshot.docs
        .map(d => d.data())
        .filter(dest =>
          dest.normalizedName?.includes(normalizeText(searchTerm)) ||
          dest.normalizedAddress?.includes(normalizeText(searchTerm))
        )
        .slice(0, 5)

      setDestinationSuggestions(results)
    } catch (error) {
      console.error('Error searching destinations:', error)
    }
  }

  const saveClientToFirestore = async (clientName) => {
    try {
      const normalized = normalizeText(clientName)
      const clientRef = doc(db, 'clients', normalized)
      await setDoc(clientRef, {
        label: clientName,
        normalizedLabel: normalized,
        createdAt: serverTimestamp()
      }, { merge: true })
    } catch (error) {
      console.error('Error saving client:', error)
    }
  }

  const saveDestinationToFirestore = async (name, address) => {
    if (!address) return
    try {
      const normalizedAddress = normalizeText(address)
      const destRef = doc(db, 'destinations', normalizedAddress)
      await setDoc(destRef, {
        name: name || '',
        address,
        normalizedName: normalizeText(name || ''),
        normalizedAddress,
        createdAt: serverTimestamp()
      }, { merge: true })
    } catch (error) {
      console.error('Error saving destination:', error)
    }
  }

  // --- Client handlers ---

  const handleAddClient = async (clientName = newClient) => {
    const trimmed = clientName.trim()
    if (trimmed) {
      const updated = [...clients, trimmed]
      setClients(updated)
      setNewClient('')
      setShowClientSuggestions(false)
      await saveClientToFirestore(trimmed)
      await saveToFirestore({ clients: updated })
    }
  }

  const handleRemoveClient = (index) => {
    const updated = clients.filter((_, i) => i !== index)
    setClients(updated)
    saveToFirestore({ clients: updated })
  }

  const toggleReason = (reason) => {
    let updated
    if (reasons.includes(reason)) {
      updated = reasons.filter((r) => r !== reason)
    } else {
      updated = [...reasons, reason]
    }
    setReasons(updated)
    saveToFirestore({ reasons: updated })
  }

  // --- Stop handlers ---

  const handleArrive = () => {
    const newStop = {
      destinationName: '',
      destinationAddress: '',
      arrivedAt: new Date().toISOString(),
      dcCheck: null,
      note: ''
    }

    const updatedStops = [...stops, newStop]
    setStops(updatedStops)
    setPendingStopIndex(updatedStops.length - 1)
    setShowDCCheck(true)
  }

  const handleDCCheckComplete = async (dcCheckData) => {
    const updatedStops = [...stops]
    updatedStops[pendingStopIndex].dcCheck = dcCheckData

    setStops(updatedStops)
    setShowDCCheck(false)
    setPendingStopIndex(null)
    setStatus('arrived')

    await saveToFirestore({
      stops: updatedStops,
      status: 'arrived'
    })
  }

  const handleStopFieldChange = (index, field, value) => {
    const updatedStops = [...stops]
    updatedStops[index][field] = value
    setStops(updatedStops)
  }

  const handleStopFieldBlur = async (index) => {
    const stop = stops[index]
    await saveToFirestore({ stops })

    // Save destination for future suggestions if address is filled
    if (stop.destinationAddress?.trim()) {
      await saveDestinationToFirestore(stop.destinationName, stop.destinationAddress)
    }
  }

  const handlePickDestSuggestion = (stopIndex, suggestion) => {
    const updatedStops = [...stops]
    updatedStops[stopIndex].destinationName = suggestion.name
    updatedStops[stopIndex].destinationAddress = suggestion.address
    setStops(updatedStops)
    setShowDestSuggestionsFor(null)
    saveToFirestore({ stops: updatedStops })
  }

  // --- Return ---

  const allStopsHaveAddress = stops.length > 0 && stops.every(s => s.destinationAddress?.trim())
  const hasClients = clients.length > 0
  const canReturn = stops.length > 0 && allStopsHaveAddress && hasClients

  const getReturnBlockedReason = () => {
    const missing = []
    if (stops.length === 0) missing.push('at least one stop (click ARRIVE)')
    if (!allStopsHaveAddress && stops.length > 0) missing.push('address for all stops')
    if (!hasClients) missing.push('at least one client')
    return missing.join(', ')
  }

  const handleReturn = async () => {
    if (!canReturn) {
      alert('Cannot return yet. Missing: ' + getReturnBlockedReason())
      return
    }

    await saveToFirestore({
      status: 'returned',
      returnedAt: serverTimestamp()
    })
    onReturn()
  }

  // --- Firestore persistence ---

  const saveToFirestore = async (updates) => {
    if (!transportId) return

    try {
      await updateDoc(doc(db, 'transports', transportId), {
        ...updates,
        notes,
        updatedAt: serverTimestamp()
      })
    } catch (error) {
      console.error('Error saving transport:', error)
    }
  }

  const handleNotesBlur = () => {
    saveToFirestore({ notes })
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
      {/* Header */}
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

      {/* Departed banner */}
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

      {/* ARRIVE button — always enabled */}
      <button
        onClick={handleArrive}
        style={{
          width: '100%',
          padding: '16px',
          fontSize: '18px',
          fontWeight: 'bold',
          borderRadius: '10px',
          border: 'none',
          cursor: 'pointer',
          backgroundColor: '#2196F3',
          color: 'white',
          marginBottom: '16px'
        }}
      >
        ARRIVE{stops.length > 0 ? ` (Stop ${stops.length + 1})` : ''}
      </button>

      {/* Stops Section — editable after arrival */}
      {stops.length > 0 && (
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
            Stop(s)
          </label>

          {stops.map((stop, index) => (
            <div
              key={index}
              style={{
                padding: '12px',
                borderRadius: '8px',
                backgroundColor: stop.destinationAddress?.trim() ? '#F5F5F5' : '#FFF8E1',
                marginBottom: '10px',
                border: stop.destinationAddress?.trim() ? '1px solid #ddd' : '2px solid #FFB300'
              }}
            >
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px'
              }}>
                <span style={{ fontWeight: 'bold', fontSize: '14px', color: '#333' }}>
                  Stop {index + 1}
                </span>
                <span style={{ fontSize: '12px', color: '#999' }}>
                  Arrived: {new Date(stop.arrivedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              {stop.dcCheck && (
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>
                  DC Check: {stop.dcCheck.option}
                  {stop.dcCheck.note && ` — ${stop.dcCheck.note}`}
                </div>
              )}

              {/* Editable location fields */}
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  value={stop.destinationName}
                  onChange={(e) => {
                    handleStopFieldChange(index, 'destinationName', e.target.value)
                    searchDestinationSuggestions(e.target.value)
                    setShowDestSuggestionsFor(index)
                  }}
                  onBlur={() => {
                    handleStopFieldBlur(index)
                    setTimeout(() => setShowDestSuggestionsFor(null), 200)
                  }}
                  placeholder="Location name (optional)"
                  style={{
                    width: '100%',
                    padding: '8px',
                    border: '2px solid #eee',
                    borderRadius: '6px',
                    fontSize: '13px',
                    outline: 'none',
                    marginBottom: '6px',
                    boxSizing: 'border-box'
                  }}
                />
                <input
                  type="text"
                  value={stop.destinationAddress}
                  onChange={(e) => {
                    handleStopFieldChange(index, 'destinationAddress', e.target.value)
                    searchDestinationSuggestions(e.target.value)
                    setShowDestSuggestionsFor(index)
                  }}
                  onBlur={() => {
                    handleStopFieldBlur(index)
                    setTimeout(() => setShowDestSuggestionsFor(null), 200)
                  }}
                  placeholder="Address *"
                  style={{
                    width: '100%',
                    padding: '8px',
                    border: !stop.destinationAddress?.trim() ? '2px solid #FFB300' : '2px solid #eee',
                    borderRadius: '6px',
                    fontSize: '13px',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />

                {showDestSuggestionsFor === index && destinationSuggestions.length > 0 && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    backgroundColor: 'white',
                    border: '2px solid #eee',
                    borderRadius: '8px',
                    marginTop: '4px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    zIndex: 10,
                    maxHeight: '160px',
                    overflowY: 'auto'
                  }}>
                    {destinationSuggestions.map((suggestion, si) => (
                      <div
                        key={si}
                        onMouseDown={() => handlePickDestSuggestion(index, suggestion)}
                        style={{
                          padding: '8px 12px',
                          cursor: 'pointer',
                          borderBottom: si < destinationSuggestions.length - 1 ? '1px solid #eee' : 'none',
                          fontSize: '13px',
                          color: '#333'
                        }}
                        onMouseEnter={(e) => e.target.style.backgroundColor = '#f5f5f5'}
                        onMouseLeave={(e) => e.target.style.backgroundColor = 'white'}
                      >
                        <div style={{ fontWeight: 'bold' }}>{suggestion.name || 'Unnamed'}</div>
                        <div style={{ fontSize: '11px', color: '#666' }}>{suggestion.address}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {!stop.destinationAddress?.trim() && (
                <div style={{ fontSize: '11px', color: '#F57C00', marginTop: '6px' }}>
                  Address required before returning
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Clients Section */}
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
          Client(s) *
        </label>
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          marginBottom: clients.length > 0 ? '10px' : '0'
        }}>
          {clients.map((client, index) => (
            <div
              key={index}
              style={{
                padding: '6px 12px',
                borderRadius: '20px',
                backgroundColor: '#E8F5E9',
                border: '2px solid #4CAF50',
                color: '#2E7D32',
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <span>{client}</span>
              <button
                onClick={() => handleRemoveClient(index)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#2E7D32',
                  cursor: 'pointer',
                  fontSize: '16px',
                  padding: 0,
                  lineHeight: 1
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={newClient}
              onChange={(e) => {
                setNewClient(e.target.value)
                searchClientSuggestions(e.target.value)
                setShowClientSuggestions(true)
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleAddClient()}
              onFocus={() => newClient && setShowClientSuggestions(true)}
              onBlur={() => setTimeout(() => setShowClientSuggestions(false), 200)}
              placeholder="Add client name..."
              style={{
                flex: 1,
                padding: '10px',
                border: '2px solid #eee',
                borderRadius: '8px',
                fontSize: '14px',
                outline: 'none'
              }}
            />
            <button
              onClick={() => handleAddClient()}
              style={{
                padding: '10px 20px',
                backgroundColor: '#4CAF50',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              + Add
            </button>
          </div>
          {showClientSuggestions && clientSuggestions.length > 0 && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: '90px',
              backgroundColor: 'white',
              border: '2px solid #eee',
              borderRadius: '8px',
              marginTop: '4px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              zIndex: 10,
              maxHeight: '200px',
              overflowY: 'auto'
            }}>
              {clientSuggestions.map((suggestion, index) => (
                <div
                  key={index}
                  onMouseDown={() => handleAddClient(suggestion.label)}
                  style={{
                    padding: '10px 12px',
                    cursor: 'pointer',
                    borderBottom: index < clientSuggestions.length - 1 ? '1px solid #eee' : 'none',
                    fontSize: '14px',
                    color: '#333'
                  }}
                  onMouseEnter={(e) => e.target.style.backgroundColor = '#f5f5f5'}
                  onMouseLeave={(e) => e.target.style.backgroundColor = 'white'}
                >
                  {suggestion.label}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Reasons Section */}
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

      {/* Notes Section */}
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
          onBlur={handleNotesBlur}
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

      {/* RETURN button — blocked until mandatory fields complete */}
      <button
        onClick={handleReturn}
        disabled={!canReturn}
        style={{
          width: '100%',
          padding: '16px',
          fontSize: '18px',
          fontWeight: 'bold',
          borderRadius: '10px',
          border: 'none',
          cursor: canReturn ? 'pointer' : 'not-allowed',
          backgroundColor: canReturn ? '#4CAF50' : '#e8e8e8',
          color: canReturn ? 'white' : '#999',
          marginBottom: '8px'
        }}
      >
        RETURN
      </button>

      {!canReturn && stops.length > 0 && (
        <div style={{
          fontSize: '12px',
          color: '#F57C00',
          textAlign: 'center',
          marginBottom: '16px'
        }}>
          Missing: {getReturnBlockedReason()}
        </div>
      )}

      {/* DC Check Modal */}
      {showDCCheck && (
        <DCCheckModal
          onComplete={handleDCCheckComplete}
          onCancel={() => {
            const updatedStops = stops.slice(0, -1)
            setStops(updatedStops)
            setShowDCCheck(false)
            setPendingStopIndex(null)
          }}
        />
      )}
    </div>
  )
}

export default TransportCard
