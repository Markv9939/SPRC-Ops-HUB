import { useEffect, useMemo, useRef, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import ClientAutocomplete from './ClientAutocomplete'
import AutocompleteDropdown from './AutocompleteDropdown'
import DebriefGroupedReadView from './DebriefGroupedReadView'
import useAutocomplete from '../hooks/useAutocomplete'
import {
  CLIENT_NOTE_SECTIONS,
  CONFIRMATION_ITEMS,
  DEBRIEF_DRAFTS_COLLECTION,
  DEBRIEFS_COLLECTION,
  GENERAL_HANDOFF_SECTIONS,
  CLOSED_DEBRIEF_MESSAGE,
  createDebriefItem,
  createEmptyConfirmation,
  getBhtDebriefContext,
  isDebriefClosedForCorrections,
  saveDebriefDraft,
  saveDebriefConfirmation,
  saveQuickDebriefNote,
  submitShiftDebrief,
  appendExtraDebriefNote,
  createExtraNote,
  upsertSharedClientName
} from '../services/shiftDebriefService'
import { deleteOfflineDraft, getOfflineDraft, listAllOfflineActions, saveOfflineDraft } from '../services/offlineStore'
import {
  OFFLINE_ACTION_TYPES,
  getDebriefDraftId,
  getDebriefQuickDraftId,
  queueShiftDebriefConfirmation,
  queueShiftDebriefExtraNote,
  queueShiftDebriefQuickNote,
  queueShiftDebriefSubmission,
  syncOfflineOutbox
} from '../services/offlineSyncService'
import { notifySuccess } from '../utils/toast'
import { showConfirmDialog } from '../utils/dialogs'
import { cloneRecord, formatConflictFields, mergeRecordFields } from '../utils/collaboration'
import { formatVersionConflictMessage, getVersionNumber } from '../services/versioning'

const GUIDE_KEY = 'sprc_shift_debrief_guide_done'
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
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function sortItems(items) {
  return [...(Array.isArray(items) ? items : [])].sort((a, b) => (
    String(a.createdAtIso || '').localeCompare(String(b.createdAtIso || ''))
  ))
}

function mergeUniqueItems(...groups) {
  const byId = new Map()
  groups.flat().forEach(item => {
    if (item?.id) byId.set(item.id, item)
  })
  return sortItems(Array.from(byId.values()))
}

function editableDebriefDraft(data = {}) {
  return {
    items: sortItems(data.items || [])
  }
}

const EDIT_SECTION_TABS = [
  {
    id: 'medication_health_updates',
    label: 'Med/Health',
    icon: 'Rx',
    header: 'Medication & Health Updates',
    emptyTitle: 'No medication clients yet',
    emptyHint: 'Use the form below to add the first one',
    tone: 'navy'
  },
  {
    id: 'client_progress_concerns',
    label: 'Progress',
    icon: 'List',
    header: 'Client Progress & Concerns',
    emptyTitle: 'No progress clients yet',
    emptyHint: 'Use the form below to add the first one',
    tone: 'navy'
  },
  {
    id: 'general',
    label: 'General',
    icon: 'Note',
    header: 'General Handoff',
    tone: 'slate'
  }
]

const CLIENT_NOTE_PLACEHOLDERS = {
  medication_health_updates: name => `Add a med/health note for ${name}...`,
  client_progress_concerns: name => `Add a progress note for ${name}...`
}

function getDebriefNotePlaceholder(type, sectionId, clientName) {
  if (type === 'client') {
    const name = String(clientName || '').trim() || 'this client'
    const getPlaceholder = CLIENT_NOTE_PLACEHOLDERS[sectionId] || (value => `Add a note for ${value}...`)
    return getPlaceholder(name)
  }

  return 'Write your note...'
}

function normalizeClientKey(value) {
  return String(value || 'Client').trim().toLowerCase().replace(/\s+/g, ' ')
}

function getClientGroupKey(sectionId, clientName) {
  return `${sectionId}:${normalizeClientKey(clientName)}`
}

function makeUiId(prefix = 'draft') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function getCurrentUserConfirmation(sourceDebrief, user) {
  const userId = String(user?.id || '').trim()
  const saved = sourceDebrief?.confirmation?.acknowledgments?.[userId]
  return saved || sourceDebrief?.confirmation || createEmptyConfirmation()
}

function ShiftDebriefGuide({ onComplete }) {
  const [stepIndex, setStepIndex] = useState(0)
  const steps = [
    {
      title: 'Build during shift',
      body: 'Add short notes as things happen so handoff is easier and nothing important waits until the end.'
    },
    {
      title: 'Quick capture',
      body: 'Use Add Debrief Note for a fast client note or general handoff item.'
    },
    {
      title: 'Review draft',
      body: 'Use Edit Shift Debrief to clean up the draft, save it, and submit only when it is ready for handoff.'
    },
    {
      title: 'After submit',
      body: 'The original debrief locks. If something was missed, add an extra note with your name and timestamp.'
    }
  ]

  const finish = () => {
    localStorage.setItem(GUIDE_KEY, 'true')
    onComplete()
  }

  const isLast = stepIndex === steps.length - 1
  const step = steps[stepIndex]

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card">
        <div className="onboarding-title">{step.title}</div>
        <div className="onboarding-body">{step.body}</div>
        <div className="onboarding-dots">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`onboarding-dot ${i === stepIndex ? 'onboarding-dot-active' : ''}`}
            />
          ))}
        </div>
        <button
          className="onboarding-btn"
          onClick={() => (isLast ? finish() : setStepIndex(prev => prev + 1))}
        >
          {isLast ? 'Got it' : 'Next'}
        </button>
        {!isLast && (
          <button className="onboarding-skip" onClick={finish}>
            Skip guide
          </button>
        )}
      </div>
    </div>
  )
}

function SectionSelect({ type, value, onChange }) {
  const options = type === 'client' ? CLIENT_NOTE_SECTIONS : GENERAL_HANDOFF_SECTIONS
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(option => (
        <option key={option.id} value={option.id}>{option.label}</option>
      ))}
    </select>
  )
}

