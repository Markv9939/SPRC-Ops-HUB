/* global process */
import assert from 'node:assert/strict'
import admin from 'firebase-admin'

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Synthetic upgrade verification is emulator-only.')
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-sprc-eoc-upgrade' })
const db = admin.firestore()
const issue = (await db.doc('eocIssues/legacy_eoc_issue').get()).data()
const attachment = (await db.doc('eocIssues/legacy_eoc_issue/attachments/legacy_photo').get()).data()
const patterns = await db.collection('eocIssuePatterns').get()
assert.equal(issue.description, 'Synthetic leak')
assert.equal(issue.sourceTrackingId, 'kitchen_sink')
assert.equal(issue.recurrenceEligible, true)
assert.equal(attachment.retentionDays, 90)
assert.equal(patterns.size, 1)
console.log('Synthetic EOC upgrade verification passed.')
