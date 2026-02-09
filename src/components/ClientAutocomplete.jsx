import { useState, useRef } from 'react'
import { db } from '../firebase'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import useAutocomplete from '../hooks/useAutocomplete'
import AutocompleteDropdown from './AutocompleteDropdown'

/**
 * Client autocomplete component
 * - Input field with "+ Add" button side by side
 * - Dropdown appears below input
 * - Shows added clients as removable chips
 * - Queries Firestore clients collection (active only)
 * - Upserts new clients to Firestore with lastUsedAt tracking
 */
function ClientAutocomplete({ onAddClient, existingClients = [], transportId }) {
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef(null)
  const { suggestions, isVisible, search, select, hide, show } = useAutocomplete(
    'clients',
    'normalizedLabel',
    1,
    5
  )

  // Filter out already-added clients from suggestions
  const filteredSuggestions = suggestions.filter(
    s => !existingClients.includes(s.label)
  )

  const normalize = (text) => text.toLowerCase().trim().replace(/\s+/g, ' ')

  const addClient = async (clientName) => {
    const trimmed = clientName.trim()
    if (!trimmed) return

    // Check if already exists
    if (existingClients.includes(trimmed)) {
      setInputValue('')
      hide()
      return
    }

    // Persist to Firestore with lastUsedAt tracking
    try {
      const normalizedLabel = normalize(trimmed)
      await setDoc(
        doc(db, 'clients', normalizedLabel),
        {
          label: trimmed,
          normalizedLabel: normalizedLabel,
          active: true,
          lastUsedAt: serverTimestamp(),
          createdAt: serverTimestamp()
        },
        { merge: true }
      )
    } catch (error) {
      console.error('Error persisting client:', error)
    }

    // Call parent handler
    onAddClient(trimmed)
    setInputValue('')
    hide()
  }

  const handleInputChange = (e) => {
    const value = e.target.value
    setInputValue(value)
    search(value)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addClient(inputValue)
    }
  }

  const handleSuggestionSelect = (suggestion) => {
    select(suggestion)
    addClient(suggestion.label)
  }

  const handleFocus = () => {
    if (inputValue.trim()) {
      show()
    }
  }

  const handleBlur = () => {
    // Delay to allow click on suggestion
    setTimeout(() => hide(), 200)
  }

  return (
    <div style={{ display: 'flex', gap: '8px' }}>
      <input
        ref={inputRef}
        className="input"
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder="Add client name..."
        style={{
          flex: 1,
          fontSize: '16px', // Prevent zoom on iOS
          minHeight: '44px' // Mobile tap target
        }}
      />
      <AutocompleteDropdown
        suggestions={filteredSuggestions}
        isVisible={isVisible && filteredSuggestions.length > 0}
        onSelect={handleSuggestionSelect}
        inputRef={inputRef}
        renderItem={(suggestion) => (
          <span style={{ fontWeight: 500 }}>{suggestion.label}</span>
        )}
      />
      <button
        className="btn btn-finish"
        onClick={() => addClient(inputValue)}
        style={{
          padding: '10px 18px',
          fontSize: '14px',
          minHeight: '44px', // Mobile tap target
          minWidth: '90px'
        }}
      >
        + Add
      </button>
    </div>
  )
}

export default ClientAutocomplete
