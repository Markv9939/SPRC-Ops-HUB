import { useState, useEffect } from 'react'
import { db } from '../firebase'
import { doc, getDoc, updateDoc, serverTimestamp, collection, query, getDocs, setDoc, orderBy, limit } from 'firebase/firestore'
import DCPaperworkModal from './DCCheckModal'
import ClientAutocomplete from './ClientAutocomplete'
import DestinationAutocomplete from './DestinationAutocomplete'

function TransportCard({ transportId, user, onReturn, onClose }) {
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('open')
  const [departedAt, setDepartedAt] = useState(null)
  const [clients, setClients] = useState([])
  const [reasons, setReasons] = useState([])
  const [stops, setStops] = useState([])
  const [destinations, setDestinations] = useState([])
  const [notes, setNotes] = useState('')
  const [showDCPaperwork, setShowDCPaperwork] = useState(false)
  const [showArriveReminder, setShowArriveReminder] = useState(false)
  const [dcPaperworkStatus, setDcPaperworkStatus] = useState(null)
  const [dcPaperworkOtherNote, setDcPaperworkOtherNote] = useState('')

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
      if (!transportId) { setLoading(false); return }
      try {
        const docSnap = await getDoc(doc(db, 'transports', transportId))
        if (docSnap.exists()) {
          const d = docSnap.data()
          setStatus(d.status || 'open')
          setDepartedAt(d.departedAt)
          setClients(d.clients || [])
          setReasons(d.reasons || [])
          setStops(d.stops || [])
          setDestinations(d.destinations || [])
          setNotes(d.notes || '')
          setDcPaperworkStatus(d.dcPaperworkStatus || null)
          setDcPaperworkOtherNote(d.dcPaperworkOtherNote || '')
        }
      } catch (err) { console.error('Error loading transport:', err) }
      finally { setLoading(false) }
    }
    loadTransport()
  }, [transportId])

  // --- helpers ---
  const fmt = (ts) => {
    if (!ts) return '--:--'
    const d = ts.toDate ? ts.toDate() : new Date(ts)
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }
  const norm = (t) => t.toLowerCase().trim().replace(/\s+/g, ' ')

  const save = async (updates) => {
    if (!transportId) return
    try {
      await updateDoc(doc(db, 'transports', transportId), { ...updates, notes, updatedAt: serverTimestamp() })
    } catch (err) { console.error('Save error:', err) }
  }

  // --- client usage tracking ---
  const touchClientUsage = async (clientName) => {
    try {
      const n = norm(clientName)
      await setDoc(
        doc(db, 'clients', n),
        {
          label: clientName,
          normalizedLabel: n,
          active: true,
          lastUsedAt: serverTimestamp(),
          createdAt: serverTimestamp()
        },
        { merge: true }
      )
    } catch (e) {
      console.error('Error updating client usage:', e)
    }
  }

  // --- clients ---
  const handleAddClient = async (clientName) => {
    const updated = [...clients, clientName]
    setClients(updated)
    await touchClientUsage(clientName) // Update lastUsedAt
    await save({ clients: updated })
  }

  const removeClient = (i) => {
    const updated = clients.filter((_, idx) => idx !== i)
    setClients(updated)
    save({ clients: updated })
  }

  // --- reasons ---
  const toggleReason = (r) => {
    const updated = reasons.includes(r) ? reasons.filter(x => x !== r) : [...reasons, r]
    setReasons(updated); save({ reasons: updated })
  }

  // --- destinations ---
  const handleAddDestination = async (destination) => {
    const updated = [...destinations, destination]
    setDestinations(updated)
    await save({ destinations: updated })
  }

  const removeDest = (i) => {
    const updated = destinations.filter((_, idx) => idx !== i)
    setDestinations(updated)
    save({ destinations: updated })
  }

  // --- arrive (logs time, shows DC reminder) ---
  const handleArrive = () => {
    setShowArriveReminder(true)
  }

  const handleArriveConfirm = () => {
    setShowArriveReminder(false)
    const stop = { arrivedAt: new Date().toISOString() }
    const updated = [...stops, stop]
    setStops(updated)
    setStatus('arrived')
    save({ stops: updated, status: 'arrived' })
  }

  // --- finish ---
  const hasDest = destinations.length > 0 && destinations.every(d => d.address?.trim())
  const hasClient = clients.length > 0
  const hasStop = stops.length > 0
  const canFinish = hasDest && hasClient && hasStop

  const missingMsg = () => {
    const m = []
    if (!hasStop) m.push('at least one arrival (click ARRIVE)')
    if (!hasClient) m.push('at least one client')
    if (destinations.length === 0) m.push('at least one destination')
    else if (!hasDest) m.push('address for all destinations')
    return m.join(', ')
  }

  const handleFinish = () => {
    if (!canFinish) { alert('Missing: ' + missingMsg()); return }
    setShowDCPaperwork(true)
  }

  const handleDCPaperworkComplete = async (result) => {
    setShowDCPaperwork(false)
    setDcPaperworkStatus(result.status)
    setDcPaperworkOtherNote(result.otherNote || '')
    await save({
      status: 'returned',
      returnedAt: serverTimestamp(),
      destinations,
      dcPaperworkStatus: result.status,
      dcPaperworkOtherNote: result.otherNote || ''
    })
    onReturn()
  }

  const dcStatusLabel = (s) => {
    if (s === 'collected') return 'Collected'
    if (s === 'na') return 'N/A'
    if (s === 'other') return 'Other'
    return s
  }

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <p style={{ color: '#8899aa' }}>Loading transport...</p>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto', paddingBottom: '40px' }}>

      {/* Title row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }} className="animate-in">
        <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: '#e8e8e8' }}>Transport</h2>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: '#556677', padding: '4px 8px', borderRadius: '6px' }}>✕</button>
      </div>

      {/* Departed banner */}
      <div className="departed-banner animate-in" style={{ marginBottom: '16px' }}>
        Departed at <strong style={{ marginLeft: '4px' }}>{fmt(departedAt)}</strong>
      </div>

      {/* ARRIVE */}
      <button
        className={`btn btn-arrive pulse`}
        onClick={handleArrive}
        style={{ width: '100%', fontSize: '18px', marginBottom: '6px', borderRadius: 'var(--radius)' }}
      >
        ARRIVE{stops.length > 0 ? ` (${stops.length} logged)` : ''}
      </button>
      <p style={{ textAlign: 'center', fontSize: '11px', color: '#556677', marginBottom: '16px' }}>Tap to log an arrival time</p>

      {/* Arrivals */}
      {stops.length > 0 && (
        <div className="glass-card animate-in" style={{ marginBottom: '16px' }}>
          <div className="section-label">Arrivals</div>
          {stops.map((s, i) => (
            <div key={i} className="stop-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: '14px' }}>Arrival {i + 1}</span>
                <span style={{ marginLeft: '10px', fontSize: '12px', color: '#556677' }}>
                  {new Date(s.arrivedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* DC Paperwork Status (shown after return) */}
      {dcPaperworkStatus && (
        <div className="glass-card animate-in" style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '14px', color: '#e8e8e8' }}>
            <strong>DC paperwork:</strong>{' '}
            {dcStatusLabel(dcPaperworkStatus)}
            {dcPaperworkStatus === 'other' && dcPaperworkOtherNote && (
              <span> — {dcPaperworkOtherNote}</span>
            )}
          </div>
        </div>
      )}

      {/* Destinations — always visible */}
      <div className="glass-card animate-in" style={{ marginBottom: '16px' }}>
        <div className="section-label">Destination(s) *</div>

        {destinations.map((d, i) => (
          <div key={i} className="dest-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              {d.name && <div style={{ fontWeight: 700, fontSize: '14px' }}>{d.name}</div>}
              <div style={{ fontSize: '13px', color: '#8899aa' }}>{d.address}</div>
            </div>
            <button
              onClick={() => removeDest(i)}
              style={{ background: 'none', border: 'none', color: '#C94A3F', cursor: 'pointer', fontSize: '18px', padding: '0 4px', lineHeight: 1 }}
            >×</button>
          </div>
        ))}

        <DestinationAutocomplete
          onAddDestination={handleAddDestination}
          existingDestinations={destinations}
        />
      </div>

      {/* Clients */}
      <div className="glass-card animate-in" style={{ marginBottom: '16px' }}>
        <div className="section-label">Client(s) *</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: clients.length > 0 ? '10px' : '0' }}>
          {clients.map((c, i) => (
            <div key={i} className="chip chip-client">
              <span>{c}</span>
              <button onClick={() => removeClient(i)} style={{ background: 'none', border: 'none', color: '#2E7D32', cursor: 'pointer', fontSize: '16px', padding: 0, lineHeight: 1 }}>×</button>
            </div>
          ))}
        </div>
        <ClientAutocomplete
          onAddClient={handleAddClient}
          existingClients={clients}
          transportId={transportId}
        />
      </div>

      {/* Reasons */}
      <div className="glass-card animate-in" style={{ marginBottom: '16px' }}>
        <div className="section-label">Reason(s)</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {reasonOptions.map((r) => (
            <button key={r} className={`chip ${reasons.includes(r) ? 'chip-selected' : 'chip-unselected'}`} onClick={() => toggleReason(r)}>
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div className="glass-card animate-in" style={{ marginBottom: '20px' }}>
        <div className="section-label">Notes (optional)</div>
        <textarea
          className="input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => save({ notes })}
          placeholder="Any additional notes..."
          rows={3}
          style={{ resize: 'vertical', fontFamily: 'inherit' }}
        />
      </div>

      {/* FINISH TX */}
      <button
        className={`btn ${canFinish ? 'btn-finish' : 'btn-disabled'}`}
        onClick={handleFinish}
        disabled={!canFinish}
        style={{ width: '100%', fontSize: '18px', padding: '16px', borderRadius: 'var(--radius)' }}
      >
        Finish TX
      </button>

      {!canFinish && (stops.length > 0 || clients.length > 0 || destinations.length > 0) && (
        <p style={{ fontSize: '12px', color: 'var(--orange)', textAlign: 'center', marginTop: '8px' }}>
          Missing: {missingMsg()}
        </p>
      )}

      {/* Arrive DC Reminder Modal */}
      {showArriveReminder && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div style={{
            backgroundColor: '#1a2332',
            borderRadius: '16px',
            padding: '24px',
            maxWidth: '400px',
            width: '100%',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            border: '1px solid rgba(229,57,53,0.3)'
          }}>
            <h2 style={{
              margin: '0 0 24px 0',
              fontSize: '20px',
              color: '#E53935',
              textAlign: 'center'
            }}>
              REMIND THE CLIENT ABOUT DC PAPERWORK
            </h2>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setShowArriveReminder(false)}
                style={{
                  flex: 1,
                  padding: '14px',
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  color: '#8899aa',
                  border: 'none',
                  borderRadius: '10px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleArriveConfirm}
                style={{
                  flex: 1,
                  padding: '14px',
                  backgroundColor: '#E53935',
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DC Paperwork Modal */}
      {showDCPaperwork && (
        <DCPaperworkModal
          onComplete={handleDCPaperworkComplete}
          onCancel={() => setShowDCPaperwork(false)}
        />
      )}
    </div>
  )
}

export default TransportCard
