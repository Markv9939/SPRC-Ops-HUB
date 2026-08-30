/* global process */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import admin from 'firebase-admin'
import { normalizeSecurityRole, validateBhtHomeLocation } from '../functions/src/securityFoundationModel.js'
import {
  evaluateStaffCohortProfiles,
  isSyntheticSecurityProfileId,
  normalizeStaffCohortProfileIds,
  planStaffCohortEnrollment,
  validateStaffRolloutBackup,
  validateStaffRolloutBoundary
} from './securityStaffRolloutModel.js'

const PROJECT_ID = 'sprc-tx-l'
const RELEASE_ID = 'security-foundation-test-house-v1'
const CONFIG_PATHS = [
  'appSettings/securityFoundation',
  'appSettings/securityWorkflows',
  'appSettings/authPolicy',
  'appSettings/appCheckMonitoring'
]
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

function argument(name) {
  const prefix = `--${name}=`
  const value = process.argv.find(item => item.startsWith(prefix))
  return value ? value.slice(prefix.length) : ''
}

function profileIdsArgument() {
  return normalizeStaffCohortProfileIds(argument('profile-ids').split(','))
}

function locationArgument() {
  const locationId = String(argument('location') || '').trim().toLowerCase()
  if (!/^[a-z0-9_]{2,64}$/.test(locationId)) throw new Error('Use --location=<exact-home-location-id>.')
  return locationId
}

function serialize(value) {
  if (value == null) return value ?? null
  if (typeof value?.toDate === 'function') return { __type: 'timestamp', value: value.toDate().toISOString() }
  if (Array.isArray(value)) return value.map(serialize)
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, serialize(nested)]))
  }
  return value
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]))
  }
  return value
}

function hash(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonicalize(value))).digest('hex')
}

function initializeAdmin() {
  if (admin.apps.length) return
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID })
}

function assertProductionTarget() {
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('This guarded command cannot target an emulator.')
  }
  if (argument('project') !== PROJECT_ID) throw new Error(`Use --project=${PROJECT_ID}.`)
}

export async function captureStaffRolloutConfig(db) {
  const snapshots = await Promise.all(CONFIG_PATHS.map(path => db.doc(path).get()))
  return Object.fromEntries(snapshots.map((snapshot, index) => [CONFIG_PATHS[index], {
    exists: snapshot.exists,
    data: snapshot.exists ? serialize(snapshot.data()) : null
  }]))
}

function configData(config, path) {
  return config[path]?.data || {}
}

function validateAppCheckBoundary(config) {
  const appCheck = configData(config, 'appSettings/appCheckMonitoring')
  if (appCheck.enforcementEnabled === true || appCheck.enforceAppCheck === true || appCheck.enforced === true) {
    throw new Error('App Check enforcement is active; the monitoring-only rollout contract no longer matches.')
  }
  return { monitoringEnabled: appCheck.monitoringEnabled === true, enforcementEnabled: false }
}

async function authUserExists(auth, authUid) {
  if (!authUid) return true
  try {
    const user = await auth.getUser(authUid)
    return user.disabled !== true
  } catch (error) {
    if (error?.code === 'auth/user-not-found') return false
    throw error
  }
}

function securityProfileState(profile = {}, credential = {}, identity = {}, reverseMapping = {}) {
  return {
    role: profile.role || '',
    active: profile.active === true,
    deleted: profile.deleted === true,
    deletedAt: serialize(profile.deletedAt || null),
    locationId: profile.locationId || '',
    site: profile.site || '',
    location: profile.location || '',
    house: profile.house || '',
    authorizedLocations: Array.isArray(profile.authorizedLocations) ? profile.authorizedLocations : [],
    issueLocationIds: Array.isArray(profile.issueLocationIds) ? profile.issueLocationIds : [],
    securityVersion: Number(profile.securityVersion || 1),
    profileAuthUid: profile.authUid || '',
    credentialActive: credential.active === true,
    credentialLookupKey: credential.lookupKey || '',
    credentialHash: credential.hash || credential.verifier || '',
    legacyPinHash: profile.pinHash || '',
    identityAuthUid: identity.authUid || '',
    reverseMappingUserId: reverseMapping.userId || ''
  }
}