function DebriefNoteForm({ user, onSave, buttonLabel = 'Save Note', compact = false, isOffline = false }) {
  const [type, setType] = useState('client')
  const [clientName, setClientName] = useState('')
  const [section, setSection] = useState(CLIENT_NOTE_SECTIONS[0].id)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const notePlaceholder = getDebriefNotePlaceholder(type, section, clientName)

  useEffect(() => {
    setSection(type === 'client' ? CLIENT_NOTE_SECTIONS[0].id : GENERAL_HANDOFF_SECTIONS[0].id)
    setClientName('')
  }, [type])

  const handleSave = async () => {
    const trimmedNote = note.trim()
    const trimmedClient = clientName.trim()
    if (type === 'client' && !trimmedClient) {
      alert('Please add the client first name before saving this note.')
      return
    }
    if (!trimmedNote) {
      alert('Please enter a note before saving.')
      return
    }

    setSaving(true)
    try {
      const item = createDebriefItem({
        type,
        section,
        clientName: type === 'client' ? trimmedClient : '',
        note: trimmedNote,
        user
      })
      await onSave(item)
      setNote('')
      setClientName('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={styles.segmented}>
        <button
          type="button"
          onClick={() => setType('client')}
          style={{ ...styles.segmentButton, ...(type === 'client' ? styles.segmentButtonActive : {}) }}
        >
          Client Note
        </button>
        <button
          type="button"
          onClick={() => setType('general')}
          style={{ ...styles.segmentButton, ...(type === 'general' ? styles.segmentButtonActive : {}) }}
        >
          General Handoff
        </button>
      </div>

      {type === 'client' && (
        <div>
          <div className="transport-section-label" style={styles.fieldLabel}>
            Client <span className="transport-section-required">required</span>
          </div>
          {clientName ? (
            <div className="chip chip-client" style={styles.selectedClientChip}>
              <span>{clientName}</span>
              <button
                type="button"
                onClick={() => setClientName('')}
                style={styles.chipRemoveButton}
                aria-label="Remove client"
              >
                x
              </button>
            </div>
          ) : (
            <ClientAutocomplete
              onAddClient={(name) => setClientName(name)}
              existingClients={[]}
              isOffline={isOffline}
            />
          )}
          <div style={styles.hintText}>Use first name and last initial when possible.</div>
        </div>
      )}

      <div>
        <div className="transport-section-label" style={styles.fieldLabel}>
          Section
        </div>
        <SectionSelect type={type} value={section} onChange={setSection} />
      </div>

      <div>
        <div className="transport-section-label" style={styles.fieldLabel}>
          Note <span className="transport-section-required">required</span>
        </div>
        <textarea
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={compact ? 4 : 5}
          placeholder={notePlaceholder}
          style={styles.textarea}
        />
      </div>

      <button
        type="button"
        className="btn btn-finish"
        onClick={handleSave}
        disabled={saving}
        style={styles.primaryButton}
      >
        {saving ? 'Saving...' : buttonLabel}
      </button>
    </div>
  )
}

function SubmittedDebriefView({ debrief, user, onExtraNoteAdded, isOffline = false }) {
  const [extraNoteText, setExtraNoteText] = useState('')
  const [confirmation, setConfirmation] = useState(() => getCurrentUserConfirmation(debrief, user))
  const [savingExtra, setSavingExtra] = useState(false)
  const [savingConfirmation, setSavingConfirmation] = useState(false)
  const [pendingExtraNotes, setPendingExtraNotes] = useState([])
  const [confirmationPending, setConfirmationPending] = useState(false)
  const correctionsClosed = isDebriefClosedForCorrections(debrief)

  useEffect(() => {
    setConfirmation(getCurrentUserConfirmation(debrief, user))
  }, [debrief, user])

  useEffect(() => {
    let cancelled = false
    const refreshPending = async () => {
      const actions = await listAllOfflineActions().catch(() => [])
      if (cancelled) return
      const pendingStatuses = new Set(['pending', 'syncing', 'failed', 'needsReview'])
      const matching = actions.filter(action => pendingStatuses.has(action.status) && action.payload?.debriefId === debrief.id)
      setPendingExtraNotes(matching
        .filter(action => action.type === OFFLINE_ACTION_TYPES.SHIFT_DEBRIEF_EXTRA_NOTE)
        .map(action => action.payload?.extraNote)
        .filter(Boolean))
      const pendingConfirmation = matching.find(action => (
        action.type === OFFLINE_ACTION_TYPES.SHIFT_DEBRIEF_CONFIRMATION
        && String(action.payload?.user?.id || '') === String(user?.id || '')
      ))
      setConfirmationPending(Boolean(pendingConfirmation))
      if (pendingConfirmation?.payload?.confirmation) setConfirmation(pendingConfirmation.payload.confirmation)
    }
    refreshPending()
    window.addEventListener('offline-outbox-changed', refreshPending)
    return () => {
      cancelled = true
      window.removeEventListener('offline-outbox-changed', refreshPending)
    }
  }, [debrief.id, user?.id])

  const addExtraNote = async () => {
    if (correctionsClosed) {
      alert(CLOSED_DEBRIEF_MESSAGE)
      return
    }
    if (!extraNoteText.trim()) {
      alert('Please enter the extra note first.')
      return
    }
    setSavingExtra(true)
    try {
      const extraNote = createExtraNote({
        note: extraNoteText,
        user,
        source: 'submitted_view'
      })
      if (isOffline) {
        await queueShiftDebriefExtraNote({ debriefId: debrief.id, extraNote, user })
      } else {
        await appendExtraDebriefNote(debrief.id, extraNote)
      }
      setExtraNoteText('')
      notifySuccess(isOffline ? 'Extra note saved on this device' : 'Extra note added')
      onExtraNoteAdded?.()
    } finally {
      setSavingExtra(false)
    }
  }

  const saveConfirmation = async () => {
    setSavingConfirmation(true)
    try {
      if (isOffline) {
        await queueShiftDebriefConfirmation({ debriefId: debrief.id, confirmation, user })
      } else {
        await saveDebriefConfirmation(debrief.id, confirmation, user)
      }
      notifySuccess(isOffline ? 'Confirmation saved on this device' : 'Confirmation saved')
    } finally {
      setSavingConfirmation(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={styles.lockedBanner}>
        {correctionsClosed
          ? CLOSED_DEBRIEF_MESSAGE
          : 'Submitted debrief is locked. Add extra notes below if something was missed.'}
      </div>

      <div style={styles.panel}>
        <h3 style={styles.panelTitle}>Submitted Handoff</h3>
        <div style={styles.metaLine}>
          Submitted by {debrief.submittedByName || debrief.draftByName || 'BHT'} on {formatTimestamp(debrief.submittedAt)}
        </div>
        <DebriefGroupedReadView items={debrief.items} emptyText="No notes in this debrief." />
      </div>

      <div style={styles.panel}>
        <h3 style={styles.panelTitle}>Extra Notes / Corrections</h3>
        {(debrief.extraNotes || []).length === 0 ? (
          <div style={styles.emptyText}>No extra notes added.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
            {sortItems(debrief.extraNotes).map(note => (
              <div key={note.id} style={styles.readOnlyItem}>
                <div style={styles.itemHeader}>
                  <strong>{note.createdByName || 'BHT'}</strong>
                  <span style={styles.itemTime}>{formatTimestamp(note.createdAtIso)}</span>
                </div>
                <div style={styles.noteText}>{note.note}</div>
              </div>
            ))}
          </div>
        )}
        {pendingExtraNotes.map(note => (
          <div key={note.id} style={styles.pendingOfflineItem}>
            <strong>Pending sync: </strong>{note.note}
          </div>
        ))}
        {correctionsClosed ? (
          <div style={styles.closedText}>No more corrections can be added after review.</div>
        ) : (
          <>
            <textarea
              className="input"
              value={extraNoteText}
              onChange={(e) => setExtraNoteText(e.target.value)}
              rows={4}
              placeholder="Add what was missed, corrected, or needs follow-up..."
              style={styles.textarea}
            />
            <button
              className="btn btn-finish"
              onClick={addExtraNote}
              disabled={savingExtra}
              style={styles.primaryButton}
            >
              {savingExtra ? 'Saving...' : 'Add Extra Note'}
            </button>
          </>
        )}
      </div>

      <div style={styles.panel}>
        <h3 style={styles.panelTitle}>Incoming Staff Confirmation</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {CONFIRMATION_ITEMS.map(item => (
            <label key={item.id} style={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={confirmation?.[item.id] === true}
                onChange={(e) => setConfirmation(prev => ({ ...prev, [item.id]: e.target.checked }))}
              />
              <span>{item.label}</span>
            </label>
          ))}
        </div>
        <div style={{ marginTop: '14px' }}>
          <div style={styles.fieldLabel}>Incoming staff initials / confirmation</div>
          <input
            className="input"
            value={confirmation?.incomingStaffInitials || ''}
            onChange={(e) => setConfirmation(prev => ({ ...prev, incomingStaffInitials: e.target.value }))}
            placeholder="Initials"
            style={{ maxWidth: '180px' }}
          />
        </div>
        {confirmation?.confirmed && (
          <div style={styles.confirmedText}>
            Confirmed by {confirmation?.confirmedByName || 'incoming staff'} on {formatTimestamp(confirmation?.confirmedAt)}
          </div>
        )}
        {confirmationPending && <div style={styles.savedText}>Confirmation pending sync</div>}
        <button
          className="btn btn-finish"
          onClick={saveConfirmation}
          disabled={savingConfirmation}
          style={styles.primaryButton}
        >
          {savingConfirmation ? 'Saving...' : 'Save Confirmation'}
        </button>
      </div>
    </div>
  )
}

function buildClientGroups(items, emptyClients) {
  const groupsBySection = EDIT_SECTION_TABS
    .filter(tab => tab.id !== 'general')
    .reduce((acc, tab) => ({ ...acc, [tab.id]: [] }), {})
  const groupLookup = new Map()

  items.forEach((item, index) => {
    if (item?.type !== 'client' || !groupsBySection[item.section]) return
    const clientName = item.clientName?.trim() || 'Client'
    const groupKey = getClientGroupKey(item.section, clientName)

    if (!groupLookup.has(groupKey)) {
      const group = {
        key: groupKey,
        sectionId: item.section,
        clientName,
        notes: [],
        emptyOnly: false
      }
      groupLookup.set(groupKey, group)
      groupsBySection[item.section].push(group)
    }

    groupLookup.get(groupKey).notes.push({ item, index })
  })

  emptyClients.forEach(client => {
    if (!groupsBySection[client.sectionId]) return
    const groupKey = getClientGroupKey(client.sectionId, client.clientName)
    if (groupLookup.has(groupKey)) return

    const group = {
      key: groupKey,
      sectionId: client.sectionId,
      clientName: client.clientName,
      notes: [],
      emptyOnly: true
    }
    groupLookup.set(groupKey, group)
    groupsBySection[client.sectionId].push(group)
  })

  return groupsBySection
}

function DebriefClientAutocomplete({
  sectionId,
  value,
  onChange,
  onAdd,
  existingClients,
  invalid,
  inputRef
}) {
  const internalInputRef = useRef(null)
  const { suggestions, isVisible, isLoading, search, select, hide, show } = useAutocomplete(
    'clients',
    'normalizedLabel',
    1,
    6
  )
  const normalizedExisting = new Set(existingClients)
  const filteredSuggestions = suggestions.filter(s => !normalizedExisting.has(normalizeClientKey(s.label)))
  const trimmedValue = value.trim()

  const handleChange = (event) => {
    const nextValue = event.target.value
    onChange(nextValue)
    search(nextValue)
  }

  const handleSelect = (suggestion) => {
    select(suggestion)
    onChange(suggestion.label)
    onAdd(sectionId, suggestion.label)
  }

  const renderSuggestion = (suggestion) => {
    const label = suggestion.label || ''
    const prefixLength = trimmedValue.length
    const prefix = label.slice(0, prefixLength)
    const rest = label.slice(prefixLength)
    const isPrefixMatch = label.toLowerCase().startsWith(trimmedValue.toLowerCase())

    return isPrefixMatch ? (
      <span>
        <span className="debrief-ac-match">{prefix}</span>{rest}
      </span>
    ) : (
      <span>{label}</span>
    )
  }

  return (
    <>
      <input
        ref={node => {
          internalInputRef.current = node
          if (typeof inputRef === 'function') inputRef(node)
        }}
        className={`input debrief-client-input ${invalid ? 'debrief-input-shake' : ''}`}
        value={value}
        onChange={handleChange}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onAdd(sectionId)
          }
        }}
        onFocus={() => {
          if (trimmedValue) show()
        }}
        onBlur={() => setTimeout(() => hide(), 250)}
        placeholder="Client first name, last initial if needed"
        autoComplete="off"
      />
      <AutocompleteDropdown
        suggestions={filteredSuggestions}
        isVisible={isVisible && filteredSuggestions.length > 0}
        loading={isLoading}
        onSelect={handleSelect}
        inputRef={internalInputRef}
        placement="below"
        maxHeightCap={130}
        renderItem={renderSuggestion}
      />
    </>
  )
}

function SectionTabsDraftEditor({
  items,
  user,
  onItemsChange,
  statusText,
  onSaveDraft,
  manualSaving,
  onSubmit,
  submitting
}) {
  const [activeTab, setActiveTab] = useState(EDIT_SECTION_TABS[0].id)
  const [emptyClients, setEmptyClients] = useState([])
  const [clientDrafts, setClientDrafts] = useState({})
  const [noteDrafts, setNoteDrafts] = useState({})
  const [generalComposerOpen, setGeneralComposerOpen] = useState(false)
  const [generalLabel, setGeneralLabel] = useState('')
  const [generalNote, setGeneralNote] = useState('')
  const [invalidClientSections, setInvalidClientSections] = useState({})
  const clientInputRefs = useRef({})
  const noteInputRefs = useRef({})
  const generalNoteInputRef = useRef(null)

  const clientGroups = useMemo(
    () => buildClientGroups(items, emptyClients),
    [emptyClients, items]
  )

  const generalNotes = useMemo(
    () => items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item?.type === 'general')
      .sort((a, b) => String(a.item.createdAtIso || '').localeCompare(String(b.item.createdAtIso || ''))),
    [items]
  )

  useEffect(() => {
    const timer = setTimeout(() => {
      if (activeTab === 'general') return
      clientInputRefs.current[activeTab]?.focus()
    }, 80)
    return () => clearTimeout(timer)
  }, [activeTab])

  useEffect(() => {
    if (!generalComposerOpen) return
    const timer = setTimeout(() => generalNoteInputRef.current?.focus(), 80)
    return () => clearTimeout(timer)
  }, [generalComposerOpen])

  const applyItemsChange = (updater) => {
    onItemsChange(updater)
  }

  const focusNoteInput = (groupKey) => {
    setTimeout(() => noteInputRefs.current[groupKey]?.focus(), 80)
  }

  const getExistingClientNames = (sectionId) => (
    (clientGroups[sectionId] || []).map(group => normalizeClientKey(group.clientName))
  )

  const addClient = (sectionId, overrideName = '') => {
    const rawName = overrideName || clientDrafts[sectionId] || ''
    const clientName = rawName.trim()
    if (!clientName) {
      setInvalidClientSections(prev => ({ ...prev, [sectionId]: true }))
      clientInputRefs.current[sectionId]?.focus()
      return
    }

    const normalized = normalizeClientKey(clientName)
    const existingNames = getExistingClientNames(sectionId)
    const groupKey = getClientGroupKey(sectionId, clientName)

    if (existingNames.includes(normalized)) {
      setClientDrafts(prev => ({ ...prev, [sectionId]: '' }))
      focusNoteInput(groupKey)
      return
    }

    setEmptyClients(prev => [
      ...prev,
      { id: makeUiId('client'), sectionId, clientName }
    ])
    setClientDrafts(prev => ({ ...prev, [sectionId]: '' }))
    setInvalidClientSections(prev => ({ ...prev, [sectionId]: false }))
    upsertSharedClientName(clientName).catch(err => console.warn('Client save skipped:', err))
    focusNoteInput(groupKey)
  }

  const addNote = (group) => {
    const noteText = (noteDrafts[group.key] || '').trim()
    if (!noteText) {
      focusNoteInput(group.key)
      return
    }

    const item = createDebriefItem({
      type: 'client',
      section: group.sectionId,
      clientName: group.clientName,
      note: noteText,
      user
    })

    applyItemsChange(prev => [...prev, item])
    setNoteDrafts(prev => ({ ...prev, [group.key]: '' }))
    focusNoteInput(group.key)
  }

  const updateNote = (itemIndex, note) => {
    applyItemsChange(prev => prev.map((item, index) => (
      index === itemIndex
        ? { ...item, note, updatedAtIso: new Date().toISOString() }
        : item
    )))
  }

  const removeNote = (itemIndex, groupKey) => {
    applyItemsChange(prev => prev.filter((_, index) => index !== itemIndex))
    focusNoteInput(groupKey)
  }

  const removeClient = (group) => {
    applyItemsChange(prev => prev.filter(item => !(
      item?.type === 'client'
      && item.section === group.sectionId
      && getClientGroupKey(group.sectionId, item.clientName || 'Client') === group.key
    )))
    setEmptyClients(prev => prev.filter(client => getClientGroupKey(client.sectionId, client.clientName) !== group.key))
    setNoteDrafts(prev => {
      const next = { ...prev }
      delete next[group.key]
      return next
    })
    clientInputRefs.current[group.sectionId]?.focus()
  }

  const closeGeneralComposer = () => {
    setGeneralComposerOpen(false)
    setGeneralLabel('')
    setGeneralNote('')
  }

  const addGeneralNote = () => {
    const noteText = generalNote.trim()
    if (!generalLabel || !noteText) return

    const item = createDebriefItem({
      type: 'general',
      section: generalLabel,
      clientName: '',
      note: noteText,
      user
    })

    applyItemsChange(prev => [...prev, item])
    closeGeneralComposer()
  }

  const removeGeneralNote = (itemIndex) => {
    applyItemsChange(prev => prev.filter((_, index) => index !== itemIndex))
  }

  const activeTabConfig = EDIT_SECTION_TABS.find(tab => tab.id === activeTab) || EDIT_SECTION_TABS[0]
  const activeGroups = clientGroups[activeTabConfig.id] || []
  const canSubmit = items.some(item => item.note?.trim() && (item.type !== 'client' || item.clientName?.trim()))

  return (
    <div className="debrief-edit-shell">
      <div className="debrief-top-bar">
        <div className="debrief-tabbar" role="tablist" aria-label="Debrief sections">
          {EDIT_SECTION_TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`debrief-tab ${activeTab === tab.id ? 'debrief-tab-active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="debrief-top-divider" />
        <div className="debrief-top-actions">
          <button
            type="button"
            className="debrief-top-save"
            onClick={onSaveDraft}
            disabled={manualSaving}
          >
            {manualSaving ? 'Saving...' : 'Save'}
          </button>
          <button
            type="button"
            className="debrief-top-submit"
            onClick={onSubmit}
            disabled={submitting || !canSubmit}
          >
            {submitting ? 'Submitting...' : 'Submit Debrief'}
          </button>
        </div>
      </div>

      <div key={activeTabConfig.id} className="debrief-section-panel">
        {activeTabConfig.id !== 'general' && (
          <div className="debrief-section-header">
            <span>{activeTabConfig.icon}</span>
            <span>{activeTabConfig.header}</span>
          </div>
        )}

        {activeTabConfig.id === 'general' ? (
          <div className="debrief-handoff-body">
            {generalNotes.length === 0 ? (
              <div className="debrief-handoff-empty">
                No handoff notes yet — tap Add to get started
              </div>
            ) : (
              <div className="debrief-handoff-list">
                {generalNotes.map(({ item, index }) => {
                  const label = GENERAL_HANDOFF_SECTIONS.find(section => section.id === item.section)
                  const tone = label?.tone || 'general'
                  return (
                    <div key={item.id || index} className={`debrief-handoff-card debrief-handoff-card-${tone}`}>
                      <div className="debrief-handoff-card-content">
                        <span className={`debrief-handoff-tag debrief-handoff-tag-${tone}`}>
                          {label?.label || item.section}
                        </span>
                        <div className="debrief-handoff-text">{item.note}</div>
                      </div>
                      <button
                        type="button"
                        className="debrief-handoff-remove"
                        onClick={() => removeGeneralNote(index)}
                        aria-label={`Remove ${label?.label || 'handoff'} note`}
                      >
                        ✕
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {generalComposerOpen ? (
              <div className="debrief-handoff-composer">
                <div className="debrief-handoff-composer-title">Add handoff note</div>
                <div className="debrief-handoff-labels" role="radiogroup" aria-label="Handoff note label">
                  {GENERAL_HANDOFF_SECTIONS.map(section => (
                    <button
                      key={section.id}
                      type="button"
                      role="radio"
                      aria-checked={generalLabel === section.id}
                      className={`debrief-handoff-label debrief-handoff-label-${section.tone} ${generalLabel === section.id ? 'debrief-handoff-label-selected' : ''}`}
                      onClick={() => setGeneralLabel(section.id)}
                    >
                      {section.label}
                    </button>
                  ))}
                </div>
                <textarea
                  ref={generalNoteInputRef}
                  className="input debrief-handoff-input"
                  value={generalNote}
                  onChange={(e) => setGeneralNote(e.target.value)}
                  rows={4}
                  placeholder="Write your note..."
                />
                <div className="debrief-handoff-actions">
                  <button
                    type="button"
                    className="debrief-handoff-cancel"
                    onClick={closeGeneralComposer}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="debrief-handoff-add"
                    onClick={addGeneralNote}
                    disabled={!generalLabel || !generalNote.trim()}
                  >
                    Add note
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="debrief-handoff-open"
                onClick={() => setGeneralComposerOpen(true)}
              >
                + Add handoff note
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="debrief-client-area">
              {activeGroups.length === 0 ? (
                <div className="debrief-empty-state">
                  <div className="debrief-empty-icon">{activeTabConfig.icon}</div>
                  <div className="debrief-empty-title">{activeTabConfig.emptyTitle}</div>
                  <div className="debrief-empty-hint">{activeTabConfig.emptyHint}</div>
                </div>
              ) : (
                activeGroups.map(group => (
                  <div key={group.key} className="debrief-client-card">
                    <div className="debrief-client-header">
                      <div className="debrief-client-name" title={group.clientName}>{group.clientName}</div>
                      <button
                        type="button"
                        className="debrief-icon-remove"
                        onClick={() => removeClient(group)}
                        aria-label={`Remove ${group.clientName}`}
                      >
                        x
                      </button>
                    </div>

                    {group.notes.length > 0 && (
                      <div className="debrief-note-list">
                        {group.notes.map(({ item, index }) => (
                          <div key={item.id || index} className="debrief-note-row">
                            <span className="debrief-note-dash">-</span>
                            <textarea
                              className="debrief-note-edit"
                              value={item.note || ''}
                              onChange={(e) => updateNote(index, e.target.value)}
                              rows={1}
                              aria-label={`Edit note for ${group.clientName}`}
                            />
                            <button
                              type="button"
                              className="debrief-note-remove"
                              onClick={() => removeNote(index, group.key)}
                              aria-label="Remove note"
                            >
                              x
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="debrief-add-note-row">
                      <textarea
                        ref={node => {
                          if (node) noteInputRefs.current[group.key] = node
                        }}
                        className="input debrief-note-input"
                        value={noteDrafts[group.key] || ''}
                        onChange={(e) => setNoteDrafts(prev => ({ ...prev, [group.key]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            addNote(group)
                          }
                        }}
                        rows={1}
                        placeholder={(CLIENT_NOTE_PLACEHOLDERS[group.sectionId] || (name => `Add a note for ${name}...`))(group.clientName)}
                      />
                      <button
                        type="button"
                        className="debrief-note-button"
                        onClick={() => addNote(group)}
                      >
                        + Note
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="debrief-add-client-zone">
              <div className="debrief-add-client-label">
                <span className="debrief-add-client-plus">+</span>
                Add a client to this section
              </div>
              <div className="debrief-add-client-row">
                <DebriefClientAutocomplete
                  sectionId={activeTabConfig.id}
                  value={clientDrafts[activeTabConfig.id] || ''}
                  onChange={(value) => {
                    setClientDrafts(prev => ({ ...prev, [activeTabConfig.id]: value }))
                    setInvalidClientSections(prev => ({ ...prev, [activeTabConfig.id]: false }))
                  }}
                  onAdd={addClient}
                  existingClients={getExistingClientNames(activeTabConfig.id)}
                  invalid={invalidClientSections[activeTabConfig.id]}
                  inputRef={node => {
                    if (node) clientInputRefs.current[activeTabConfig.id] = node
                  }}
                />
                <button
                  type="button"
                  className="debrief-add-client-button"
                  onClick={() => addClient(activeTabConfig.id)}
                >
                  + Add
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="debrief-save-strip">
        <span className="debrief-save-dot" />
        <span>{statusText}</span>
      </div>
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
  onQuickNoteSaved
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
  const [manualSaving, setManualSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [showGuide, setShowGuide] = useState(() => !localStorage.getItem(GUIDE_KEY))
  const [quickStatus, setQuickStatus] = useState('')
  const [collaborationNotice, setCollaborationNotice] = useState('')
  const [collaborationConflicts, setCollaborationConflicts] = useState([])
  const [conflictRemoteDraft, setConflictRemoteDraft] = useState(null)
  const baseDraftRef = useRef(null)
  const itemsRef = useRef([])
  const dirtyRef = useRef(false)
  const hasLocalDraftRef = useRef(false)

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  useEffect(() => {
    hasLocalDraftRef.current = hasLocalDraft
  }, [hasLocalDraft])

  useEffect(() => {
    if (!targetDebriefId) return undefined
    const unsubSubmitted = onSnapshot(
      doc(db, DEBRIEFS_COLLECTION, targetDebriefId),
      (snap) => setSubmitted(snap.exists() ? { id: snap.id, ...snap.data() } : null),
      (err) => {
        console.error('Shift debrief submitted listener failed:', err)
        setSubmitted(null)
      }
    )
    return () => unsubSubmitted()
  }, [targetDebriefId])

  useEffect(() => {
    if (!context?.id || debriefId) return undefined
    const unsubDraft = onSnapshot(
      doc(db, DEBRIEF_DRAFTS_COLLECTION, context.id),
      (snap) => {
        const latestDraft = snap.exists() ? { id: snap.id, ...snap.data() } : null
        setDraft(latestDraft)
        const remoteEditable = editableDebriefDraft(latestDraft || {})

        if (!baseDraftRef.current) {
          baseDraftRef.current = cloneRecord(remoteEditable)
          if (!dirtyRef.current && !hasLocalDraftRef.current) {
            setItems(remoteEditable.items)
          }
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
          return
        }

        if (result.autoMerged.length > 0) {
          setItems(sortItems(result.merged.items))
          baseDraftRef.current = cloneRecord(remoteEditable)
          setCollaborationNotice('Debrief updated elsewhere. Safe changes were merged without replacing your typing.')
        }
      },
      (err) => {
        console.error('Shift debrief draft listener failed:', err)
        setDraft(null)
        setCollaborationNotice('Debrief live updates are unavailable. You can keep typing, but save may need to be retried.')
      }
    )
    return () => unsubDraft()
  }, [context?.id, debriefId])

  useEffect(() => {
    if (!context?.id || debriefId) return undefined
    let cancelled = false
    ;(async () => {
      const localDraft = await getOfflineDraft(getDebriefDraftId(context.id)).catch(() => null)
      if (cancelled || !localDraft?.payload) return
      setItems(sortItems(localDraft.payload.items || []))
      setLastSavedAt(localDraft.updatedAtIso ? new Date(localDraft.updatedAtIso) : new Date())
      setHasLocalDraft(true)
      setDirty(false)
    })()
    return () => { cancelled = true }
  }, [context?.id, debriefId])

  useEffect(() => {
    if (!context?.id || !submitted?.id || debriefId) return undefined
    let cancelled = false
    ;(async () => {
      const legacyDraftId = getDebriefDraftId(context.id)
      const legacyDraft = await getOfflineDraft(legacyDraftId).catch(() => null)
      const legacyItems = Array.isArray(legacyDraft?.payload?.items) ? legacyDraft.payload.items : []
      if (legacyItems.length === 0 || cancelled) return

      const submittedItemIds = new Set((Array.isArray(submitted.items) ? submitted.items : []).map(item => item?.id))
      const submittedExtraItemIds = new Set((Array.isArray(submitted.extraNotes) ? submitted.extraNotes : [])
        .map(note => String(note?.id || '').replace(/^quick_/, '')))
      const recoverableItems = legacyItems.filter(item => (
        item?.id
        && !submittedItemIds.has(item.id)
        && !submittedExtraItemIds.has(item.id)
      ))
      if (recoverableItems.length === 0) return

      const quickDraftId = getDebriefQuickDraftId(context.id)
      const quickDraft = await getOfflineDraft(quickDraftId).catch(() => null)
      const existingQuickItems = Array.isArray(quickDraft?.payload?.items) ? quickDraft.payload.items : []
      const nextQuickItems = mergeUniqueItems(existingQuickItems, recoverableItems)
      await saveOfflineDraft(quickDraftId, 'debriefQuick', { context, items: nextQuickItems })
      for (const item of recoverableItems) {
        await queueShiftDebriefQuickNote({ context, item, user })
      }
      await deleteOfflineDraft(legacyDraftId)
      if (!isOffline) await syncOfflineOutbox()
      if (!cancelled) {
        const remainingDraft = await getOfflineDraft(quickDraftId).catch(() => null)
        setPendingQuickItems(sortItems(remainingDraft?.payload?.items || []))
      }
    })().catch(err => console.warn('Legacy offline debrief note recovery failed:', err))
    return () => { cancelled = true }
  }, [context, debriefId, isOffline, submitted, user])

  useEffect(() => {
    if (!context?.id || debriefId) return undefined
    let cancelled = false
    const loadPendingQuickItems = async () => {
      const localDraft = await getOfflineDraft(getDebriefQuickDraftId(context.id)).catch(() => null)
      if (!cancelled) {
        setPendingQuickItems(sortItems(localDraft?.payload?.items || []))
      }
    }
    loadPendingQuickItems()
    window.addEventListener('offline-outbox-changed', loadPendingQuickItems)
    return () => {
      cancelled = true
      window.removeEventListener('offline-outbox-changed', loadPendingQuickItems)
    }
  }, [context?.id, debriefId])

  useEffect(() => {
    if (dirty || hasLocalDraft || collaborationConflicts.length > 0) return
    setItems(sortItems(draft?.items || []))
  }, [collaborationConflicts.length, draft, dirty, hasLocalDraft])

  useEffect(() => {
    if (!dirty || submitted || mode === 'quick' || !context || collaborationConflicts.length > 0) return undefined
    const timer = setTimeout(async () => {
      try {
        await saveOfflineDraft(getDebriefDraftId(context.id), 'debrief', { context, items })
        setHasLocalDraft(true)
        if (!isOffline) {
          await saveDebriefDraft(context, items, { expectedVersion: getVersionNumber(draft) })
          await deleteOfflineDraft(getDebriefDraftId(context.id))
          setHasLocalDraft(false)
        }
        setLastSavedAt(new Date())
        setDirty(false)
        baseDraftRef.current = cloneRecord(editableDebriefDraft({ items }))
        setCollaborationConflicts([])
        setConflictRemoteDraft(null)
      } catch (err) {
        console.error('Debrief autosave failed:', err)
        setCollaborationNotice(formatVersionConflictMessage(err, 'Debrief autosave paused. Review latest changes before saving.'))
      }
    }, 1200)
    return () => clearTimeout(timer)
  }, [collaborationConflicts.length, context, dirty, draft, isOffline, items, mode, submitted])

  if (!context && !debriefId) {
    return (
      <DebriefShell title="Shift Debrief" onBack={onBack}>
        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>Not available for this assignment</h3>
          <p style={styles.bodyText}>
            Shift Debrief V1 is only for Mesquite House, Lone Mountain, and Test House PHP/OTC assignments.
          </p>
        </div>
      </DebriefShell>
    )
  }

  const useLatestDebriefConflicts = () => {
    if (!conflictRemoteDraft || collaborationConflicts.length === 0) return
    const remoteItems = editableDebriefDraft(conflictRemoteDraft).items
    const remoteById = new Map(remoteItems.map(item => [item.id, item]))
    const conflictIds = new Set(collaborationConflicts.map(conflict => conflict.field))
    const nextItems = sortItems(items
      .filter(item => !(conflictIds.has(item.id) && !remoteById.has(item.id)))
      .map(item => (
        conflictIds.has(item.id) && remoteById.has(item.id)
          ? remoteById.get(item.id)
          : item
      )))
    setItems(nextItems)
    itemsRef.current = nextItems
    baseDraftRef.current = cloneRecord(editableDebriefDraft(conflictRemoteDraft))
    setCollaborationConflicts([])
    setConflictRemoteDraft(null)
    setCollaborationNotice('Latest conflicting notes applied. Your other notes were kept.')
  }

  const keepMineDebriefConflicts = () => {
    if (!conflictRemoteDraft || collaborationConflicts.length === 0) return
    baseDraftRef.current = cloneRecord(editableDebriefDraft(conflictRemoteDraft))
    setCollaborationConflicts([])
    setConflictRemoteDraft(null)
    setDirty(true)
    setCollaborationNotice('Your version was kept. Save again to apply it over the latest conflicting notes.')
  }

  const saveManualDraft = async () => {
    if (!context) return
    if (collaborationConflicts.length > 0) {
      alert(`Debrief changed elsewhere: ${formatConflictFields(collaborationConflicts)}. Use latest or keep yours before saving.`)
      return
    }
    setManualSaving(true)
    try {
      await saveOfflineDraft(getDebriefDraftId(context.id), 'debrief', { context, items })
      setHasLocalDraft(true)
      if (!isOffline) {
        await saveDebriefDraft(context, items, { expectedVersion: getVersionNumber(draft) })
        await deleteOfflineDraft(getDebriefDraftId(context.id))
        setHasLocalDraft(false)
      }
      setLastSavedAt(new Date())
      setDirty(false)
      baseDraftRef.current = cloneRecord(editableDebriefDraft({ items }))
      setCollaborationConflicts([])
      setConflictRemoteDraft(null)
      notifySuccess(isOffline ? 'Draft saved on this device' : 'Draft saved')
    } catch (err) {
      console.error('Debrief manual save failed:', err)
      alert(formatVersionConflictMessage(err, err?.message || 'Failed to save debrief draft.'))
    } finally {
      setManualSaving(false)
    }
  }

  const handleSubmit = async () => {
    if (!context) return
    if (collaborationConflicts.length > 0) {
      alert(`Debrief changed elsewhere: ${formatConflictFields(collaborationConflicts)}. Use latest or keep yours before submitting.`)
      return
    }
    const validItems = mergeUniqueItems(items, pendingQuickItems)
      .filter(item => item.note?.trim() && (item.type !== 'client' || item.clientName?.trim()))
    if (validItems.length === 0) {
      alert('Please add at least one complete debrief note before submitting.')
      return
    }
    const confirmed = await showConfirmDialog('Submit this shift debrief for handoff? The original notes will lock after submission.', {
      title: 'Submit Shift Debrief',
      tone: 'warning',
      confirmText: 'Submit',
      cancelText: 'Cancel'
    })
    if (!confirmed) {
      return
    }
    setSubmitting(true)
    try {
      if (isOffline) {
        await saveOfflineDraft(getDebriefDraftId(context.id), 'debrief', { context, items: validItems })
        await queueShiftDebriefSubmission({ context, items: validItems, user })
        setHasLocalDraft(true)
        notifySuccess('Shift debrief saved on this device. It will sync when internet returns.')
        onBack()
      } else {
        await submitShiftDebrief(context, validItems, user)
        await deleteOfflineDraft(getDebriefDraftId(context.id))
        setHasLocalDraft(false)
        notifySuccess('Shift debrief submitted')
      }
      setDirty(false)
    } catch (err) {
      console.error('Shift debrief submit failed:', err)
      alert(formatVersionConflictMessage(
        err,
        err?.code === 'permission-denied'
          ? 'Debrief submit was blocked by app permissions. Please tell a supervisor so this can be checked.'
          : err?.message || 'Failed to submit shift debrief.'
      ))
    } finally {
      setSubmitting(false)
    }
  }

  const handleQuickSave = async (item) => {
    if (!context) return
    try {
      if (submitted && isDebriefClosedForCorrections(submitted)) {
        throw new Error(CLOSED_DEBRIEF_MESSAGE)
      }
      if (isOffline) {
        const quickDraftId = getDebriefQuickDraftId(context.id)
        const localDraft = await getOfflineDraft(quickDraftId).catch(() => null)
        const existingItems = Array.isArray(localDraft?.payload?.items) ? localDraft.payload.items : []
        const nextItems = mergeUniqueItems(existingItems, [item])
        await saveOfflineDraft(quickDraftId, 'debriefQuick', { context, items: nextItems })
        await queueShiftDebriefQuickNote({ context, item, user })
        setPendingQuickItems(nextItems)
        setLastSavedAt(new Date())
        setQuickStatus('Saved on this device. It will sync when internet returns.')
        notifySuccess('Debrief note saved on this device')
        onQuickNoteSaved?.()
        return
      }
      const result = await saveQuickDebriefNote(context, item, user)
      setQuickStatus(result.mode === 'extra'
        ? 'Saved as an extra note because today\'s debrief is already submitted.'
        : 'Saved to today\'s draft debrief.')
      notifySuccess(result.mode === 'extra' ? 'Extra note added' : 'Debrief note saved')
      onQuickNoteSaved?.()
    } catch (err) {
      console.error('Quick debrief note save failed:', err)
      const message = formatVersionConflictMessage(
        err,
        err?.code === 'permission-denied'
          ? 'Debrief note was blocked by app permissions. Please tell a supervisor so this can be checked.'
          : err?.message || 'Failed to save debrief note.'
      )
      setQuickStatus(message)
      alert(message)
      throw err
    }
  }

  const updateDraftItems = (updater) => {
    setItems(prev => (typeof updater === 'function' ? updater(prev) : updater))
    setDirty(true)
  }

  const title = mode === 'quick'
    ? 'Add Debrief Note'
    : (submitted ? 'View Shift Debrief' : 'Edit Shift Debrief')

  const draftStatusText = dirty
    ? 'Unsaved changes'
    : hasLocalDraft
      ? 'Saved on this device'
      : lastSavedAt
        ? `Autosaved ${formatTime(lastSavedAt)}`
        : draft?.updatedAt
          ? `Autosaved ${formatTimestamp(draft.updatedAt)}`
          : 'Draft not saved yet'

  return (
    <DebriefShell
      title={title}
      subtitle={submitted
        ? `${submitted.locationLabel || context?.locationLabel || ''} - ${submitted.shiftLabel || context?.shiftLabel || ''}`
        : `${context?.locationLabel || ''} - ${context?.shiftLabel || ''}`}
      onBack={onBack}
    >
      {showGuide && <ShiftDebriefGuide onComplete={() => setShowGuide(false)} />}
      {collaborationNotice && mode !== 'quick' && !submitted && (
        <div style={{
          ...styles.collaborationBanner,
          ...(collaborationConflicts.length > 0 ? styles.collaborationBannerConflict : {})
        }}>
          <div>{collaborationNotice}</div>
          {collaborationConflicts.length > 0 && (
            <>
              <div style={{ marginTop: '4px', fontWeight: 700 }}>
                Conflicts: {formatConflictFields(collaborationConflicts)}
              </div>
              <div style={styles.conflictActions}>
                <button type="button" onClick={useLatestDebriefConflicts} style={styles.conflictButton}>
                  Use latest
                </button>
                <button type="button" onClick={keepMineDebriefConflicts} style={{ ...styles.conflictButton, ...styles.keepMineButton }}>
                  Keep mine
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {pendingQuickItems.length > 0 && (
        <div style={styles.pendingOfflinePanel}>
          <strong>{pendingQuickItems.length} offline debrief note{pendingQuickItems.length === 1 ? '' : 's'} pending sync</strong>
          {pendingQuickItems.map(item => (
            <div key={item.id} style={styles.pendingOfflineItem}>
              {item.clientName ? `${item.clientName}: ` : ''}{item.note}
            </div>
          ))}
        </div>
      )}

      {mode === 'quick' ? (
        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>Quick Note</h3>
          <p style={styles.bodyText}>
            {submitted && isDebriefClosedForCorrections(submitted)
              ? CLOSED_DEBRIEF_MESSAGE
              : 'Save a client note or general handoff item. If the debrief is already submitted, this saves as an extra note.'}
          </p>
          {submitted && isDebriefClosedForCorrections(submitted) ? null : (
            <DebriefNoteForm user={user} onSave={handleQuickSave} buttonLabel="Save Debrief Note" compact isOffline={isOffline} />
          )}
          {quickStatus && <div style={styles.savedText}>{quickStatus}</div>}
        </div>
      ) : submitted ? (
        <SubmittedDebriefView debrief={submitted} user={user} isOffline={isOffline} />
      ) : (
        <SectionTabsDraftEditor
          items={items}
          user={user}
          onItemsChange={updateDraftItems}
          statusText={draftStatusText}
          onSaveDraft={saveManualDraft}
          manualSaving={manualSaving}
          onSubmit={handleSubmit}
          submitting={submitting}
        />
      )}
    </DebriefShell>
  )
}

function DebriefShell({ title, subtitle = '', children }) {
  return (
    <div className="transport-page debrief-page">
      <div className="transport-header">
        <div>
          <div className="transport-title">{title}</div>
          {subtitle && <div style={styles.metaLine}>{subtitle}</div>}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {children}
      </div>
    </div>
  )
}

const styles = {
  panel: {
    backgroundColor: 'rgba(255,255,255,0.72)',
    border: '1px solid rgba(17,47,82,0.16)',
    borderRadius: '8px',
    padding: '16px'
  },
  panelTitle: {
    margin: '0 0 8px 0',
    fontSize: '16px',
    color: 'var(--text-primary)'
  },
  bodyText: {
    margin: '0 0 14px 0',
    fontSize: '14px',
    color: 'var(--text-secondary)',
    lineHeight: 1.45
  },
  fieldLabel: {
    fontSize: '13px',
    fontWeight: 700,
    color: 'var(--text-primary)',
    marginBottom: '6px'
  },
  hintText: {
    marginTop: '6px',
    fontSize: '12px',
    color: 'var(--text-secondary)'
  },
  textarea: {
    width: '100%',
    resize: 'vertical',
    minHeight: '96px',
    boxSizing: 'border-box'
  },
  segmented: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '6px',
    padding: '4px',
    backgroundColor: 'rgba(17,47,82,0.08)',
    borderRadius: '8px'
  },
  segmentButton: {
    border: 'none',
    borderRadius: '6px',
    padding: '10px 8px',
    backgroundColor: 'transparent',
    color: 'var(--text-secondary)',
    fontSize: '13px',
    fontWeight: 700,
    cursor: 'pointer'
  },
  segmentButtonActive: {
    backgroundColor: '#112F52',
    color: '#FFFFFF'
  },
  primaryButton: {
    width: '100%',
    minHeight: '46px'
  },
  submitButton: {
    width: '100%',
    minHeight: '52px',
    fontSize: '16px'
  },
  secondaryButton: {
    padding: '10px 14px',
    borderRadius: '8px',
    border: '1px solid rgba(17,47,82,0.22)',
    backgroundColor: 'rgba(17,47,82,0.08)',
    color: 'var(--text-primary)',
    fontWeight: 700,
    cursor: 'pointer'
  },
  secondaryDangerButton: {
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid rgba(205,78,66,0.36)',
    backgroundColor: 'rgba(205,78,66,0.08)',
    color: '#9D362E',
    fontWeight: 700,
    cursor: 'pointer'
  },
  selectedClientChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    padding: '8px 12px'
  },
  chipRemoveButton: {
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    fontWeight: 700,
    cursor: 'pointer',
    padding: '0 2px'
  },
  itemCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '14px',
    borderRadius: '8px',
    border: '1px solid rgba(17,47,82,0.14)',
    backgroundColor: 'rgba(17,47,82,0.04)'
  },
  readOnlyItem: {
    padding: '12px',
    borderRadius: '8px',
    border: '1px solid rgba(17,47,82,0.12)',
    backgroundColor: 'rgba(17,47,82,0.04)'
  },
  itemHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '10px',
    marginBottom: '8px'
  },
  itemType: {
    fontSize: '12px',
    color: 'var(--text-secondary)',
    marginTop: '2px'
  },
  itemTime: {
    fontSize: '12px',
    color: '#556677',
    whiteSpace: 'nowrap'
  },
  noteText: {
    fontSize: '14px',
    lineHeight: 1.45,
    color: 'var(--text-primary)',
    whiteSpace: 'pre-wrap'
  },
  editorHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '14px'
  },
  metaLine: {
    fontSize: '12px',
    color: 'var(--text-secondary)'
  },
  emptyText: {
    fontSize: '14px',
    color: 'var(--text-secondary)',
    padding: '10px 0'
  },
  closedText: {
    fontSize: '14px',
    color: 'var(--text-secondary)',
    padding: '8px 0',
    fontWeight: 700
  },
  savedText: {
    marginTop: '12px',
    fontSize: '13px',
    color: '#2F7D57',
    fontWeight: 700
  },
  pendingOfflinePanel: {
    padding: '12px 14px',
    borderRadius: '8px',
    backgroundColor: 'rgba(176,122,40,0.10)',
    border: '1px solid rgba(176,122,40,0.28)',
    color: '#765116',
    fontSize: '13px'
  },
  pendingOfflineItem: {
    marginTop: '7px',
    paddingTop: '7px',
    borderTop: '1px solid rgba(176,122,40,0.22)',
    color: 'var(--text-primary)',
    whiteSpace: 'pre-wrap'
  },
  lockedBanner: {
    padding: '12px 14px',
    borderRadius: '8px',
    backgroundColor: 'rgba(47,125,87,0.12)',
    border: '1px solid rgba(47,125,87,0.28)',
    color: '#2F7D57',
    fontSize: '14px',
    fontWeight: 700
  },
  collaborationBanner: {
    padding: '12px 14px',
    borderRadius: '8px',
    backgroundColor: 'rgba(47,125,87,0.10)',
    border: '1px solid rgba(47,125,87,0.26)',
    color: '#2F7D57',
    fontSize: '13px',
    fontWeight: 700
  },
  collaborationBannerConflict: {
    backgroundColor: 'rgba(205,78,66,0.10)',
    border: '1px solid rgba(205,78,66,0.28)',
    color: '#9D362E'
  },
  conflictActions: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    marginTop: '8px'
  },
  conflictButton: {
    padding: '7px 11px',
    borderRadius: '6px',
    border: '1px solid rgba(17,47,82,0.24)',
    backgroundColor: '#FFFFFF',
    color: 'var(--text-primary)',
    fontWeight: 700,
    cursor: 'pointer'
  },
  keepMineButton: {
    border: '1px solid rgba(205,78,66,0.36)',
    color: '#9D362E'
  },
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '14px',
    color: 'var(--text-primary)'
  },
  confirmedText: {
    marginTop: '12px',
    fontSize: '13px',
    color: '#2F7D57',
    fontWeight: 700
  }
}
