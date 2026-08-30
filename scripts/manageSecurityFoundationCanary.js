/* global process */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import admin from 'firebase-admin'
import {
  OPERATIONS_ADMIN_DATA_COLLECTIONS,
  configuredCanaryStage,
  evaluateOperationsAdminDataReadiness,
  planCanaryStageAdvance,
  validateCanaryStageBackup
} from './securityCanaryStageModel.js'
import { summarizeAppCheckObservation } from './appCheckObservationModel.js'
import { summarizeIdentityCanaryEvidence } from './securityCanaryEvidenceModel.js'

const PROJECT_ID = 'sprc-tx-l'
const RELEASE_ID = 'security-foundation-test-house-v1'
const ACTIVATE_PHRASE = 'ACTIVATE TEST HOUSE SECURITY CANARY'
const ROLLBACK_PHRASE = 'ROLL BACK TEST HOUSE SECURITY CANARY'
const CANARY_PROFILE_IDS = ['test_supervisor', 'test_bht_shift_1', 'test_bht_shift_2']
const CONFIG_PATHS = ['appSettings/securityFoundation', 'appSettings/securityWorkflows']
const APP_CHECK_AUDIT_COLLECTIONS = Object.freeze({
  login: 'securityLoginAudit',
  accountAccess: 'securityAccountAudit',
  offlineReplay: 'securityOfflineReplayAudit',
  workflow: 'securityWorkflowAudit'
})
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

function deserialize(value) {
  if (Array.isArray(value)) return value.map(deserialize)
  if (value && typeof value === 'object') {
    if (value.__type === 'timestamp' && typeof value.value === 'string') {
      return admin.firestore.Timestamp.fromDate(new Date(value.value))
    }
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, deserialize(nested)]))
  }
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
    return {
      profileId,
      name: String(data.name || ''),
      role: String(data.role || ''),
      securityVersion: Number(data.securityVersion || 0),
      valid
    }
  })
}

async function inspectOperationsAdminDataReadiness(db) {
  const snapshots = await Promise.all(
    OPERATIONS_ADMIN_DATA_COLLECTIONS.map(collectionName => db.collection(collectionName).get())
  )
  const documentsByCollection = Object.fromEntries(snapshots.map((snapshot, index) => [
    OPERATIONS_ADMIN_DATA_COLLECTIONS[index],
    snapshot.docs.map(document => ({ data: document.data() }))
  ]))
  return evaluateOperationsAdminDataReadiness(documentsByCollection)
}

async function requireOperationsAdminDataReadiness(db, targetStage) {
  if (!['operations_admin', 'settings'].includes(targetStage)) return null
  const readiness = await inspectOperationsAdminDataReadiness(db)
  if (!readiness.ready) {
    const failures = readiness.collections
      .filter(result => result.invalidCount > 0)
      .map(result => `${result.collection}:${result.invalidCount}`)
      .join(', ')
    throw new Error(`Operations data is not ready for strict location-scoped queries (${failures}). Correct it through a separately approved, backed-up data migration before advancing.`)
  }
  return readiness
}

function observationHours() {
  const raw = argument('hours') || '24'
  if (!/^\d{1,3}$/.test(raw)) throw new Error('Use --hours=<1-168>.')
  const hours = Number(raw)
  if (hours < 1 || hours > 168) throw new Error('Use --hours=<1-168>.')
  return hours
}

function appCheckEnforcementEnabled(config = {}) {
  return config.enforcementEnabled === true
    || config.enforceAppCheck === true
    || config.enforced === true
}

async function observeAppCheck(db, config) {
  validateActiveCanaryScope(config)
  const hours = observationHours()
  const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - (hours * 60 * 60 * 1000))
  const appCheckSnapshot = await db.doc('appSettings/appCheckMonitoring').get()
  const appCheckConfig = appCheckSnapshot.data() || {}
  const enforcementEnabled = appCheckEnforcementEnabled(appCheckConfig)
  if (enforcementEnabled) {
    throw new Error('App Check enforcement is active. Monitoring-only observation refuses to continue.')
  }
  const entries = await Promise.all(Object.entries(APP_CHECK_AUDIT_COLLECTIONS).map(async ([key, collectionName]) => {
    const snapshot = await db.collection(collectionName)
      .where('createdAt', '>=', cutoff)
      .limit(500)
      .get()
    return [key, snapshot.docs.map(document => document.data() || {})]
  }))
  const evidence = summarizeAppCheckObservation({
    ...Object.fromEntries(entries),
    enforcementEnabled
  })
  return {
    windowHours: hours,
    cutoffIso: cutoff.toDate().toISOString(),
    appCheckConfigPresent: appCheckSnapshot.exists,
    monitoringVersion: Number(appCheckConfig.version || appCheckConfig.schemaVersion || 0),
    enforcementEnabled,
    evidence
  }
}