export async function captureStaffRolloutProfileEvidence({ db, auth, profileIds, enrolledProfileIds }) {
  const evidenceEntries = await Promise.all(profileIds.map(async profileId => {
    const [profileSnapshot, credentialSnapshot, identitySnapshot] = await Promise.all([
      db.doc(`users/${profileId}`).get(),
      db.doc(`staffPinCredentials/${profileId}`).get(),
      db.doc(`staffAuthIdentities/${profileId}`).get()
    ])
    const profile = profileSnapshot.data() || {}
    const credential = credentialSnapshot.data() || {}
    const identity = identitySnapshot.data() || {}
    const authUid = String(identity.authUid || profile.authUid || '').trim()
    const reverseSnapshot = authUid ? await db.doc(`usersByAuthUid/${authUid}`).get() : null
    const reverseMapping = reverseSnapshot?.data() || {}

    let credentialUnique = false
    if (credentialSnapshot.exists && credential.lookupKey) {
      const duplicateSnapshot = await db.collection('staffPinCredentials').where('lookupKey', '==', credential.lookupKey).limit(3).get()
      credentialUnique = duplicateSnapshot.size === 1 && duplicateSnapshot.docs[0].id === profileId
    } else if (profile.pinHash) {
      const duplicateSnapshot = await db.collection('users').where('pinHash', '==', profile.pinHash).limit(3).get()
      credentialUnique = duplicateSnapshot.size === 1 && duplicateSnapshot.docs[0].id === profileId
    }

    const mappingValues = [profile.authUid, identity.authUid].filter(Boolean).map(String)
    const mappingConsistent = new Set(mappingValues).size <= 1
      && (!authUid || (reverseSnapshot?.exists === true && reverseMapping.userId === profileId))
      && await authUserExists(auth, authUid)
    const state = securityProfileState(profile, credential, identity, reverseMapping)
    return [profileId, {
      exists: profileSnapshot.exists,
      profile,
      serverCredentialExists: credentialSnapshot.exists,
      serverCredentialActive: credential.active === true,
      legacyPinHashPresent: Boolean(profile.pinHash),
      credentialUnique,
      identityMappingValid: mappingConsistent,
      alreadyEnrolled: enrolledProfileIds.includes(profileId),
      stateHash: hash(state),
      profileDocumentHash: hash(serialize(profile)),
      securityVersion: Number(profile.securityVersion || 1),
      authUid,
      credentialSource: credentialSnapshot.exists ? 'server_credential' : profile.pinHash ? 'legacy_pin_hash' : 'missing'
    }]
  }))
  return Object.fromEntries(evidenceEntries)
}

function publicProfileEvidence(cohort, evidenceById) {
  return cohort.profiles.map(profile => ({
    ...profile,
    securityVersion: evidenceById[profile.profileId].securityVersion,
    hasStableIdentity: Boolean(evidenceById[profile.profileId].authUid)
  }))
}

function validateCurrentBoundary(config) {
  const boundary = validateStaffRolloutBoundary({
    foundationConfig: configData(config, 'appSettings/securityFoundation'),
    workflowConfig: configData(config, 'appSettings/securityWorkflows'),
    authPolicy: configData(config, 'appSettings/authPolicy'),
    releaseId: RELEASE_ID
  })
  const appCheck = validateAppCheckBoundary(config)
  return { ...boundary, appCheck }
}

function requireExternalBackupDirectory() {
  const directory = resolve(argument('backup-dir') || '')
  if (!argument('backup-dir') || !isAbsolute(argument('backup-dir'))) {
    throw new Error('Use an absolute --backup-dir outside the repository.')
  }
  const pathFromRepo = relative(repoRoot, directory)
  if (!pathFromRepo.startsWith('..') && !isAbsolute(pathFromRepo)) {
    throw new Error('The rollout backup must be stored outside the repository.')
  }
  mkdirSync(directory, { recursive: true })
  return directory
}

function writeBackup(backup) {
  const directory = requireExternalBackupDirectory()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const path = resolve(directory, `sprc-security-staff-rollout-${backup.locationId}-${stamp}.json`)
  const contents = `${JSON.stringify(backup, null, 2)}\n`
  writeFileSync(path, contents, { encoding: 'utf8', flag: 'wx' })
  return { path, sha256: hash(contents) }
}

