import { useState, useEffect, useCallback } from 'react'
import { db } from '../firebase'
import { doc, getDoc, updateDoc, deleteDoc, serverTimestamp, setDoc, increment } from 'firebase/firestore'
import DCPaperworkModal from './DCCheckModal'
import ClientAutocomplete from './ClientAutocomplete'
import DestinationAutocomplete from './DestinationAutocomplete'
import { notifySuccess } from '../utils/toast'
import { showConfirmDialog } from '../utils/dialogs'
import { createTransportCompletedAlert, writeAuditLog } from '../services/notificationService'
import { deleteOfflineDraft, getOfflineDraft, saveOfflineDraft } from '../services/offlineStore'
import { getTransportDraftId, queueTransportClose, queueTransportUpdate } from '../services/offlineSyncService'

function TransportCard({ transportId, user, onClose, onTransportClosed, isOffline = false }) {
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
  const [showMore, setShowMore] = useState(false)
  const [version, setVersion] = useState(1)
  const [hasLocalDraft, setHasLocalDraft] = useState(false)

  const normalizedStatus = String(status || '').trim().toLowerCase()
  const submitLocked = normalizedStatus === 'returned' || normalizedStatus === 'closed'
  const writeLocked = submitLocked
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
        setVersion(Number(d.version || 1))

        const localDraft = await getOfflineDraft(getTransportDraftId(transportId)).catch(() => null)
        const local = localDraft?.payload?.snapshot
        if (local) {
          setStatus(String(local.status || d.status || 'open').trim().toLowerCase())
          setClients(local.clients || [])
          setReasons(local.reasons || [])
          setStops(local.stops || [])
          setDestinations(local.destinations || [])
          setNotes(local.notes || '')
          setDcPaperworkStatus(local.dcPaperworkStatus || null)
          setDcPaperworkOtherNote(local.dcPaperworkOtherNote || '')
          setHasLocalDraft(true)
        }
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

  const fmt = (ts) => {
    if (!ts) return '--:--'
    const d = ts.toDate ? ts.toDate() : new Date(ts)
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  const norm = (t) => t.toLowerCase().trim().replace(/\s+/g, ' ')

  const buildSnapshot = (updates = {}) => ({
    status,
    departedAt,
    clients,
    reasons,
    stops,
    destinations,
    notes,
    dcPaperworkStatus,
    dcPaperworkOtherNote,
    ...updates
  })

  const save = async (updates) => {
    if (!transportId) return
    if (writeLocked) return
    const snapshot = buildSnapshot({ ...updates, notes: updates?.notes ?? notes })
    if (isOffline) {
      const offlineUpdates = {
        clients,
        reasons,
        stops,
        destinations,
        dcPaperworkStatus,
        dcPaperworkOtherNote,
        ...updates,
        notes: updates?.notes ?? notes
      }
      await saveOfflineDraft(getTransportDraftId(transportId), 'transport', { snapshot, expectedVersion: version })
      await queueTransportUpdate({
        transportId,
        expectedVersion: version,
        updates: offlineUpdates,
        snapshot,
        user
      })
      setHasLocalDraft(true)
      return
    }
    try {
      await updateDoc(doc(db, 'transports', transportId), {
        ...updates,
        notes,
        version: increment(1),
        updatedAt: serverTimestamp()
      })
      setVersion(prev => Number(prev || 1) + 1)
      setHasLocalDraft(false)
      await deleteOfflineDraft(getTransportDraftId(transportId))
    } catch (err) {
      console.error('Save error:', err)
      const message = err?.message || 'Failed to save transport changes.'
      alert(message)
      await loadTransport()
      throw err
    }
  }

  const blockIfLocked = () => {
    if (!submitLocked) return false
    if (normalizedStatus === 'closed') {
      alert('This transport is finished and locked from further edits.')
      return true
    }
    alert('This transport is returned and locked from further edits.')
    return true
  }

  const touchClientUsage = async (clientName) => {
    if (isOffline) return
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

  const handleAddClient = async (clientName) => {
    if (blockIfLocked()) return
    const updated = [...clients, clientName]
    setClients(updated)
    try {
      await touchClientUsage(clientName)
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

  const toggleReason = (r) => {
    if (blockIfLocked()) return
    const updated = reasons.includes(r) ? reasons.filter(x => x !== r) : [...reasons, r]
    setReasons(updated)
    save({ reasons: updated }).catch(() => {})
  }

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
        confirmText: 'Yes, Cancel',
        cancelText: 'Keep It'
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

  // --- Validation ---
  const hasDest = destinations.length > 0 && destinations.every(d => d.address?.trim())
  const hasClient = clients.length > 0
  const hasReason = reasons.length > 0
  const canFinish = hasDest && hasClient && hasReason

  const missingFields = () => {
    const m = []
    if (!hasClient) m.push('client')
    if (!hasReason) m.push('reason')
    if (destinations.length === 0) m.push('destination')
    else if (!hasDest) m.push('destination address')
    return m
  }

  const handleFinish = () => {
    if (blockIfLocked()) return
    if (!canFinish) {
      const missing = missingFields()
      alert('Please add: ' + missing.join(', '))
      return
    }
    setShowDCPaperwork(true)
  }

  const handleDCPaperworkComplete = async (result) => {
    if (writeLocked) return
    setShowDCPaperwork(false)
    setDcPaperworkStatus(result.status)
    setDcPaperworkOtherNote(result.otherNote || '')
    const closedAt = new Date()
    const closeUpdates = {
      status: 'closed',
      returnedAt: closedAt.toISOString(),
      closedAt: closedAt.toISOString(),
      destinations,
      dcPaperworkStatus: result.status,
      dcPaperworkOtherNote: result.otherNote || ''
    }
    const closedTransport = {
      id: transportId,
      status: 'closed',
      departedAt,
      returnedAt: closedAt,
      closedAt,
      clients,
      reasons,
      stops,
      destinations,
      notes,
      dcPaperworkStatus: result.status,
      dcPaperworkOtherNote: result.otherNote || ''
    }

    if (isOffline) {
      setStatus('closed')
      const snapshot = buildSnapshot(closeUpdates)
      await saveOfflineDraft(getTransportDraftId(transportId), 'transport', { snapshot, expectedVersion: version })
      await queueTransportClose({
        transportId,
        expectedVersion: version,
        updates: {
          destinations,
          dcPaperworkStatus: result.status,
          dcPaperworkOtherNote: result.otherNote || '',
          clients,
          reasons,
          stops,
          notes
        },
        closedTransport,
        user,
        auditReason: `DC paperwork: ${dcStatusLabel(result.status)}`
      })
      setHasLocalDraft(true)
      onTransportClosed?.(closedTransport)
      notifySuccess('Transport saved on this device. It will sync when internet returns.')
      onClose()
      return
    }

    try {
      await save({
        status: 'closed',
        returnedAt: serverTimestamp(),
        closedAt: serverTimestamp(),
        destinations,
        dcPaperworkStatus: result.status,
        dcPaperworkOtherNote: result.otherNote || ''
      })
      setStatus('closed')
      onTransportClosed?.(closedTransport)
      try {
        await createTransportCompletedAlert({
          transport: { ...closedTransport, site: user?.site || user?.location || '' },
          userName: user?.name
        })
        await writeAuditLog({
          action: 'transport_closed',
          collectionPath: 'transports',
          documentId: transportId,
          reason: `DC paperwork: ${dcStatusLabel(result.status)}`,
          actorUser: user,
          extra: { dcPaperworkStatus: result.status }
        })
      } catch (notificationError) {
        console.warn('Transport closed, but follow-up alert/audit write failed:', notificationError)
      }
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

  // --- Progress indicator ---
  const completedSteps = [hasClient, hasDest, hasReason].filter(Boolean).length
  const totalSteps = 3
  const progressPercent = Math.round((completedSteps / totalSteps) * 100)

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Loading transport...</p>
      </div>
    )
  }

  return (
    <div className="transport-page">
      {/* Header */}
      <div className="transport-header">
        <div>
          <div className="transport-title">Transport</div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Departed {fmt(departedAt)}
          </div>
        </div>
        <button className="transport-close-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>

      {/* Status messages */}
      {isOffline && (
        <div style={{ marginBottom: '12px', fontSize: '13px', color: '#B07A28', textAlign: 'center', padding: '8px', background: 'rgba(176,122,40,0.08)', borderRadius: '8px' }}>
          Offline - transport changes will be saved on this device and synced when internet returns.
        </div>
      )}
      {hasLocalDraft && (
        <div style={{ marginBottom: '12px', fontSize: '13px', color: '#2F7D57', textAlign: 'center', padding: '8px', background: 'rgba(47,125,87,0.08)', borderRadius: '8px' }}>
          Pending sync
        </div>
      )}
      {submitLocked && (
        <div style={{ marginBottom: '12px', fontSize: '13px', color: 'var(--text-secondary)', textAlign: 'center', padding: '8px', background: 'rgba(17,47,82,0.04)', borderRadius: '8px' }}>
          Transport is {normalizedStatus} — view only
        </div>
      )}

      {/* Progress bar (only for active transports) */}
      {activeTransport && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span className="progress-label">{completedSteps} of {totalSteps} required fields</span>
            <span className="progress-label">{progressPercent}%</span>
          </div>
          <div className="progress-bar-container">
            <div
              className={`progress-bar-fill ${progressPercent < 100 ? 'progress-bar-fill-warning' : ''}`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* DC Paperwork Status (shown after close) */}
      {dcPaperworkStatus && (
        <div className="glass-card" style={{ marginBottom: '16px', padding: '14px' }}>
          <div style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
            <strong>DC paperwork:</strong>{' '}
            {dcStatusLabel(dcPaperworkStatus)}
            {dcPaperworkStatus === 'other' && dcPaperworkOtherNote && (
              <span> — {dcPaperworkOtherNote}</span>
            )}
          </div>
        </div>
      )}

      {/* 1. Clients */}
      <div className="transport-section">
        <div className="transport-section-label">
          Who is being transported?
          <span className="transport-section-required">required</span>
        </div>
        <div className="glass-card" style={{ padding: '14px' }}>
          {clients.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
              {clients.map((c, i) => (
                <div key={i} className="chip chip-client" style={{ fontSize: '14px', padding: '8px 14px' }}>
                  <span>{c}</span>
                  {!writeLocked && (
                    <button onClick={() => removeClient(i)} style={{ background: 'none', border: 'none', color: '#2E7D32', cursor: 'pointer', fontSize: '18px', padding: 0, lineHeight: 1, marginLeft: '4px' }}>×</button>
                  )}
                </div>
              ))}
            </div>
          )}
          {!writeLocked && (
            <ClientAutocomplete
              onAddClient={handleAddClient}
              existingClients={clients}
              transportId={transportId}
            />
          )}
        </div>
      </div>

      {/* 2. Destination */}
      <div className="transport-section">
        <div className="transport-section-label">
          Where are they going?
          <span className="transport-section-required">required</span>
        </div>
        <div className="glass-card" style={{ padding: '14px' }}>
          {destinations.map((d, i) => (
            <div key={i} className="dest-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                {d.name && <div style={{ fontWeight: 600, fontSize: '14px' }}>{d.name}</div>}
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{d.address}</div>
              </div>
              {!writeLocked && (
                <button
                  onClick={() => removeDest(i)}
                  style={{ background: 'none', border: 'none', color: '#C94A3F', cursor: 'pointer', fontSize: '20px', padding: '4px 8px', lineHeight: 1 }}
                >×</button>
              )}
            </div>
          ))}
          {!writeLocked && (
            <DestinationAutocomplete
              onAddDestination={handleAddDestination}
              existingDestinations={destinations}
            />
          )}
        </div>
      </div>

      {/* 3. Reason */}
      <div className="transport-section">
        <div className="transport-section-label">
          Reason for transport
          <span className="transport-section-required">required</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {reasonOptions.map((r) => (
            <button
              key={r}
              className={`chip ${reasons.includes(r) ? 'chip-selected' : 'chip-unselected'}`}
              onClick={() => toggleReason(r)}
              disabled={writeLocked}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Optional fields toggle */}
      {activeTransport && (
        <button
          onClick={() => setShowMore(!showMore)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            fontSize: '13px',
            cursor: 'pointer',
            padding: '8px 0',
            marginBottom: '8px'
          }}
        >
          {showMore ? '▾ Hide optional fields' : '▸ Notes & arrivals (optional)'}
        </button>
      )}

      {/* Optional: Notes & Arrivals */}
      {(showMore || submitLocked) && (
        <>
          {/* Arrivals */}
          {stops.length > 0 && (
            <div className="transport-section">
              <div className="transport-section-label">Arrivals</div>
              <div className="glass-card" style={{ padding: '14px' }}>
                {stops.map((s, i) => (
                  <div key={i} className="stop-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: '14px' }}>Arrival {i + 1}</span>
                      <span style={{ marginLeft: '10px', fontSize: '12px', color: '#556677' }}>
                        {new Date(s.arrivedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="transport-section">
            <div className="transport-section-label">Notes</div>
            <textarea
              className="input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => { if (!writeLocked) save({ notes }).catch(() => {}) }}
              readOnly={writeLocked}
              disabled={writeLocked}
              placeholder="Any additional notes..."
              rows={3}
              style={{ resize: 'vertical', fontFamily: 'inherit', opacity: writeLocked ? 0.72 : 1 }}
            />
          </div>
        </>
      )}

      {/* Finish button */}
      {activeTransport && (
        <div style={{ marginTop: '8px' }}>
          <button
            className={`btn ${canFinish ? 'btn-finish' : 'btn-disabled'}`}
            onClick={handleFinish}
            disabled={!canFinish || writeLocked}
            style={{ width: '100%', fontSize: '18px', padding: '16px', borderRadius: 'var(--radius)' }}
          >
            Finish transport
          </button>

          {!canFinish && (clients.length > 0 || destinations.length > 0 || reasons.length > 0) && (
            <p style={{ fontSize: '13px', color: 'var(--orange)', textAlign: 'center', marginTop: '8px' }}>
              Still need: {missingFields().join(', ')}
            </p>
          )}
        </div>
      )}

      {/* Cancel transport */}
      {activeTransport && !isOffline && (
        <button
          onClick={handleCancelTransport}
          style={{
            width: '100%',
            marginTop: '12px',
            padding: '12px',
            borderRadius: 'var(--radius)',
            backgroundColor: 'transparent',
            color: '#C94A3F',
            border: '1px solid rgba(201,74,63,0.3)',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          Cancel transport
        </button>
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
