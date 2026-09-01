/* global process */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import admin from 'firebase-admin'
import { inspectCompatibilityReadiness } from './inspectSecurityCompatibilityReadiness.js'
import {
  evaluateSecurityCutover,
  normalizeSecurityCutoverTarget,
  planSecurityCutover,
  securityCutoverConfirmation,
  validateSecurityCutoverBackup
} from './securityCompatibilityCutoverModel.js'

const PROJECT_ID = 'sprc-tx-l'
const CONFIG_PATHS = Object.freeze([
  'appSettings/securityFoundation',
  'appSettings/securityWorkflows',
  'appSettings/authPolicy',
  'appSettings/appCheckMonitoring'
])
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

function argument(name) {
  const prefix = `--${name}=`
  const value = process.argv.find(item => item.startsWith(prefix))
  return value ? value.slice(prefix.length) : ''
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]))
  }
  return value
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
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

function initializeAdmin() {
  if (admin.apps.length) return
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID })
}

function assertProductionTarget() {
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('This guarded production command cannot target an emulator.')
  }
  if (argument('project') !== PROJECT_ID) throw new Error(`Use --project=${PROJECT_ID}.`)
}

async function captureConfig(db) {
  const snapshots = await Promise.all(CONFIG_PATHS.map(path => db.doc(path).get()))
  return Object.fromEntries(snapshots.map((snapshot, index) => [CONFIG_PATHS[index], {
    exists: snapshot.exists,
    data: snapshot.exists ? serialize(snapshot.data()) : null
  }]))
}

function configData(config, path) {
  return config[path]?.data || {}
}

function backupDirectory(requested) {
  const directory = resolve(requested || '')
  if (!requested || !isAbsolute(requested)) throw new Error('Use an absolute --backup-dir outside the repository.')
  const inside = relative(repoRoot, directory)
  if (inside === '' || (!inside.startsWith('..') && !isAbsolute(inside))) {
    throw new Error('The rollback package must be outside the repository.')
  }
  return directory
}

