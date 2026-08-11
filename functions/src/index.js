import crypto from 'node:crypto'
import { initializeApp } from 'firebase-admin/app'
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { attachmentNeedsDeletion, summarizeCleanupResults } from './retentionModel.js'

initializeApp()
const db = getFirestore()
const bucket = () => getStorage().bucket()
const PIN_PEPPER = 'sprc-pin-v2-6digit'
const PIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000
const PIN_MAX_ATTEMPTS = 5

function hashPin(pin) {
  return crypto.createHash('sha256').update(`${PIN_PEPPER}:${String(pin || '').trim()}`).digest('hex')
}

async function requireAdminPin(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'A Firebase session is required.')
  const profileId = String(request.data?.adminProfileId || '').trim()
  const pin = String(request.data?.pin || '').trim()
  if (!/^\d{6}$/.test(pin) || !profileId) throw new HttpsError('invalid-argument', 'Admin profile and six-digit PIN are required.')
  const profileRef = db.doc(`users/${profileId}`)
  const rateKey = crypto.createHash('sha256').update(profileId).digest('hex').slice(0, 32)
  const rateRef = db.doc(`securityRateLimits/privacyRemoval_${rateKey}`)
  const nowMs = Date.now()
  const result = await db.runTransaction(async transaction => {
    const [profileSnap, rateSnap] = await Promise.all([transaction.get(profileRef), transaction.get(rateRef)])
    const profile = profileSnap.data()
    const rate = rateSnap.data() || {}
    const lockedUntilMs = rate.lockedUntil?.toMillis?.() || 0
    if (lockedUntilMs > nowMs) return { locked: true }

    const valid = profileSnap.exists && profile?.active === true && profile?.role === 'admin' && profile?.pinHash === hashPin(pin)
    if (valid) {
      transaction.set(rateRef, { failedAttempts: 0, lockedUntil: null, lastSucceededAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      return { actor: { id: profileId, name: profile.name || 'Admin' } }
    }

    const windowStartedMs = rate.windowStartedAt?.toMillis?.() || 0
    const inWindow = windowStartedMs > 0 && nowMs - windowStartedMs < PIN_ATTEMPT_WINDOW_MS
    const failedAttempts = (inWindow ? Number(rate.failedAttempts || 0) : 0) + 1
    transaction.set(rateRef, {
      failedAttempts,
      windowStartedAt: inWindow ? rate.windowStartedAt : Timestamp.fromMillis(nowMs),
      lockedUntil: failedAttempts >= PIN_MAX_ATTEMPTS ? Timestamp.fromMillis(nowMs + PIN_ATTEMPT_WINDOW_MS) : null,
      lastFailedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true })
    return { locked: failedAttempts >= PIN_MAX_ATTEMPTS }
  })
  if (result.locked) throw new HttpsError('resource-exhausted', 'Too many failed attempts. Try again later.')
  if (!result.actor) throw new HttpsError('permission-denied', 'Admin PIN verification failed.')
  return result.actor
}

async function appendAttachmentHistory({ issueId, attachmentId, eventType, actor, reason, operationId = '' }) {
  const historyRef = operationId
    ? db.doc(`eocIssues/${issueId}/attachmentHistory/${operationId}`)
    : db.collection(`eocIssues/${issueId}/attachmentHistory`).doc()
  const auditRef = operationId ? db.doc(`auditLogs/${operationId}`) : db.collection('auditLogs').doc()
  const [historySnap, auditSnap] = await Promise.all([historyRef.get(), auditRef.get()])
  if (historySnap.exists && auditSnap.exists) return
  const batch = db.batch()
  if (!historySnap.exists) batch.set(historyRef, { issueId, attachmentId, eventType, reason, actorUserId: actor.id, actorName: actor.name, immutable: true, version: 1, createdAt: FieldValue.serverTimestamp() })
  if (!auditSnap.exists) batch.set(auditRef, { action: eventType, collectionPath: 'eocIssues', documentId: issueId, performedByUserId: actor.id, performedByName: actor.name, reason, attachmentId, version: 1, createdAt: FieldValue.serverTimestamp() })
  await batch.commit()
}

export async function emergencyPrivacyRemoveHandler(request) {
  const actor = await requireAdminPin(request)
  const issueId = String(request.data?.issueId || '').trim()
  const attachmentId = String(request.data?.attachmentId || '').trim()
  const reason = String(request.data?.reason || '').trim()
  if (!issueId || !attachmentId || !reason) throw new HttpsError('invalid-argument', 'Issue, attachment, and reason are required.')
  const attachmentRef = db.doc(`eocIssues/${issueId}/attachments/${attachmentId}`)
  const snap = await attachmentRef.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Attachment was not found.')
  const attachment = snap.data()
  if (attachment.state === 'privacy_removed') return { removed: true, alreadyRemoved: true }
  if (attachment.storagePath) await bucket().file(attachment.storagePath).delete({ ignoreNotFound: true })
  await appendAttachmentHistory({ issueId, attachmentId, eventType: 'attachment_privacy_removed', actor, reason, operationId: `privacy_${issueId}_${attachmentId}` })
  await attachmentRef.update({ state: 'privacy_removed', visibility: 'removed', storagePath: null, privacyRemovedAt: FieldValue.serverTimestamp(), privacyRemovedByUserId: actor.id, privacyRemovedByName: actor.name, privacyRemovalReason: reason, updatedAt: FieldValue.serverTimestamp(), version: Number(attachment.version || 1) + 1 })
  return { removed: true }
}

export const emergencyPrivacyRemove = onCall({ region: 'us-central1' }, emergencyPrivacyRemoveHandler)

export async function runPhotoRetentionCleanup({ now = Timestamp.now(), batchLimit = 100 } = {}) {
  const issuesSnap = await db.collection('eocIssues').where('photoDeletionDueAt', '<=', now).limit(batchLimit).get()
  const results = []
  for (const issueDoc of issuesSnap.docs) {
    if (!['resolved', 'voided'].includes(String(issueDoc.data()?.status || ''))) continue
    const attachments = await issueDoc.ref.collection('attachments').get()
    let issueFailed = false
    for (const attachmentDoc of attachments.docs) {
      const attachment = attachmentDoc.data()
      if (!attachmentNeedsDeletion(attachment)) continue
      try {
        const [metadata] = attachment.storagePath ? await bucket().file(attachment.storagePath).getMetadata().catch(error => error.code === 404 ? [null] : Promise.reject(error)) : [null]
        if (attachment.storagePath) await bucket().file(attachment.storagePath).delete({ ignoreNotFound: true })
        const status = metadata ? 'deleted' : 'missing'
        await appendAttachmentHistory({ issueId: issueDoc.id, attachmentId: attachmentDoc.id, eventType: 'attachment_retention_deleted', actor: { id: 'system_retention', name: 'Photo retention cleanup' }, reason: `Automatic deletion 90 days after issue closure (${status}).`, operationId: `retention_${issueDoc.id}_${attachmentDoc.id}` })
        await attachmentDoc.ref.update({ state: 'deleted', visibility: 'removed', storagePath: null, automaticallyDeletedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), version: Number(attachment.version || 1) + 1 })
        results.push({ issueId: issueDoc.id, attachmentId: attachmentDoc.id, status })
      } catch (error) {
        issueFailed = true
        await attachmentDoc.ref.update({ lastCleanupError: String(error?.message || 'Cleanup failed.').slice(0, 500), lastCleanupAttemptAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
        results.push({ issueId: issueDoc.id, attachmentId: attachmentDoc.id, status: 'failed' })
      }
    }
    if (!issueFailed) {
      await issueDoc.ref.update({ photoDeletionDueAt: null, photoRetentionCompletedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    }
  }
  const summary = { dueIssues: issuesSnap.size, ...summarizeCleanupResults(results), updatedAt: FieldValue.serverTimestamp() }
  await db.doc('appMetrics/photoRetention').set(summary, { merge: true })
  return { ...summary, results }
}

export const cleanupIssuePhotos = onSchedule({ schedule: 'every day 02:15', timeZone: 'America/Phoenix', region: 'us-central1' }, async () => runPhotoRetentionCleanup())
