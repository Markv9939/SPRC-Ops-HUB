import { useState, useEffect } from 'react'
import { db } from '../firebase'
import { collection, doc, getDocs, onSnapshot, query, where } from 'firebase/firestore'

/**
 * Hook to load active BHT assignment for a user.
 * Reads from `shiftAssignments` collection (persistent assignment model).
 * Returns the assignment data or null if no active assignment exists.
 */
export default function useEocAssignments(user) {
  const [assignment, setAssignment] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user || !user.id) {
      const timer = window.setTimeout(() => {
        setAssignment(null)
        setLoading(false)
      }, 0)
      return () => window.clearTimeout(timer)
    }
    const normalizedUserId = String(user.id || '').trim()
    if (!normalizedUserId) {
      const timer = window.setTimeout(() => {
        setAssignment(null)
        setLoading(false)
      }, 0)
      return () => window.clearTimeout(timer)
    }

    const canonicalRef = doc(db, 'shiftAssignments', `asg_${normalizedUserId}`)
    const unsubscribe = onSnapshot(
      canonicalRef,
      async (canonicalSnap) => {
        try {
          if (canonicalSnap.exists()) {
            const canonicalData = canonicalSnap.data()
            if (canonicalData.active === true && canonicalData.deleted !== true) {
              setAssignment({ id: canonicalSnap.id, ...canonicalData })
              setLoading(false)
              return
            }
          }

          const q = query(
            collection(db, 'shiftAssignments'),
            where('bhtUserId', '==', normalizedUserId),
            where('active', '==', true)
          )
          const snap = await getDocs(q)
          if (snap.empty) {
            setAssignment(null)
            setLoading(false)
            return
          }

          const fallback = snap.docs[0]
          setAssignment({ id: fallback.id, ...fallback.data() })
          setLoading(false)
        } catch (err) {
          console.error('Error loading BHT assignment:', err)
          setAssignment(null)
          setLoading(false)
        }
      },
      (err) => {
        console.error('Error loading BHT assignment:', err)
        setAssignment(null)
        setLoading(false)
      }
    )
    return () => unsubscribe()
  }, [user])

  return { assignment, loading }
}

