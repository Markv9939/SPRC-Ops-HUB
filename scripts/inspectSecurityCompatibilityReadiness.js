/* global process */
import admin from 'firebase-admin'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeSecurityRole, validateBhtHomeLocation } from '../functions/src/securityFoundationModel.js'
import {
  SECURITY_WORKFLOWS,
  compatibilityRetirementReady,
  validateWorkflowRollout
} from '../functions/src/workflowSecurityModel.js'
import { summarizeAppCheckObservation } from './appCheckObservationModel.js'
import { isSyntheticSecurityProfileId } from './securityStaffRolloutModel.js'

const PROJECT_ID = 'sprc-tx-l'
const ALLOWED_ROLES = new Set(['bht', 'supervisor', 'admin'])
const APP_CHECK_OBSERVATION_HOURS = 168
const APP_CHECK_AUDIT_COLLECTIONS = Object.freeze({
  login: 'securityLoginAudit',
  accountAccess: 'securityAccountAudit',
  offlineReplay: 'securityOfflineReplayAudit',
  workflow: 'securityWorkflowAudit'
})

function argument(name) {
  const prefix = `--${name}=`
  const value = process.argv.find(item => item.startsWith(prefix))
  return value ? value.slice(prefix.length) : ''
}

function initializeAdmin() {
  if (admin.apps.length) return
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID })
}

function assertReadOnlyProductionTarget() {
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('This read-only production inspection cannot target an emulator.')
  }
  if (argument('project') !== PROJECT_ID) throw new Error(`Use --project=${PROJECT_ID}.`)
}

function activeProfile(profile = {}) {
  return profile.active === true && profile.deleted !== true && !profile.deletedAt
}

function credentialKey(profile = {}, credential = null) {
  if (credential) return String(credential.lookupKey || '').trim()
  return String(profile.pinHash || '').trim()
}

function groupKey(profileId, role, home) {
  const category = isSyntheticSecurityProfileId(profileId) ? 'test_or_canary' : 'real_staff'
  const scope = role === 'bht' ? (home.valid ? home.homeLocationId : 'invalid_home') : 'management'
  return `${category}:${role || 'unknown'}:${scope}`
}

async function authIdentityValid(auth, profileId, profile, identity, reverseByUid) {
  const values = [profile.authUid, identity?.authUid].map(value => String(value || '').trim()).filter(Boolean)
  if (values.length === 0 || new Set(values).size !== 1) return false
  const authUid = values[0]
  if (reverseByUid.get(authUid)?.userId !== profileId) return false
  try {
    const authUser = await auth.getUser(authUid)
    return authUser.disabled !== true
  } catch {
    return false
  }
}

