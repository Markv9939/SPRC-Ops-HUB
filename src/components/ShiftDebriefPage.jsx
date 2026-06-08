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
import { deleteOfflineDraft, getOfflineDraft, saveOfflineDraft } from '../services/offlineStore'
import { getDebriefDraftId, queueShiftDebriefSubmission } from '../services/offlineSyncService'
import { notifySuccess } from '../utils/toast'
import { showConfirmDialog } from '../utils/dialogs'

const GUIDE_KEY = 'sprc_shift_debrief_guide_done'

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

function DebriefNoteForm({ user, onSave, buttonLabel = 'Save Note', compact = false }) {
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

function SubmittedDebriefView({ debrief, user, onExtraNoteAdded }) {
  const [extraNoteText, setExtraNoteText] = useState('')
  const [confirmation, setConfirmation] = useState(() => getCurrentUserConfirmation(debrief, user))
  const [savingExtra, setSavingExtra] = useState(false)
  const [savingConfirmation, setSavingConfirmation] = useState(false)
  const correctionsClosed = isDebriefClosedForCorrections(debrief)

  useEffect(() => {
    setConfirmation(getCurrentUserConfirmation(debrief, user))
  }, [debrief, user])

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
      await appendExtraDebriefNote(debrief.id, createExtraNote({
        note: extraNoteText,
        user,
        source: 'submitted_view'
      }))
      setExtraNoteText('')
      notifySuccess('Extra note added')
      onExtraNoteAdded?.()
    } finally {
      setSavingExtra(false)
    }
  }

  const saveConfirmation = async () => {
    setSavingConfirmation(true)
    try {
      await saveDebriefConfirmation(debrief.id, confirmation, user)
      notifySuccess('Confirmation saved')
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
  onBack
}) {
  const context = useMemo(() => getBhtDebriefContext(user, new Date(), assignment), [assignment, user])
  const targetDebriefId = debriefId || context?.id || ''
  const [draft, setDraft] = useState(null)
  const [submitted, setSubmitted] = useState(null)
  const [items, setItems] = useState([])
  const [dirty, setDirty] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [hasLocalDraft, setHasLocalDraft] = useState(false)
  const [manualSaving, setManualSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [showGuide, setShowGuide] = useState(() => !localStorage.getItem(GUIDE_KEY))
  const [quickStatus, setQuickStatus] = useState('')

  useEffect(() => {
    if (!targetDebriefId) return undefined
    const unsubSubmitted = onSnapshot(
      doc(db, DEBRIEFS_COLLECTION, targetDebriefId),
      (snap) => setSubmitted(snap.exists() ? { id: snap.id, ...snap.data() } : null)
    )
    return () => unsubSubmitted()
  }, [targetDebriefId])

  useEffect(() => {
    if (!context?.id || debriefId) return undefined
    const unsubDraft = onSnapshot(
      doc(db, DEBRIEF_DRAFTS_COLLECTION, context.id),
      (snap) => setDraft(snap.exists() ? { id: snap.id, ...snap.data() } : null)
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
    if (dirty || hasLocalDraft) return
    setItems(sortItems(draft?.items || []))
  }, [draft, dirty, hasLocalDraft])

  useEffect(() => {
    if (!dirty || submitted || mode === 'quick' || !context) return undefined
    const timer = setTimeout(async () => {
      try {
        await saveOfflineDraft(getDebriefDraftId(context.id), 'debrief', { context, items })
        setHasLocalDraft(true)
        if (!isOffline) {
          await saveDebriefDraft(context, items)
          await deleteOfflineDraft(getDebriefDraftId(context.id))
          setHasLocalDraft(false)
        }
        setLastSavedAt(new Date())
        setDirty(false)
      } catch (err) {
        console.error('Debrief autosave failed:', err)
      }
    }, 1200)
    return () => clearTimeout(timer)
  }, [context, dirty, isOffline, items, mode, submitted])

  if (!context && !debriefId) {
    return (
      <DebriefShell title="Shift Debrief" onBack={onBack}>
        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>Not available for this assignment</h3>
          <p style={styles.bodyText}>
            Shift Debrief V1 is only for Mesquite House and Lone Mountain PHP/OTC assignments.
          </p>
        </div>
      </DebriefShell>
    )
  }

  const saveManualDraft = async () => {
    if (!context) return
    setManualSaving(true)
    try {
      await saveOfflineDraft(getDebriefDraftId(context.id), 'debrief', { context, items })
      setHasLocalDraft(true)
      if (!isOffline) {
        await saveDebriefDraft(context, items)
        await deleteOfflineDraft(getDebriefDraftId(context.id))
        setHasLocalDraft(false)
      }
      setLastSavedAt(new Date())
      setDirty(false)
      notifySuccess(isOffline ? 'Draft saved on this device' : 'Draft saved')
    } finally {
      setManualSaving(false)
    }
  }

  const handleSubmit = async () => {
    if (!context) return
    const validItems = items.filter(item => item.note?.trim() && (item.type !== 'client' || item.clientName?.trim()))
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
      } else {
        await submitShiftDebrief(context, validItems, user)
        await deleteOfflineDraft(getDebriefDraftId(context.id))
        setHasLocalDraft(false)
        notifySuccess('Shift debrief submitted')
      }
      setDirty(false)
    } finally {
      setSubmitting(false)
    }
  }

  const handleQuickSave = async (item) => {
    if (!context) return
    if (submitted && isDebriefClosedForCorrections(submitted)) {
      setQuickStatus(CLOSED_DEBRIEF_MESSAGE)
      alert(CLOSED_DEBRIEF_MESSAGE)
      return
    }
    if (isOffline) {
      const localDraft = await getOfflineDraft(getDebriefDraftId(context.id)).catch(() => null)
      const existingItems = Array.isArray(localDraft?.payload?.items) ? localDraft.payload.items : items
      const nextItems = [...existingItems, item]
      await saveOfflineDraft(getDebriefDraftId(context.id), 'debrief', { context, items: nextItems })
      setItems(sortItems(nextItems))
      setHasLocalDraft(true)
      setLastSavedAt(new Date())
      setQuickStatus('Saved on this device. It will sync when internet returns.')
      notifySuccess('Debrief note saved on this device')
      return
    }
    const result = await saveQuickDebriefNote(context, item, user)
    setQuickStatus(result.mode === 'extra'
      ? 'Saved as an extra note because today\'s debrief is already submitted.'
      : 'Saved to today\'s draft debrief.')
    notifySuccess(result.mode === 'extra' ? 'Extra note added' : 'Debrief note saved')
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

      {mode === 'quick' ? (
        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>Quick Note</h3>
          <p style={styles.bodyText}>
            {submitted && isDebriefClosedForCorrections(submitted)
              ? CLOSED_DEBRIEF_MESSAGE
              : 'Save a client note or general handoff item. If the debrief is already submitted, this saves as an extra note.'}
          </p>
          {submitted && isDebriefClosedForCorrections(submitted) ? null : (
            <DebriefNoteForm user={user} onSave={handleQuickSave} buttonLabel="Save Debrief Note" compact />
          )}
          {quickStatus && <div style={styles.savedText}>{quickStatus}</div>}
        </div>
      ) : submitted ? (
        <SubmittedDebriefView debrief={submitted} user={user} />
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

function DebriefShell({ title, subtitle = '', onBack, children }) {
  return (
    <div className="transport-page debrief-page">
      <div className="transport-header">
        <div>
          <div className="transport-title">{title}</div>
          {subtitle && <div style={styles.metaLine}>{subtitle}</div>}
        </div>
        <button className="transport-close-btn" onClick={onBack} aria-label="Close">x</button>
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
  lockedBanner: {
    padding: '12px 14px',
    borderRadius: '8px',
    backgroundColor: 'rgba(47,125,87,0.12)',
    border: '1px solid rgba(47,125,87,0.28)',
    color: '#2F7D57',
    fontSize: '14px',
    fontWeight: 700
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