function readVerifiedBackup({ locationId, profileIds }) {
  const path = resolve(argument('backup') || '')
  const expectedSha256 = String(argument('backup-sha256') || '').trim().toLowerCase()
  if (!argument('backup') || !isAbsolute(argument('backup')) || !existsSync(path)) {
    throw new Error('Use the exact absolute --backup path printed by preview.')
  }
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error('Use the exact --backup-sha256 printed by preview.')
  const contents = readFileSync(path, 'utf8')
  if (hash(contents) !== expectedSha256) throw new Error('The rollout backup checksum does not match.')
  const backup = JSON.parse(contents)
  validateStaffRolloutBackup(backup, { projectId: PROJECT_ID, releaseId: RELEASE_ID, locationId, profileIds })
  return { backup, path, sha256: expectedSha256 }
}

function expectedConfirmation(action, locationId) {
  const location = locationId.toUpperCase()
  return action === 'enroll'
    ? `ENROLL ${location} BHT SECURITY COHORT`
    : `ROLL BACK ${location} BHT SECURITY COHORT`
}

function requireConfirmation(action, locationId, suppliedConfirmation = argument('confirm')) {
  const phrase = expectedConfirmation(action, locationId)
  if (suppliedConfirmation !== phrase) throw new Error(`Use --confirm="${phrase}".`)
}

async function preview({ db, auth, config, profileIds, locationId }) {
  const boundary = validateCurrentBoundary(config)
  const evidenceById = await captureStaffRolloutProfileEvidence({ db, auth, profileIds, enrolledProfileIds: boundary.currentProfileIds })
  const cohort = evaluateStaffCohortProfiles({ profileIds, profilesById: evidenceById, locationId })
  const plan = planStaffCohortEnrollment({
    foundationConfig: configData(config, 'appSettings/securityFoundation'),
    workflowConfig: configData(config, 'appSettings/securityWorkflows'),
    authPolicy: configData(config, 'appSettings/authPolicy'),
    releaseId: RELEASE_ID,
    cohort
  })
  const backup = {
    schemaVersion: 1,
    projectId: PROJECT_ID,
    releaseId: RELEASE_ID,
    createdAt: new Date().toISOString(),
    locationId,
    profileIds,
    config,
    profileState: Object.fromEntries(profileIds.map(profileId => [profileId, {
      stateHash: evidenceById[profileId].stateHash,
      profileDocumentHash: evidenceById[profileId].profileDocumentHash,
      securityVersion: evidenceById[profileId].securityVersion,
      authUid: evidenceById[profileId].authUid
    }]))
  }
  const backupFile = writeBackup(backup)
  const profileList = profileIds.join(',')
  const commonArguments = `--project=${PROJECT_ID} --location=${locationId} --profile-ids=${profileList}`
  const backupArguments = `--backup="${backupFile.path}" --backup-sha256=${backupFile.sha256}`
  return {
    mode: 'preview',
    projectId: PROJECT_ID,
    releaseId: RELEASE_ID,
    cohort: { ...cohort, profiles: publicProfileEvidence(cohort, evidenceById) },
    plan,
    appCheck: boundary.appCheck,
    backup: backupFile,
    requiredEnrollConfirmation: expectedConfirmation('enroll', locationId),
    commands: {
      status: `npm run security:staff-rollout -- --mode=status ${commonArguments}`,
      enroll: `npm run security:staff-rollout -- --mode=enroll ${commonArguments} ${backupArguments} --confirm="${expectedConfirmation('enroll', locationId)}"`,
      rollback: `npm run security:staff-rollout -- --mode=rollback ${commonArguments} ${backupArguments} --confirm="${expectedConfirmation('rollback', locationId)}"`
    }
  }
}

async function verifyProfileState({ db, auth, backup, profileIds, enrolledProfileIds, expectEnrolled }) {
  const evidenceById = await captureStaffRolloutProfileEvidence({ db, auth, profileIds, enrolledProfileIds })
  for (const profileId of profileIds) {
    if (evidenceById[profileId].stateHash !== backup.profileState?.[profileId]?.stateHash) {
      throw new Error(`Profile ${profileId} changed after preview. Run preview again.`)
    }
    if (evidenceById[profileId].alreadyEnrolled !== expectEnrolled) {
      throw new Error(`Profile ${profileId} enrollment state no longer matches this operation.`)
    }
  }
  return evidenceById
}

