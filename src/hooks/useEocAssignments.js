import { useState, useEffect } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc, addDoc, collection, serverTimestamp, updateDoc } from 'firebase/firestore'
import { SHIFTS, VAN_BY_LOCATION } from '../data/eocConstants'
import {
  getAssignmentId,
  getCurrentCycleDueDate,
  getNextCycleDueDate,
  isDueDatePassed
} from '../utils/eocSchedule'

/**
 * Lazy EOC assignment creation hook.
 * On mount, ensures current + next cycle assignments exist for the user's shift/location
 * for both house and van EOCs.
 * Flips past-due pending assignments to "missed".
 */
export default function useEocAssignments(user) {
  const [houseAssignment, setHouseAssignment] = useState(null)
  const [vanAssignment, setVanAssignment] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user || !user.locationId || !user.shiftId) {
      setLoading(false)
      return
    }

    const shift = SHIFTS.find(s => s.id === user.shiftId)
    if (!shift) {
      setLoading(false)
      return
    }

    async function ensureAssignments() {
      try {
        const currentDue = getCurrentCycleDueDate(shift)
        const nextDue = getNextCycleDueDate(shift)

        const ensureForType = async (eocType) => {
          const currentId = getAssignmentId(user.locationId, user.shiftId, currentDue, eocType)
          const nextId = getAssignmentId(user.locationId, user.shiftId, nextDue, eocType)

          const currentDoc = await ensureAssignment(currentId, user, currentDue, eocType)
          const nextDoc = await ensureAssignment(nextId, user, nextDue, eocType)

          if (currentDoc.status === 'pending' && isDueDatePassed(currentDue)) {
            await updateDoc(doc(db, 'eocAssignments', currentId), {
              status: 'missed',
              updatedAt: serverTimestamp()
            })
            await addDoc(collection(db, 'supervisorAlerts'), {
              type: 'eoc_missed',
              assignmentId: currentId,
              locationId: user.locationId,
              shiftId: user.shiftId,
              techId: user.id,
              techName: user.name,
              dueDate: currentDue,
              message: `${user.name} missed ${eocType} EOC for ${user.locationId} (due ${currentDue})`,
              read: false,
              createdAt: serverTimestamp()
            })
            currentDoc.status = 'missed'
          }

          return { currentId, currentDoc, nextId, nextDoc }
        }

        const house = await ensureForType('house')
        const van = await ensureForType('van')

        setHouseAssignment({ id: house.currentId, ...house.currentDoc })
        setVanAssignment({ id: van.currentId, ...van.currentDoc })
      } catch (err) {
        console.error('Error ensuring EOC assignments:', err)
      } finally {
        setLoading(false)
      }
    }

    ensureAssignments()
  }, [user])

  return { houseAssignment, vanAssignment, loading }
}

function getDefaultVanId(locationId) {
  return VAN_BY_LOCATION[locationId] || null
}

async function ensureAssignment(assignmentId, user, dueDate, eocType) {
  const ref = doc(db, 'eocAssignments', assignmentId)
  const snap = await getDoc(ref)

  if (snap.exists()) {
    return snap.data()
  }

  const vanId = eocType === 'van' ? getDefaultVanId(user.locationId) : null

  // Create new assignment
  const data = {
    locationId: user.locationId,
    shiftId: user.shiftId,
    dueDate,
    assignedTechId: user.id,
    assignedTechName: user.name,
    vanId,
    eocType,
    status: 'pending',
    submissionId: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }

  await setDoc(ref, data)
  return data
}
