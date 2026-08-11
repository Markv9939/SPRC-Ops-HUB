import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { db } from '../firebase'
import DebriefGroupedReadView from './DebriefGroupedReadView'
import ShiftDebriefDocumentEditor from './ShiftDebriefDocumentEditor'
import ShiftDebriefQuickNote from './ShiftDebriefQuickNote'
import {
  CLOSED_DEBRIEF_MESSAGE,
  CONFIRMATION_ITEMS,
  DEBRIEF_DRAFTS_COLLECTION,
  DEBRIEFS_COLLECTION,
  appendExtraDebriefNote,
  createEmptyConfirmation,
  createExtraNote,
  getBhtDebriefContext,
  isDebriefClosedForCorrections,
  saveDebriefConfirmation,
  saveDebriefDraft,
  saveQuickDebriefNote,
  submitShiftDebrief,
  undoQuickDebriefNote,
  upsertSharedClientName
} from '../services/shiftDebriefService'
import {
  DEBRIEF_SCHEMA_VERSION,
  mergeUniqueDebriefItems,
  sanitizeDebriefItems,
  sortDebriefItems
} from '../services/shiftDebriefModel'
import {
  deleteOfflineAction,
  deleteOfflineDraft,
  getOfflineDraft,
  listAllOfflineActions,
  mutateOfflineDraftAndOutbox,
  saveOfflineDraft
} from '../services/offlineStore'
import {
  OFFLINE_ACTION_TYPES,
  getDebriefDraftId,
  getDebriefQuickDraftId,
  getShiftDebriefQuickActionId,
  queueShiftDebriefConfirmation,
  queueShiftDebriefExtraNote,
  queueShiftDebriefSubmission
} from '../services/offlineSyncService'
import { cloneRecord, formatConflictFields, mergeRecordFields } from '../utils/collaboration'
import { showConfirmDialog } from '../utils/dialogs'
import { formatVersionConflictMessage, getVersionNumber } from '../services/versioning'
import { notifySuccess } from '../utils/toast'

const GUIDE_KEY = 'sprc_shift_debrief_guide_v2_done'
const DEBRIEF_COLLAB_FIELDS = [
  { field: 'items', label: 'debrief notes', type: 'listById', idField: 'id' }
]

