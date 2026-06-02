import { useEffect, useMemo, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import ClientAutocomplete from './ClientAutocomplete'
import {
  CLIENT_NOTE_SECTIONS,
  CONFIRMATION_ITEMS,
  DEBRIEF_DRAFTS_COLLECTION,
  DEBRIEFS_COLLECTION,
  GENERAL_HANDOFF_SECTIONS,
  createDebriefItem,
  createEmptyConfirmation,
  getBhtDebriefContext,
  getDebriefSectionLabel,
  saveDebriefDraft,
  saveDebriefConfirmation,
  saveQuickDebriefNote,
  submitShiftDebrief,
  appendExtraDebriefNote,
  createExtraNote,
  upsertSharedClientName
} from '../services/shiftDebriefService'
import { requireOnline } from '../utils/networkGuard'
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
          placeholder="Type the handoff note..."
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

function DraftItemEditor({ item, onChange, onRemove }) {
  const sections = item.type === 'client' ? CLIENT_NOTE_SECTIONS : GENERAL_HANDOFF_SECTIONS

  const update = (patch) => {
    onChange({
      ...item,
      ...patch,
      updatedAtIso: new Date().toISOString()
    })
  }

  return (
    <div style={styles.itemCard}>
      <div style={styles.itemHeader}>
        <div>
          <div style={styles.itemType}>{item.type === 'client' ? 'Client Note' : 'General Handoff'}</div>
          <div style={styles.itemTime}>{formatTime(item.createdAtIso)}</div>
        </div>
        <button type="button" onClick={onRemove} style={styles.secondaryDangerButton}>
          Remove
        </button>
      </div>

      {item.type === 'client' && (
        <div>
          <div style={styles.fieldLabel}>Client</div>
          <input
            className="input"
            value={item.clientName || ''}
            onChange={(e) => update({ clientName: e.target.value })}
            onBlur={() => upsertSharedClientName(item.clientName).catch(err => console.warn('Client save skipped:', err))}
            placeholder="First name, last initial optional"
          />
        </div>
      )}

      <div>
        <div style={styles.fieldLabel}>Section</div>
        <select className="input" value={item.section} onChange={(e) => update({ section: e.target.value })}>
          {sections.map(section => (
            <option key={section.id} value={section.id}>{section.label}</option>
          ))}
        </select>
      </div>

      <div>
        <div style={styles.fieldLabel}>Note</div>
        <textarea
          className="input"
          value={item.note || ''}
          onChange={(e) => update({ note: e.target.value })}
          rows={4}
          style={styles.textarea}
        />
      </div>
    </div>
  )
}

function SubmittedDebriefView({ debrief, user, onExtraNoteAdded }) {
  const [extraNoteText, setExtraNoteText] = useState('')
  const [confirmation, setConfirmation] = useState(() => debrief?.confirmation || createEmptyConfirmation())
  const [savingExtra, setSavingExtra] = useState(false)
  const [savingConfirmation, setSavingConfirmation] = useState(false)

  useEffect(() => {
    setConfirmation(debrief?.confirmation || createEmptyConfirmation())
  }, [debrief?.confirmation])

  const addExtraNote = async () => {
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
        Submitted debrief is locked. Add extra notes below if something was missed.
      </div>

      <div style={styles.panel}>
        <h3 style={styles.panelTitle}>Submitted Handoff</h3>
        <div style={styles.metaLine}>
          Submitted by {debrief.submittedByName || debrief.draftByName || 'BHT'} on {formatTimestamp(debrief.submittedAt)}
        </div>
        <DebriefItemsReadOnly items={debrief.items} />
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
        <textarea
          className="input"
          value={extraNoteText}
          onChange={(e) => setExtraNoteText(e.target.value)}
          rows={4}
          placeholder="Add an extra note or correction..."
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
        {debrief.confirmed && (
          <div style={styles.confirmedText}>
            Confirmed by {debrief.confirmation?.confirmedByName || 'incoming staff'} on {formatTimestamp(debrief.confirmation?.confirmedAt)}
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

function DebriefItemsReadOnly({ items }) {
  const sorted = sortItems(items)
  if (sorted.length === 0) {
    return <div style={styles.emptyText}>No notes in this debrief.</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {sorted.map(item => (
        <div key={item.id} style={styles.readOnlyItem}>
          <div style={styles.itemHeader}>
            <div>
              <strong>
                {item.type === 'client' ? (item.clientName || 'Client') : 'General Handoff'}
              </strong>
              <div style={styles.itemType}>{getDebriefSectionLabel(item.section)}</div>
            </div>
            <span style={styles.itemTime}>{formatTime(item.createdAtIso)}</span>
          </div>
          <div style={styles.noteText}>{item.note}</div>
        </div>
      ))}
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
    if (dirty) return
    setItems(sortItems(draft?.items || []))
  }, [draft, dirty])

  useEffect(() => {
    if (!dirty || submitted || mode === 'quick' || !context) return undefined
    const timer = setTimeout(async () => {
      try {
        if (isOffline) return
        await saveDebriefDraft(context, items)
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
    if (!requireOnline('saving shift debrief')) return
    setManualSaving(true)
    try {
      await saveDebriefDraft(context, items)
      setLastSavedAt(new Date())
      setDirty(false)
      notifySuccess('Draft saved')
    } finally {
      setManualSaving(false)
    }
  }

  const handleSubmit = async () => {
    if (!context) return
    if (!requireOnline('submitting shift debrief')) return
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
      await submitShiftDebrief(context, validItems, user)
      setDirty(false)
      notifySuccess('Shift debrief submitted')
    } finally {
      setSubmitting(false)
    }
  }

  const handleQuickSave = async (item) => {
    if (!context) return
    if (!requireOnline('saving debrief note')) return
    const result = await saveQuickDebriefNote(context, item, user)
    setQuickStatus(result.mode === 'extra'
      ? 'Saved as an extra note because today\'s debrief is already submitted.'
      : 'Saved to today\'s draft debrief.')
    notifySuccess(result.mode === 'extra' ? 'Extra note added' : 'Debrief note saved')
  }

  const addItemToLocalDraft = async (item) => {
    setItems(prev => [...prev, item])
    setDirty(true)
    notifySuccess('Item added to draft')
  }

  const updateItem = (index, nextItem) => {
    setItems(prev => prev.map((item, i) => (i === index ? nextItem : item)))
    setDirty(true)
  }

  const removeItem = (index) => {
    setItems(prev => prev.filter((_, i) => i !== index))
    setDirty(true)
  }

  const title = mode === 'quick'
    ? 'Add Debrief Note'
    : (submitted ? 'View Shift Debrief' : 'Edit Shift Debrief')

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
            Save a client note or general handoff item. If the debrief is already submitted, this saves as an extra note.
          </p>
          <DebriefNoteForm user={user} onSave={handleQuickSave} buttonLabel="Save Debrief Note" compact />
          {quickStatus && <div style={styles.savedText}>{quickStatus}</div>}
        </div>
      ) : submitted ? (
        <SubmittedDebriefView debrief={submitted} user={user} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={styles.panel}>
            <h3 style={styles.panelTitle}>Add Item</h3>
            <DebriefNoteForm user={user} onSave={addItemToLocalDraft} buttonLabel="Add To Draft" compact />
          </div>

          <div style={styles.panel}>
            <div style={styles.editorHeader}>
              <div>
                <h3 style={styles.panelTitle}>Draft Items</h3>
                <div style={styles.metaLine}>
                  {dirty
                    ? 'Unsaved changes'
                    : lastSavedAt
                      ? `Autosaved ${formatTime(lastSavedAt)}`
                      : draft?.updatedAt
                        ? `Autosaved ${formatTimestamp(draft.updatedAt)}`
                        : 'Draft not saved yet'}
                </div>
              </div>
              <button
                className="btn"
                onClick={saveManualDraft}
                disabled={manualSaving}
                style={styles.secondaryButton}
              >
                {manualSaving ? 'Saving...' : 'Save Draft'}
              </button>
            </div>

            {items.length === 0 ? (
              <div style={styles.emptyText}>No debrief items yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {items.map((item, index) => (
                  <DraftItemEditor
                    key={item.id || index}
                    item={item}
                    onChange={(nextItem) => updateItem(index, nextItem)}
                    onRemove={() => removeItem(index)}
                  />
                ))}
              </div>
            )}
          </div>

          <button
            className="btn btn-finish"
            onClick={handleSubmit}
            disabled={submitting || items.length === 0}
            style={styles.submitButton}
          >
            {submitting ? 'Submitting...' : 'Submit For Handoff'}
          </button>
        </div>
      )}
    </DebriefShell>
  )
}

function DebriefShell({ title, subtitle = '', onBack, children }) {
  return (
    <div className="transport-page">
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
