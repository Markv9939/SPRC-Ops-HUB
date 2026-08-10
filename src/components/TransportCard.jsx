import { useState, useEffect, useCallback, useRef } from 'react'
import { db } from '../firebase'
import { doc, getDoc, deleteDoc, serverTimestamp, runTransaction, onSnapshot } from 'firebase/firestore'
import DCPaperworkModal from './DCCheckModal'
import ClientAutocomplete from './ClientAutocomplete'
import DestinationAutocomplete from './DestinationAutocomplete'
import { notifySuccess } from '../utils/toast'
import { showConfirmDialog } from '../utils/dialogs'
import { createTransportCompletedAlert, writeAuditLog } from '../services/notificationService'
import { deleteOfflineAction, deleteOfflineDraft, getOfflineDraft, listAllOfflineActions, saveOfflineDraft } from '../services/offlineStore'
import {
  getTransportCreateActionId,
  getTransportDraftId,
  isLocalTransportId,
  queueTransportClose,
  queueTransportCreate,
  queueTransportUpdate
} from '../services/offlineSyncService'
import { assertExpectedVersion, formatVersionConflictMessage, getVersionNumber } from '../services/versioning'
import { cloneRecord, formatConflictFields, isCollaborationConflict, makeConflictError, mergeRecordFields } from '../utils/collaboration'
import { toTransportRecordDate } from '../utils/transportRecord'

const TRANSPORT_COLLAB_FIELDS = [
  { field: 'status', label: 'status' },
  { field: 'clients', label: 'clients' },
  { field: 'reasons', label: 'reasons' },
  { field: 'stops', label: 'arrivals' },
  { field: 'destinations', label: 'destinations' },
  { field: 'notes', label: 'notes' },
  { field: 'dcPaperworkStatus', label: 'DC paperwork status' },
  { field: 'dcPaperworkOtherNote', label: 'DC paperwork note' }
]

function editableTransportRecord(data = {}) {
  return {
    status: String(data.status || 'open').trim().toLowerCase(),
    clients: Array.isArray(data.clients) ? data.clients : [],
    reasons: Array.isArray(data.reasons) ? data.reasons : [],
    stops: Array.isArray(data.stops) ? data.stops : [],
    destinations: Array.isArray(data.destinations) ? data.destinations : [],
    notes: typeof data.notes === 'string' ? data.notes : '',
    dcPaperworkStatus: data.dcPaperworkStatus || null,
    dcPaperworkOtherNote: data.dcPaperworkOtherNote || ''
  }
}

function getOfflineTransportUpdates(snapshot = {}) {
  return {
    clients: Array.isArray(snapshot.clients) ? snapshot.clients : [],
    reasons: Array.isArray(snapshot.reasons) ? snapshot.reasons : [],
    stops: Array.isArray(snapshot.stops) ? snapshot.stops : [],
    destinations: Array.isArray(snapshot.destinations) ? snapshot.destinations : [],
    notes: typeof snapshot.notes === 'string' ? snapshot.notes : '',
    dcPaperworkStatus: snapshot.dcPaperworkStatus || null,
    dcPaperworkOtherNote: snapshot.dcPaperworkOtherNote || ''
  }
}