async function activeSessionsForProfiles(db, profileIds) {
  const snapshot = await db.collection('staffSessions').where('profileId', 'in', profileIds).get()
  return snapshot.docs.filter(document => document.data()?.active === true)
}

async function closeActiveSessions(db, profileIds, reason) {
  const sessionDocuments = await activeSessionsForProfiles(db, profileIds)
  for (let index = 0; index < sessionDocuments.length; index += 400) {
    const now = admin.firestore.Timestamp.now()
    const batch = db.batch()
    sessionDocuments.slice(index, index + 400).forEach(document => batch.set(document.ref, {
      active: false,
      revokedAt: now,
      revocationReason: reason,
      updatedAt: now
    }, { merge: true }))
    await batch.commit()
  }
  return sessionDocuments.length
}

async function revokeRefreshTokens(auth, evidenceById) {
  const failures = []
  for (const evidence of Object.values(evidenceById)) {
    if (!evidence.authUid) continue
    try {
      await auth.revokeRefreshTokens(evidence.authUid)
    } catch {
      failures.push(evidence.authUid)
    }
  }
  return failures
}

async function completeCleanup({ db, auth, auditRef, profileIds, evidenceById, reason }) {
  let revokedSessionCount = 0
  try {
    revokedSessionCount = await closeActiveSessions(db, profileIds, reason)
  } catch {
    await auditRef.set({ cleanupStatus: 'failed', cleanupFailureStage: 'session_closure' }, { merge: true })
    throw new Error('Session cleanup failed; the security-version cutoff is active and audit evidence was recorded. Retry the same command.')
  }
  const failures = await revokeRefreshTokens(auth, evidenceById)
  await auditRef.set({
    cleanupStatus: failures.length ? 'failed' : 'completed',
    cleanupFailureStage: failures.length ? 'refresh_token_revocation' : '',
    cleanupFailureCount: failures.length,
    cleanupRevokedSessionCount: revokedSessionCount,
    cleanupCompletedAt: failures.length ? null : admin.firestore.Timestamp.now()
  }, { merge: true })
  if (failures.length) {
    throw new Error(`Refresh-token cleanup failed for ${failures.length} profile(s); the security-version cutoff is active and audit evidence was recorded. Retry the same command.`)
  }
  return revokedSessionCount
}

function expectedEnrolledConfig(backup, profileIds) {
  const foundation = configData(backup.config, 'appSettings/securityFoundation')
  const workflow = configData(backup.config, 'appSettings/securityWorkflows')
  return {
    ...backup.config,
    'appSettings/securityFoundation': {
      exists: true,
      data: { ...foundation, enabledProfileIds: [...foundation.enabledProfileIds, ...profileIds] }
    },
    'appSettings/securityWorkflows': {
      exists: true,
      data: { ...workflow, enabledProfileIds: [...workflow.enabledProfileIds, ...profileIds] }
    }
  }
}

function configWithoutUpdatedAt(config) {
  return Object.fromEntries(Object.entries(config).map(([path, snapshot]) => [path, {
    ...snapshot,
    data: snapshot.data ? Object.fromEntries(Object.entries(snapshot.data).filter(([key]) => key !== 'updatedAt')) : null
  }]))
}

function sameConfig(left, right) {
  return hash(configWithoutUpdatedAt(left)) === hash(configWithoutUpdatedAt(right))
}

function sameProfileIds(left, right) {
  return [...(left || [])].map(String).sort().join('\n') === [...(right || [])].map(String).sort().join('\n')
}

function configFromSnapshots(snapshots) {
  return Object.fromEntries(snapshots.map((snapshot, index) => [CONFIG_PATHS[index], {
    exists: snapshot.exists,
    data: snapshot.exists ? serialize(snapshot.data()) : null
  }]))
}

