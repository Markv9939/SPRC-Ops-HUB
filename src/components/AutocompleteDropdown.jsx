import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'

/**
 * Reusable autocomplete dropdown component
 * Renders via portal at document.body to escape all parent overflow constraints
 * Positions itself using getBoundingClientRect() on the passed inputRef
 */
function AutocompleteDropdown({ suggestions, onSelect, isVisible, renderItem, loading, inputRef }) {
  const dropdownRef = useRef(null)
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 })

  const updatePosition = useCallback(() => {
    if (inputRef?.current) {
      const rect = inputRef.current.getBoundingClientRect()
      setPosition({
        top: rect.bottom + window.scrollY + 2,
        left: rect.left + window.scrollX,
        width: rect.width
      })
    }
  }, [inputRef])

  // Update position when visible or suggestions change
  useEffect(() => {
    if (!isVisible) return
    updatePosition()

    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [isVisible, suggestions, updatePosition])

  // Scroll to top when suggestions change
  useEffect(() => {
    if (dropdownRef.current && isVisible) {
      dropdownRef.current.scrollTop = 0
    }
  }, [suggestions, isVisible])

  if (!isVisible || suggestions.length === 0) {
    return null
  }

  return createPortal(
    <div
      ref={dropdownRef}
      className="autocomplete-dropdown"
      style={{
        position: 'absolute',
        top: position.top,
        left: position.left,
        width: position.width,
        background: 'var(--bg-surface)',
        border: '2px solid var(--card-border)',
        borderRadius: '0 0 var(--radius-sm) var(--radius-sm)',
        boxShadow: 'var(--shadow-lg)',
        zIndex: 9999,
        maxHeight: '240px',
        overflowY: 'auto',
        overflowX: 'hidden'
      }}
    >
      {loading && (
        <div style={{
          padding: '10px 12px',
          fontSize: '13px',
          color: '#556677',
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
            color: '#e8e8e8',
            transition: 'background 0.1s',
            borderBottom: index < suggestions.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
            minHeight: '44px', // Mobile tap target
            display: 'flex',
            alignItems: 'center'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(229,57,53,0.1)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          {renderItem(suggestion)}
        </div>
      ))}
    </div>,
    document.body
  )
}

export default AutocompleteDropdown
