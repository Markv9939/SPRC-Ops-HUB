import { useState, useEffect } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc, addDoc, collection, serverTimestamp, updateDoc } from 'firebase/firestore'
import { SHIFTS } from '../data/eocConstants'
import {
  getAssignmentId,
  getCurrentCycleDueDate,
  getNextCycleDueDate,
  isDueDatePassed
} from '../utils/eocSchedule'

/**
 * Lazy EOC assignment creation hook.
 * On mount, ensures current + next cycle assignments exist for the user's shift/location.
 * Flips past-due pending assignments to "missed".
 */
export default function useEocAssignments(user) {
  const [currentAssignment, setCurrentAssignment] = useState(null)
  const [nextAssignment, setNextAssignment] = useState(null)
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

        const currentId = getAssignmentId(user.locationId, user.shiftId, currentDue)
        const nextId = getAssignmentId(user.locationId, user.shiftId, nextDue)

        // Ensure current assignment exists
        const currentDoc = await ensureAssignment(currentId, user, currentDue)
        // Ensure next assignment exists
        const nextDoc = await ensureAssignment(nextId, user, nextDue)

        // Check if current is past due and still pending → mark missed
        if (currentDoc.status === 'pending' && isDueDatePassed(currentDue)) {
          await updateDoc(doc(db, 'eocAssignments', currentId), {
            status: 'missed',
            updatedAt: serverTimestamp()
          })
          // Create supervisor alert for missed assignment
          await addDoc(collection(db, 'supervisorAlerts'), {
            type: 'eoc_missed',
            assignmentId: currentId,
            locationId: user.locationId,
            shiftId: user.shiftId,
            techId: user.id,
            techName: user.name,
            dueDate: currentDue,
            message: `${user.name} missed EOC for ${user.locationId} (due ${currentDue})`,
            read: false,
            createdAt: serverTimestamp()
          })
          currentDoc.status = 'missed'
        }

        setCurrentAssignment({ id: currentId, ...currentDoc })
        setNextAssignment({ id: nextId, ...nextDoc })
      } catch (err) {
        console.error('Error ensuring EOC assignments:', err)
      } finally {
        setLoading(false)
      }
    }

    ensureAssignments()
  }, [user])

  return { currentAssignment, nextAssignment, loading }
}

async function ensureAssignment(assignmentId, user, dueDate) {
  const ref = doc(db, 'eocAssignments', assignmentId)
  const snap = await getDoc(ref)

  if (snap.exists()) {
    return snap.data()
  }

  // Create new assignment
  const data = {
    locationId: user.locationId,
    shiftId: user.shiftId,
    dueDate,
    assignedTechId: user.id,
    assignedTechName: user.name,
    vanId: user.vanId || null,
    status: 'pending',
    submissionId: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }

  await setDoc(ref, data)
  return data
}
