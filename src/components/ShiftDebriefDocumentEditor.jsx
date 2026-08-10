import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Plus, RotateCcw, Send, X } from 'lucide-react'
import AutocompleteDropdown from './AutocompleteDropdown'
import useAutocomplete from '../hooks/useAutocomplete'
import {
  CLIENT_NOTE_SECTIONS,
  GENERAL_HANDOFF_SECTIONS,
  getDebriefClientGroupKey,
  normalizeDebriefClientName,
  sanitizeDebriefItems,
  sortDebriefItems
} from '../services/shiftDebriefModel'
import { createDebriefItem, upsertSharedClientName } from '../services/shiftDebriefService'
import { showConfirmDialog } from '../utils/dialogs'

function growTextarea(node, minimum = 32) {
  if (!node) return
  node.style.height = 'auto'
  node.style.height = `${Math.max(node.scrollHeight, minimum)}px`
}

function groupClientItems(items) {
  const bySection = Object.fromEntries(CLIENT_NOTE_SECTIONS.map(section => [section.id, []]))
  const lookup = new Map()

  sortDebriefItems(items).forEach(item => {
    if (item?.type !== 'client' || !bySection[item.section]) return
    const clientName = String(item.clientName || '').trim() || 'Client'
    const key = getDebriefClientGroupKey(item.section, clientName)
    if (!lookup.has(key)) {
      const group = { key, sectionId: item.section, clientName, notes: [] }
      lookup.set(key, group)
      bySection[item.section].push(group)
    }
    lookup.get(key).notes.push(item)
  })

  return bySection
}

function ClientAdder({ sectionId, suggestions, existingNames, onAdd, inputRef, isOffline }) {
  const [value, setValue] = useState('')
  const internalRef = useRef(null)
  const { suggestions: remoteSuggestions, isVisible, search, select, hide, show } = useAutocomplete(
    'clients',
    'normalizedLabel',
    1,
    6
  )
  const existing = new Set(existingNames.map(normalizeDebriefClientName))
  const filteredRemote = remoteSuggestions.filter(row => !existing.has(normalizeDebriefClientName(row.label)))

  const commit = name => {
    const trimmed = String(name || value).trim()
    if (!trimmed) {
      internalRef.current?.focus()
      return
    }
    onAdd(sectionId, trimmed)
    setValue('')
    select()
  }

  return (
    <div className="debrief-add-client-zone">
      <div className="debrief-add-client-label"><Plus aria-hidden="true" /> Add a client to this section</div>
      {suggestions.length > 0 && (
        <div className="debrief-client-suggestions">
          {suggestions.map(name => (
            <button key={normalizeDebriefClientName(name)} type="button" onClick={() => commit(name)}>
              <Plus aria-hidden="true" /> {name}
            </button>
          ))}
        </div>
      )}
      <div className="debrief-add-client-row">
        <div className="debrief-client-autocomplete">
          <input
            ref={node => {
              internalRef.current = node
              inputRef(node)
            }}
            className="input debrief-client-input"
            value={value}
            onChange={event => {
              setValue(event.target.value)
              if (isOffline) hide()
              else search(event.target.value)
            }}
            onFocus={() => !isOffline && value.trim() && show()}
            onBlur={() => setTimeout(hide, 150)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commit()
              }
            }}
            placeholder="Client name..."
            autoComplete="off"
          />
          <AutocompleteDropdown
            suggestions={filteredRemote}
            isVisible={!isOffline && isVisible && filteredRemote.length > 0}
            onSelect={row => commit(row.label)}
            inputRef={internalRef}
            renderItem={row => <span>{row.label}</span>}
          />
        </div>
        <button type="button" className="debrief-add-client-button" onClick={() => commit()}>
          <Plus aria-hidden="true" /> Add
        </button>
      </div>
    </div>
  )
}

