/* global process */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import admin from 'firebase-admin'

const PROJECT_ID = 'sprc-tx-l'
if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('This backup is intended for production only.')

admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID })
const db = admin.firestore()

function serialize(value) {
  if (value?.toDate) return { __firestoreTimestamp: value.toDate().toISOString() }
  if (Array.isArray(value)) return value.map(serialize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]))
  }
  return value
}

async function captureCollection(path) {
  const snap = await db.collection(path).get()
  return snap.docs.map(doc => ({ path: doc.ref.path, exists: true, data: serialize(doc.data()) }))
}

async function captureDocument(path) {
  const snap = await db.doc(path).get()
  return { path, exists: snap.exists, data: snap.exists ? serialize(snap.data()) : null }
}

const templates = await captureCollection('eocTemplateLibrary')
const assignments = await captureCollection('eocTemplateAssignments')
const additionalTargets = await Promise.all([
  captureDocument('appSettings/eocIssueFeatures'),
  captureDocument('eocTemplateLibrary/standard_fallback_house'),
  captureDocument('eocTemplateLibrary/standard_fallback_van'),
  captureDocument('eocTemplateVersions/standard_fallback_house__v1'),
  captureDocument('eocTemplateVersions/standard_fallback_van__v1')
])

const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const directory = '.release-backups'
const outputPath = join(directory, `eoc-canary-production-${timestamp}.json`)
mkdirSync(directory, { recursive: true })
writeFileSync(outputPath, JSON.stringify({
  projectId: PROJECT_ID,
  createdAt: new Date().toISOString(),
  purpose: 'Pre-activation backup for Test House EOC and Issues canary',
  templates,
  assignments,
  additionalTargets
}, null, 2), 'utf8')

console.log(JSON.stringify({
  projectId: PROJECT_ID,
  outputPath,
  templateCount: templates.length,
  assignmentCount: assignments.length,
  existingAdditionalTargets: additionalTargets.filter(item => item.exists).length
}, null, 2))
