import { useState, useRef } from 'react'
import { db } from '../firebase'
import { doc, setDoc, serverTimestamp, collection, query, where, getDocs } from 'firebase/firestore'
import AutocompleteDropdown from './AutocompleteDropdown'

/**
 * Destination autocomplete component
 * - Two fields: name (optional) and address (required)
 * - "+ Add Destination" button
 * - Dropdown appears below with suggestions
 * - Queries by normalized name and address
 * - Dedupes by normalized address
 */
function DestinationAutocomplete({ onAddDestination, existingDestinations = [] }) {
  const [nameInput, setNameInput] = useState('')
  const [addressInput, setAddressInput] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const addressRef = useRef(null)
  let debounceTimer = null

  const normalize = (text) => text.toLowerCase().trim().replace(/\s+/g, ' ')

  // Get normalized addresses from existing destinations
  const existingNormalizedAddresses = existingDestinations.map(d =>
    normalize(d.address || '')
  )

  // Search destinations in Firestore
  const searchDestinations = async (searchTerm, searchType) => {
    if (debounceTimer) clearTimeout(debounceTimer)

    if (!searchTerm.trim()) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }

    debounceTimer = setTimeout(async () => {
      setIsLoading(true)
      try {
        const normalizedTerm = normalize(searchTerm)
        const searchField = searchType === 'name' ? 'normalizedName' : 'normalizedAddress'

        const q = query(
          collection(db, 'destinations'),
          where(searchField, '>=', normalizedTerm),
          where(searchField, '<=', normalizedTerm + '\uf8ff')
        )

        const snapshot = await getDocs(q)
        let results = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }))

        // Filter out destinations already added (by normalized address)
        results = results.filter(dest =>
          !existingNormalizedAddresses.includes(normalize(dest.address))
        )

        // Limit to 5 results
        results = results.slice(0, 5)

        // Check for duplicate addresses and add dedupe hints
        results = results.map(dest => {
          const normalizedAddr = normalize(dest.address)
          const duplicate = results.find(
            other => other.id !== dest.id && normalize(other.address) === normalizedAddr
          )
          return {
            ...dest,
            isDuplicate: !!duplicate
          }
        })

        setSuggestions(results)
        setShowSuggestions(results.length > 0)
      } catch (error) {
        console.error('Destination search error:', error)
        setSuggestions([])
        setShowSuggestions(false)
      } finally {
        setIsLoading(false)
      }
    }, 150)
  }

  const addDestination = async () => {
    const address = addressInput.trim()
    if (!address) return

    const name = nameInput.trim()
    const normalizedAddress = normalize(address)

    // Check if address already exists in current destinations
    if (existingNormalizedAddresses.includes(normalizedAddress)) {
      alert('This address is already added')
      return
    }

    // Persist to Firestore
    try {
      await setDoc(
        doc(db, 'destinations', normalizedAddress),
        {
          name: name || '',
          address: address,
          normalizedName: normalize(name || ''),
          normalizedAddress: normalizedAddress,
          createdAt: serverTimestamp()
        },
        { merge: true }
      )
    } catch (error) {
      console.error('Error persisting destination:', error)
    }

    // Call parent handler
    onAddDestination({ name, address })

    // Clear inputs
    setNameInput('')
    setAddressInput('')
    setShowSuggestions(false)
  }

  const selectSuggestion = (suggestion) => {
    setShowSuggestions(false)

    const name = (suggestion.name || '').trim()
    const address = (suggestion.address || '').trim()
    if (!address) return

    const normalizedAddress = normalize(address)
    if (existingNormalizedAddresses.includes(normalizedAddress)) {
      alert('This address is already added')
      return
    }

    // Persist to Firestore
    setDoc(
      doc(db, 'destinations', normalizedAddress),
      {
        name: name,
        address: address,
        normalizedName: normalize(name),
        normalizedAddress: normalizedAddress,
        createdAt: serverTimestamp()
      },
      { merge: true }
    ).catch(err => console.error('Error persisting destination:', err))

    // Add immediately
    onAddDestination({ name, address })
    setNameInput('')
    setAddressInput('')
  }

  const handleNameChange = (e) => {
    const value = e.target.value
    setNameInput(value)
    searchDestinations(value, 'name')
  }

  const handleAddressChange = (e) => {
    const value = e.target.value
    setAddressInput(value)
    searchDestinations(value, 'address')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addDestination()
    }
  }

  return (
    <div style={{ marginTop: existingDestinations.length > 0 ? '10px' : '0' }}>
      <input
        className="input"
        type="text"
        value={nameInput}
        onChange={handleNameChange}
        onFocus={() => {
          if (nameInput.trim()) setShowSuggestions(suggestions.length > 0)
        }}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
        placeholder="Location name (optional)"
        style={{
          marginBottom: '8px',
          fontSize: '16px', // Prevent zoom on iOS
          minHeight: '44px' // Mobile tap target
        }}
      />
      <input
        ref={addressRef}
        className="input"
        type="text"
        value={addressInput}
        onChange={handleAddressChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (addressInput.trim()) setShowSuggestions(suggestions.length > 0)
        }}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
        placeholder="Address *"
        style={{
          marginBottom: '10px',
          fontSize: '16px', // Prevent zoom on iOS
          minHeight: '44px' // Mobile tap target
        }}
      />

      <a
        href={(() => {
          const searchQuery = [nameInput.trim(), addressInput.trim()].filter(Boolean).join(' ')
          return searchQuery
            ? `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`
            : 'https://www.google.com/maps'
        })()}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'block', textAlign: 'center',
          width: '100%', fontSize: '14px',
          padding: '12px', minHeight: '44px',
          marginBottom: '10px', boxSizing: 'border-box',
          color: '#4285F4', textDecoration: 'none',
          border: '1px solid #4285F4', borderRadius: '4px',
          backgroundColor: 'transparent', cursor: 'pointer'
        }}
      >Click here to search in Google Maps</a>

      <AutocompleteDropdown
        suggestions={suggestions}
        isVisible={showSuggestions}
        onSelect={selectSuggestion}
        loading={isLoading}
        inputRef={addressRef}
        renderItem={(suggestion) => (
          <div style={{ width: '100%' }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: suggestion.name ? '4px' : '0'
            }}>
              <span style={{ fontWeight: 700, fontSize: '14px' }}>
                {suggestion.name || 'Unnamed Location'}
              </span>
              {suggestion.isDuplicate && (
                <span style={{
                  fontSize: '10px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: '#FFF3CD',
                  color: '#856404',
                  fontWeight: 600
                }}>
                  DUPLICATE
                </span>
              )}
            </div>
            <div style={{
              fontSize: '12px',
              color: '#666',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {suggestion.address}
            </div>
          </div>
        )}
      />

      <button
        className={`btn ${addressInput.trim() ? 'btn-primary' : 'btn-disabled'}`}
        onClick={addDestination}
        disabled={!addressInput.trim()}
        style={{
          width: '100%',
          fontSize: '14px',
          padding: '12px',
          minHeight: '44px' // Mobile tap target
        }}
      >
        + Add Destination
      </button>
    </div>
  )
}

export default DestinationAutocomplete