async function resumeCompletedMutation({
  db,
  auth,
  auditSnapshot,
  auditRef,
  expectedAction,
  expectedConfig,
  profileIds,
  locationId,
  reason,
  result
}) {
  const audit = auditSnapshot.data() || {}
  if (audit.action !== expectedAction
    || audit.locationId !== locationId
    || !sameProfileIds(audit.profileIds, profileIds)) {
    throw new Error('An audit record already exists but does not match this exact rollout operation.')
  }
  const currentConfig = await captureStaffRolloutConfig(db)
  if (!sameConfig(currentConfig, expectedConfig)) {
    throw new Error('The prior rollout operation exists, but current configuration has since changed.')
  }
  const currentIds = configData(currentConfig, 'appSettings/securityFoundation').enabledProfileIds || []
  const evidenceById = await captureStaffRolloutProfileEvidence({ db, auth, profileIds, enrolledProfileIds: currentIds })
  const revokedSessionCount = await completeCleanup({ db, auth, auditRef, profileIds, evidenceById, reason })
  return { ...result, replayed: true, revokedSessionCount, cleanupStatus: 'completed' }
}

export async function applyStaffCohortEnrollment({ db, auth, backup, backupSha256, profileIds, locationId, confirmation }) {
  requireConfirmation('enroll', locationId, confirmation)
  const auditId = `staff_rollout_enroll_${backupSha256.slice(0, 32)}`
  const auditRef = db.doc(`securityWorkflowAudit/${auditId}`)
  const expectedConfig = expectedEnrolledConfig(backup, profileIds)
  const existingAudit = await auditRef.get()
  const baseResult = {
    mode: 'enroll',
    projectId: PROJECT_ID,
    releaseId: RELEASE_ID,
    locationId,
    profileIds,
    auditId,
    nextStep: 'Have only the enrolled cohort sign in with their existing PINs, then complete the documented desktop/phone, offline, role, workflow, and rollback observation gate.'
  }
  if (existingAudit.exists) {
    return resumeCompletedMutation({
      db, auth, auditSnapshot: existingAudit, auditRef,
      expectedAction: 'security_staff_cohort_enrolled', expectedConfig,
      profileIds, locationId, reason: 'staff_security_cohort_enrollment', result: baseResult
    })
  }

  const currentConfig = await captureStaffRolloutConfig(db)
  if (!sameConfig(currentConfig, backup.config)) throw new Error('Protected configuration changed after preview. Run preview again.')
  const boundary = validateCurrentBoundary(currentConfig)
  const evidenceById = await verifyProfileState({
    db, auth, backup, profileIds, enrolledProfileIds: boundary.currentProfileIds, expectEnrolled: false
  })
  const cohort = evaluateStaffCohortProfiles({ profileIds, profilesById: evidenceById, locationId })
  const plan = planStaffCohortEnrollment({
    foundationConfig: configData(currentConfig, 'appSettings/securityFoundation'),
    workflowConfig: configData(currentConfig, 'appSettings/securityWorkflows'),
    authPolicy: configData(currentConfig, 'appSettings/authPolicy'),
    releaseId: RELEASE_ID,
    cohort
  })

  await db.runTransaction(async transaction => {
    const configRefs = CONFIG_PATHS.map(path => db.doc(path))
    const profileRefs = profileIds.map(profileId => db.doc(`users/${profileId}`))
    const snapshots = await transaction.getAll(...configRefs, ...profileRefs, auditRef)
    const transactionConfig = configFromSnapshots(snapshots.slice(0, CONFIG_PATHS.length))
    if (!sameConfig(transactionConfig, backup.config)) throw new Error('Protected configuration changed during enrollment.')
    const profileSnapshots = snapshots.slice(CONFIG_PATHS.length, CONFIG_PATHS.length + profileIds.length)
    profileSnapshots.forEach((snapshot, index) => {
      const profileId = profileIds[index]
      if (!snapshot.exists || hash(serialize(snapshot.data())) !== backup.profileState[profileId].profileDocumentHash) {
        throw new Error(`Profile ${profileId} changed during enrollment. Run preview again.`)
      }
    })
    if (snapshots.at(-1).exists) throw new Error('This exact enrollment operation already exists. Retry the command.')
    const now = admin.firestore.Timestamp.now()
    transaction.set(configRefs[0], { enabledProfileIds: plan.nextEnabledProfileIds, updatedAt: now }, { merge: true })
    transaction.set(configRefs[1], { enabledProfileIds: plan.nextEnabledProfileIds, updatedAt: now }, { merge: true })
    profileRefs.forEach((ref, index) => transaction.set(ref, {
      securityVersion: Number(profileSnapshots[index].data()?.securityVersion || 1) + 1,
      updatedAt: now
    }, { merge: true }))
    transaction.create(auditRef, {
      schemaVersion: 1,
      action: 'security_staff_cohort_enrolled',
      releaseId: RELEASE_ID,
      locationId,
      roleGroup: 'bht',
      profileIds,
      previousProfileCount: boundary.currentProfileIds.length,
      nextProfileCount: plan.nextEnabledProfileIds.length,
      backupSha256,
      cleanupStatus: 'pending',
      immutable: true,
      createdAt: now
    })
  })

  const revokedSessionCount = await completeCleanup({
    db, auth, auditRef, profileIds, evidenceById, reason: 'staff_security_cohort_enrollment'
  })
  return {
    ...baseResult,
    replayed: false,
    nextEnabledProfileCount: plan.nextEnabledProfileIds.length,
    revokedSessionCount,
    cleanupStatus: 'completed'
  }
}

