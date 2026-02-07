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
  const [destinations, setDestinations] = useState([])
  const [notes, setNotes] = useState('')
  const [showDCCheck, setShowDCCheck] = useState(false)
  const [pendingStopIndex, setPendingStopIndex] = useState(null)

  // Client input
  const [newClient, setNewClient] = useState('')
  const [clientSuggestions, setClientSuggestions] = useState([])
  const [showClientSuggestions, setShowClientSuggestions] = useState(false)

  // Destination input
  const [newDestName, setNewDestName] = useState('')
  const [newDestAddress, setNewDestAddress] = useState('')
  const [destinationSuggestions, setDestinationSuggestions] = useState([])
  const [showDestSuggestions, setShowDestSuggestions] = useState(false)

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

  // --- suggestions ---
  const searchClients = async (term) => {
    if (!term.trim()) { setClientSuggestions([]); return }
    try {
      const snap = await getDocs(query(collection(db, 'clients'), orderBy('label'), limit(20)))
      setClientSuggestions(snap.docs.map(d => d.data()).filter(c => c.normalizedLabel.includes(norm(term))).slice(0, 5))
    } catch (e) { console.error(e) }
  }

  const searchDests = async (term) => {
    if (!term.trim()) { setDestinationSuggestions([]); return }
    try {
      const snap = await getDocs(query(collection(db, 'destinations'), orderBy('name'), limit(20)))
      setDestinationSuggestions(snap.docs.map(d => d.data()).filter(dest =>
        dest.normalizedName?.includes(norm(term)) || dest.normalizedAddress?.includes(norm(term))
      ).slice(0, 5))
    } catch (e) { console.error(e) }
  }

  const persistClient = async (name) => {
    try {
      const n = norm(name)
      await setDoc(doc(db, 'clients', n), { label: name, normalizedLabel: n, createdAt: serverTimestamp() }, { merge: true })
    } catch (e) { console.error(e) }
  }

  const persistDest = async (name, addr) => {
    if (!addr) return
    try {
      const n = norm(addr)
      await setDoc(doc(db, 'destinations', n), { name: name||'', address: addr, normalizedName: norm(name||''), normalizedAddress: n, createdAt: serverTimestamp() }, { merge: true })
    } catch (e) { console.error(e) }
  }

  // --- clients ---
  const addClient = async (val = newClient) => {
    const t = val.trim()
    if (!t) return
    const updated = [...clients, t]
    setClients(updated); setNewClient(''); setShowClientSuggestions(false)
    await persistClient(t)
    await save({ clients: updated })
  }

  const removeClient = (i) => {
    const updated = clients.filter((_, idx) => idx !== i)
    setClients(updated); save({ clients: updated })
  }

  // --- reasons ---
  const toggleReason = (r) => {
    const updated = reasons.includes(r) ? reasons.filter(x => x !== r) : [...reasons, r]
    setReasons(updated); save({ reasons: updated })
  }

  // --- destinations (always visible, independent of ARRIVE) ---
  const addDestination = async () => {
    if (!newDestAddress.trim()) return
    const dest = { name: newDestName.trim(), address: newDestAddress.trim() }
    const updated = [...destinations, dest]
    setDestinations(updated)
    setNewDestName(''); setNewDestAddress(''); setShowDestSuggestions(false)
    await persistDest(dest.name, dest.address)
    await save({ destinations: updated })
  }

  const removeDest = (i) => {
    const updated = destinations.filter((_, idx) => idx !== i)
    setDestinations(updated); save({ destinations: updated })
  }

  const pickDestSuggestion = (s) => {
    setNewDestName(s.name); setNewDestAddress(s.address); setShowDestSuggestions(false)
  }

  // --- arrive (logs time, triggers DC check) ---
  const handleArrive = () => {
    const stop = { arrivedAt: new Date().toISOString(), dcCheck: null, note: '' }
    const updated = [...stops, stop]
    setStops(updated)
    setPendingStopIndex(updated.length - 1)
    setShowDCCheck(true)
  }

  const handleDCComplete = async (dc) => {
    const updated = [...stops]
    updated[pendingStopIndex].dcCheck = dc
    setStops(updated); setShowDCCheck(false); setPendingStopIndex(null); setStatus('arrived')
    await save({ stops: updated, status: 'arrived' })
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

  const handleFinish = async () => {
    if (!canFinish) { alert('Missing: ' + missingMsg()); return }
    await save({ status: 'returned', returnedAt: serverTimestamp(), destinations })
    onReturn()
  }

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <p style={{ color: '#888' }}>Loading transport...</p>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto', paddingBottom: '40px' }}>

      {/* Title row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }} className="animate-in">
        <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: '#333' }}>Transport</h2>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: '#aaa', padding: '4px 8px', borderRadius: '6px' }}>✕</button>
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
      <p style={{ textAlign: 'center', fontSize: '11px', color: '#999', marginBottom: '16px' }}>Tap to log an arrival time</p>

      {/* Arrivals */}
      {stops.length > 0 && (
        <div className="glass-card animate-in" style={{ marginBottom: '16px' }}>
          <div className="section-label">Arrivals</div>
          {stops.map((s, i) => (
            <div key={i} className="stop-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: '14px' }}>Arrival {i + 1}</span>
                <span style={{ marginLeft: '10px', fontSize: '12px', color: '#999' }}>
                  {new Date(s.arrivedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              {s.dcCheck && (
                <span className="badge badge-arrived">{s.dcCheck.option}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Destinations — always visible */}
      <div className="glass-card animate-in" style={{ marginBottom: '16px' }}>
        <div className="section-label">Destination(s) *</div>

        {destinations.map((d, i) => (
          <div key={i} className="dest-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              {d.name && <div style={{ fontWeight: 700, fontSize: '14px' }}>{d.name}</div>}
              <div style={{ fontSize: '13px', color: '#666' }}>{d.address}</div>
            </div>
            <button
              onClick={() => removeDest(i)}
              style={{ background: 'none', border: 'none', color: '#C94A3F', cursor: 'pointer', fontSize: '18px', padding: '0 4px', lineHeight: 1 }}
            >×</button>
          </div>
        ))}

        <div style={{ position: 'relative', marginTop: destinations.length > 0 ? '10px' : '0' }}>
          <input
            className="input"
            type="text"
            value={newDestName}
            onChange={(e) => { setNewDestName(e.target.value); searchDests(e.target.value); setShowDestSuggestions(true) }}
            onFocus={() => newDestName && setShowDestSuggestions(true)}
            onBlur={() => setTimeout(() => setShowDestSuggestions(false), 200)}
            placeholder="Location name (optional)"
            style={{ marginBottom: '8px' }}
          />
          <input
            className={`input ${!newDestAddress.trim() && destinations.length === 0 ? '' : ''}`}
            type="text"
            value={newDestAddress}
            onChange={(e) => { setNewDestAddress(e.target.value); searchDests(e.target.value); setShowDestSuggestions(true) }}
            onFocus={() => newDestAddress && setShowDestSuggestions(true)}
            onBlur={() => setTimeout(() => setShowDestSuggestions(false), 200)}
            onKeyDown={(e) => e.key === 'Enter' && addDestination()}
            placeholder="Address *"
            style={{ marginBottom: '10px' }}
          />

          {showDestSuggestions && destinationSuggestions.length > 0 && (
            <div className="suggestion-dropdown">
              {destinationSuggestions.map((s, i) => (
                <div key={i} className="suggestion-item" onMouseDown={() => pickDestSuggestion(s)}>
                  <div style={{ fontWeight: 700 }}>{s.name || 'Unnamed'}</div>
                  <div style={{ fontSize: '12px', color: '#666' }}>{s.address}</div>
                </div>
              ))}
            </div>
          )}

          <button
            className={`btn ${newDestAddress.trim() ? 'btn-primary' : 'btn-disabled'}`}
            onClick={addDestination}
            disabled={!newDestAddress.trim()}
            style={{ width: '100%', fontSize: '14px', padding: '12px' }}
          >
            + Add Destination
          </button>
        </div>
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
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              className="input"
              type="text"
              value={newClient}
              onChange={(e) => { setNewClient(e.target.value); searchClients(e.target.value); setShowClientSuggestions(true) }}
              onKeyDown={(e) => e.key === 'Enter' && addClient()}
              onFocus={() => newClient && setShowClientSuggestions(true)}
              onBlur={() => setTimeout(() => setShowClientSuggestions(false), 200)}
              placeholder="Add client name..."
              style={{ flex: 1 }}
            />
            <button className="btn btn-finish" onClick={() => addClient()} style={{ padding: '10px 18px', fontSize: '14px' }}>+ Add</button>
          </div>
          {showClientSuggestions && clientSuggestions.length > 0 && (
            <div className="suggestion-dropdown" style={{ right: '90px' }}>
              {clientSuggestions.map((s, i) => (
                <div key={i} className="suggestion-item" onMouseDown={() => addClient(s.label)}>{s.label}</div>
              ))}
            </div>
          )}
        </div>
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

      {/* DC Check Modal */}
      {showDCCheck && (
        <DCCheckModal
          onComplete={handleDCComplete}
          onCancel={() => { setStops(stops.slice(0, -1)); setShowDCCheck(false); setPendingStopIndex(null) }}
        />
      )}
    </div>
  )
}

export default TransportCard