function formatTimestamp(value) {
  if (!value) return ''
  const date = value.toDate ? value.toDate() : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

function formatTime(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function editableDebriefDraft(data = {}) {
  return { items: sortDebriefItems(data.items || []) }
}

function getCurrentUserConfirmation(debrief, user) {
  const userId = String(user?.id || '').trim()
  return debrief?.confirmation?.acknowledgments?.[userId]
    || debrief?.confirmation
    || createEmptyConfirmation()
}

function ShiftDebriefGuide({ onComplete }) {
  const [step, setStep] = useState(0)
  const steps = [
    ['Capture during the shift', 'Add short notes as events happen so important details are not missed.'],
    ['Review one document', 'Quick notes appear in the full Shift Debrief for cleanup before submission.'],
    ['Submit for handoff', 'Submitted notes lock. Missed details are added later as named, timestamped corrections.']
  ]
  const finish = () => {
    localStorage.setItem(GUIDE_KEY, 'true')
    onComplete()
  }

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card">
        <div className="onboarding-title">{steps[step][0]}</div>
        <div className="onboarding-body">{steps[step][1]}</div>
        <div className="onboarding-dots">
          {steps.map((_, index) => <span key={index} className={`onboarding-dot ${index === step ? 'onboarding-dot-active' : ''}`} />)}
        </div>
        <button className="onboarding-btn" onClick={() => (step === steps.length - 1 ? finish() : setStep(value => value + 1))}>
          {step === steps.length - 1 ? 'Got it' : 'Next'}
        </button>
        {step < steps.length - 1 && <button className="onboarding-skip" onClick={finish}>Skip guide</button>}
      </div>
    </div>
  )
}

function SubmittedDebriefView({ debrief, user, isOffline, onOpenIssue }) {
  const [extraNoteText, setExtraNoteText] = useState('')
  const [confirmation, setConfirmation] = useState(() => getCurrentUserConfirmation(debrief, user))
  const [savingExtra, setSavingExtra] = useState(false)
  const [savingConfirmation, setSavingConfirmation] = useState(false)
  const [pendingExtraNotes, setPendingExtraNotes] = useState([])
  const [confirmationPending, setConfirmationPending] = useState(false)
  const correctionsClosed = isDebriefClosedForCorrections(debrief)

  useEffect(() => setConfirmation(getCurrentUserConfirmation(debrief, user)), [debrief, user])

  useEffect(() => {
    let cancelled = false
    const refreshPending = async () => {
      const actions = await listAllOfflineActions().catch(() => [])
      if (cancelled) return
      const pendingStatuses = new Set(['pending', 'syncing', 'failed', 'needsReview'])
      const matching = actions.filter(action => (
        pendingStatuses.has(action.status)
        && action.payload?.debriefId === debrief.id
      ))
      setPendingExtraNotes(matching
        .filter(action => action.type === OFFLINE_ACTION_TYPES.SHIFT_DEBRIEF_EXTRA_NOTE)
        .map(action => action.payload?.extraNote)
        .filter(Boolean))
      const queuedConfirmation = matching.find(action => (
        action.type === OFFLINE_ACTION_TYPES.SHIFT_DEBRIEF_CONFIRMATION
        && String(action.payload?.user?.id || '') === String(user?.id || '')
      ))
      setConfirmationPending(Boolean(queuedConfirmation))
      if (queuedConfirmation?.payload?.confirmation) setConfirmation(queuedConfirmation.payload.confirmation)
    }
    refreshPending()
    window.addEventListener('offline-outbox-changed', refreshPending)
    return () => {
      cancelled = true
      window.removeEventListener('offline-outbox-changed', refreshPending)
    }
  }, [debrief.id, user?.id])

  const addExtraNote = async () => {
    if (!extraNoteText.trim() || correctionsClosed) return
    setSavingExtra(true)
    try {
      const extraNote = createExtraNote({ note: extraNoteText, user, source: 'submitted_view' })
      if (isOffline) await queueShiftDebriefExtraNote({ debriefId: debrief.id, extraNote, user })
      else await appendExtraDebriefNote(debrief.id, extraNote)
      setExtraNoteText('')
      notifySuccess(isOffline ? 'Extra note saved on this device' : 'Extra note added')
    } catch (error) {
      alert(error?.message || 'The extra note could not be saved.')
    } finally {
      setSavingExtra(false)
    }
  }

  const saveConfirmation = async () => {
    setSavingConfirmation(true)
    try {
      if (isOffline) await queueShiftDebriefConfirmation({ debriefId: debrief.id, confirmation, user })
      else await saveDebriefConfirmation(debrief.id, confirmation, user)
      notifySuccess(isOffline ? 'Confirmation saved on this device' : 'Confirmation saved')
    } catch (error) {
      alert(error?.message || 'The confirmation could not be saved.')
    } finally {
      setSavingConfirmation(false)
    }
  }

  return (
    <div className="debrief-submitted-view">
      <div className="debrief-locked-banner">
        <AlertTriangle aria-hidden="true" />
        {correctionsClosed ? CLOSED_DEBRIEF_MESSAGE : 'Submitted debrief is locked. Add a correction below if something was missed.'}
      </div>

      <section className="debrief-document-card debrief-read-card">
        <div className="debrief-document-header">Submitted Handoff</div>
        <div className="debrief-read-meta">Submitted by {debrief.submittedByName || debrief.draftByName || 'BHT'} on {formatTimestamp(debrief.submittedAt)}</div>
        <DebriefGroupedReadView items={debrief.items} emptyText="No notes in this debrief." />
      </section>

      {(debrief.issueSnapshot || []).length > 0 && (
        <section className="debrief-document-card debrief-submitted-panel">
          <div className="debrief-document-header">House Issues at Handoff</div>
          <div className="debrief-submitted-body debrief-issue-snapshot">
            {debrief.issueSnapshot.map(issue => (
              <button type="button" key={issue.issueId} onClick={() => onOpenIssue?.(issue.issueId)} disabled={!onOpenIssue}>
                <span><strong>{issue.label}</strong><small>{issue.description}</small></span>
                <b>{String(issue.status || '').replace('_', ' ')}</b>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="debrief-document-card debrief-submitted-panel">
        <div className="debrief-document-header">Extra Notes / Corrections</div>
        <div className="debrief-submitted-body">
          {(debrief.extraNotes || []).map(note => (
            <div key={note.id} className="debrief-extra-note">
              <div><strong>{note.createdByName || 'BHT'}</strong><span>{formatTimestamp(note.createdAtIso)}</span></div>
              <p>{note.note}</p>
            </div>
          ))}
          {pendingExtraNotes.map(note => <div key={note.id} className="debrief-pending-note">Pending sync: {note.note}</div>)}
          {(debrief.extraNotes || []).length === 0 && pendingExtraNotes.length === 0 && <div className="debrief-document-empty">No corrections added.</div>}
          {!correctionsClosed && (
            <>
              <textarea
                className="input debrief-submitted-textarea"
                value={extraNoteText}
                onChange={event => setExtraNoteText(event.target.value)}
                rows={4}
                placeholder="Add what was missed, corrected, or needs follow-up..."
              />
              <button type="button" className="debrief-secondary-submit" onClick={addExtraNote} disabled={savingExtra || !extraNoteText.trim()}>
                {savingExtra ? 'Saving...' : 'Add Extra Note'}
              </button>
            </>
          )}
        </div>
      </section>

      <section className="debrief-document-card debrief-submitted-panel">
        <div className="debrief-document-header">Incoming Staff Confirmation</div>
        <div className="debrief-submitted-body">
          <div className="debrief-confirmation-list">
            {CONFIRMATION_ITEMS.map(item => (
              <label key={item.id}>
                <input
                  type="checkbox"
                  checked={confirmation?.[item.id] === true}
                  onChange={event => setConfirmation(previous => ({ ...previous, [item.id]: event.target.checked }))}
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
          <label className="debrief-initials-field">
            <span>Incoming staff initials</span>
            <input
              className="input"
              value={confirmation?.incomingStaffInitials || ''}
              onChange={event => setConfirmation(previous => ({ ...previous, incomingStaffInitials: event.target.value.toUpperCase() }))}
              maxLength={8}
              placeholder="Initials"
            />
          </label>
          {confirmation?.confirmed && <div className="debrief-confirmed-message"><CheckCircle2 aria-hidden="true" /> Confirmed by {confirmation.confirmedByName || 'incoming staff'} on {formatTimestamp(confirmation.confirmedAt)}</div>}
          {confirmationPending && <div className="debrief-pending-note">Confirmation pending sync</div>}
          <button type="button" className="debrief-secondary-submit" onClick={saveConfirmation} disabled={savingConfirmation}>
            {savingConfirmation ? 'Saving...' : 'Save Confirmation'}
          </button>
        </div>
      </section>
    </div>
  )
}

export default function ShiftDebriefPage({
  user,
  assignment = null,
  mode = 'full',
  debriefId = null,
  isOffline = false,
  onBack,
  onDone,
  onViewFull,
  onOpenIssue
}) {
  const context = useMemo(() => getBhtDebriefContext(user, new Date(), assignment), [assignment, user])
  const targetDebriefId = debriefId || context?.id || ''
  const [draft, setDraft] = useState(null)
  const [submitted, setSubmitted] = useState(null)
  const [items, setItems] = useState([])
  const [dirty, setDirty] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [hasLocalDraft, setHasLocalDraft] = useState(false)
  const [pendingQuickItems, setPendingQuickItems] = useState([])
  const [saveStatus, setSaveStatus] = useState({ tone: 'idle', text: 'Draft not saved yet' })
  const [submitting, setSubmitting] = useState(false)
  const [showGuide, setShowGuide] = useState(() => !localStorage.getItem(GUIDE_KEY))
  const [quickBannerDismissed, setQuickBannerDismissed] = useState(false)
  const [collaborationNotice, setCollaborationNotice] = useState('')
  const [collaborationConflicts, setCollaborationConflicts] = useState([])
  const [conflictRemoteDraft, setConflictRemoteDraft] = useState(null)
  const baseDraftRef = useRef(null)
  const draftRef = useRef(null)
  const itemsRef = useRef([])
  const dirtyRef = useRef(false)
  const hasLocalDraftRef = useRef(false)
  const revisionRef = useRef(0)
  const claimedQuickRef = useRef(false)

  useEffect(() => { itemsRef.current = items }, [items])
  useEffect(() => { dirtyRef.current = dirty }, [dirty])
  useEffect(() => { hasLocalDraftRef.current = hasLocalDraft }, [hasLocalDraft])
  useEffect(() => { draftRef.current = draft }, [draft])

  const persistDraft = useCallback(async ({ notify = false } = {}) => {
    if (!context || collaborationConflicts.length > 0) return false
    const savingItems = itemsRef.current
    const savingRevision = revisionRef.current
    setSaveStatus({ tone: 'saving', text: 'Saving' })
    try {
      await saveOfflineDraft(getDebriefDraftId(context.id), 'debrief', {
        schemaVersion: DEBRIEF_SCHEMA_VERSION,
        context,
        items: savingItems
      })
      setHasLocalDraft(true)
      if (!isOffline) {
        await saveDebriefDraft(context, savingItems, { expectedVersion: getVersionNumber(draftRef.current) })
        await deleteOfflineDraft(getDebriefDraftId(context.id))
        setHasLocalDraft(false)
      }
      setLastSavedAt(new Date())
      baseDraftRef.current = cloneRecord(editableDebriefDraft({ items: savingItems }))
      setCollaborationConflicts([])
      setConflictRemoteDraft(null)
      if (revisionRef.current === savingRevision) {
        setDirty(false)
        setSaveStatus(isOffline
          ? { tone: 'offline', text: 'Saved offline' }
          : { tone: 'saved', text: `Autosaved ${formatTime(new Date())}` })
      } else {
        setSaveStatus({ tone: 'unsaved', text: 'Unsaved' })
      }
      if (notify) notifySuccess(isOffline ? 'Draft saved on this device' : 'Draft saved')
      return true
    } catch (error) {
      console.error('Debrief save failed:', error)
      setSaveStatus({ tone: 'error', text: 'Save failed' })
      setCollaborationNotice(formatVersionConflictMessage(error, 'Autosave paused. Retry after reviewing any conflicts.'))
      return false
    }
  }, [collaborationConflicts.length, context, isOffline])

  useEffect(() => {
    if (!targetDebriefId) return undefined
    return onSnapshot(doc(db, DEBRIEFS_COLLECTION, targetDebriefId), snapshot => {
      const data = snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null
      setSubmitted(data?.schemaVersion === DEBRIEF_SCHEMA_VERSION ? data : null)
    }, error => {
      console.error('Shift debrief submitted listener failed:', error)
      setSubmitted(null)
    })
  }, [targetDebriefId])

  useEffect(() => {
    if (!context?.id || debriefId) return undefined
    return onSnapshot(doc(db, DEBRIEF_DRAFTS_COLLECTION, context.id), snapshot => {
      const candidate = snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null
      const latestDraft = candidate?.schemaVersion === DEBRIEF_SCHEMA_VERSION ? candidate : null
      setDraft(latestDraft)
      const remoteEditable = editableDebriefDraft(latestDraft || {})

      if (!baseDraftRef.current) {
        baseDraftRef.current = cloneRecord(remoteEditable)
        if (!dirtyRef.current && !hasLocalDraftRef.current) setItems(remoteEditable.items)
        return
      }
      if (!dirtyRef.current && !hasLocalDraftRef.current) {
        baseDraftRef.current = cloneRecord(remoteEditable)
        setItems(remoteEditable.items)
        setCollaborationConflicts([])
        setConflictRemoteDraft(null)
        return
      }

      const localEditable = editableDebriefDraft({ items: itemsRef.current })
      const result = mergeRecordFields(baseDraftRef.current, localEditable, remoteEditable, DEBRIEF_COLLAB_FIELDS)
      if (result.conflicts.length > 0) {
        setCollaborationConflicts(result.conflicts)
        setConflictRemoteDraft(latestDraft)
        setCollaborationNotice('This debrief changed in another session. Review the conflicting notes before saving.')
      } else if (result.autoMerged.length > 0) {
        setItems(sortDebriefItems(result.merged.items))
        baseDraftRef.current = cloneRecord(remoteEditable)
        setCollaborationNotice('Changes from another session were safely merged with your draft.')
      }
    }, error => {
      console.error('Shift debrief draft listener failed:', error)
      setCollaborationNotice('Live draft updates are unavailable. You can keep typing and retry saving.')
    })
  }, [context?.id, debriefId])

  useEffect(() => {
    if (!context?.id || debriefId) return undefined
    let cancelled = false
    ;(async () => {
      const localDraft = await getOfflineDraft(getDebriefDraftId(context.id)).catch(() => null)
      if (cancelled || localDraft?.payload?.schemaVersion !== DEBRIEF_SCHEMA_VERSION) return
      const localItems = sortDebriefItems(localDraft.payload.items || [])
      setItems(localItems)
      itemsRef.current = localItems
      setLastSavedAt(localDraft.updatedAtIso ? new Date(localDraft.updatedAtIso) : new Date())
      setHasLocalDraft(true)
      setSaveStatus({ tone: 'offline', text: 'Saved offline' })
    })()
    return () => { cancelled = true }
  }, [context?.id, debriefId])

  useEffect(() => {
    if (!context?.id || debriefId) return undefined
    let cancelled = false
    const loadPending = async () => {
      const localDraft = await getOfflineDraft(getDebriefQuickDraftId(context.id)).catch(() => null)
      if (!cancelled) setPendingQuickItems(sortDebriefItems(localDraft?.payload?.items || []))
    }
    loadPending()
    window.addEventListener('offline-outbox-changed', loadPending)
    return () => {
      cancelled = true
      window.removeEventListener('offline-outbox-changed', loadPending)
    }
  }, [context?.id, debriefId])

  useEffect(() => {
    if (mode !== 'full' || submitted || !context?.id || pendingQuickItems.length === 0 || claimedQuickRef.current) return
    claimedQuickRef.current = true
    ;(async () => {
      const merged = mergeUniqueDebriefItems(itemsRef.current, pendingQuickItems)
      await saveOfflineDraft(getDebriefDraftId(context.id), 'debrief', {
        schemaVersion: DEBRIEF_SCHEMA_VERSION,
        context,
        items: merged
      })
      await Promise.all(pendingQuickItems.map(item => deleteOfflineAction(getShiftDebriefQuickActionId(context.id, item.id))))
      await deleteOfflineDraft(getDebriefQuickDraftId(context.id))
      itemsRef.current = merged
      setItems(merged)
      setPendingQuickItems([])
      setHasLocalDraft(true)
      revisionRef.current += 1
      setDirty(true)
      setSaveStatus({ tone: 'unsaved', text: 'Unsaved' })
    })().catch(error => {
      claimedQuickRef.current = false
      console.warn('Pending quick notes could not be merged into the full draft:', error)
    })
  }, [context, mode, pendingQuickItems, submitted])

  useEffect(() => {
    if (!dirty || submitted || mode === 'quick' || !context || collaborationConflicts.length > 0) return undefined
    const timer = setTimeout(() => persistDraft(), 1200)
    return () => clearTimeout(timer)
  }, [collaborationConflicts.length, context, dirty, items, mode, persistDraft, submitted])

  const updateDraftItems = updater => {
    const next = typeof updater === 'function' ? updater(itemsRef.current) : updater
    itemsRef.current = next
    revisionRef.current += 1
    setItems(next)
    setDirty(true)
    setSaveStatus({ tone: 'unsaved', text: 'Unsaved' })
  }

  const useLatestConflicts = () => {
    if (!conflictRemoteDraft) return
    const remoteItems = editableDebriefDraft(conflictRemoteDraft).items
    const remoteById = new Map(remoteItems.map(item => [item.id, item]))
    const conflictIds = new Set(collaborationConflicts
      .map(conflict => conflict.localValue?.id || conflict.remoteValue?.id)
      .filter(Boolean))
    const next = sortDebriefItems(itemsRef.current
      .filter(item => !(conflictIds.has(item.id) && !remoteById.has(item.id)))
      .map(item => (conflictIds.has(item.id) && remoteById.has(item.id) ? remoteById.get(item.id) : item)))
    itemsRef.current = next
    setItems(next)
    baseDraftRef.current = cloneRecord(editableDebriefDraft(conflictRemoteDraft))
    setCollaborationConflicts([])
    setConflictRemoteDraft(null)
    setCollaborationNotice('Latest conflicting notes applied. Your other notes were kept.')
  }

  const keepMineConflicts = () => {
    if (!conflictRemoteDraft) return
    baseDraftRef.current = cloneRecord(editableDebriefDraft(conflictRemoteDraft))
    setCollaborationConflicts([])
    setConflictRemoteDraft(null)
    setDirty(true)
    setCollaborationNotice('Your version was kept. Retry save to apply it over the conflicting notes.')
  }

  const handleSubmit = async () => {
    if (!context || collaborationConflicts.length > 0) {
      if (collaborationConflicts.length > 0) alert(`Resolve these conflicts before submitting: ${formatConflictFields(collaborationConflicts)}.`)
      return
    }
    const validItems = sanitizeDebriefItems(mergeUniqueDebriefItems(itemsRef.current, pendingQuickItems))
    if (validItems.length === 0) {
      alert('Add at least one complete debrief note before submitting.')
      return
    }
    const confirmed = await showConfirmDialog('Submit this shift debrief for handoff? The original notes will lock after submission.', {
      title: 'Submit Shift Debrief',
      tone: 'warning',
      confirmText: 'Submit',
      cancelText: 'Cancel'
    })
    if (!confirmed) return

    setSubmitting(true)
    try {
      if (isOffline) {
        await saveOfflineDraft(getDebriefDraftId(context.id), 'debrief', {
          schemaVersion: DEBRIEF_SCHEMA_VERSION,
          context,
          items: validItems
        })
        await queueShiftDebriefSubmission({ context, items: validItems, user })
        setHasLocalDraft(true)
        notifySuccess('Shift debrief saved on this device. It will sync when internet returns.')
        onBack?.()
      } else {
        await submitShiftDebrief(context, validItems, user)
        await deleteOfflineDraft(getDebriefDraftId(context.id))
        setHasLocalDraft(false)
        notifySuccess('Shift debrief submitted')
      }
      setDirty(false)
    } catch (error) {
      console.error('Shift debrief submit failed:', error)
      alert(formatVersionConflictMessage(error, error?.message || 'The shift debrief could not be submitted.'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleQuickSave = async item => {
    if (!context) throw new Error('Shift debrief is not available for this assignment.')
    if (submitted && isDebriefClosedForCorrections(submitted)) throw new Error(CLOSED_DEBRIEF_MESSAGE)
    if (item.clientName) upsertSharedClientName(item.clientName).catch(error => console.warn('Client name could not be saved:', error))

    if (isOffline) {
      const quickDraftId = getDebriefQuickDraftId(context.id)
      const updated = await mutateOfflineDraftAndOutbox({
        draftId: quickDraftId,
        draftType: 'debriefQuick',
        mutatePayload: payload => ({
          schemaVersion: DEBRIEF_SCHEMA_VERSION,
          context,
          items: mergeUniqueDebriefItems(payload?.items || [], [item])
        }),
        queueAction: {
          id: getShiftDebriefQuickActionId(context.id, item.id),
          type: OFFLINE_ACTION_TYPES.SHIFT_DEBRIEF_QUICK_NOTE,
          payload: { schemaVersion: DEBRIEF_SCHEMA_VERSION, context, item, user }
        }
      })
      const nextItems = updated?.payload?.items || []
      setPendingQuickItems(nextItems)
      notifySuccess('Debrief note saved on this device')
      return { mode: submitted ? 'extra' : 'draft', debriefId: submitted?.id || context.id, pending: true }
    }

    const result = await saveQuickDebriefNote(context, item, user)
    notifySuccess(result.mode === 'extra' ? 'Extra note added' : 'Debrief note saved')
    return { ...result, pending: false }
  }

  const handleQuickUndo = async entry => {
    if (!context) return
    if (entry.result?.pending) {
      const quickDraftId = getDebriefQuickDraftId(context.id)
      const updated = await mutateOfflineDraftAndOutbox({
        draftId: quickDraftId,
        draftType: 'debriefQuick',
        mutatePayload: payload => {
          const nextItems = (payload?.items || []).filter(item => item.id !== entry.item.id)
          return nextItems.length > 0
            ? { ...payload, schemaVersion: DEBRIEF_SCHEMA_VERSION, context, items: nextItems }
            : null
        },
        deleteActionId: getShiftDebriefQuickActionId(context.id, entry.item.id)
      })
      const nextItems = updated?.payload?.items || []
      setPendingQuickItems(nextItems)
      if (!isOffline) await undoQuickDebriefNote(context, entry.item, entry.result).catch(() => false)
      return
    }
    await undoQuickDebriefNote(context, entry.item, entry.result)
  }

  if (!context && !debriefId) {
    return <div className="transport-page debrief-page"><div className="debrief-unavailable">Shift Debrief is not available for this assignment.</div></div>
  }

  const visibleItems = mergeUniqueDebriefItems(items, pendingQuickItems)
  const quickNoteCount = visibleItems.filter(item => item.source === 'quick_note').length
  const locationLabel = submitted?.locationLabel || context?.locationLabel || ''
  const shiftLabel = submitted?.shiftLabel || context?.shiftLabel || ''

  return (
    <div className={`transport-page debrief-page ${mode === 'quick' ? 'debrief-page-quick' : ''}`}>
      {showGuide && !debriefId && <ShiftDebriefGuide onComplete={() => setShowGuide(false)} />}

      {mode !== 'quick' && (
        <div className="debrief-page-heading">
          <span>{locationLabel}{locationLabel && shiftLabel ? ' - ' : ''}{shiftLabel}</span>
        </div>
      )}

      {collaborationNotice && mode !== 'quick' && !submitted && (
        <div className={`debrief-collaboration-banner ${collaborationConflicts.length > 0 ? 'is-conflict' : ''}`}>
          <div>{collaborationNotice}</div>
          {collaborationConflicts.length > 0 && (
            <div className="debrief-conflict-actions">
              <button type="button" onClick={useLatestConflicts}>Use latest</button>
              <button type="button" onClick={keepMineConflicts}>Keep mine</button>
            </div>
          )}
        </div>
      )}

      {mode === 'quick' ? (
        <ShiftDebriefQuickNote
          user={user}
          locationLabel={locationLabel}
          shiftLabel={shiftLabel}
          items={visibleItems}
          isOffline={isOffline}
          pendingCount={pendingQuickItems.length}
          closedMessage={submitted && isDebriefClosedForCorrections(submitted) ? CLOSED_DEBRIEF_MESSAGE : ''}
          onSave={handleQuickSave}
          onUndo={handleQuickUndo}
          onDone={onDone || onBack}
          onViewFull={onViewFull}
        />
      ) : submitted ? (
        <SubmittedDebriefView debrief={submitted} user={user} isOffline={isOffline} onOpenIssue={onOpenIssue} />
      ) : (
        <ShiftDebriefDocumentEditor
          items={visibleItems}
          user={user}
          statusText={saveStatus.text || (lastSavedAt ? `Autosaved ${formatTime(lastSavedAt)}` : 'Draft not saved yet')}
          statusTone={saveStatus.tone}
          retryVisible={saveStatus.tone === 'error'}
          quickNoteCount={quickBannerDismissed ? 0 : quickNoteCount}
          onDismissQuickBanner={() => setQuickBannerDismissed(true)}
          onItemsChange={updateDraftItems}
          onRetrySave={() => persistDraft({ notify: true })}
          onSubmit={handleSubmit}
          submitting={submitting}
          isOffline={isOffline}
        />
      )}
    </div>
  )
}