function createBackup({ target, config, readiness, requestedDirectory }) {
  const directory = backupDirectory(requestedDirectory)
  mkdirSync(directory, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const path = resolve(directory, `sprc-security-${target}-${stamp}.json`)
  const payload = {
    schemaVersion: 1,
    purpose: `Rollback package before SPRC security ${target} cutover`,
    projectId: PROJECT_ID,
    target,
    capturedAt: new Date().toISOString(),
    configHash: hash(config),
    config,
    readiness: {
      activeProfileCount: readiness.activeProfileCount,
      invalidProfileCount: readiness.invalidProfileCount,
      credentialReadyCount: readiness.credentialReadyCount,
      stableIdentityCount: readiness.stableIdentityCount,
      secureLoginCoveredCount: readiness.secureLoginCoveredCount,
      secureLoginForAll: readiness.secureLoginForAll,
      appCheckObservation: readiness.appCheckObservation
    }
  }
  const contents = JSON.stringify(payload, null, 2)
  writeFileSync(path, contents, 'utf8')
  const readBack = readFileSync(path, 'utf8')
  if (hash(JSON.parse(readBack)) !== hash(payload)) throw new Error('Rollback package verification failed.')
  return { path, sha256: createHash('sha256').update(readBack).digest('hex') }
}

function readBackup({ target }) {
  const path = resolve(argument('backup') || '')
  const expectedSha256 = String(argument('backup-sha256') || '').trim().toLowerCase()
  if (!path || !existsSync(path) || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error('Use --backup=<verified absolute path> and --backup-sha256=<exact digest>.')
  }
  const contents = readFileSync(path, 'utf8')
  const actualSha256 = createHash('sha256').update(contents).digest('hex')
  if (actualSha256 !== expectedSha256) throw new Error('Rollback package checksum mismatch.')
  const backup = JSON.parse(contents)
  validateSecurityCutoverBackup(backup, {
    projectId: PROJECT_ID,
    target,
    configHash: hash(backup.config)
  })
  return { path, sha256: actualSha256, backup }
}

function evaluateBoundary({ target, config, readiness }) {
  return evaluateSecurityCutover({
    target,
    foundationConfig: configData(config, 'appSettings/securityFoundation'),
    workflowConfig: configData(config, 'appSettings/securityWorkflows'),
    authPolicy: configData(config, 'appSettings/authPolicy'),
    readiness
  })
}

async function preview({ db, auth, target }) {
  const [config, readiness] = await Promise.all([captureConfig(db), inspectCompatibilityReadiness({ db, auth })])
  const boundary = evaluateBoundary({ target, config, readiness })
  if (!boundary.ready) throw new Error(`Cutover preview blocked: ${boundary.blockers.join(', ')}.`)
  const rollback = createBackup({
    target,
    config,
    readiness,
    requestedDirectory: argument('backup-dir')
  })
  return {
    mode: 'preview',
    projectId: PROJECT_ID,
    target,
    ready: true,
    confirmation: securityCutoverConfirmation(target),
    rollback,
    accountCounts: {
      active: readiness.activeProfileCount,
      credentialsReady: readiness.credentialReadyCount,
      stableIdentities: readiness.stableIdentityCount,
      secureLoginCovered: readiness.secureLoginCoveredCount
    }
  }
}

function auditId(target, action, backupSha256) {
  return `compatibility_cutover_${hash(`${target}:${action}:${backupSha256}`).slice(0, 40)}`
}

async function applyCutover({ db, auth, target }) {
  const confirmation = argument('confirm')
  if (confirmation !== securityCutoverConfirmation(target)) throw new Error('Exact cutover confirmation phrase is required.')
  const verified = readBackup({ target })
  const auditRef = db.doc(`securityWorkflowAudit/${auditId(target, 'apply', verified.sha256)}`)
  const [config, readiness, existingAudit] = await Promise.all([
    captureConfig(db),
    inspectCompatibilityReadiness({ db, auth }),
    auditRef.get()
  ])
  if (existingAudit.exists) {
    const foundation = configData(config, 'appSettings/securityFoundation')
    const policy = configData(config, 'appSettings/authPolicy')
    const desired = target === 'all_active'
      ? foundation.rolloutState === 'active'
      : policy.authScopeEnforced === true
    if (!desired) throw new Error('Cutover audit exists but protected configuration does not match it.')
    return {
      mode: 'apply', projectId: PROJECT_ID, target, replayed: true,
      rolloutState: foundation.rolloutState,
      globalStrictAuthorization: policy.authScopeEnforced === true,
      rollback: { path: verified.path, sha256: verified.sha256 }
    }
  }
  if (hash(config) !== verified.backup.configHash) throw new Error('Protected configuration drifted after preview. Create a fresh rollback package.')
  const boundary = evaluateBoundary({ target, config, readiness })
  if (!boundary.ready) throw new Error(`Cutover apply blocked: ${boundary.blockers.join(', ')}.`)
  const plan = planSecurityCutover({
    target,
    foundationConfig: configData(config, 'appSettings/securityFoundation'),
    authPolicy: configData(config, 'appSettings/authPolicy')
  })
  const now = admin.firestore.Timestamp.now()
  const transactionResult = await db.runTransaction(async transaction => {
    const refs = CONFIG_PATHS.map(path => db.doc(path))
    const snapshots = await transaction.getAll(...refs, auditRef)
    const currentConfig = Object.fromEntries(refs.map((ref, index) => [CONFIG_PATHS[index], {
      exists: snapshots[index].exists,
      data: snapshots[index].exists ? serialize(snapshots[index].data()) : null
    }]))
    if (snapshots.at(-1).exists) return { replayed: true }
    if (hash(currentConfig) !== verified.backup.configHash) throw new Error('Protected configuration changed during cutover.')
    if (plan.foundationPatch) transaction.set(refs[0], { ...plan.foundationPatch, updatedAt: now }, { merge: true })
    if (plan.authPolicyPatch) transaction.set(refs[2], { ...plan.authPolicyPatch, updatedAt: now }, { merge: true })
    transaction.create(auditRef, {
      action: target === 'all_active' ? 'all_active_secure_login_activated' : 'strict_authorization_enabled',
      target,
      backupSha256: verified.sha256,
      previousConfigHash: verified.backup.configHash,
      activeProfileCount: readiness.activeProfileCount,
      stableIdentityCount: readiness.stableIdentityCount,
      appCheckValidSampleCount: readiness.appCheckObservation.validSamples,
      createdAt: now
    })
    return { replayed: false }
  })
  const after = await captureConfig(db)
  const foundation = configData(after, 'appSettings/securityFoundation')
  const policy = configData(after, 'appSettings/authPolicy')
  if (target === 'all_active' && foundation.rolloutState !== 'active') throw new Error('All-active cutover readback failed.')
  if (target === 'strict_authorization' && policy.authScopeEnforced !== true) throw new Error('Strict-authorization cutover readback failed.')
  return {
    mode: 'apply', projectId: PROJECT_ID, target, replayed: transactionResult.replayed,
    rolloutState: foundation.rolloutState,
    globalStrictAuthorization: policy.authScopeEnforced === true,
    rollback: { path: verified.path, sha256: verified.sha256 }
  }
}

async function activeRollbackSubjects(db, backup) {
  const allowed = new Set(configData(backup.config, 'appSettings/securityFoundation').enabledProfileIds || [])
  const usersSnapshot = await db.collection('users').get()
  const profileIds = usersSnapshot.docs
    .filter(snapshot => {
      const profile = snapshot.data() || {}
      return profile.active === true && profile.deleted !== true && !profile.deletedAt && !allowed.has(snapshot.id)
    })
    .map(snapshot => snapshot.id)
  const sessionsSnapshot = await db.collection('staffSessions').where('active', '==', true).get()
  const sessions = sessionsSnapshot.docs.filter(snapshot => profileIds.includes(String(snapshot.data()?.profileId || '')))
  if (sessions.length > 400) throw new Error('Rollback would close more than 400 sessions; stop for reviewed batching.')
  const identitySnapshots = await Promise.all(profileIds.map(profileId => db.doc(`staffAuthIdentities/${profileId}`).get()))
  const authUids = [...new Set(identitySnapshots.map(snapshot => String(snapshot.data()?.authUid || '').trim()).filter(Boolean))]
  return { sessions, authUids }
}

async function revokeRollbackRefreshTokens(auth, authUids, auditRef) {
  let failureCount = 0
  for (const authUid of authUids) {
    try {
      await auth.revokeRefreshTokens(authUid)
    } catch {
      failureCount += 1
    }
  }
  await auditRef.set({
    cleanupStatus: failureCount === 0 ? 'complete' : 'complete_with_auth_failures',
    refreshTokenRevocationCount: authUids.length - failureCount,
    refreshTokenRevocationFailureCount: failureCount,
    cleanupUpdatedAt: admin.firestore.Timestamp.now()
  }, { merge: true })
  return failureCount
}

async function rollbackCutover({ db, auth, target }) {
  const confirmation = argument('confirm')
  if (confirmation !== securityCutoverConfirmation(target, 'rollback')) throw new Error('Exact rollback confirmation phrase is required.')
  const verified = readBackup({ target })
  const auditRef = db.doc(`securityWorkflowAudit/${auditId(target, 'rollback', verified.sha256)}`)
  const [current, existingAudit] = await Promise.all([captureConfig(db), auditRef.get()])
  if (existingAudit.exists) {
    if (hash(current) !== verified.backup.configHash) {
      throw new Error('Rollback audit exists but protected configuration does not match the verified package.')
    }
    const retrySubjects = target === 'all_active'
      ? await activeRollbackSubjects(db, verified.backup)
      : { sessions: [], authUids: [] }
    const retryFailureCount = target === 'all_active'
      ? await revokeRollbackRefreshTokens(auth, retrySubjects.authUids, auditRef)
      : 0
    return {
      mode: 'rollback', projectId: PROJECT_ID, target, replayed: true,
      closedSessionCount: Number(existingAudit.data()?.closedSessionCount || 0),
      refreshTokenRevocationFailureCount: retryFailureCount,
      rollbackVerified: true
    }
  }
  const foundation = configData(current, 'appSettings/securityFoundation')
  const policy = configData(current, 'appSettings/authPolicy')
  if (target === 'all_active' && (foundation.rolloutState !== 'active' || policy.authScopeEnforced === true)) {
    throw new Error('All-active rollback requires active rollout with strict authorization still off.')
  }
  if (target === 'strict_authorization' && policy.authScopeEnforced !== true) {
    throw new Error('Strict-authorization rollback requires strict authorization to be enabled.')
  }

  const subjects = target === 'all_active'
    ? await activeRollbackSubjects(db, verified.backup)
    : { sessions: [], authUids: [] }
  const now = admin.firestore.Timestamp.now()
  const targetPath = target === 'all_active' ? 'appSettings/securityFoundation' : 'appSettings/authPolicy'
  const targetRef = db.doc(targetPath)
  const backupEntry = verified.backup.config[targetPath]
  const result = await db.runTransaction(async transaction => {
    const [targetSnapshot, auditSnapshot] = await transaction.getAll(targetRef, auditRef)
    if (auditSnapshot.exists) return { replayed: true }
    if (!targetSnapshot.exists) throw new Error('The protected cutover setting is missing.')
    if (backupEntry.exists) transaction.set(targetRef, deserialize(backupEntry.data))
    else transaction.delete(targetRef)
    for (const session of subjects.sessions) {
      transaction.set(session.ref, {
        active: false,
        revokedAt: now,
        revocationReason: 'all_active_secure_login_rollback',
        updatedAt: now
      }, { merge: true })
    }
    transaction.create(auditRef, {
      action: target === 'all_active' ? 'all_active_secure_login_rolled_back' : 'strict_authorization_rolled_back',
      target,
      backupSha256: verified.sha256,
      restoredConfigHash: verified.backup.configHash,
      closedSessionCount: subjects.sessions.length,
      cleanupStatus: subjects.authUids.length > 0 ? 'pending' : 'complete',
      createdAt: now
    })
    return { replayed: false }
  })
  const refreshTokenRevocationFailureCount = target === 'all_active'
    ? await revokeRollbackRefreshTokens(auth, subjects.authUids, auditRef)
    : 0
  const after = await captureConfig(db)
  if (hash(after) !== verified.backup.configHash) throw new Error('Rollback configuration readback did not match the verified package.')
  return {
    mode: 'rollback', projectId: PROJECT_ID, target, replayed: result.replayed,
    closedSessionCount: subjects.sessions.length,
    refreshTokenRevocationFailureCount,
    rollbackVerified: true
  }
}

async function main() {
  assertProductionTarget()
  initializeAdmin()
  const db = admin.firestore()
  const auth = admin.auth()
  const mode = String(argument('mode') || 'status').trim().toLowerCase()
  if (mode === 'status') {
    console.log(JSON.stringify(await inspectCompatibilityReadiness({ db, auth }), null, 2))
    return
  }
  const target = normalizeSecurityCutoverTarget(argument('target'))
  let result
  if (mode === 'preview') result = await preview({ db, auth, target })
  else if (mode === 'apply') result = await applyCutover({ db, auth, target })
  else if (mode === 'rollback') result = await rollbackCutover({ db, auth, target })
  else throw new Error('Use mode status, preview, apply, or rollback.')
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch(error => {
    console.error(error?.message || error)
    process.exitCode = 1
  })
}
