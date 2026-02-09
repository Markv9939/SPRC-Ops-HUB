import { useEffect, useRef } from 'react'

/**
 * Reusable autocomplete dropdown component
 * Positioned below input with z-index: 1000 to overlay all content
 */
function AutocompleteDropdown({ suggestions, onSelect, isVisible, renderItem, loading }) {
  const dropdownRef = useRef(null)

  // Scroll to top when suggestions change
  useEffect(() => {
    if (dropdownRef.current && isVisible) {
      dropdownRef.current.scrollTop = 0
    }
  }, [suggestions, isVisible])

  if (!isVisible || suggestions.length === 0) {
    return null
  }

  return (
    <div
      ref={dropdownRef}
      className="autocomplete-dropdown"
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        right: 0,
        background: 'white',
        border: '2px solid #eee',
        borderRadius: '0 0 var(--radius-sm) var(--radius-sm)',
        marginTop: '2px',
        boxShadow: 'var(--shadow-lg)',
        zIndex: 1000,
        maxHeight: '240px',
        overflowY: 'auto',
        overflowX: 'hidden'
      }}
    >
      {loading && (
        <div style={{
          padding: '10px 12px',
          fontSize: '13px',
          color: '#999',
          textAlign: 'center'
        }}>
          Loading...
        </div>
      )}
      {!loading && suggestions.map((suggestion, index) => (
        <div
          key={suggestion.id || index}
          className="autocomplete-dropdown-item"
          onMouseDown={(e) => {
            e.preventDefault() // Prevent input blur
            onSelect(suggestion)
          }}
          style={{
            padding: '12px 14px',
            cursor: 'pointer',
            fontSize: '14px',
            color: '#333',
            transition: 'background 0.1s',
            borderBottom: index < suggestions.length - 1 ? '1px solid #f0f0f0' : 'none',
            minHeight: '44px', // Mobile tap target
            display: 'flex',
            alignItems: 'center'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#f5f5f5'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'white'
          }}
        >
          {renderItem(suggestion)}
        </div>
      ))}
    </div>
  )
}

export default AutocompleteDropdown
