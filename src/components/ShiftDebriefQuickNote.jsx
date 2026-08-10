import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, getDocs, limitToLast, orderBy, query, where } from 'firebase/firestore'
import { CheckCircle2, RotateCcw } from 'lucide-react'
import { db } from '../firebase'
import AutocompleteDropdown from './AutocompleteDropdown'
import useAutocomplete from '../hooks/useAutocomplete'
import {
  CLIENT_NOTE_SECTIONS,
  GENERAL_HANDOFF_SECTIONS,
  getDebriefSectionLabel,
  getQuickNoteMergeState,
  mergeUniqueDebriefItems,
  normalizeDebriefClientName
} from '../services/shiftDebriefModel'
import { createDebriefItem } from '../services/shiftDebriefService'

function growTextarea(node, minimum = 96) {
  if (!node) return
  node.style.height = 'auto'
  node.style.height = `${Math.max(node.scrollHeight, minimum)}px`
}

function timestampMillis(value) {
  if (!value) return 0
  if (typeof value.toMillis === 'function') return value.toMillis()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

export default function ShiftDebriefQuickNote({
  user,
  locationLabel,
  shiftLabel,
  items,
  isOffline,
  pendingCount,
  closedMessage = '',
  onSave,
  onUndo,
  onDone,
  onViewFull
}) {
  const [type, setType] = useState('client')
  const [clientName, setClientName] = useState('')
  const [sectionByType, setSectionByType] = useState({
    client: CLIENT_NOTE_SECTIONS[0].id,
    general: GENERAL_HANDOFF_SECTIONS[0].id
  })
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [sessionEntries, setSessionEntries] = useState([])
  const [recentRemoteClients, setRecentRemoteClients] = useState([])
  const [undoEntry, setUndoEntry] = useState(null)
  const [statusMessage, setStatusMessage] = useState('')
  const clientInputRef = useRef(null)
  const noteInputRef = useRef(null)
  const undoTimerRef = useRef(null)
  const section = sectionByType[type]
  const sectionOptions = type === 'client' ? CLIENT_NOTE_SECTIONS : GENERAL_HANDOFF_SECTIONS
  const { suggestions, isVisible, search, select, hide, show } = useAutocomplete('clients', 'normalizedLabel', 1, 5)

  useEffect(() => () => clearTimeout(undoTimerRef.current), [])

  useEffect(() => {
    growTextarea(noteInputRef.current)
  }, [note])

  useEffect(() => {
    if (isOffline) return undefined
    let cancelled = false
    ;(async () => {
      try {
        const snapshot = await getDocs(query(
          collection(db, 'clients'),
          where('active', '==', true),
          orderBy('lastUsedAt', 'asc'),
          limitToLast(12)
        ))
        if (cancelled) return
        setRecentRemoteClients(snapshot.docs
          .map(row => row.data())
          .sort((left, right) => timestampMillis(right.lastUsedAt) - timestampMillis(left.lastUsedAt))
          .map(row => String(row.label || '').trim())
          .filter(Boolean))
      } catch (error) {
        console.warn('Recent debrief clients unavailable:', error)
      }
    })()
    return () => { cancelled = true }
  }, [isOffline])

  const allVisibleItems = useMemo(
    () => mergeUniqueDebriefItems(items, sessionEntries.map(entry => entry.item)),
    [items, sessionEntries]
  )

  const recentClients = useMemo(() => {
    const ordered = [
      ...sessionEntries.map(entry => entry.item?.clientName),
      ...[...allVisibleItems].reverse().map(item => item?.clientName),
      ...recentRemoteClients
    ]
    const seen = new Set()
    return ordered.filter(name => {
      const key = normalizeDebriefClientName(name)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0, 4)
  }, [allVisibleItems, recentRemoteClients, sessionEntries])

  const filteredSuggestions = suggestions.filter(suggestion => (
    normalizeDebriefClientName(suggestion.label) !== normalizeDebriefClientName(clientName)
  ))

  const mergeState = type === 'client'
    ? getQuickNoteMergeState(allVisibleItems, section, clientName)
    : null
  const mergeHint = !clientName.trim()
    ? ''
    : mergeState === 'existing_section'
      ? `Adds a new line under ${clientName.trim()}'s existing notes here.`
      : mergeState === 'other_section'
        ? `${clientName.trim()} has notes in another section; this starts a group here.`
        : 'New client; this creates a new entry.'

  const canSave = !closedMessage && note.trim() && (type === 'general' || clientName.trim())

  const changeType = nextType => {
    setType(nextType)
    setStatusMessage('')
  }

  const handleClientChange = event => {
    const value = event.target.value
    setClientName(value)
    if (isOffline) hide()
    else search(value)
  }

  const chooseClient = name => {
    setClientName(name)
    select()
    requestAnimationFrame(() => noteInputRef.current?.focus())
  }

  const saveNote = async () => {
    if (!canSave || saving) return
    setSaving(true)
    setStatusMessage('')
    try {
      const item = createDebriefItem({
        type,
        section,
        clientName: type === 'client' ? clientName : '',
        note,
        user,
        source: 'quick_note'
      })
      const result = await onSave(item)
      const entry = { item, result, pending: result?.pending === true }
      setSessionEntries(previous => [entry, ...previous])
      setUndoEntry(entry)
      clearTimeout(undoTimerRef.current)
      undoTimerRef.current = setTimeout(() => setUndoEntry(current => (
        current?.item?.id === item.id ? null : current
      )), 5000)
      setNote('')
      if (type === 'client') setClientName('')
      setStatusMessage(result?.pending ? 'Saved on this device and pending sync.' : 'Saved to this shift debrief.')
      requestAnimationFrame(() => (type === 'client' ? clientInputRef.current : noteInputRef.current)?.focus())
    } catch (error) {
      setStatusMessage(error?.message || 'The note could not be saved. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const undoLastSave = async () => {
    if (!undoEntry) return
    const entry = undoEntry
    clearTimeout(undoTimerRef.current)
    setUndoEntry(null)
    try {
      await onUndo(entry)
      setSessionEntries(previous => previous.filter(row => row.item.id !== entry.item.id))
      setStatusMessage('The note was removed.')
    } catch (error) {
      setStatusMessage(error?.message || 'The note could not be removed.')
    }
  }

  return (
    <div className="debrief-quick-page">
      <div className="debrief-location-line">{locationLabel}{locationLabel && shiftLabel ? ' - ' : ''}{shiftLabel}</div>

      {pendingCount > 0 && (
        <div className="debrief-pending-banner" role="status">
          {pendingCount} debrief note{pendingCount === 1 ? '' : 's'} pending sync
        </div>
      )}

      <section className="debrief-document-card debrief-quick-card">
        <div className="debrief-document-header">Quick Note</div>
        <div className="debrief-document-prompt">Adds straight into this shift&apos;s debrief document</div>

        <div className="debrief-quick-form">
          <div className="debrief-segmented" role="tablist" aria-label="Debrief note type">
            {[
              { id: 'client', label: 'Client Note' },
              { id: 'general', label: 'General Handoff' }
            ].map(option => (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={type === option.id}
                className={type === option.id ? 'is-active' : ''}
                onClick={() => changeType(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>

          {type === 'client' && (
            <div className="debrief-field debrief-client-picker">
              <label htmlFor="debrief-quick-client">Client <span>Required</span></label>
              {!clientName.trim() && recentClients.length > 0 && (
                <div className="debrief-recent-clients" aria-label="Recent clients">
                  {recentClients.map(name => (
                    <button key={normalizeDebriefClientName(name)} type="button" onClick={() => chooseClient(name)}>
                      {name}
                    </button>
                  ))}
                </div>
              )}
              <input
                id="debrief-quick-client"
                ref={clientInputRef}
                className="input"
                value={clientName}
                onChange={handleClientChange}
                onFocus={() => !isOffline && clientName.trim() && show()}
                onBlur={() => setTimeout(hide, 150)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    hide()
                    noteInputRef.current?.focus()
                  }
                }}
                placeholder="Client name..."
                autoComplete="off"
              />
              <AutocompleteDropdown
                suggestions={filteredSuggestions}
                isVisible={!isOffline && isVisible && filteredSuggestions.length > 0}
                onSelect={suggestion => chooseClient(suggestion.label)}
                inputRef={clientInputRef}
                renderItem={suggestion => <span>{suggestion.label}</span>}
              />
              <div className="debrief-field-help">Use first name and last initial when possible.</div>
              {mergeHint && <div className={`debrief-merge-hint is-${mergeState}`}>{mergeHint}</div>}
            </div>
          )}

          <fieldset className="debrief-fieldset">
            <legend>Section</legend>
            <div className="debrief-section-pills" role="radiogroup" aria-label="Debrief section">
              {sectionOptions.map(option => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={section === option.id}
                  className={section === option.id ? 'is-active' : ''}
                  onClick={() => setSectionByType(previous => ({ ...previous, [type]: option.id }))}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="debrief-field">
            <label htmlFor="debrief-quick-note">Note <span>Required</span></label>
            <textarea
              id="debrief-quick-note"
              ref={noteInputRef}
              className="input debrief-quick-note-input"
              value={note}
              onChange={event => setNote(event.target.value)}
              onInput={event => growTextarea(event.currentTarget)}
              onKeyDown={event => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault()
                  saveNote()
                }
              }}
              rows={4}
              placeholder={type === 'client' ? 'Add a note for this client...' : 'Add a general handoff note...'}
            />
          </div>
        </div>
      </section>

      {sessionEntries.length > 0 && (
        <section className="debrief-document-card">
          <div className="debrief-document-header">Added This Session</div>
          <div className="debrief-session-list">
            {sessionEntries.map(entry => (
              <div key={entry.item.id} className="debrief-session-entry">
                <CheckCircle2 aria-hidden="true" />
                <div>
                  <div>{entry.item.clientName && <strong>{entry.item.clientName}: </strong>}{entry.item.note}</div>
                  <span>{getDebriefSectionLabel(entry.item.section)}{entry.pending ? ' - pending sync' : ' - in full debrief'}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="debrief-quick-footer-actions">
        <button type="button" onClick={onDone}>Done, Back to Dashboard</button>
        <button type="button" onClick={onViewFull}>View Full Shift Debrief</button>
      </div>

      <div className="debrief-quick-savebar">
        <div className="debrief-quick-savebar-inner">
          {closedMessage && <div className="debrief-closed-message">{closedMessage}</div>}
          {undoEntry && (
            <div className="debrief-undo-toast" role="status">
              <span>Saved to {getDebriefSectionLabel(undoEntry.item.section)}</span>
              <button type="button" onClick={undoLastSave}><RotateCcw aria-hidden="true" /> Undo</button>
            </div>
          )}
          {!undoEntry && statusMessage && <div className="debrief-save-message" role="status">{statusMessage}</div>}
          <button
            type="button"
            className="debrief-quick-save"
            onClick={saveNote}
            disabled={!canSave || saving}
          >
            {saving ? 'Saving...' : 'Save Debrief Note'}
          </button>
        </div>
      </div>
    </div>
  )
}
