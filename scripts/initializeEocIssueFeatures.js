/* global process */
import admin from 'firebase-admin'

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'sprc-tx-l'
const confirm = process.argv.includes('--confirm')
const emulator = !!process.env.FIRESTORE_EMULATOR_HOST

if (confirm && !emulator) {
  throw new Error('Feature initialization writes are emulator-only in this release. Production changes require the approved deployment procedure.')
}

admin.initializeApp({ projectId })
const db = admin.firestore()
const payload = {
  flags: {
    recurrence: false,
    photos: false,
    offlinePhotos: false,
    supervisorTools: false,
    retention: false,
    strictAuthentication: false
  },
  enabledLocationIds: ['test_house'],
  rolloutMode: 'test_house_canary',
  version: 1
}

if (confirm) await db.doc('appSettings/eocIssueFeatures').set({ ...payload, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
console.log(JSON.stringify({ mode: confirm ? 'emulator-write' : 'dry-run', projectId, document: 'appSettings/eocIssueFeatures', payload }, null, 2))
