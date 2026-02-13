import { useState, useEffect } from 'react'
import { db } from '../firebase'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'

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
      setLoading(false)
      return
    }

    async function loadAssignment() {
      try {
        const canonicalRef = doc(db, 'shiftAssignments', `asg_${user.id}`)
        const canonicalSnap = await getDoc(canonicalRef)

        if (canonicalSnap.exists()) {
          const canonicalData = canonicalSnap.data()
          if (canonicalData.active === true && canonicalData.deleted !== true) {
            setAssignment({ id: canonicalSnap.id, ...canonicalData })
            return
          }
        }

        const q = query(
          collection(db, 'shiftAssignments'),
          where('bhtUserId', '==', user.id),
          where('active', '==', true)
        )
        const snap = await getDocs(q)
        if (snap.empty) {
          setAssignment(null)
          return
        }

        const fallback = snap.docs[0]
        setAssignment({ id: fallback.id, ...fallback.data() })
      } catch (err) {
        console.error('Error loading BHT assignment:', err)
        setAssignment(null)
      } finally {
        setLoading(false)
      }
    }

    loadAssignment()
  }, [user])

  return { assignment, loading }
}