async function identityStatus(db, config) {
  validateActiveCanaryScope(config)
  const profiles = await validateProfiles(db)
  const [sessionSnapshot, ...mappingSnapshots] = await Promise.all([
    db.collection('staffSessions').where('profileId', 'in', CANARY_PROFILE_IDS).get(),
    ...CANARY_PROFILE_IDS.map(profileId => db.doc(`staffAuthIdentities/${profileId}`).get())
  ])
  const backupPath = argument('backup')
  const backupSha256 = argument('backup-sha256')
  if (!backupPath || !backupSha256) {
    throw new Error('Identity status requires the verified --backup path and --backup-sha256 rollback anchor.')
  }
  const backup = readBackup(backupPath, { expectedSha256: backupSha256 })
  const summary = summarizeIdentityCanaryEvidence({
    expectedProfileIds: CANARY_PROFILE_IDS,
    foundationConfig: config['appSettings/securityFoundation'].data,
    workflowConfig: config['appSettings/securityWorkflows'].data,
    profiles,
    mappings: mappingSnapshots.map((snapshot, index) => ({
      profileId: CANARY_PROFILE_IDS[index],
      exists: snapshot.exists
    })),
    sessions: sessionSnapshot.docs.map(snapshot => ({
      profileId: String(snapshot.data()?.profileId || ''),
      active: snapshot.data()?.active === true
    })),
    rollbackAnchorVerified: true,
    rollbackAnchorMatchesCurrent: hash(config) === hash(backup.config)
  })
  return {
    releaseId: RELEASE_ID,
    configuredStage: configuredCanaryStage(config['appSettings/securityWorkflows'].data),
    summary
  }
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

function createBackup(config, requestedDirectory, details = {}) {
  const directory = backupDirectory(requestedDirectory)
  mkdirSync(directory, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const path = resolve(directory, `sprc-security-canary-${stamp}.json`)
  const payload = {
    purpose: details.purpose || 'Rollback snapshot before the first SPRC security-foundation production canary',
    projectId: PROJECT_ID,
    releaseId: RELEASE_ID,
    capturedAt: new Date().toISOString(),
    config,
    ...details
  }
  const contents = JSON.stringify(payload, null, 2)
  writeFileSync(path, contents, 'utf8')
  const readBack = readFileSync(path, 'utf8')
  if (hash(JSON.parse(readBack)) !== hash(payload)) throw new Error('Rollback backup verification failed.')
  return { path, sha256: createHash('sha256').update(readBack).digest('hex') }
}

function hasExactCanaryProfiles(config) {
  const configured = Array.isArray(config?.enabledProfileIds) ? [...config.enabledProfileIds].sort() : []
  return hash(configured) === hash([...CANARY_PROFILE_IDS].sort())
}

function validateActiveCanaryScope(config) {
  if (CONFIG_PATHS.some(path => !config[path]?.exists || !hasExactCanaryProfiles(config[path]?.data))) {
    throw new Error('Current protected settings do not contain the exact approved three-profile canary scope.')
  }
}

function stageAdvancePhrase(targetStage) {
  return `ADVANCE TEST HOUSE SECURITY CANARY TO ${targetStage}`
}

function stageRollbackPhrase(targetStage) {
  return `ROLL BACK TEST HOUSE SECURITY CANARY FROM ${targetStage}`
}

async function closeCanarySessions(db, batch, now, reason) {
  const sessions = await db.collection('staffSessions').where('profileId', 'in', CANARY_PROFILE_IDS).get()
  const activeSessions = sessions.docs.filter(snapshot => snapshot.data()?.active === true)
  activeSessions.forEach(snapshot => batch.set(snapshot.ref, {
    active: false,
    revokedAt: now,
    revocationReason: reason,
    updatedAt: now
  }, { merge: true }))
  return activeSessions.length
}

async function revokeCanaryRefreshTokens(db, auth, action) {
  const mappings = await Promise.all(CANARY_PROFILE_IDS.map(profileId => db.doc(`staffAuthIdentities/${profileId}`).get()))
  const failures = []
  for (let index = 0; index < mappings.length; index += 1) {
    const authUid = mappings[index].data()?.authUid
    if (!authUid) continue
    let finalError = null
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await auth.revokeRefreshTokens(authUid)
        finalError = null
        break
      } catch (error) {
        finalError = error
      }
    }
    if (finalError) {
      failures.push({
        profileId: CANARY_PROFILE_IDS[index],
        code: String(finalError?.code || 'unknown'),
        attempts: 3
      })
    }
  }
  if (failures.length) {
    await db.collection('securityWorkflowAudit').add({
      action: `${action}_refresh_token_failures`,
      releaseId: RELEASE_ID,
      failures,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      immutable: true
    })
    throw new Error(`Refresh-token revocation failed for ${failures.length} canary profile(s); audit evidence was recorded.`)
  }
}

