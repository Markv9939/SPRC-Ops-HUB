import { useState, useEffect, useCallback } from 'react'
import { db } from '../firebase'
import { doc, getDoc, updateDoc, deleteDoc, serverTimestamp, setDoc, increment } from 'firebase/firestore'
import DCPaperworkModal from './DCCheckModal'
import ClientAutocomplete from './ClientAutocomplete'
import DestinationAutocomplete from './DestinationAutocomplete'
import { requireOnline } from '../utils/networkGuard'
import { notifySuccess } from '../utils/toast'
import { showConfirmDialog } from '../utils/dialogs'

function TransportCard({ transportId, onClose, isOffline = false }) {
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('open')
  const [departedAt, setDepartedAt] = useState(null)
  const [clients, setClients] = useState([])
  const [reasons, setReasons] = useState([])
  const [stops, setStops] = useState([])
  const [destinations, setDestinations] = useState([])
  const [notes, setNotes] = useState('')
  const [showDCPaperwork, setShowDCPaperwork] = useState(false)
  const [dcPaperworkStatus, setDcPaperworkStatus] = useState(null)
  const [dcPaperworkOtherNote, setDcPaperworkOtherNote] = useState('')
  const normalizedStatus = String(status || '').trim().toLowerCase()
  const submitLocked = normalizedStatus === 'returned' || normalizedStatus === 'closed'
  const writeLocked = submitLocked || isOffline
  const activeTransport = normalizedStatus === 'open' || normalizedStatus === 'arrived'

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

  const loadTransport = useCallback(async () => {
    if (!transportId) { setLoading(false); return }
    try {
      const docSnap = await getDoc(doc(db, 'transports', transportId))
      if (docSnap.exists()) {
        const d = docSnap.data()
        setStatus(String(d.status || 'open').trim().toLowerCase())
        setDepartedAt(d.departedAt)
        setClients(d.clients || [])
        setReasons(d.reasons || [])
        setStops(d.stops || [])
        setDestinations(d.destinations || [])
        setNotes(d.notes || '')
        setDcPaperworkStatus(d.dcPaperworkStatus || null)
        setDcPaperworkOtherNote(d.dcPaperworkOtherNote || '')
      }
    } catch (err) {
      console.error('Error loading transport:', err)
    } finally {
      setLoading(false)
    }
  }, [transportId])

  useEffect(() => {
    loadTransport()
  }, [loadTransport])

  // --- helpers ---
  const fmt = (ts) => {
    if (!ts) return '--:--'
    const d = ts.toDate ? ts.toDate() : new Date(ts)
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }
  const norm = (t) => t.toLowerCase().trim().replace(/\s+/g, ' ')

  const save = async (updates) => {
    if (!transportId) return
    if (writeLocked) return
    try {
      await updateDoc(doc(db, 'transports', transportId), {
        ...updates,
        notes,
        version: increment(1),
        updatedAt: serverTimestamp()
      })
    } catch (err) {
      console.error('Save error:', err)
      const message = err?.message || 'Failed to save transport changes.'
      alert(message)
      await loadTransport()
      throw err
    }
  }

  const blockIfLocked = () => {
    if (isOffline) {
      requireOnline('editing transport records')
      return true
    }
    if (!submitLocked) return false
    if (normalizedStatus === 'closed') {
      alert('This transport is finished and locked from further edits.')
      return true
    }
    alert('This transport is returned and locked from further edits.')
    return true
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
    if (blockIfLocked()) return
    const updated = [...clients, clientName]
    setClients(updated)
    try {
      await touchClientUsage(clientName) // Update lastUsedAt
      await save({ clients: updated })
    } catch {
      // Error already handled in save()
    }
  }

  const removeClient = (i) => {
    if (blockIfLocked()) return
    const updated = clients.filter((_, idx) => idx !== i)
    setClients(updated)
    save({ clients: updated }).catch(() => {})
  }

  // --- reasons ---
  const toggleReason = (r) => {
    if (blockIfLocked()) return
    const updated = reasons.includes(r) ? reasons.filter(x => x !== r) : [...reasons, r]
    setReasons(updated)
    save({ reasons: updated }).catch(() => {})
  }

  // --- destinations ---
  const handleAddDestination = async (destination) => {
    if (blockIfLocked()) return
    const updated = [...destinations, destination]
    setDestinations(updated)
    try {
      await save({ destinations: updated })
    } catch {
      // Error already handled in save()
    }
  }

  const removeDest = (i) => {
    if (blockIfLocked()) return
    const updated = destinations.filter((_, idx) => idx !== i)
    setDestinations(updated)
    save({ destinations: updated }).catch(() => {})
  }

  const handleCancelTransport = async () => {
    if (!transportId) return
    if (blockIfLocked()) return
    const confirmed = await showConfirmDialog(
      'Cancel this transport? This removes it completely and cannot be undone.',
      {
        title: 'Cancel Transport',
        tone: 'danger',
        confirmText: 'Yes, Cancel Transport',
        cancelText: 'Keep Transport'
      }
    )
    if (!confirmed) return

    try {
      await deleteDoc(doc(db, 'transports', transportId))
      notifySuccess('Transport cancelled')
      onClose()
    } catch (err) {
      console.error('Cancel transport failed:', err)
      alert(err?.message || 'Failed to cancel transport. Please try again.')
    }
  }

  // --- finish ---
  const hasDest = destinations.length > 0 && destinations.every(d => d.address?.trim())
  const hasClient = clients.length > 0
  const hasReason = reasons.length > 0
  const canFinish = hasDest && hasClient && hasReason

  const missingMsg = () => {
    const m = []
    if (!hasClient) m.push('at least one client')
    if (!hasReason) m.push('at least one reason')
    if (destinations.length === 0) m.push('at least one destination')
    else if (!hasDest) m.push('address for all destinations')
    return m.join(', ')
  }

  const handleFinish = () => {
    if (blockIfLocked()) return
    if (!canFinish) { alert('Missing: ' + missingMsg()); return }
    setShowDCPaperwork(true)
  }

  const handleDCPaperworkComplete = async (result) => {
    if (writeLocked) return
    setShowDCPaperwork(false)
    setDcPaperworkStatus(result.status)
    setDcPaperworkOtherNote(result.otherNote || '')
    try {
      await save({
        status: 'closed',
        returnedAt: serverTimestamp(),
        closedAt: serverTimestamp(),
        destinations,
        dcPaperworkStatus: result.status,
        dcPaperworkOtherNote: result.otherNote || ''
      })
      notifySuccess('Transport closed')
      onClose()
    } catch {
      // Error already handled in save()
    }
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
        <p style={{ color: 'var(--text-secondary)' }}>Loading transport...</p>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto', paddingBottom: '40px' }}>

      {/* Title row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }} className="animate-in">
        <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: 'var(--text-primary)' }}>Transport</h2>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: '#556677', padding: '4px 8px', borderRadius: '6px' }}>✕</button>
      </div>

      {/* Departed banner */}
      <div className="departed-banner animate-in" style={{ marginBottom: '16px' }}>
        Departed at <strong style={{ marginLeft: '4px' }}>{fmt(departedAt)}</strong>
      </div>

      {activeTransport && !isOffline && (
        <button
          className="btn"
          onClick={handleCancelTransport}
          style={{
            width: '100%',
            marginBottom: '16px',
            borderRadius: 'var(--radius)',
            backgroundColor: '#ffffff',
            color: '#C94A3F',
            border: '2px solid #C94A3F',
            fontSize: '16px',
            fontWeight: 700
          }}
        >
          Cancel Transport
        </button>
      )}

      {isOffline && (
        <div style={{ marginBottom: '16px', fontSize: '12px', color: '#B07A28', textAlign: 'center' }}>
          Offline mode is active. Transport writes are disabled until connection is restored.
        </div>
      )}

      {submitLocked && (
        <div style={{ marginBottom: '16px', fontSize: '12px', color: '#B07A28', textAlign: 'center' }}>
          {normalizedStatus === 'closed'
            ? 'Transport is finished and locked. You can review details, but editing is disabled.'
            : 'Transport is returned and locked. You can review details, but editing is disabled.'}
        </div>
      )}

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
          <div style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
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
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{d.address}</div>
            </div>
            <button
              onClick={() => removeDest(i)}
              disabled={writeLocked}
              style={{ background: 'none', border: 'none', color: '#C94A3F', cursor: 'pointer', fontSize: '18px', padding: '0 4px', lineHeight: 1 }}
            >×</button>
          </div>
        ))}

        {!writeLocked ? (
          <DestinationAutocomplete
            onAddDestination={handleAddDestination}
            existingDestinations={destinations}
          />
        ) : (
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            {isOffline ? 'Destination editing is disabled while offline.' : 'Destination editing is locked after submit.'}
          </div>
        )}
      </div>

      {/* Clients */}
      <div className="glass-card animate-in" style={{ marginBottom: '16px' }}>
        <div className="section-label">Client(s) *</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: clients.length > 0 ? '10px' : '0' }}>
          {clients.map((c, i) => (
            <div key={i} className="chip chip-client">
              <span>{c}</span>
              <button onClick={() => removeClient(i)} disabled={writeLocked} style={{ background: 'none', border: 'none', color: '#2E7D32', cursor: 'pointer', fontSize: '16px', padding: 0, lineHeight: 1 }}>×</button>
            </div>
          ))}
        </div>
        {!writeLocked ? (
          <ClientAutocomplete
            onAddClient={handleAddClient}
            existingClients={clients}
            transportId={transportId}
          />
        ) : (
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            {isOffline ? 'Client editing is disabled while offline.' : 'Client editing is locked after submit.'}
          </div>
        )}
      </div>

      {/* Reasons */}
      <div className="glass-card animate-in" style={{ marginBottom: '16px' }}>
        <div className="section-label">Reason(s) *</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {reasonOptions.map((r) => (
            <button key={r} className={`chip ${reasons.includes(r) ? 'chip-selected' : 'chip-unselected'}`} onClick={() => toggleReason(r)} disabled={writeLocked}>
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
          onBlur={() => { if (!writeLocked) save({ notes }).catch(() => {}) }}
          readOnly={writeLocked}
          placeholder="Any additional notes..."
          rows={3}
          style={{ resize: 'vertical', fontFamily: 'inherit' }}
        />
      </div>

      {/* FINISH TX */}
      <button
        className={`btn ${canFinish ? 'btn-finish' : 'btn-disabled'}`}
        onClick={handleFinish}
        disabled={!canFinish || writeLocked}
        style={{ width: '100%', fontSize: '18px', padding: '16px', borderRadius: 'var(--radius)' }}
      >
        Finish TX / Log Return Time
      </button>

      {!canFinish && (clients.length > 0 || destinations.length > 0 || reasons.length > 0) && (
        <p style={{ fontSize: '12px', color: 'var(--orange)', textAlign: 'center', marginTop: '8px' }}>
          Missing: {missingMsg()}
        </p>
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



