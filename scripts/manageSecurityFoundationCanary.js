/* global process */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import admin from 'firebase-admin'

const PROJECT_ID = 'sprc-tx-l'
const RELEASE_ID = 'security-foundation-test-house-v1'
const ACTIVATE_PHRASE = 'ACTIVATE TEST HOUSE SECURITY CANARY'
const ROLLBACK_PHRASE = 'ROLL BACK TEST HOUSE SECURITY CANARY'
const CANARY_PROFILE_IDS = ['test_supervisor', 'test_bht_shift_1', 'test_bht_shift_2']
const CONFIG_PATHS = ['appSettings/securityFoundation', 'appSettings/securityWorkflows']
const repoRoot = resolve(new URL('..', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, value => value.slice(1)))

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

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function initializeAdmin() {
  if (admin.apps.length) return
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID })
}

async function captureConfig(db) {
  const snapshots = await Promise.all(CONFIG_PATHS.map(path => db.doc(path).get()))
  return Object.fromEntries(snapshots.map((snapshot, index) => [CONFIG_PATHS[index], {
    exists: snapshot.exists,
    data: snapshot.exists ? serialize(snapshot.data()) : null
  }]))
}

async function validateProfiles(db) {
  const snapshots = await Promise.all(CANARY_PROFILE_IDS.map(profileId => db.doc(`users/${profileId}`).get()))
  return snapshots.map((snapshot, index) => {
    const profileId = CANARY_PROFILE_IDS[index]
    const data = snapshot.data() || {}
    const valid = snapshot.exists && data.active === true && data.deleted !== true
      && ['bht', 'tech', 'supervisor'].includes(String(data.role || '').toLowerCase())
      && (data.role === 'supervisor' || String(data.locationId || '') === 'test_house')
    return { profileId, name: String(data.name || ''), role: String(data.role || ''), valid }
  })
}

function backupDirectory(requested) {
  const directory = resolve(requested || '')
  if (!requested || !isAbsolute(directory)) throw new Error('Use an absolute --backup-dir outside the repository.')
  const inside = relative(repoRoot, directory)
  if (inside === '' || (!inside.startsWith('..') && !isAbsolute(inside))) {
    throw new Error('The rollback backup must be outside the repository.')
  }
  return directory
}

