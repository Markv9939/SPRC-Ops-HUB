import { useState, useCallback, useRef, useEffect } from 'react'
import { db } from '../firebase'
import { collection, query, where, getDocs, limit } from 'firebase/firestore'

/**
 * Custom hook for autocomplete functionality with Firestore
 * @param {string} collectionName - Firestore collection to query
 * @param {string} searchField - Field to search on (e.g., 'normalizedLabel')
 * @param {number} minChars - Minimum characters before searching (default: 1)
 * @param {number} maxResults - Maximum number of results (default: 5)
 */
function useAutocomplete(collectionName, searchField, minChars = 1, maxResults = 5) {
  const [suggestions, setSuggestions] = useState([])
  const [isVisible, setIsVisible] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const debounceTimer = useRef(null)

  // Debounced search function
  const search = useCallback(async (term) => {
    // Clear previous timer
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
    }

    // Clear suggestions if below minimum characters
    if (!term || term.trim().length < minChars) {
      setSuggestions([])
      setIsVisible(false)
      return
    }

    // Debounce the search
    debounceTimer.current = setTimeout(async () => {
      setIsLoading(true)
      try {
        const normalizedTerm = term.toLowerCase().trim()
        const q = query(
          collection(db, collectionName),
          where(searchField, '>=', normalizedTerm),
          where(searchField, '<=', normalizedTerm + '\uf8ff'),
          where('active', '==', true), // Only show active clients
          limit(maxResults)
        )

        const snapshot = await getDocs(q)
        const results = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }))

        setSuggestions(results)
        setIsVisible(results.length > 0)
      } catch (error) {
        console.error('Autocomplete search error:', error)
        setSuggestions([])
        setIsVisible(false)
      } finally {
        setIsLoading(false)
      }
    }, 150) // 150ms debounce
  }, [collectionName, searchField, minChars, maxResults])

  // Select a suggestion
  const select = useCallback(() => {
    setIsVisible(false)
    setSuggestions([])
  }, [])

  // Clear suggestions
  const clear = useCallback(() => {
    setSuggestions([])
    setIsVisible(false)
    setIsLoading(false)
  }, [])

  // Show suggestions
  const show = useCallback(() => {
    if (suggestions.length > 0) {
      setIsVisible(true)
    }
  }, [suggestions.length])

  // Hide suggestions
  const hide = useCallback(() => {
    setIsVisible(false)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
      }
    }
  }, [])

  return {
    suggestions,
    isVisible,
    isLoading,
    search,
    select,
    clear,
    show,
    hide
  }
}

export default useAutocomplete