export async function applyStaffCohortRollback({ db, auth, backup, backupSha256, profileIds, locationId, confirmation }) {
  requireConfirmation('rollback', locationId, confirmation)
  const expectedConfig = expectedEnrolledConfig(backup, profileIds)
  const restoredIds = configData(backup.config, 'appSettings/securityFoundation').enabledProfileIds
  const auditId = `staff_rollout_rollback_${backupSha256.slice(0, 32)}`
  const auditRef = db.doc(`securityWorkflowAudit/${auditId}`)
  const baseResult = {
    mode: 'rollback',
    projectId: PROJECT_ID,
    releaseId: RELEASE_ID,
    locationId,
    profileIds,
    restoredEnabledProfileCount: restoredIds.length,
    auditId
  }
  const existingAudit = await auditRef.get()
  if (existingAudit.exists) {
    return resumeCompletedMutation({
      db, auth, auditSnapshot: existingAudit, auditRef,
      expectedAction: 'security_staff_cohort_rolled_back', expectedConfig: backup.config,
      profileIds, locationId, reason: 'staff_security_cohort_rollback', result: baseResult
    })
  }

  const currentConfig = await captureStaffRolloutConfig(db)
  validateAppCheckBoundary(currentConfig)
  if (!sameConfig(currentConfig, expectedConfig)) {
    throw new Error('Current protected configuration is not the exact enrolled state produced from this backup.')
  }
  const currentIds = configData(currentConfig, 'appSettings/securityFoundation').enabledProfileIds || []
  const evidenceById = await captureStaffRolloutProfileEvidence({ db, auth, profileIds, enrolledProfileIds: currentIds })

  await db.runTransaction(async transaction => {
    const configRefs = CONFIG_PATHS.map(path => db.doc(path))
    const profileRefs = profileIds.map(profileId => db.doc(`users/${profileId}`))
    const snapshots = await transaction.getAll(...configRefs, ...profileRefs, auditRef)
    const transactionConfig = configFromSnapshots(snapshots.slice(0, CONFIG_PATHS.length))
    if (!sameConfig(transactionConfig, expectedConfig)) throw new Error('Protected configuration changed during rollback.')
    if (snapshots.at(-1).exists) throw new Error('This exact rollback operation already exists. Retry the command.')
    const profileSnapshots = snapshots.slice(CONFIG_PATHS.length, CONFIG_PATHS.length + profileIds.length)
    if (profileSnapshots.some(snapshot => !snapshot.exists)) throw new Error('A cohort profile was removed before rollback.')
    const now = admin.firestore.Timestamp.now()
    transaction.set(configRefs[0], { enabledProfileIds: restoredIds, updatedAt: now }, { merge: true })
    transaction.set(configRefs[1], { enabledProfileIds: restoredIds, updatedAt: now }, { merge: true })
    profileRefs.forEach((ref, index) => transaction.set(ref, {
      securityVersion: Number(profileSnapshots[index].data()?.securityVersion || 1) + 1,
      updatedAt: now
    }, { merge: true }))
    transaction.create(auditRef, {
      schemaVersion: 1,
      action: 'security_staff_cohort_rolled_back',
      releaseId: RELEASE_ID,
      locationId,
      roleGroup: 'bht',
      profileIds,
      restoredProfileCount: restoredIds.length,
      backupSha256,
      cleanupStatus: 'pending',
      immutable: true,
      createdAt: now
    })
  })

  const revokedSessionCount = await completeCleanup({
    db, auth, auditRef, profileIds, evidenceById, reason: 'staff_security_cohort_rollback'
  })
  return { ...baseResult, replayed: false, revokedSessionCount, cleanupStatus: 'completed' }
}

