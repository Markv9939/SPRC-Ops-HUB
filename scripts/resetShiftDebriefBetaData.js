/* global process */
import { createHash } from 'crypto'
import { Buffer } from 'buffer'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import { fileURLToPath } from 'url'
import admin from 'firebase-admin'

export const PROJECT_ID = 'sprc-tx-l'
export const CONFIRM_PHRASE = 'RESET_SHIFT_DEBRIEF_BETA_V2'
export const NO_BACKUP_PHRASE = 'DELETE_DEBRIEF_DATA_WITHOUT_BACKUP'
export const DEBRIEF_ALERT_TYPES = [
  'shift_debrief_submitted',
  'shift_debrief_missing',
  'shift_debrief_no_receivers',
  'shift_debrief_incoming_ack_late'
]
export const USER_HOME_DEBRIEF_FIELDS = ['reviewedDebriefIds', 'lastReviewedDebriefId']

const __filename = fileURLToPath(import.meta.url)
const repoRoot = resolve(dirname(__filename), '..')

function argumentValue(name, argv = process.argv) {
  const prefix = `--${name}=`
  const argument = argv.find(value => value.startsWith(prefix))
  return argument ? argument.slice(prefix.length) : ''
}

function hasFlag(name, argv = process.argv) {
  return argv.includes(`--${name}`)
}

export function parseArguments(argv = process.argv) {
  return {
    project: argumentValue('project', argv),
    confirm: argumentValue('confirm', argv),
    backup: hasFlag('backup', argv),
    noBackup: argumentValue('no-backup', argv),
    backupDir: argumentValue('backup-dir', argv),
    expectedDrafts: argumentValue('expected-drafts', argv),
    expectedDebriefs: argumentValue('expected-debriefs', argv),
    expectedAlerts: argumentValue('expected-alerts', argv),
    expectedHomeStates: argumentValue('expected-home-states', argv)
  }
}

function initAdmin() {
  if (admin.apps.length) return

  const serviceAccountPath = join(repoRoot, 'serviceAccountKey.json')
  if (existsSync(serviceAccountPath)) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(readFileSync(serviceAccountPath, 'utf8'))),
      projectId: PROJECT_ID
    })
    return
  }

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: PROJECT_ID
  })
}

function serializeValue(value) {
  if (value === null || value === undefined) return value ?? null
  if (value instanceof Date) return { __type: 'date', value: value.toISOString() }
  if (typeof value?.toDate === 'function') return { __type: 'timestamp', value: value.toDate().toISOString() }
  if (typeof value?.path === 'string' && value?.firestore) return { __type: 'reference', path: value.path }
  if (Buffer.isBuffer(value)) return { __type: 'bytes', value: value.toString('base64') }
  if (Array.isArray(value)) return value.map(serializeValue)
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, serializeValue(nested)]))
  }
  return value
}

function captureDocuments(snapshot) {
  return snapshot.docs.map(document => ({
    path: document.ref.path,
    data: serializeValue(document.data())
  }))
}

export async function captureDebriefResetTargets(db) {
  const [draftsSnapshot, debriefsSnapshot, alertsSnapshot, supervisorAlertsSnapshot, homeSnapshot] = await Promise.all([
    db.collection('shiftDebriefDrafts').get(),
    db.collection('shiftDebriefs').get(),
    db.collection('alerts').where('type', 'in', DEBRIEF_ALERT_TYPES).get(),
    db.collection('supervisorAlerts').where('type', 'in', DEBRIEF_ALERT_TYPES).get(),
    db.collection('userHomeState').get()
  ])

  const homeStates = homeSnapshot.docs
    .filter(document => USER_HOME_DEBRIEF_FIELDS.some(field => Object.hasOwn(document.data() || {}, field)))
    .map(document => ({
      path: document.ref.path,
      data: serializeValue(document.data()),
      fieldsToClear: USER_HOME_DEBRIEF_FIELDS.filter(field => Object.hasOwn(document.data() || {}, field))
    }))
  const alerts = [...captureDocuments(alertsSnapshot), ...captureDocuments(supervisorAlertsSnapshot)]
  const targets = {
    drafts: captureDocuments(draftsSnapshot),
    debriefs: captureDocuments(debriefsSnapshot),
    alerts,
    homeStates
  }

  return {
    capturedAt: new Date().toISOString(),
    projectId: PROJECT_ID,
    counts: {
      drafts: targets.drafts.length,
      debriefs: targets.debriefs.length,
      alerts: targets.alerts.length,
      homeStates: targets.homeStates.length,
      deleteDocuments: targets.drafts.length + targets.debriefs.length + targets.alerts.length,
      updateDocuments: targets.homeStates.length
    },
    targets
  }
}

function expectedCount(value, label) {
  if (!/^\d+$/.test(String(value))) throw new Error(`Refusing reset: --expected-${label} must be a whole number from the preview.`)
  return Number(value)
}