async function previewStage(db, config, profiles) {
  if (profiles.some(profile => !profile.valid)) throw new Error('One or more synthetic canary profiles are not ready.')
  validateActiveCanaryScope(config)
  const targetStage = argument('stage')
  const plan = planCanaryStageAdvance({
    foundationConfig: config['appSettings/securityFoundation'].data,
    workflowConfig: config['appSettings/securityWorkflows'].data,
    targetStage,
    releaseId: RELEASE_ID
  })
  const dataReadiness = await requireOperationsAdminDataReadiness(db, targetStage)
  const backup = createBackup(config, argument('backup-dir'), {
    purpose: `Rollback snapshot before advancing the SPRC security canary to ${targetStage}`,
    previousStage: plan.currentStage,
    targetStage
  })
  return { plan, dataReadiness, backup }
}

async function advanceStage(db, auth, backup, profiles) {
  const targetStage = argument('stage')
  validateCanaryStageBackup(backup, { projectId: PROJECT_ID, releaseId: RELEASE_ID, targetStage })
  if (argument('confirm') !== stageAdvancePhrase(targetStage)) {
    throw new Error(`Use --confirm="${stageAdvancePhrase(targetStage)}".`)
  }
  if (argument('expected-release') !== RELEASE_ID) throw new Error(`Use --expected-release=${RELEASE_ID}.`)
  if (profiles.some(profile => !profile.valid)) throw new Error('One or more synthetic canary profiles are not ready.')

  const current = await captureConfig(db)
  validateActiveCanaryScope(current)
  if (hash(current) !== hash(backup.config)) throw new Error('Protected configuration changed after stage preview. Run stage-preview again.')
  const plan = planCanaryStageAdvance({
    foundationConfig: current['appSettings/securityFoundation'].data,
    workflowConfig: current['appSettings/securityWorkflows'].data,
    targetStage,
    releaseId: RELEASE_ID
  })
  await requireOperationsAdminDataReadiness(db, targetStage)
  if (plan.currentStage !== backup.previousStage) throw new Error('The rollback backup previous stage no longer matches current production.')

  const now = admin.firestore.FieldValue.serverTimestamp()
  const batch = db.batch()
  batch.set(db.doc('appSettings/securityWorkflows'), { workflows: plan.targetWorkflows, updatedAt: now }, { merge: true })
  if (Object.keys(plan.foundationUpdates).length) {
    batch.set(db.doc('appSettings/securityFoundation'), { ...plan.foundationUpdates, updatedAt: now }, { merge: true })
  }
  const revokedSessionCount = await closeCanarySessions(db, batch, now, `security_canary_advanced_to_${targetStage}`)
  batch.create(db.collection('securityWorkflowAudit').doc(), {
    action: 'security_canary_stage_advanced',
    releaseId: RELEASE_ID,
    previousStage: plan.currentStage,
    targetStage,
    workflows: plan.targetWorkflows,
    profileIds: CANARY_PROFILE_IDS,
    revokedSessionCount,
    createdAt: now,
    immutable: true
  })
  await batch.commit()
  await revokeCanaryRefreshTokens(db, auth, 'security_canary_stage_advanced')
}