export async function inspectCompatibilityReadiness({ db, auth }) {
  const [usersSnapshot, credentialsSnapshot, identitiesSnapshot, reverseSnapshot, foundationSnapshot, workflowsSnapshot, authPolicySnapshot, appCheckSnapshot] = await Promise.all([
    db.collection('users').get(),
    db.collection('staffPinCredentials').get(),
    db.collection('staffAuthIdentities').get(),
    db.collection('usersByAuthUid').get(),
    db.doc('appSettings/securityFoundation').get(),
    db.doc('appSettings/securityWorkflows').get(),
    db.doc('appSettings/authPolicy').get(),
    db.doc('appSettings/appCheckMonitoring').get()
  ])

  const credentialsById = new Map(credentialsSnapshot.docs.map(snapshot => [snapshot.id, snapshot.data() || {}]))
  const identitiesById = new Map(identitiesSnapshot.docs.map(snapshot => [snapshot.id, snapshot.data() || {}]))
  const reverseByUid = new Map(reverseSnapshot.docs.map(snapshot => [snapshot.id, snapshot.data() || {}]))
  const serverKeyCounts = new Map()
  const legacyKeyCounts = new Map()
  for (const snapshot of credentialsSnapshot.docs) {
    const key = credentialKey({}, snapshot.data() || {})
    if (key) serverKeyCounts.set(key, Number(serverKeyCounts.get(key) || 0) + 1)
  }
  for (const snapshot of usersSnapshot.docs) {
    const key = credentialKey(snapshot.data() || {}, null)
    if (key) legacyKeyCounts.set(key, Number(legacyKeyCounts.get(key) || 0) + 1)
  }

  const foundationConfig = foundationSnapshot.data() || {}
  const workflowConfig = workflowsSnapshot.data() || {}
  const authPolicy = authPolicySnapshot.data() || {}
  const appCheckConfig = appCheckSnapshot.data() || {}
  const appCheckEnforcementEnabled = appCheckConfig.enforcementEnabled === true
    || appCheckConfig.enforceAppCheck === true
    || appCheckConfig.enforced === true
  const appCheckCutoff = admin.firestore.Timestamp.fromMillis(Date.now() - (APP_CHECK_OBSERVATION_HOURS * 60 * 60 * 1000))
  const appCheckEntries = await Promise.all(Object.entries(APP_CHECK_AUDIT_COLLECTIONS).map(async ([key, collectionName]) => {
    const snapshot = await db.collection(collectionName).where('createdAt', '>=', appCheckCutoff).limit(500).get()
    return [key, snapshot.docs.map(document => document.data() || {})]
  }))
  const appCheckEvidence = summarizeAppCheckObservation({
    ...Object.fromEntries(appCheckEntries),
    enforcementEnabled: appCheckEnforcementEnabled
  })
  const enabledIds = new Set(Array.isArray(foundationConfig.enabledProfileIds) ? foundationConfig.enabledProfileIds : [])
  const secureLoginForAll = foundationConfig.rolloutState === 'active'
  const groups = {}
  let activeProfileCount = 0
  let invalidProfileCount = 0
  let credentialReadyCount = 0
  let stableIdentityCount = 0
  let secureLoginCoveredCount = 0

  for (const snapshot of usersSnapshot.docs) {
    const profile = snapshot.data() || {}
    if (!activeProfile(profile)) continue
    activeProfileCount += 1
    const role = normalizeSecurityRole(profile.role)
    const home = validateBhtHomeLocation(profile)
    const profileValid = ALLOWED_ROLES.has(role) && (role !== 'bht' || home.valid)
    const credential = credentialsById.get(snapshot.id) || null
    const key = credentialKey(profile, credential)
    const credentialReady = credential
      ? credential.active === true && Boolean(key) && serverKeyCounts.get(key) === 1
      : Boolean(key) && legacyKeyCounts.get(key) === 1
    const identityValid = await authIdentityValid(auth, snapshot.id, profile, identitiesById.get(snapshot.id), reverseByUid)
    const secureLoginCovered = secureLoginForAll || enabledIds.has(snapshot.id)
    if (!profileValid) invalidProfileCount += 1
    if (credentialReady) credentialReadyCount += 1
    if (identityValid) stableIdentityCount += 1
    if (secureLoginCovered) secureLoginCoveredCount += 1
    const keyName = groupKey(snapshot.id, role, home)
    const group = groups[keyName] || { count: 0, credentialReady: 0, stableIdentity: 0, secureLoginCovered: 0 }
    group.count += 1
    if (credentialReady) group.credentialReady += 1
    if (identityValid) group.stableIdentity += 1
    if (secureLoginCovered) group.secureLoginCovered += 1
    groups[keyName] = group
  }

  const workflow = validateWorkflowRollout(workflowConfig)
  const accountReadiness = {
    activeProfileCount,
    invalidProfileCount,
    credentialReadyCount,
    stableIdentityCount,
    secureLoginForAll
  }
  const completeDocumentedGates = {
    runtimeParity: true,
    emulatorMatrix: true,
    browserMatrix: true,
    offlineReplay: true,
    roleAndNegativeSecurity: true,
    canaryRollback: true
  }
  const retirement = compatibilityRetirementReady({
    workflowConfig,
    appCheckConfig: {
      schemaVersion: 7,
      monitoringEnabled: appCheckEvidence.ready,
      enforcementEnabled: appCheckEnforcementEnabled
    },
    accountReadiness,
    gates: completeDocumentedGates
  })
  const broadActivationChecks = {
    strictAuthorizationOff: authPolicy.authScopeEnforced !== true,
    foundationVersionReady: foundationConfig.schemaVersion === 2
      && foundationConfig.serverPinLoginEnabled === true
      && foundationConfig.clientBootstrapEnabled === true
      && ['production_canary', 'active'].includes(foundationConfig.rolloutState),
    activeInventoryPresent: activeProfileCount > 0,
    activeProfilesValid: invalidProfileCount === 0,
    activeCredentialsReady: credentialReadyCount === activeProfileCount,
    allWorkflowsReady: workflow.valid && workflow.enabled && workflow.secureWorkflows.length === SECURITY_WORKFLOWS.length,
    appCheckMonitoringReady: appCheckEvidence.ready
  }
  const broadActivationBlockers = Object.entries(broadActivationChecks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name)
  const broadActivationReady = broadActivationBlockers.length === 0

  return {
    projectId: PROJECT_ID,
    mode: 'read_only_compatibility_readiness',
    activeProfileCount,
    invalidProfileCount,
    credentialReadyCount,
    stableIdentityCount,
    secureLoginCoveredCount,
    secureLoginForAll,
    globalStrictAuthorization: authPolicy.authScopeEnforced === true,
    broadActivationReady,
    broadActivationBlockers,
    appCheckObservation: {
      windowHours: APP_CHECK_OBSERVATION_HOURS,
      ready: appCheckEvidence.ready,
      enforcementEnabled: appCheckEnforcementEnabled,
      missingGroups: appCheckEvidence.missingGroups,
      validSamples: appCheckEvidence.totals.validSamples
    },
    strictAuthorizationReady: retirement.ready && authPolicy.authScopeEnforced !== true,
    missingAccountConditions: retirement.missingAccountConditions,
    missingWorkflows: retirement.missingWorkflows,
    groups
  }
}

async function main() {
  assertReadOnlyProductionTarget()
  initializeAdmin()
  const result = await inspectCompatibilityReadiness({ db: admin.firestore(), auth: admin.auth() })
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch(error => {
    console.error(error?.message || error)
    process.exitCode = 1
  })
}
