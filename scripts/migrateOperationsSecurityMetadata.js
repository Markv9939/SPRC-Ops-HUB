/* global process */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import admin from 'firebase-admin'

const PROJECT_ID = 'sprc-tx-l'
const VEHICLE_ID = 'IrvfGd1xkv5AY8kV8X0J'
const VEHICLE_PATH = `eocVehicles/${VEHICLE_ID}`
const RUNTIME_PATH = `fleetVehicleRuntime/${VEHICLE_ID}`
const EXPECTED_LOCATION_ID = 'lone_mountain'
const TARGET_MAIN_LOCATION = 'OTC'
const CONFIRM_PHRASE = 'APPLY OTC METADATA TO MENS PHP VEHICLE'

function argument(name) {
  const prefix = `--${name}=`
  const value = process.argv.find(item => item.startsWith(prefix))
  return value ? value.slice(prefix.length) : ''
}

function serialize(value) {
  if (value == null) return value ?? null
  if (typeof value?.toDate === 'function') return { __type: 'timestamp', value: value.toDate().toISOString() }
  if (Array.isArray(value)) return value.map(serialize)
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, serialize(nested)]))
  return value
}

function hashText(value) {
  return createHash('sha256').update(value).digest('hex')
}

function hashValue(value) {
  return hashText(JSON.stringify(serialize(value)))
}

function initializeAdmin() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID })
  }
}

async function readTargets(db, transaction = null) {
  const references = [db.doc(VEHICLE_PATH), db.doc(RUNTIME_PATH)]
  const snapshots = transaction
    ? await transaction.getAll(...references)
    : await db.getAll(...references)
  const entries = snapshots.map(snapshot => ({
    path: snapshot.ref.path,
    exists: snapshot.exists,
    data: snapshot.exists ? snapshot.data() : null
  }))
  return Object.fromEntries(entries.map(entry => [entry.path, entry]))
}

function validateTargets(targets, { requireMissing = false } = {}) {
  const vehicle = targets[VEHICLE_PATH]
  const runtime = targets[RUNTIME_PATH]
  if (!vehicle?.exists || !runtime?.exists) throw new Error('Both exact fleet records must exist.')
  if (String(vehicle.data?.locationId || '').trim().toLowerCase() !== EXPECTED_LOCATION_ID) {
    throw new Error('The vehicle no longer belongs to the expected Lone Mountain location.')
  }
  if (String(runtime.data?.vehicleId || '').trim() !== VEHICLE_ID) {
    throw new Error('The runtime record no longer points to the expected vehicle.')
  }
  for (const entry of [vehicle, runtime]) {
    const current = String(entry.data?.mainLocation || '').trim().toUpperCase()
    if (requireMissing && current) throw new Error(`${entry.path} already has mainLocation=${current}; refusing to overwrite it.`)
    if (!requireMissing && current !== TARGET_MAIN_LOCATION) {
      throw new Error(`${entry.path} does not have the expected ${TARGET_MAIN_LOCATION} metadata.`)
    }
  }
}

function createBackup(targets, backupDir) {
  if (!backupDir || !isAbsolute(backupDir)) throw new Error('Use an absolute --backup-dir path.')
  const resolvedDir = resolve(backupDir)
  mkdirSync(resolvedDir, { recursive: true })
  const capturedAt = new Date().toISOString()
  const backup = {
    purpose: 'Rollback snapshot before adding strict operations location metadata',
    projectId: PROJECT_ID,
    capturedAt,
    targetMainLocation: TARGET_MAIN_LOCATION,
    documents: Object.fromEntries(Object.entries(targets).map(([path, entry]) => [path, {
      exists: entry.exists,
      data: serialize(entry.data)
    }]))
  }
  const contents = `${JSON.stringify(backup, null, 2)}\n`
  const path = join(resolvedDir, `sprc-operations-metadata-${capturedAt.replace(/[:.]/g, '-')}.json`)
  writeFileSync(path, contents, { encoding: 'utf8', flag: 'wx' })
  return { path, sha256: hashText(contents) }
}

function readVerifiedBackup(path, expectedSha256) {
  if (!path || !isAbsolute(path) || !existsSync(path)) throw new Error('Use the exact absolute --backup path from preview.')
  const contents = readFileSync(path, 'utf8')
  if (!expectedSha256 || hashText(contents) !== expectedSha256) throw new Error('The backup checksum does not match --backup-sha256.')
  const backup = JSON.parse(contents)
  if (backup.projectId !== PROJECT_ID
    || backup.targetMainLocation !== TARGET_MAIN_LOCATION
    || !backup.documents?.[VEHICLE_PATH]?.exists
    || !backup.documents?.[RUNTIME_PATH]?.exists) {
    throw new Error('The backup does not match this exact production metadata migration.')
  }
  return backup
}

async function preview(db) {
  const targets = await readTargets(db)
  validateTargets(targets, { requireMissing: true })
  const backup = createBackup(targets, argument('backup-dir'))
  return {
    mode: 'preview',
    projectId: PROJECT_ID,
    changes: [VEHICLE_PATH, RUNTIME_PATH].map(path => ({ path, mainLocation: TARGET_MAIN_LOCATION })),
    backup
  }
}

async function apply(db) {
  if (argument('confirm') !== CONFIRM_PHRASE) throw new Error(`Use --confirm="${CONFIRM_PHRASE}".`)
  const backup = readVerifiedBackup(argument('backup'), argument('backup-sha256'))
  await db.runTransaction(async transaction => {
    const current = await readTargets(db, transaction)
    validateTargets(current, { requireMissing: true })
    for (const path of [VEHICLE_PATH, RUNTIME_PATH]) {
      if (hashValue(current[path].data) !== hashValue(backup.documents[path].data)) {
        throw new Error(`${path} changed after preview; run preview again.`)
      }
      transaction.update(db.doc(path), { mainLocation: TARGET_MAIN_LOCATION })
    }
  })
  return verify(db, 'apply')
}

async function verify(db, mode = 'verify') {
  const targets = await readTargets(db)
  validateTargets(targets)
  return {
    mode,
    projectId: PROJECT_ID,
    verified: [VEHICLE_PATH, RUNTIME_PATH].map(path => ({
      path,
      mainLocation: String(targets[path].data.mainLocation).trim().toUpperCase()
    }))
  }
}

async function main() {
  const mode = argument('mode') || 'preview'
  initializeAdmin()
  const db = admin.firestore()
  let result
  if (mode === 'preview') result = await preview(db)
  else if (mode === 'apply') result = await apply(db)
  else if (mode === 'verify') result = await verify(db)
  else throw new Error('Use --mode=preview, --mode=apply, or --mode=verify.')
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
