import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where
} from 'firebase/firestore'
import { db } from '../firebase'
import { buildAppFeedbackRecord, normalizeAppFeedbackStatus } from '../utils/appFeedbackModel'
import { assertExpectedVersion, getVersionNumber } from './versioning'

function safeId(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120)
}

export async function submitAppFeedbackOnline(payload = {}) {
  const record = buildAppFeedbackRecord(payload)
  const deterministicId = safeId(payload.localFeedbackId)
  const feedbackRef = deterministicId
    ? doc(db, 'appFeedback', `feedback_${deterministicId}`)
    : doc(collection(db, 'appFeedback'))

  await setDoc(feedbackRef, {
    ...record,
    ...(payload.offlineReplayAuthorization ? { offlineReplayAuthorization: payload.offlineReplayAuthorization } : {}),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  })
  return { feedbackId: feedbackRef.id }
}

export function subscribeMyAppFeedback(userId, onRows, onError) {
  if (!userId) return () => {}
  return onSnapshot(query(
    collection(db, 'appFeedback'),
    where('submittedByUserId', '==', userId),
    orderBy('createdAt', 'desc'),
    limit(20)
  ), snap => onRows(snap.docs.map(row => ({ id: row.id, ...row.data() }))), onError)
}

export function subscribeAdminAppFeedback(onRows, onError) {
  return onSnapshot(query(
    collection(db, 'appFeedback'),
    orderBy('createdAt', 'desc'),
    limit(200)
  ), snap => onRows(snap.docs.map(row => ({ id: row.id, ...row.data() }))), onError)
}

export async function updateAppFeedbackStatus({ feedback, status, adminNote, actorUser }) {
  const feedbackId = String(feedback?.id || '').trim()
  if (!feedbackId) throw new Error('Feedback ID is required.')
  const nextStatus = normalizeAppFeedbackStatus(status)
  const note = String(adminNote || '').trim()
  const feedbackRef = doc(db, 'appFeedback', feedbackId)

  await runTransaction(db, async transaction => {
    const snap = await transaction.get(feedbackRef)
    if (!snap.exists()) throw new Error('Feedback no longer exists.')
    const latest = snap.data()
    const { nextVersion } = assertExpectedVersion({
      expectedVersion: getVersionNumber(feedback),
      currentVersion: getVersionNumber(latest),
      documentId: feedbackId,
      recordLabel: 'App feedback'
    })
    transaction.update(feedbackRef, {
      status: nextStatus,
      adminNote: note,
      reviewedByUserId: String(actorUser?.id || '').trim(),
      reviewedByName: String(actorUser?.name || '').trim(),
      reviewedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      version: nextVersion
    })
  })
}

export async function listMyAppFeedback(userId) {
  if (!userId) return []
  const snap = await getDocs(query(
    collection(db, 'appFeedback'),
    where('submittedByUserId', '==', userId),
    orderBy('createdAt', 'desc'),
    limit(20)
  ))
  return snap.docs.map(row => ({ id: row.id, ...row.data() }))
}
