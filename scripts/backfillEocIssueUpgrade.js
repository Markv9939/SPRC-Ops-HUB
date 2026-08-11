/* global process */
import admin from 'firebase-admin'
import { addPatternObservation, buildIssuePatternId } from '../src/utils/issueRecurrence.js'

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'sprc-tx-l'
const confirm = process.argv.includes('--confirm')
const emulator = !!process.env.FIRESTORE_EMULATOR_HOST
if (confirm && !emulator) throw new Error('Backfill writes are emulator-only until backup, counts, exact writes, and production approval are confirmed.')
admin.initializeApp({ projectId })
const db = admin.firestore()
const issuesSnap = await db.collection('eocIssues').get()
const issueUpdates = []
const attachmentUpdates = []
const patterns = new Map()

for (const issueDoc of issuesSnap.docs) {
  const issue = issueDoc.data()
  const trackingId = String(issue.sourceTrackingId || issue.trackingId || '').trim()
  const eligible = issue.source === 'eoc_checklist' && !!trackingId && issue.status !== 'voided' && issue.recurrenceInvalidated !== true
  const patch = {
    schemaVersion: Math.max(3, Number(issue.schemaVersion || 0)),
    recurrenceEligible: issue.source === 'eoc_checklist' && !!trackingId,
    sourceTrackingId: issue.source === 'eoc_checklist' && trackingId ? trackingId : null,
    linkedTrackingId: issue.linkedTrackingId || null,
    parentIssueId: issue.parentIssueId || null
  }
  if (JSON.stringify(Object.fromEntries(Object.keys(patch).map(key => [key, issue[key] ?? null]))) !== JSON.stringify(patch)) issueUpdates.push({ ref: issueDoc.ref, patch })
  if (eligible) {
    const patternId = issue.patternId || buildIssuePatternId(issue.locationId, trackingId)
    const current = patterns.get(patternId) || { locationId: issue.locationId, trackingId, summary: null }
    current.summary = addPatternObservation(current.summary, { issueId: issueDoc.id, observedAtMs: Number(issue.recurrenceObservedAtMs || issue.createdAt?.toMillis?.() || Date.now()) })
    patterns.set(patternId, current)
  }
  const attachments = await issueDoc.ref.collection('attachments').get()
  for (const attachmentDoc of attachments.docs) {
    const attachment = attachmentDoc.data()
    const attachmentPatch = { schemaVersion: 1, issueId: issueDoc.id, locationId: issue.locationId, visibility: attachment.visibility || (attachment.hiddenFromBht ? 'management_only' : 'location'), retentionDays: 90, hiddenFromBht: attachment.hiddenFromBht === true }
    attachmentUpdates.push({ ref: attachmentDoc.ref, patch: attachmentPatch })
  }
}

const writes = [
  ...issueUpdates.map(item => batch => batch.set(item.ref, item.patch, { merge: true })),
  ...attachmentUpdates.map(item => batch => batch.set(item.ref, item.patch, { merge: true })),
  ...Array.from(patterns, ([patternId, row]) => batch => batch.set(db.doc(`eocIssuePatterns/${patternId}`), { schemaVersion: 1, patternId, locationId: row.locationId, trackingId: row.trackingId, ...row.summary, version: 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }))
]
if (confirm) {
  for (let index = 0; index < writes.length; index += 400) {
    const batch = db.batch()
    writes.slice(index, index + 400).forEach(write => write(batch))
    await batch.commit()
  }
}
console.log(JSON.stringify({ mode: confirm ? 'emulator-write' : 'dry-run', projectId, issuesScanned: issuesSnap.size, issueUpdates: issueUpdates.length, attachmentUpdates: attachmentUpdates.length, patternSummaries: patterns.size, writesPlanned: writes.length }, null, 2))
