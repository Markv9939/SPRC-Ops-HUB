import { collection, doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { writeAuditLog } from './notificationService'

export async function addMissedEocNote({ task, text, actorUser }) {
  const note = String(text || '').trim()
  if (!task?.id) throw new Error('Missed EOC task is required.')
  if (!note) throw new Error('Enter a note before saving.')
  const noteRef = doc(collection(db, 'eocTasks', task.id, 'missedNotes'))
  await setDoc(noteRef, {
    taskId: task.id,
    locationId: task.locationId,
    text: note,
    authorUserId: actorUser?.id || '',
    authorName: actorUser?.name || '',
    immutable: true,
    version: 1,
    createdAt: serverTimestamp()
  })
  await writeAuditLog({ action: 'missed_eoc_note_added', collectionPath: 'eocTasks', documentId: task.id, reason: note, actorUser, extra: { locationId: task.locationId, noteId: noteRef.id } })
  return noteRef.id
}