export default function ShiftDebriefDocumentEditor({
  items,
  user,
  statusText,
  statusTone,
  retryVisible,
  quickNoteCount,
  onDismissQuickBanner,
  onItemsChange,
  onRetrySave,
  onSubmit,
  submitting,
  isOffline
}) {
  const [focusItemId, setFocusItemId] = useState('')
  const lineRefs = useRef(new Map())
  const clientInputRefs = useRef(new Map())
  const clientGroups = useMemo(() => groupClientItems(items), [items])
  const generalItems = useMemo(() => Object.fromEntries(GENERAL_HANDOFF_SECTIONS.map(section => [
    section.id,
    sortDebriefItems(items).filter(item => item?.type === 'general' && item.section === section.id)
  ])), [items])
  const allClientNames = useMemo(() => {
    const counts = new Map()
    items.filter(item => item?.type === 'client' && item.clientName?.trim()).forEach(item => {
      const key = normalizeDebriefClientName(item.clientName)
      const current = counts.get(key) || { name: item.clientName.trim(), count: 0 }
      counts.set(key, { ...current, count: current.count + 1 })
    })
    return Array.from(counts.values()).sort((a, b) => b.count - a.count).map(row => row.name)
  }, [items])

  useEffect(() => {
    if (!focusItemId) return
    const node = lineRefs.current.get(focusItemId)
    if (!node) return
    growTextarea(node)
    node.focus()
    node.setSelectionRange(node.value.length, node.value.length)
  }, [focusItemId])

  const replaceItems = updater => onItemsChange(previous => sortDebriefItems(updater(previous)))

  const addLine = (type, sectionId, clientName = '') => {
    const item = createDebriefItem({ type, section: sectionId, clientName, note: '', user, source: 'editor' })
    replaceItems(previous => [...previous, item])
    setFocusItemId(item.id)
  }

  const updateLine = (itemId, note) => {
    replaceItems(previous => previous.map(item => (
      item.id === itemId ? { ...item, note, updatedAtIso: new Date().toISOString() } : item
    )))
  }

  const removeLine = itemId => {
    replaceItems(previous => previous.filter(item => item.id !== itemId))
  }

  const addClient = (sectionId, clientName) => {
    const existing = (clientGroups[sectionId] || []).find(group => (
      normalizeDebriefClientName(group.clientName) === normalizeDebriefClientName(clientName)
    ))
    if (existing) {
      const blank = existing.notes.find(item => !item.note?.trim())
      if (blank) setFocusItemId(blank.id)
      else addLine('client', sectionId, existing.clientName)
      return
    }
    upsertSharedClientName(clientName).catch(error => console.warn('Client name could not be saved:', error))
    addLine('client', sectionId, clientName)
  }

  const removeClient = async group => {
    const completedCount = group.notes.filter(item => item.note?.trim()).length
    if (completedCount > 0) {
      const confirmed = await showConfirmDialog(
        `Remove ${group.clientName} and ${completedCount} note${completedCount === 1 ? '' : 's'} from this section?`,
        { title: 'Remove Client Notes', tone: 'warning', confirmText: 'Remove', cancelText: 'Keep' }
      )
      if (!confirmed) return
    }
    const groupIds = new Set(group.notes.map(item => item.id))
    replaceItems(previous => previous.filter(item => !groupIds.has(item.id)))
    requestAnimationFrame(() => clientInputRefs.current.get(group.sectionId)?.focus())
  }

  const canSubmit = sanitizeDebriefItems(items).length > 0

  return (
    <div className="debrief-document-editor">
      {quickNoteCount > 0 && (
        <div className="debrief-quick-merge-banner" role="status">
          <span>{quickNoteCount} note{quickNoteCount === 1 ? '' : 's'} added from Quick Note</span>
          <button type="button" onClick={onDismissQuickBanner} aria-label="Dismiss quick note message"><X aria-hidden="true" /></button>
        </div>
      )}

      {CLIENT_NOTE_SECTIONS.map(section => {
        const groups = clientGroups[section.id] || []
        const existingNames = groups.map(group => group.clientName)
        const existingKeys = new Set(existingNames.map(normalizeDebriefClientName))
        const suggestions = allClientNames.filter(name => !existingKeys.has(normalizeDebriefClientName(name))).slice(0, 6)
        return (
          <section key={section.id} className="debrief-document-card" id={`debrief-${section.id}`}>
            <div className="debrief-document-header">{section.label}</div>
            <div className="debrief-document-prompt">{section.prompt}</div>
            <div className="debrief-client-groups">
              {groups.length === 0 && <div className="debrief-document-empty">No clients added to this section.</div>}
              {groups.map(group => (
                <div key={group.key} className="debrief-client-card-v2">
                  <div className="debrief-client-card-header">
                    <strong title={group.clientName}>{group.clientName}</strong>
                    <button type="button" onClick={() => removeClient(group)} aria-label={`Remove ${group.clientName}`} title="Remove client">
                      <X aria-hidden="true" />
                    </button>
                  </div>
                  <div className="debrief-document-lines">
                    {group.notes.map(item => (
                      <div key={item.id} className="debrief-document-line">
                        <span aria-hidden="true">-</span>
                        <textarea
                          ref={node => {
                            if (node) {
                              lineRefs.current.set(item.id, node)
                              growTextarea(node)
                            } else lineRefs.current.delete(item.id)
                          }}
                          value={item.note || ''}
                          onChange={event => updateLine(item.id, event.target.value)}
                          onInput={event => growTextarea(event.currentTarget)}
                          onKeyDown={event => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                              event.preventDefault()
                              addLine('client', section.id, group.clientName)
                            }
                          }}
                          rows={1}
                          placeholder={`Add a note for ${group.clientName}...`}
                          aria-label={`Note for ${group.clientName}`}
                        />
                        <button type="button" onClick={() => removeLine(item.id)} aria-label="Remove line" title="Remove line">
                          <X aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button type="button" className="debrief-add-line" onClick={() => addLine('client', section.id, group.clientName)}>
                    <Plus aria-hidden="true" /> Add line
                  </button>
                </div>
              ))}
            </div>
            <ClientAdder
              sectionId={section.id}
              suggestions={suggestions}
              existingNames={existingNames}
              onAdd={addClient}
              isOffline={isOffline}
              inputRef={node => {
                if (node) clientInputRefs.current.set(section.id, node)
                else clientInputRefs.current.delete(section.id)
              }}
            />
          </section>
        )
      })}

      {GENERAL_HANDOFF_SECTIONS.map(section => {
        const sectionItems = generalItems[section.id] || []
        return (
          <section key={section.id} className="debrief-document-card" id={`debrief-${section.id}`}>
            <div className="debrief-document-header">{section.label}</div>
            <div className="debrief-document-prompt">{section.prompt}</div>
            <div className="debrief-general-lines">
              {sectionItems.length === 0 && <div className="debrief-document-empty">No notes added to this section.</div>}
              {sectionItems.map(item => (
                <div key={item.id} className="debrief-document-line">
                  <span aria-hidden="true">-</span>
                  <textarea
                    ref={node => {
                      if (node) {
                        lineRefs.current.set(item.id, node)
                        growTextarea(node)
                      } else lineRefs.current.delete(item.id)
                    }}
                    value={item.note || ''}
                    onChange={event => updateLine(item.id, event.target.value)}
                    onInput={event => growTextarea(event.currentTarget)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        addLine('general', section.id)
                      }
                    }}
                    rows={1}
                    placeholder="Type here..."
                    aria-label={section.label}
                  />
                  <button type="button" onClick={() => removeLine(item.id)} aria-label="Remove line" title="Remove line">
                    <X aria-hidden="true" />
                  </button>
                </div>
              ))}
              <button type="button" className="debrief-add-line" onClick={() => addLine('general', section.id)}>
                <Plus aria-hidden="true" /> Add
              </button>
            </div>
          </section>
        )
      })}

      <div className={`debrief-autosave-status is-${statusTone || 'idle'}`} role="status">
        <span className="debrief-save-dot"><Check aria-hidden="true" /></span>
        <span>{statusText}</span>
        {retryVisible && (
          <button type="button" onClick={onRetrySave}><RotateCcw aria-hidden="true" /> Retry</button>
        )}
      </div>

      <button type="button" className="debrief-submit-v2" onClick={onSubmit} disabled={!canSubmit || submitting}>
        <Send aria-hidden="true" /> {submitting ? 'Submitting...' : 'Submit Debrief'}
      </button>
    </div>
  )
}