async function rollbackStage(db, auth, backup) {
  const targetStage = argument('stage')
  validateCanaryStageBackup(backup, { projectId: PROJECT_ID, releaseId: RELEASE_ID, targetStage })
  if (argument('confirm') !== stageRollbackPhrase(targetStage)) {
    throw new Error(`Use --confirm="${stageRollbackPhrase(targetStage)}".`)
  }
  if (argument('expected-release') !== RELEASE_ID) throw new Error(`Use --expected-release=${RELEASE_ID}.`)

  const current = await captureConfig(db)
  validateActiveCanaryScope(current)
  if (configuredCanaryStage(current['appSettings/securityWorkflows'].data) !== targetStage) {
    throw new Error(`Stage rollback requires ${targetStage} to be the currently configured canary stage.`)
  }

  const now = admin.firestore.FieldValue.serverTimestamp()
  const batch = db.batch()
  for (const path of CONFIG_PATHS) {
    const saved = backup.config[path]
    if (saved?.exists) batch.set(db.doc(path), deserialize(saved.data))
    else batch.delete(db.doc(path))
  }
  const revokedSessionCount = await closeCanarySessions(db, batch, now, `security_canary_rollback_from_${targetStage}`)
  batch.create(db.collection('securityWorkflowAudit').doc(), {
    action: 'security_canary_stage_rolled_back',
    releaseId: RELEASE_ID,
    previousStage: backup.previousStage,
    targetStage,
    profileIds: CANARY_PROFILE_IDS,
    revokedSessionCount,
    createdAt: now,
    immutable: true
  })
  await batch.commit()
  await revokeCanaryRefreshTokens(db, auth, 'security_canary_stage_rolled_back')
}

function readBackup(path, { expectedSha256 = '' } = {}) {
  if (!path || !existsSync(path)) throw new Error('A verified --backup file is required.')
  const contents = readFileSync(path, 'utf8')
  const actualSha256 = createHash('sha256').update(contents).digest('hex')
  if (expectedSha256 && actualSha256 !== expectedSha256) {
    throw new Error('The rollback backup checksum does not match --backup-sha256.')
  }
  const backup = JSON.parse(contents)
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
      offlineReplayEnabled: false,
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
  batch.create(db.collection('securityWorkflowAudit').doc(), {
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
  batch.create(db.collection('securityWorkflowAudit').doc(), {
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
  const config = await captureConfig(db)

  if (mode === 'app-check-observe') {
    const observation = await observeAppCheck(db, config)
    console.log(JSON.stringify({ mode, projectId: PROJECT_ID, releaseId: RELEASE_ID, ...observation }, null, 2))
    return
  }

  if (mode === 'identity-status') {
    const status = await identityStatus(db, config)
    console.log(JSON.stringify({ mode, projectId: PROJECT_ID, ...status }, null, 2))
    return
  }

  const profiles = await validateProfiles(db)

  if (mode === 'preview') {
    const backup = createBackup(config, argument('backup-dir'))
    console.log(JSON.stringify({ mode, projectId: PROJECT_ID, releaseId: RELEASE_ID, canaryProfiles: profiles, currentConfig: config, backup }, null, 2))
    return
  }

  if (mode === 'stage-preview') {
    const result = await previewStage(db, config, profiles)
    console.log(JSON.stringify({ mode, projectId: PROJECT_ID, releaseId: RELEASE_ID, canaryProfiles: profiles, ...result }, null, 2))
    return
  }

  const stageMode = mode === 'stage-advance' || mode === 'stage-rollback'
  if (stageMode && !argument('backup-sha256')) {
    throw new Error('Stage changes require --backup-sha256 from the exact stage preview.')
  }
  const backup = readBackup(argument('backup'), {
    expectedSha256: stageMode ? argument('backup-sha256') : ''
  })
  if (mode === 'activate') await activate(db, backup, profiles)
  else if (mode === 'rollback') await rollback(db, auth, backup)
  else if (mode === 'stage-advance') await advanceStage(db, auth, backup, profiles)
  else if (mode === 'stage-rollback') await rollbackStage(db, auth, backup)
  else throw new Error('Use --mode=preview, --mode=activate, --mode=rollback, --mode=stage-preview, --mode=stage-advance, --mode=stage-rollback, --mode=app-check-observe, or --mode=identity-status.')

  console.log(JSON.stringify({ mode, projectId: PROJECT_ID, releaseId: RELEASE_ID, verifiedConfig: await captureConfig(db) }, null, 2))
}

main().catch(error => {
  console.error(error?.stack || error?.message || error)
  process.exitCode = 1
})