function createBackup(config, requestedDirectory) {
  const directory = backupDirectory(requestedDirectory)
  mkdirSync(directory, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const path = resolve(directory, `sprc-security-canary-${stamp}.json`)
  const payload = {
    purpose: 'Rollback snapshot before the first SPRC security-foundation production canary',
    projectId: PROJECT_ID,
    releaseId: RELEASE_ID,
    capturedAt: new Date().toISOString(),
    config
  }
  const contents = JSON.stringify(payload, null, 2)
  writeFileSync(path, contents, 'utf8')
  const readBack = readFileSync(path, 'utf8')
  if (hash(JSON.parse(readBack)) !== hash(payload)) throw new Error('Rollback backup verification failed.')
  return { path, sha256: createHash('sha256').update(readBack).digest('hex') }
}

function readBackup(path) {
  if (!path || !existsSync(path)) throw new Error('A verified --backup file is required.')
  const backup = JSON.parse(readFileSync(path, 'utf8'))
  if (backup.projectId !== PROJECT_ID || backup.releaseId !== RELEASE_ID || !backup.config) {
    throw new Error('The rollback backup does not match this project and release.')
  }
  return backup
}

function activationPayloads(now) {
  return {
    'appSettings/securityFoundation': {
      schemaVersion: 2,
      serverPinLoginEnabled: true,
      clientBootstrapVersion: 3,
      clientBootstrapEnabled: true,
      protectedAccountActionsVersion: 4,
      protectedAccountActionsEnabled: true,
      offlineReplayVersion: 5,
      offlineReplayEnabled: true,
      rolloutState: 'production_canary',
      enabledProfileIds: CANARY_PROFILE_IDS,
      releaseId: RELEASE_ID,
      updatedAt: now
    },
    'appSettings/securityWorkflows': {
      schemaVersion: 6,
      enabled: true,
      workflows: ['identity_users'],
      rolloutState: 'production_canary',
      enabledProfileIds: CANARY_PROFILE_IDS,
      releaseId: RELEASE_ID,
      updatedAt: now
    }
  }
}

async function activate(db, backup, profiles) {
  if (argument('confirm') !== ACTIVATE_PHRASE) throw new Error(`Use --confirm="${ACTIVATE_PHRASE}".`)
  if (argument('expected-release') !== RELEASE_ID) throw new Error(`Use --expected-release=${RELEASE_ID}.`)
  if (profiles.some(profile => !profile.valid)) throw new Error('One or more synthetic canary profiles are not ready.')
  const current = await captureConfig(db)
  if (hash(current) !== hash(backup.config)) throw new Error('Protected configuration changed after preview. Run preview again.')
  if (CONFIG_PATHS.some(path => current[path].exists)) throw new Error('First-canary activation requires both protected settings to be absent.')

  const now = admin.firestore.FieldValue.serverTimestamp()
  const payloads = activationPayloads(now)
  const batch = db.batch()
  CONFIG_PATHS.forEach(path => batch.create(db.doc(path), payloads[path]))
  batch.create(db.doc(`securityWorkflowAudit/${RELEASE_ID}_activated`), {
    action: 'security_canary_activated',
    releaseId: RELEASE_ID,
    profileIds: CANARY_PROFILE_IDS,
    workflows: ['identity_users'],
    createdAt: now,
    immutable: true
  })
  await batch.commit()
}

async function rollback(db, auth, backup) {
  if (argument('confirm') !== ROLLBACK_PHRASE) throw new Error(`Use --confirm="${ROLLBACK_PHRASE}".`)
  if (argument('expected-release') !== RELEASE_ID) throw new Error(`Use --expected-release=${RELEASE_ID}.`)
  const current = await captureConfig(db)
  if (CONFIG_PATHS.some(path => current[path].data?.releaseId !== RELEASE_ID)) {
    throw new Error('Current protected settings do not match this canary release.')
  }

  await db.doc('appSettings/securityFoundation').set({ serverPinLoginEnabled: false, clientBootstrapEnabled: false, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
  const sessions = await db.collection('staffSessions').where('profileId', 'in', CANARY_PROFILE_IDS).get()
  const now = admin.firestore.FieldValue.serverTimestamp()
  const batch = db.batch()
  sessions.docs.forEach(snapshot => batch.set(snapshot.ref, { active: false, revokedAt: now, revocationReason: 'security_canary_rollback', updatedAt: now }, { merge: true }))
  for (const path of CONFIG_PATHS) {
    if (backup.config[path]?.exists) throw new Error('This first-release rollback supports only the verified absent baseline.')
    batch.delete(db.doc(path))
  }
  batch.create(db.doc(`securityWorkflowAudit/${RELEASE_ID}_rolled_back`), {
    action: 'security_canary_rolled_back', releaseId: RELEASE_ID,
    profileIds: CANARY_PROFILE_IDS, revokedSessionCount: sessions.size,
    createdAt: now, immutable: true
  })
  await batch.commit()

  const mappings = await Promise.all(CANARY_PROFILE_IDS.map(profileId => db.doc(`staffAuthIdentities/${profileId}`).get()))
  for (const mapping of mappings) {
    const authUid = mapping.data()?.authUid
    if (authUid) await auth.revokeRefreshTokens(authUid)
  }
}

async function main() {
  if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('This guarded command cannot target an emulator.')
  if (argument('project') !== PROJECT_ID) throw new Error(`Use --project=${PROJECT_ID}.`)
  initializeAdmin()
  const db = admin.firestore()
  const auth = admin.auth()
  const mode = argument('mode') || 'preview'
  const profiles = await validateProfiles(db)
  const config = await captureConfig(db)

  if (mode === 'preview') {
    const backup = createBackup(config, argument('backup-dir'))
    console.log(JSON.stringify({ mode, projectId: PROJECT_ID, releaseId: RELEASE_ID, canaryProfiles: profiles, currentConfig: config, backup }, null, 2))
    return
  }

  const backup = readBackup(argument('backup'))
  if (mode === 'activate') await activate(db, backup, profiles)
  else if (mode === 'rollback') await rollback(db, auth, backup)
  else throw new Error('Use --mode=preview, --mode=activate, or --mode=rollback.')

  console.log(JSON.stringify({ mode, projectId: PROJECT_ID, releaseId: RELEASE_ID, verifiedConfig: await captureConfig(db) }, null, 2))
}

main().catch(error => {
  console.error(error?.stack || error?.message || error)
  process.exitCode = 1
})