export function assertResetApproved({ args, inventory, backupVerified }) {
  if (args.project !== PROJECT_ID) {
    throw new Error(`Refusing reset: --project must exactly equal ${PROJECT_ID}.`)
  }
  if (args.confirm !== CONFIRM_PHRASE) {
    throw new Error(`Refusing reset: --confirm must exactly equal ${CONFIRM_PHRASE}.`)
  }
  const verifiedBackup = args.backup && backupVerified
  const explicitBackupWaiver = args.noBackup === NO_BACKUP_PHRASE
  if (!verifiedBackup && !explicitBackupWaiver) {
    throw new Error(`Refusing reset: use a verified --backup or --no-backup=${NO_BACKUP_PHRASE}.`)
  }

  const comparisons = [
    ['drafts', args.expectedDrafts, inventory.counts.drafts],
    ['debriefs', args.expectedDebriefs, inventory.counts.debriefs],
    ['alerts', args.expectedAlerts, inventory.counts.alerts],
    ['home-states', args.expectedHomeStates, inventory.counts.homeStates]
  ]
  for (const [label, supplied, actual] of comparisons) {
    if (expectedCount(supplied, label) !== actual) {
      throw new Error(`Refusing reset: ${label} count changed since preview (expected ${supplied}, found ${actual}).`)
    }
  }
}

function resolveBackupDirectory(requested) {
  const fallback = join(process.env.TEMP || 'C:\\tmp', 'sprc-debrief-reset-backups')
  const backupDirectory = resolve(requested || fallback)
  const relativeToRepo = relative(repoRoot, backupDirectory)
  const isInsideRepo = relativeToRepo === '' || (!relativeToRepo.startsWith('..') && !isAbsolute(relativeToRepo))
  if (isInsideRepo) throw new Error('Backup directory must be outside the app repository.')
  return backupDirectory
}

export function writeAndValidateBackup(inventory, requestedDirectory = '') {
  const backupDirectory = resolveBackupDirectory(requestedDirectory)
  mkdirSync(backupDirectory, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = join(backupDirectory, `sprc-shift-debrief-v2-reset-${stamp}.json`)
  const contents = JSON.stringify({
    purpose: 'Rollback-only backup before Shift Debrief V2 beta reset',
    ...inventory
  }, null, 2)
  const expectedHash = createHash('sha256').update(contents).digest('hex')
  writeFileSync(backupPath, contents, 'utf8')

  const readBack = readFileSync(backupPath, 'utf8')
  const parsed = JSON.parse(readBack)
  const actualHash = createHash('sha256').update(readBack).digest('hex')
  if (actualHash !== expectedHash || parsed?.counts?.deleteDocuments !== inventory.counts.deleteDocuments) {
    throw new Error('Backup verification failed. No reset was performed.')
  }
  return { path: backupPath, sha256: actualHash, verified: true }
}

export async function executeDebriefReset(db, inventory) {
  const operations = [
    ...inventory.targets.drafts.map(document => ({ type: 'delete', path: document.path })),
    ...inventory.targets.debriefs.map(document => ({ type: 'delete', path: document.path })),
    ...inventory.targets.alerts.map(document => ({ type: 'delete', path: document.path })),
    ...inventory.targets.homeStates.map(document => ({ type: 'update', path: document.path, fields: document.fieldsToClear }))
  ]
  let completed = 0

  for (let offset = 0; offset < operations.length; offset += 400) {
    const batch = db.batch()
    const batchOperations = operations.slice(offset, offset + 400)
    batchOperations.forEach(operation => {
      const reference = db.doc(operation.path)
      if (operation.type === 'delete') batch.delete(reference)
      else {
        const updates = Object.fromEntries(operation.fields.map(field => [field, admin.firestore.FieldValue.delete()]))
        batch.update(reference, updates)
      }
    })
    await batch.commit()
    completed += batchOperations.length
  }

  return {
    deletedDocuments: inventory.counts.deleteDocuments,
    updatedHomeStateDocuments: inventory.counts.updateDocuments,
    completedOperations: completed
  }
}

async function main() {
  const args = parseArguments()
  initAdmin()
  const db = admin.firestore()
  const inventory = await captureDebriefResetTargets(db)
  const backup = args.backup ? writeAndValidateBackup(inventory, args.backupDir) : null
  const confirmed = Boolean(args.confirm)

  console.log(JSON.stringify({
    mode: confirmed ? 'confirmed debrief-only reset' : 'preview only',
    projectId: PROJECT_ID,
    counts: inventory.counts,
    affectedCollections: ['shiftDebriefDrafts', 'shiftDebriefs', 'alerts', 'supervisorAlerts', 'userHomeState'],
    preservedExamples: ['users', 'assignments', 'clients', 'transports', 'EOC records', 'facility issues', 'templates'],
    backup: backup || { verified: false, path: null },
    backupWaived: args.noBackup === NO_BACKUP_PHRASE
  }, null, 2))

  if (!confirmed) {
    console.log('\nPreview complete. No Firebase writes or deletions were performed.')
    console.log('A destructive run remains blocked until Mark separately approves it and every expected count is supplied.')
    return
  }

  assertResetApproved({ args, inventory, backupVerified: backup?.verified === true })
  const result = await executeDebriefReset(db, inventory)
  const verification = await captureDebriefResetTargets(db)
  if (Object.values(verification.counts).some(count => count !== 0)) {
    throw new Error(`Reset verification failed: ${JSON.stringify(verification.counts)}`)
  }
  console.log('\nShift Debrief V2 beta reset completed and verified.')
  console.log(JSON.stringify(result, null, 2))
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === __filename
if (isDirectRun) {
  main().catch(error => {
    console.error(error?.stack || error?.message || error)
    process.exitCode = 1
  })
}