function TransportCard({ transportId, user, onClose, onTransportClosed, onTransportCancelled, isOffline = false }) {
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
  const [transportMeta, setTransportMeta] = useState({})
  const [collaborationNotice, setCollaborationNotice] = useState('')
  const [collaborationConflicts, setCollaborationConflicts] = useState([])
  const [conflictRemoteData, setConflictRemoteData] = useState(null)
  const baseTransportRef = useRef(null)
  const dirtyFieldsRef = useRef(new Set())
  const versionRef = useRef(1)
  const saveQueueRef = useRef(Promise.resolve())
  const hasLocalDraftRef = useRef(false)
  const localDraftCheckCompleteRef = useRef(false)

  const normalizedStatus = String(status || '').trim().toLowerCase()
  const localOnlyTransport = isLocalTransportId(transportId) || transportMeta.localOnly === true
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

  const applyTransportData = useCallback((data, options = {}) => {
    const d = data || {}
    setStatus(String(d.status || 'open').trim().toLowerCase())
    setDepartedAt(d.departedAt)
    setClients(Array.isArray(d.clients) ? d.clients : [])
    setReasons(Array.isArray(d.reasons) ? d.reasons : [])
    setStops(Array.isArray(d.stops) ? d.stops : [])
    setDestinations(Array.isArray(d.destinations) ? d.destinations : [])
    setNotes(typeof d.notes === 'string' ? d.notes : '')
    setDcPaperworkStatus(d.dcPaperworkStatus || null)
    setDcPaperworkOtherNote(d.dcPaperworkOtherNote || '')
    const nextVersion = Number(d.version || 1)
    versionRef.current = nextVersion
    setVersion(nextVersion)
    setTransportMeta({
      site: d.site || '',
      createdByUserId: d.createdByUserId || '',
      createdByName: d.createdByName || '',
      createdAt: d.createdAt || null,
      updatedAt: d.updatedAt || null,
      localOnly: options.localOnly === true || d.localOnly === true || isLocalTransportId(transportId)
    })
    if (options.setBase !== false) {
      baseTransportRef.current = cloneRecord(editableTransportRecord(d))
      dirtyFieldsRef.current.clear()
      setCollaborationConflicts([])
      setConflictRemoteData(null)
    }
  }, [transportId])

  const markLocalDraft = useCallback((value) => {
    hasLocalDraftRef.current = value === true
    setHasLocalDraft(value === true)
  }, [])

  const loadTransport = useCallback(async () => {
    if (!transportId) { setLoading(false); return }
    setLoading(true)
    localDraftCheckCompleteRef.current = false
    markLocalDraft(false)
    setTransportMeta({})
    try {
      let remote = null
      if (!isLocalTransportId(transportId)) {
        try {
          const docSnap = await getDoc(doc(db, 'transports', transportId))
          if (docSnap.exists()) remote = docSnap.data()
        } catch (err) {
          console.error('Error loading remote transport:', err)
        }
      }

      const localDraft = await getOfflineDraft(getTransportDraftId(transportId)).catch(() => null)
      const local = localDraft?.payload?.snapshot || null

      if (remote) {
        applyTransportData(remote)
      }
      if (local) {
        applyTransportData({ ...(remote || {}), ...local }, {
          localOnly: localDraft?.payload?.localOnly === true || isLocalTransportId(transportId),
          setBase: !remote
        })
        markLocalDraft(true)
      }
    } catch (err) {
      console.error('Error loading transport:', err)
    } finally {
      localDraftCheckCompleteRef.current = true
      setLoading(false)
    }
  }, [applyTransportData, markLocalDraft, transportId])

  useEffect(() => {
    loadTransport()
  }, [loadTransport])

  useEffect(() => {
    if (!transportId) return undefined
    let cancelled = false
    let refreshTimer = null
    const refreshPendingState = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(async () => {
        const [localDraft, actions] = await Promise.all([
          getOfflineDraft(getTransportDraftId(transportId)).catch(() => null),
          listAllOfflineActions().catch(() => [])
        ])
        if (cancelled) return
        const pendingStatuses = new Set(['pending', 'failed', 'syncing', 'needsReview'])
        const hasPendingAction = actions.some(action => {
          if (!pendingStatuses.has(action?.status)) return false
          const actionTransportId = action?.payload?.transportId || action?.payload?.localTransportId || ''
          return String(actionTransportId) === String(transportId)
        })
        if (localDraft || hasPendingAction) {
          markLocalDraft(true)
          return
        }
        if (!hasLocalDraftRef.current) return
        markLocalDraft(false)
        if (!isOffline) await loadTransport()
      }, 50)
    }
    window.addEventListener('offline-outbox-changed', refreshPendingState)
    return () => {
      cancelled = true
      if (refreshTimer) window.clearTimeout(refreshTimer)
      window.removeEventListener('offline-outbox-changed', refreshPendingState)
    }
  }, [isOffline, loadTransport, markLocalDraft, transportId])

  const fmt = (ts) => {
    const d = toTransportRecordDate(ts)
    if (!d) return '--:--'
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  const buildSnapshot = useCallback((updates = {}) => ({
    id: transportId,
    site: transportMeta.site || user?.site || user?.location || '',
    createdByUserId: transportMeta.createdByUserId || user?.id || '',
    createdByName: transportMeta.createdByName || user?.name || '',
    status,
    version,
    departedAt,
    clients,
    reasons,
    stops,
    destinations,
    notes,
    dcPaperworkStatus,
    dcPaperworkOtherNote,
    createdAt: transportMeta.createdAt || departedAt || new Date(),
    updatedAt: new Date(),
    localOnly: localOnlyTransport,
    pendingSync: localOnlyTransport || isOffline,
    ...updates
  }), [
    clients,
    dcPaperworkOtherNote,
    dcPaperworkStatus,
    departedAt,
    destinations,
    isOffline,
    localOnlyTransport,
    notes,
    reasons,
    status,
    stops,
    transportId,
    transportMeta.createdAt,
    transportMeta.createdByName,
    transportMeta.createdByUserId,
    transportMeta.site,
    user,
    version
  ])

  const buildMergedOfflineSnapshot = useCallback(async (updates = {}) => {
    const localDraft = await getOfflineDraft(getTransportDraftId(transportId)).catch(() => null)
    const existing = localDraft?.payload?.snapshot || null
    const current = buildSnapshot()
    return {
      ...current,
      ...(existing || {}),
      ...updates,
      id: transportId,
      site: existing?.site || current.site,
      locationId: existing?.locationId || current.locationId || user?.locationId || '',
      createdByUserId: existing?.createdByUserId || current.createdByUserId || user?.id || '',
      createdByName: existing?.createdByName || current.createdByName || user?.name || '',
      createdAt: existing?.createdAt || current.createdAt,
      updatedAt: updates.updatedAt || new Date(),
      localOnly: localOnlyTransport,
      pendingSync: true
    }
  }, [buildSnapshot, localOnlyTransport, transportId, user?.id, user?.locationId, user?.name])

  const persistOfflineEdit = useCallback(async (updates = {}) => {
    const expectedVersion = versionRef.current
    const snapshot = await buildMergedOfflineSnapshot({ ...updates, version: expectedVersion })
    await saveOfflineDraft(getTransportDraftId(transportId), 'transport', {
      snapshot,
      expectedVersion,
      localOnly: localOnlyTransport
    })
    if (localOnlyTransport) {
      await queueTransportCreate({
        localTransportId: transportId,
        snapshot,
        user
      })
    } else {
      await queueTransportUpdate({
        transportId,
        expectedVersion,
        updates: getOfflineTransportUpdates(snapshot),
        snapshot,
        user
      })
    }
    markLocalDraft(true)
    return snapshot
  }, [buildMergedOfflineSnapshot, localOnlyTransport, markLocalDraft, transportId, user])

  useEffect(() => {
    if (!transportId || isLocalTransportId(transportId)) return undefined
    const transportRef = doc(db, 'transports', transportId)
    const unsubscribe = onSnapshot(
      transportRef,
      { includeMetadataChanges: true },
      (snap) => {
        if (!snap.exists() || snap.metadata.hasPendingWrites) return
        if (!localDraftCheckCompleteRef.current || hasLocalDraftRef.current) return
        const remoteData = { id: snap.id, ...snap.data() }
        const remoteEditable = editableTransportRecord(remoteData)

        if (!baseTransportRef.current) {
          baseTransportRef.current = cloneRecord(remoteEditable)
          return
        }

        const localEditable = editableTransportRecord(buildSnapshot())
        const hasLocalChanges = dirtyFieldsRef.current.size > 0 || hasLocalDraftRef.current
        if (!hasLocalChanges) {
          applyTransportData(remoteData)
          if (getVersionNumber(remoteData) !== version) {
            setCollaborationNotice('Transport updated to the latest version.')
          }
          return
        }

        const result = mergeRecordFields(baseTransportRef.current, localEditable, remoteEditable, TRANSPORT_COLLAB_FIELDS)
        if (result.conflicts.length > 0) {
          setCollaborationConflicts(result.conflicts)
          setConflictRemoteData(remoteData)
          setCollaborationNotice('Transport changed in another session. Review the conflicting fields before saving.')
          return
        }

        if (result.autoMerged.length > 0) {
          applyTransportData({ ...remoteData, ...result.merged }, { setBase: false })
          baseTransportRef.current = cloneRecord(remoteEditable)
          setVersion(getVersionNumber(remoteData) || version)
          setCollaborationNotice('Transport updated elsewhere. Safe changes were merged without replacing your typing.')
        }
      },
      (err) => {
        console.error('Transport live update failed:', err)
      }
    )
    return () => unsubscribe()
  }, [applyTransportData, buildSnapshot, transportId, version])

  useEffect(() => {
    if (!transportId || writeLocked || !dirtyFieldsRef.current.has('notes')) return undefined
    const timer = window.setTimeout(() => {
      const saveNotes = async () => {
        if (localOnlyTransport || isOffline) {
          await persistOfflineEdit({ notes })
          return
        }
        const snapshot = await buildMergedOfflineSnapshot({ notes })
        await saveOfflineDraft(getTransportDraftId(transportId), 'transport', {
          snapshot,
          expectedVersion: version,
          localOnly: false
        })
        markLocalDraft(true)
      }
      saveNotes().catch(err => {
        console.warn('Transport local draft save failed:', err)
      })
    }, 600)
    return () => window.clearTimeout(timer)
  }, [buildMergedOfflineSnapshot, isOffline, localOnlyTransport, markLocalDraft, notes, persistOfflineEdit, transportId, version, writeLocked])

  const performSave = async (updates) => {
    if (!transportId) return
    if (writeLocked) return
    if (collaborationConflicts.length > 0) {
      throw makeConflictError(collaborationConflicts)
    }
    const expectedVersion = versionRef.current
    if (localOnlyTransport) {
      await persistOfflineEdit(updates)
      return
    }
    if (isOffline) {
      await persistOfflineEdit(updates)
      return
    }
    try {
      let committedVersion = expectedVersion
      const updateFields = {
        ...updates,
        notes,
        updatedAt: serverTimestamp()
      }
      await runTransaction(db, async (transaction) => {
        const transportRef = doc(db, 'transports', transportId)
        const latestSnap = await transaction.get(transportRef)
        if (!latestSnap.exists()) throw new Error('Transport no longer exists.')
        const latest = latestSnap.data()
        const { nextVersion } = assertExpectedVersion({
          expectedVersion,
          currentVersion: getVersionNumber(latest),
          documentId: transportId,
          recordLabel: 'Transport'
        })
        transaction.update(transportRef, {
          ...updateFields,
          version: nextVersion
        })
        committedVersion = nextVersion
      })
      versionRef.current = committedVersion
      setVersion(committedVersion)
      markLocalDraft(false)
      Object.keys(updates || {}).concat('notes').forEach(field => dirtyFieldsRef.current.delete(field))
      setCollaborationNotice('')
      setCollaborationConflicts([])
      setConflictRemoteData(null)
      await deleteOfflineDraft(getTransportDraftId(transportId))
    } catch (err) {
      console.error('Save error:', err)
      const message = isCollaborationConflict(err)
        ? `Transport changed elsewhere: ${formatConflictFields(err.conflicts)}. Review latest version before saving.`
        : formatVersionConflictMessage(err, err?.message || 'Failed to save transport changes.')
      alert(message)
      if (!isCollaborationConflict(err)) {
        await loadTransport()
      }
      throw err
    }
  }

  const save = (updates) => {
    const queuedSave = saveQueueRef.current.then(() => performSave(updates))
    saveQueueRef.current = queuedSave.catch(() => {})
    return queuedSave
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

  const handleAddClient = async (clientName) => {
    if (blockIfLocked()) return
    const updated = [...clients, clientName]
    dirtyFieldsRef.current.add('clients')
    setClients(updated)
    try {
      await save({ clients: updated })
    } catch {
      // Error already handled in save()
    }
  }

  const removeClient = (i) => {
    if (blockIfLocked()) return
    const updated = clients.filter((_, idx) => idx !== i)
    dirtyFieldsRef.current.add('clients')
    setClients(updated)
    save({ clients: updated }).catch(() => {})
  }

  const toggleReason = (r) => {
    if (blockIfLocked()) return
    const updated = reasons.includes(r) ? reasons.filter(x => x !== r) : [...reasons, r]
    dirtyFieldsRef.current.add('reasons')
    setReasons(updated)
    save({ reasons: updated }).catch(() => {})
  }

  const handleAddDestination = async (destination) => {
    if (blockIfLocked()) return
    const updated = [...destinations, destination]
    dirtyFieldsRef.current.add('destinations')
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
    dirtyFieldsRef.current.add('destinations')
    setDestinations(updated)
    save({ destinations: updated }).catch(() => {})
  }

  const handleCancelTransport = async () => {
    if (!transportId) return
    if (blockIfLocked()) return
    const isLocalCancel = localOnlyTransport
    const confirmed = await showConfirmDialog(
      isLocalCancel
        ? 'Cancel this offline transport? This removes it from this device before it syncs.'
        : 'Cancel this transport? This removes it completely and cannot be undone.',
      {
        title: 'Cancel Transport',
        tone: 'danger',
        confirmText: 'Yes, Cancel',
        cancelText: 'Keep It'
      }
    )
    if (!confirmed) return

    try {
      if (isLocalCancel) {
        await deleteOfflineDraft(getTransportDraftId(transportId))
        await deleteOfflineAction(getTransportCreateActionId(transportId))
        notifySuccess('Offline transport cancelled')
        onTransportCancelled?.(transportId)
        onClose()
        return
      }
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
    ;['status', 'destinations', 'dcPaperworkStatus', 'dcPaperworkOtherNote'].forEach(field => dirtyFieldsRef.current.add(field))
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
      site: transportMeta.site || user?.site || user?.location || '',
      locationId: user?.locationId || '',
      createdByUserId: transportMeta.createdByUserId || user?.id || '',
      createdByName: transportMeta.createdByName || user?.name || '',
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

    if (localOnlyTransport) {
      setStatus('closed')
      const snapshot = await buildMergedOfflineSnapshot({ ...closeUpdates, updatedAt: closedAt })
      await saveOfflineDraft(getTransportDraftId(transportId), 'transport', {
        snapshot,
        expectedVersion: versionRef.current,
        localOnly: true
      })
      await queueTransportCreate({
        localTransportId: transportId,
        snapshot,
        user,
        auditReason: `DC paperwork: ${dcStatusLabel(result.status)}`
      })
      markLocalDraft(true)
      onTransportClosed?.({ ...closedTransport, ...snapshot })
      notifySuccess('Transport saved on this device. It will sync when internet returns.')
      return
    }

    if (isOffline) {
      setStatus('closed')
      const snapshot = await buildMergedOfflineSnapshot(closeUpdates)
      await saveOfflineDraft(getTransportDraftId(transportId), 'transport', { snapshot, expectedVersion: versionRef.current })
      await queueTransportClose({
        transportId,
        expectedVersion: versionRef.current,
        updates: {
          ...getOfflineTransportUpdates(snapshot),
          dcPaperworkStatus: result.status,
          dcPaperworkOtherNote: result.otherNote || ''
        },
        closedTransport: { ...closedTransport, ...snapshot },
        user,
        auditReason: `DC paperwork: ${dcStatusLabel(result.status)}`
      })
      markLocalDraft(true)
      onTransportClosed?.({ ...closedTransport, ...snapshot })
      notifySuccess('Transport saved on this device. It will sync when internet returns.')
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
          transport: {
            ...closedTransport,
            site: closedTransport.site || user?.site || user?.location || '',
            locationId: closedTransport.locationId || user?.locationId || ''
          },
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
    } catch {
      // Error already handled in save()
    }
  }

  const useLatestConflictFields = () => {
    if (!conflictRemoteData || collaborationConflicts.length === 0) return
    const next = buildSnapshot()
    collaborationConflicts.forEach(conflict => {
      next[conflict.field] = conflictRemoteData[conflict.field]
      dirtyFieldsRef.current.delete(conflict.field)
    })
    applyTransportData(next, { setBase: false })
    baseTransportRef.current = cloneRecord(editableTransportRecord(conflictRemoteData))
    setVersion(getVersionNumber(conflictRemoteData) || version)
    setCollaborationConflicts([])
    setConflictRemoteData(null)
    setCollaborationNotice('Latest conflicting fields applied. Your other typing was kept.')
  }

  const keepMineConflictFields = () => {
    if (!conflictRemoteData || collaborationConflicts.length === 0) return
    collaborationConflicts.forEach(conflict => dirtyFieldsRef.current.add(conflict.field))
    baseTransportRef.current = cloneRecord(editableTransportRecord(conflictRemoteData))
    setVersion(getVersionNumber(conflictRemoteData) || version)
    setCollaborationConflicts([])
    setConflictRemoteData(null)
    setCollaborationNotice('Your version was kept. Save again to apply it over the latest conflicting fields.')
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
      </div>

      {/* Status messages */}
      {collaborationNotice && (
        <div style={{ marginBottom: '12px', fontSize: '13px', color: collaborationConflicts.length > 0 ? '#9D362E' : '#2F7D57', textAlign: 'center', padding: '8px', background: collaborationConflicts.length > 0 ? 'rgba(205,78,66,0.10)' : 'rgba(47,125,87,0.08)', borderRadius: '8px' }}>
          {collaborationNotice}
          {collaborationConflicts.length > 0 && (
            <>
              <div style={{ marginTop: '4px', fontWeight: 700 }}>
                Conflicts: {formatConflictFields(collaborationConflicts)}
              </div>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '8px' }}>
                <button type="button" onClick={useLatestConflictFields} style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(17,47,82,0.24)', background: '#FFFFFF', color: 'var(--text-primary)', fontWeight: 700 }}>
                  Use latest
                </button>
                <button type="button" onClick={keepMineConflictFields} style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(205,78,66,0.36)', background: '#FFFFFF', color: '#9D362E', fontWeight: 700 }}>
                  Keep mine
                </button>
              </div>
            </>
          )}
        </div>
      )}
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
              isOffline={isOffline}
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
              isOffline={isOffline}
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
              onChange={(e) => {
                dirtyFieldsRef.current.add('notes')
                setNotes(e.target.value)
              }}
              onBlur={() => { if (!writeLocked) save({ notes }).catch(() => {}) }}
              readOnly={writeLocked}
              disabled={writeLocked}
              placeholder="Add delays, route changes, concerns, or handoff info..."
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
      {activeTransport && (!isOffline || localOnlyTransport) && (
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
