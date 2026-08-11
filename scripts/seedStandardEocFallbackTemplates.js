/* global process */
import admin from 'firebase-admin'
import { EOC_HOUSE_TEMPLATE, EOC_VAN_TEMPLATE } from '../src/data/eocConstants.js'
import { normalizeEocTemplateItems } from '../src/utils/eocTemplateModel.js'

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'sprc-tx-l'
const confirm = process.argv.includes('--confirm')
const emulator = !!process.env.FIRESTORE_EMULATOR_HOST
if (confirm && !emulator) throw new Error('Fallback template writes are emulator-only until production deployment approval.')
admin.initializeApp({ projectId })
const db = admin.firestore()

const templates = [
  { id: 'standard_fallback_house', eocType: 'house', name: 'Standard House fallback', items: normalizeEocTemplateItems(EOC_HOUSE_TEMPLATE) },
  { id: 'standard_fallback_van', eocType: 'van', name: 'Standard Van fallback', items: normalizeEocTemplateItems(EOC_VAN_TEMPLATE) }
]

if (confirm) {
  const batch = db.batch()
  for (const template of templates) {
    const versionId = `${template.id}__v1`
    batch.set(db.doc(`eocTemplateLibrary/${template.id}`), { ...template, status: 'active', locked: true, standardFallback: true, publishedVersion: 1, publishedVersionId: versionId, version: 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
    batch.set(db.doc(`eocTemplateVersions/${versionId}`), { templateId: template.id, templateName: template.name, eocType: template.eocType, items: template.items, status: 'active', locked: true, standardFallback: true, versionNumber: 1, ownerAuthUid: null, publishedByUserId: 'system_fallback_seed', version: 1, publishedAt: admin.firestore.FieldValue.serverTimestamp(), createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: false })
  }
  await batch.commit()
}
console.log(JSON.stringify({ mode: confirm ? 'emulator-write' : 'dry-run', projectId, templates: templates.map(item => ({ id: item.id, itemCount: item.items.length })) }, null, 2))