async function status({ db, auth, config, profileIds, locationId }) {
  const boundary = validateCurrentBoundary(config)
  const evidenceById = await captureStaffRolloutProfileEvidence({ db, auth, profileIds, enrolledProfileIds: boundary.currentProfileIds })
  const sessionSnapshot = await db.collection('staffSessions').where('profileId', 'in', profileIds).get()
  return {
    mode: 'status',
    projectId: PROJECT_ID,
    releaseId: RELEASE_ID,
    locationId,
    globalStrictAuthorization: false,
    appCheck: boundary.appCheck,
    enabledProfileCount: boundary.currentProfileIds.length,
    profiles: profileIds.map(profileId => ({
      profileId,
      enrolled: evidenceById[profileId].alreadyEnrolled,
      securityVersion: evidenceById[profileId].securityVersion,
      hasStableIdentity: Boolean(evidenceById[profileId].authUid),
      activeSessionCount: sessionSnapshot.docs.filter(document => document.data()?.profileId === profileId && document.data()?.active === true).length
    }))
  }
}

async function candidates({ db, auth, config, locationId }) {
  const boundary = validateCurrentBoundary(config)
  const usersSnapshot = await db.collection('users').get()
  const profileIds = usersSnapshot.docs
    .filter(snapshot => {
      const profile = snapshot.data() || {}
      const home = validateBhtHomeLocation(profile)
      return normalizeSecurityRole(profile.role) === 'bht'
        && home.valid
        && home.homeLocationId === locationId
        && !isSyntheticSecurityProfileId(snapshot.id)
    })
    .map(snapshot => snapshot.id)
    .sort()
  if (profileIds.length === 0) {
    return { mode: 'candidates', projectId: PROJECT_ID, releaseId: RELEASE_ID, locationId, candidateCount: 0, candidates: [] }
  }
  const evidenceById = await captureStaffRolloutProfileEvidence({ db, auth, profileIds, enrolledProfileIds: boundary.currentProfileIds })
  return {
    mode: 'candidates',
    projectId: PROJECT_ID,
    releaseId: RELEASE_ID,
    locationId,
    candidateCount: profileIds.length,
    candidates: profileIds.map(profileId => {
      const evidence = evidenceById[profileId]
      const cohort = evaluateStaffCohortProfiles({ profileIds: [profileId], profilesById: { [profileId]: evidence }, locationId })
      return {
        profileId,
        name: String(evidence.profile.name || '').trim(),
        role: normalizeSecurityRole(evidence.profile.role),
        enrolled: evidence.alreadyEnrolled,
        credentialSource: evidence.credentialSource,
        ready: cohort.profiles[0].ready,
        reasons: cohort.profiles[0].reasons
      }
    })
  }
}

async function main() {
  assertProductionTarget()
  initializeAdmin()
  const db = admin.firestore()
  const auth = admin.auth()
  const mode = argument('mode') || 'preview'
  const locationId = locationArgument()
  const config = await captureStaffRolloutConfig(db)

  let result
  if (mode === 'candidates') {
    result = await candidates({ db, auth, config, locationId })
  } else {
    const profileIds = profileIdsArgument()
    if (mode === 'preview') {
    result = await preview({ db, auth, config, profileIds, locationId })
    } else if (mode === 'status') {
      result = await status({ db, auth, config, profileIds, locationId })
    } else if (mode === 'enroll' || mode === 'rollback') {
      const verified = readVerifiedBackup({ locationId, profileIds })
      result = mode === 'enroll'
        ? await applyStaffCohortEnrollment({ db, auth, ...verified, profileIds, locationId, backupSha256: verified.sha256 })
        : await applyStaffCohortRollback({ db, auth, ...verified, profileIds, locationId, backupSha256: verified.sha256 })
    } else {
      throw new Error('Use --mode=candidates, --mode=preview, --mode=status, --mode=enroll, or --mode=rollback.')
    }
  }
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch(error => {
    console.error(error?.message || error)
    process.exitCode = 1
  })
}
