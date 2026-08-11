/* global process */
import admin from 'firebase-admin'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  EOC_TEMPLATE_ITEM_SCHEMA_VERSION,
  normalizeEocTemplateItems
} from '../src/utils/eocTemplateModel.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ID = 'sprc-tx-l'
const confirm = process.argv.includes('--confirm')
const MAX_BATCH_OPERATIONS = 400

function initAdmin() {
  try {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: PROJECT_ID
    })
    return
  } catch {
    const serviceAccount = JSON.parse(
      readFileSync(join(__dirname, '../serviceAccountKey.json'), 'utf8')
    )
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: PROJECT_ID
    })
  }
}

if (!admin.apps.length) initAdmin()

const db = admin.firestore()
const serverTimestamp = () => admin.firestore.FieldValue.serverTimestamp()

function positiveVersion(value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

function nextVersion(value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed + 1 : 1
}

function buildVersionId(templateId, versionNumber) {
  return `${String(templateId || '').trim()}__v${positiveVersion(versionNumber)}`
}

async function commitOperations(operations) {
  for (let index = 0; index < operations.length; index += MAX_BATCH_OPERATIONS) {
    const batch = db.batch()
    operations.slice(index, index + MAX_BATCH_OPERATIONS).forEach(operation => operation(batch))
    await batch.commit()
  }
}

async function main() {
  const [templatesSnap, assignmentsSnap, pendingTasksSnap, overdueTasksSnap] = await Promise.all([
    db.collection('eocTemplateLibrary').get(),
    db.collection('eocTemplateAssignments').get(),
    db.collection('eocTasks').where('status', '==', 'pending').get(),
    db.collection('eocTasks').where('status', '==', 'overdue').get()
  ])

  const templateVersions = new Map()
  const operations = []
  let templateSnapshotsToCreate = 0
  let templatesToNormalize = 0
  let assignmentsToLink = 0
  let actionableTasksToLink = 0

  for (const templateDoc of templatesSnap.docs) {
    const template = templateDoc.data() || {}
    const normalizedItems = normalizeEocTemplateItems(template.items)
    const versionNumber = positiveVersion(template.publishedVersion || template.version)
    const versionId = String(template.publishedVersionId || '').trim()
      || buildVersionId(templateDoc.id, versionNumber)
    const versionRef = db.collection('eocTemplateVersions').doc(versionId)
    const versionSnap = await versionRef.get()

    if (versionSnap.exists) {
      const versionData = versionSnap.data() || {}
      if (String(versionData.templateId || '').trim() !== templateDoc.id) {
        throw new Error(`Version ID collision at ${versionId}; no writes were made.`)
      }
    } else {
      templateSnapshotsToCreate += 1
      operations.push(batch => batch.create(versionRef, {
        templateId: templateDoc.id,
        templateName: String(template.name || '').trim() || 'Unnamed EOC template',
        eocType: String(template.eocType || '').trim() === 'van' ? 'van' : 'house',
        status: String(template.status || '').trim() === 'archived' ? 'archived' : 'active',
        items: normalizedItems,
        itemSchemaVersion: EOC_TEMPLATE_ITEM_SCHEMA_VERSION,
        versionNumber,
        ownerUserId: template.ownerUserId || null,
        ownerName: template.ownerName || null,
        ownerAuthUid: template.ownerAuthUid || null,
        publishedByUserId: 'system_migration',
        publishedByName: 'EOC foundation migration',
        publishedByAuthUid: null,
        migrationSource: 'migrateEocTemplateFoundation',
        publishedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        version: 1
      }))
    }

    templateVersions.set(templateDoc.id, {
      versionId,
      versionNumber,
      templateName: String(template.name || '').trim()
    })

    const needsLibraryUpdate = template.itemSchemaVersion !== EOC_TEMPLATE_ITEM_SCHEMA_VERSION
      || String(template.publishedVersionId || '').trim() !== versionId
      || Number(template.publishedVersion || 0) !== versionNumber
      || JSON.stringify(template.items || []) !== JSON.stringify(normalizedItems)

    if (needsLibraryUpdate) {
      templatesToNormalize += 1
      operations.push(batch => batch.set(templateDoc.ref, {
        items: normalizedItems,
        itemSchemaVersion: EOC_TEMPLATE_ITEM_SCHEMA_VERSION,
        publishedVersion: versionNumber,
        publishedVersionId: versionId,
        foundationMigratedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true }))
    }
  }

  for (const assignmentDoc of assignmentsSnap.docs) {
    const assignment = assignmentDoc.data() || {}
    const versionMeta = templateVersions.get(String(assignment.defaultTemplateId || '').trim())
    if (!versionMeta) continue
    if (
      String(assignment.defaultTemplateVersionId || '').trim() === versionMeta.versionId
      && Number(assignment.defaultTemplateVersion || 0) === versionMeta.versionNumber
    ) continue

    assignmentsToLink += 1
    operations.push(batch => batch.set(assignmentDoc.ref, {
      defaultTemplateName: assignment.defaultTemplateName || versionMeta.templateName,
      defaultTemplateVersion: versionMeta.versionNumber,
      defaultTemplateVersionId: versionMeta.versionId,
      foundationMigratedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      version: nextVersion(assignment.version)
    }, { merge: true }))
  }

  const actionableTasks = [...pendingTasksSnap.docs, ...overdueTasksSnap.docs]
  for (const taskDoc of actionableTasks) {
    const task = taskDoc.data() || {}
    if (String(task.templateVersionId || '').trim()) continue
    const versionMeta = templateVersions.get(String(task.templateId || '').trim())
    if (!versionMeta) continue

    actionableTasksToLink += 1
    operations.push(batch => batch.set(taskDoc.ref, {
      templateName: task.templateName || versionMeta.templateName,
      templateVersion: versionMeta.versionNumber,
      templateVersionId: versionMeta.versionId,
      foundationMigratedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      version: nextVersion(task.version)
    }, { merge: true }))
  }

  if (confirm) await commitOperations(operations)

  console.log(JSON.stringify({
    mode: confirm ? 'write' : 'dry-run',
    templatesScanned: templatesSnap.size,
    templateSnapshotsToCreate,
    templatesToNormalize,
    assignmentsScanned: assignmentsSnap.size,
    assignmentsToLink,
    actionableTasksScanned: actionableTasks.length,
    actionableTasksToLink,
    writesPlanned: operations.length,
    writesCommitted: confirm ? operations.length : 0
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
