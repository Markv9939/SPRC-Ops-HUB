import { useState, useEffect } from 'react'
import { db } from '../firebase'
import { doc, onSnapshot } from 'firebase/firestore'

function buildProfileAssignment(user) {
  const userId = String(user?.id || '').trim()
  const locationId = String(user?.locationId || '').trim().toLowerCase()
  const shiftId = String(user?.shiftId || '').trim()
  const vanIds = Array.isArray(user?.vanIds)
    ? user.vanIds.map(vanId => String(vanId || '').trim().toLowerCase()).filter(Boolean)
    : []
  const fallbackVanId = String(user?.vanId || '').trim().toLowerCase()
  const mergedVanIds = [...new Set([...(vanIds || []), fallbackVanId].filter(Boolean))]

  if (!userId || user?.active === false || !locationId || !shiftId || mergedVanIds.length === 0) {
    return null
  }

  return {
    id: `profile_${userId}`,
    bhtUserId: userId,
    bhtUserName: user?.name || userId,
    locationId,
    shiftId,
    vanId: mergedVanIds[0],
    vanIds: mergedVanIds,
    active: true,
    source: 'user_profile_fallback'
  }
}

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

          setAssignment(buildProfileAssignment(user))
          setLoading(false)
        } catch (err) {
          console.error('Error loading BHT assignment:', err)
          setAssignment(buildProfileAssignment(user))
          setLoading(false)
        }
      },
      (err) => {
        console.error('Error loading BHT assignment:', err)
        setAssignment(buildProfileAssignment(user))
        setLoading(false)
      }
    )
    return () => unsubscribe()
  }, [user])

  return { assignment, loading }
}

