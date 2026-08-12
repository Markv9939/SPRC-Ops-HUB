/* global process */
import { existsSync } from 'node:fs'
import admin from 'firebase-admin'
import { EOC_HOUSE_TEMPLATE, EOC_VAN_TEMPLATE } from '../src/data/eocConstants.js'
import { EOC_TEMPLATE_ITEM_SCHEMA_VERSION, normalizeEocTemplateItems } from '../src/utils/eocTemplateModel.js'

const PROJECT_ID = 'sprc-tx-l'
const EXPECTED_WRITES = 5
const REQUIRED_PHRASE = 'ACTIVATE TEST HOUSE EOC CANARY'
const confirm = process.argv.includes('--confirm')
const expectedArg = process.argv.find(arg => arg.startsWith('--expected-writes='))
const phraseArg = process.argv.find(arg => arg.startsWith('--phrase='))
const backupArg = process.argv.find(arg => arg.startsWith('--backup='))
const expectedWrites = Number(expectedArg?.split('=')[1] || 0)
const phrase = phraseArg?.slice('--phrase='.length) || ''
const backupPath = backupArg?.slice('--backup='.length) || ''

if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Production canary activation cannot target an emulator.')
if (confirm && (expectedWrites !== EXPECTED_WRITES || phrase !== REQUIRED_PHRASE || !backupPath || !existsSync(backupPath))) {
  throw new Error('Canary activation blocked: expected count, confirmation phrase, or backup file did not match.')
}

admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID })
const db = admin.firestore()
const timestamp = admin.firestore.FieldValue.serverTimestamp()
const templates = [
  { id: 'standard_fallback_house', eocType: 'house', name: 'Standard House fallback', items: normalizeEocTemplateItems(EOC_HOUSE_TEMPLATE) },
  { id: 'standard_fallback_van', eocType: 'van', name: 'Standard Van fallback', items: normalizeEocTemplateItems(EOC_VAN_TEMPLATE) }
]
const targetPaths = [
  'appSettings/eocIssueFeatures',
  ...templates.flatMap(template => [
    `eocTemplateLibrary/${template.id}`,
    `eocTemplateVersions/${template.id}__v1`
  ])
]
const existingTargets = (await Promise.all(targetPaths.map(path => db.doc(path).get()))).filter(snap => snap.exists)
if (existingTargets.length > 0) {
  throw new Error(`Canary activation blocked because target records already exist: ${existingTargets.map(snap => snap.ref.path).join(', ')}`)
}

const settings = {
  flags: {
    recurrence: true,
    photos: true,
    offlinePhotos: true,
    supervisorTools: true,
    retention: true,
    strictAuthentication: false
  },
  enabledLocationIds: ['test_house'],
  rolloutMode: 'test_house_canary',
  canaryLabel: 'Synthetic Test House',
  version: 1
}

if (confirm) {
  const batch = db.batch()
  for (const template of templates) {
    const versionId = `${template.id}__v1`
    batch.create(db.doc(`eocTemplateLibrary/${template.id}`), {
      ...template,
      status: 'active',
      locked: true,
      standardFallback: true,
      itemSchemaVersion: EOC_TEMPLATE_ITEM_SCHEMA_VERSION,
      publishedVersion: 1,
      publishedVersionId: versionId,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp
    })
    batch.create(db.doc(`eocTemplateVersions/${versionId}`), {
      templateId: template.id,
      templateName: template.name,
      eocType: template.eocType,
      items: template.items,
      itemSchemaVersion: EOC_TEMPLATE_ITEM_SCHEMA_VERSION,
      status: 'active',
      locked: true,
      standardFallback: true,
      versionNumber: 1,
      ownerAuthUid: null,
      publishedByUserId: 'system_fallback_seed',
      version: 1,
      publishedAt: timestamp,
      createdAt: timestamp
    })
  }
  batch.create(db.doc('appSettings/eocIssueFeatures'), { ...settings, createdAt: timestamp, updatedAt: timestamp })
  await batch.commit()
}

console.log(JSON.stringify({
  mode: confirm ? 'production-write' : 'dry-run',
  projectId: PROJECT_ID,
  writesPlanned: EXPECTED_WRITES,
  writesCommitted: confirm ? EXPECTED_WRITES : 0,
  settings,
  templates: templates.map(template => ({ id: template.id, itemCount: template.items.length }))
}, null, 2))
