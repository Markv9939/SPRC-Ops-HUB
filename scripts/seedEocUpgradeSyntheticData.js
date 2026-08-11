/* global process */
import admin from 'firebase-admin'

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Synthetic upgrade seed is emulator-only.')
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-sprc-eoc-upgrade' })
const db = admin.firestore()
const batch = db.batch()
batch.set(db.doc('eocIssues/legacy_eoc_issue'), { source: 'eoc_checklist', trackingId: 'kitchen_sink', locationId: 'test_house', status: 'resolved', createdAt: admin.firestore.Timestamp.fromMillis(Date.now() - 1000), description: 'Synthetic leak', version: 1 })
batch.set(db.doc('eocIssues/legacy_eoc_issue/attachments/legacy_photo'), { kind: 'report', state: 'uploaded', storagePath: 'issueAttachments/test_house/legacy_eoc_issue/legacy_photo.jpg', mimeType: 'image/jpeg', sizeBytes: 100, version: 1 })
batch.set(db.doc('eocIssues/legacy_quick_issue'), { source: 'quick_report', locationId: 'test_house', status: 'open', description: 'Synthetic quick report', version: 1 })
await batch.commit()
console.log('Synthetic EOC upgrade data seeded.')
