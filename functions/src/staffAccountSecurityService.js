import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import {
  evaluateStaffAccountManagement,
  normalizeSecurityRole,
  validateBhtHomeLocation
} from './securityFoundationModel.js'
import {
  containsCredentialMaterial,
  createServerPinCredential,
  deriveLegacyPinHash,
  derivePrivateIdentifier,
  normalizeStaffPin,
  sanitizeStaffProfile,
  verifyServerPinCredential
} from './staffPinCredentialModel.js'
import { sessionRecordIsCurrent } from './staffPinLoginService.js'
import {
  STAFF_ACCOUNT_ACTIONS,
  accountMutationRevocationTriggers,
  auditSafeProfileChanges,
  normalizeProfilePatch,
  operationFingerprint,
  protectedAccountActionsEnabled,
  validateManagedProfile
} from './staffAccountSecurityModel.js'

const CONFIG_PATH = 'appSettings/securityFoundation'
const ACTION_VALUES = new Set(Object.values(STAFF_ACCOUNT_ACTIONS))
const SHIFT_IDS = new Set(['shift_1', 'shift_2', 'res_shift_1_day', 'res_shift_1_night', 'res_shift_2_day', 'res_shift_2_night'])
const OBVIOUS_PINS = new Set(['012345', '123456', '654321', '987654'])

export class StaffAccountSecurityError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'StaffAccountSecurityError'
    this.code = code
  }
}

function cleanId(value, label = 'ID') {
  const normalized = String(value || '').trim()
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(normalized)) {
    throw new StaffAccountSecurityError('invalid-argument', `${label} is invalid.`)
  }
  return normalized
}

function cleanOperationId(value) {
  const normalized = String(value || '').trim()
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(normalized)) {
    throw new StaffAccountSecurityError('invalid-argument', 'A unique operation ID is required.')
  }
  return normalized
}

function obviousPin(pin) {
  return /^(\d)\1+$/.test(pin) || OBVIOUS_PINS.has(pin)
}

function auditReason(value) {
  return String(value || '').trim().slice(0, 500).replace(/\b\d{6}\b/g, '[redacted]')
}

function requestClaims(requestAuth = {}) {
  return requestAuth.token || requestAuth.claims || {}
}

async function requireConfig(db) {
  const snapshot = await db.doc(CONFIG_PATH).get()
  if (!snapshot.exists || !protectedAccountActionsEnabled(snapshot.data())) {
    throw new StaffAccountSecurityError('failed-precondition', 'Protected staff account actions are not enabled.')
  }
  return snapshot.data()
}

export async function loadMappedActor({ db, requestAuth, nowMs, requireCurrentSession = true }) {
  const authUid = String(requestAuth?.uid || '').trim()
  if (!authUid) throw new StaffAccountSecurityError('unauthenticated', 'A secure Firebase session is required.')
  const claims = requestClaims(requestAuth)
  const mappingSnapshot = await db.doc(`usersByAuthUid/${authUid}`).get()
  const actorProfileId = String(mappingSnapshot.data()?.userId || '').trim()
  if (!mappingSnapshot.exists || !actorProfileId || String(claims.profileId || '') !== actorProfileId) {
    throw new StaffAccountSecurityError('permission-denied', 'This Firebase identity is not mapped to the current staff profile.')
  }
  const actorSnapshot = await db.doc(`users/${actorProfileId}`).get()
  const actor = actorSnapshot.data() || {}
  if (!actorSnapshot.exists || actor.active !== true || actor.deleted === true || actor.deletedAt) {
    throw new StaffAccountSecurityError('permission-denied', 'This staff profile is not active.')
  }
  if (actor.authUid && actor.authUid !== authUid) {
    throw new StaffAccountSecurityError('permission-denied', 'This staff identity mapping needs administrator review.')
  }
  const securityVersion = Number(actor.securityVersion || 1)
  if (Number(claims.securityVersion || 0) !== securityVersion) {
    throw new StaffAccountSecurityError('permission-denied', 'This session is no longer current. Sign in again.')
  }
  const sessionId = String(claims.sessionId || '').trim()
  if (requireCurrentSession) {
    if (!sessionId) throw new StaffAccountSecurityError('permission-denied', 'This device session is missing.')
    const sessionSnapshot = await db.doc(`staffSessions/${sessionId}`).get()
    const result = sessionRecordIsCurrent(sessionId, sessionSnapshot.data(), {
      nowMs,
      authUid,
      profileId: actorProfileId,
      currentSecurityVersion: securityVersion
    })
    if (!sessionSnapshot.exists || !result.valid) {
      throw new StaffAccountSecurityError('permission-denied', 'This device session is no longer active.')
    }
  }
  return { id: actorProfileId, authUid, sessionId, ...actor }
}

async function verifyCurrentPin({ db, profileId, profile, pin, secret }) {
  const credentialSnapshot = await db.doc(`staffPinCredentials/${profileId}`).get()
  if (credentialSnapshot.exists && credentialSnapshot.data()?.active === true) {
    return verifyServerPinCredential(pin, secret, credentialSnapshot.data())
  }
  return String(profile.pinHash || '') === deriveLegacyPinHash(pin)
}

function managementActionForSave(before, after) {
  if (before.active !== true && after.active === true) return 'reactivate'
  if (before.active === true && after.active === false) return 'deactivate'
  return 'update_operational_assignment'
}

function requestedLocation(profile = {}) {
  return String(profile.locationId || profile.house || profile.location || profile.site || '').trim()
}

function assignmentPayload(profileId, profile, now) {
  const home = validateBhtHomeLocation(profile)
  const vanIds = [...new Set([
    ...(Array.isArray(profile.vanIds) ? profile.vanIds : []),
    profile.vanId
  ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean))]
  let shiftId = String(profile.shiftId || '').trim()
  if (home.mainLocation === 'RES' && shiftId === 'shift_1') shiftId = 'res_shift_1_day'
  if (home.mainLocation === 'RES' && shiftId === 'shift_2') shiftId = 'res_shift_2_day'
  const active = normalizeSecurityRole(profile.role) === 'bht'
    && profile.active === true
    && profile.deleted !== true
    && home.valid
    && SHIFT_IDS.has(shiftId)
    && vanIds.length > 0
  return {
    bhtUserId: profileId,
    bhtUserName: String(profile.name || profileId).trim(),
    locationId: home.homeLocationId || String(profile.locationId || '').trim().toLowerCase(),
    shiftId,
    vanIds,
    active,
    source: 'user_profile',
    deleted: !active,
    deletedAt: active ? null : now,
    deleteReason: active ? null : 'Derived from inactive/non-BHT user profile',
    effectiveTo: active ? null : now,
    updatedAt: now
  }
}

async function closeAllSessionsAndTokens({ db, auth, targetProfileId, authUid, operationHash, nowMs }) {
  const cleanupRef = db.doc(`securityCleanupJobs/${operationHash}`)
  try {
    const sessions = await db.collection('staffSessions').where('profileId', '==', targetProfileId).get()
    const activeDocs = sessions.docs.filter(snapshot => snapshot.data()?.active !== false)
    for (let offset = 0; offset < activeDocs.length; offset += 400) {
      const batch = db.batch()
      for (const snapshot of activeDocs.slice(offset, offset + 400)) {
        batch.set(snapshot.ref, {
          active: false,
          revokedAt: Timestamp.fromMillis(nowMs),
          revocationReason: 'security_version_changed',
          revocationOperationHash: operationHash,
          updatedAt: Timestamp.fromMillis(nowMs)
        }, { merge: true })
      }
      await batch.commit()
    }
    if (authUid) await auth.revokeRefreshTokens(authUid)
    await cleanupRef.set({
      status: 'completed',
      attempts: FieldValue.increment(1),
      closedSessionCount: activeDocs.length,
      completedAt: Timestamp.fromMillis(nowMs),
      updatedAt: Timestamp.fromMillis(nowMs),
      lastErrorCode: ''
    }, { merge: true })
    return { status: 'completed', closedSessionCount: activeDocs.length }
  } catch (error) {
    await cleanupRef.set({
      status: 'failed',
      attempts: FieldValue.increment(1),
      lastAttemptAt: Timestamp.fromMillis(nowMs),
      updatedAt: Timestamp.fromMillis(nowMs),
      lastErrorCode: String(error?.code || 'cleanup_failed').slice(0, 120)
    }, { merge: true })
    return { status: 'failed', closedSessionCount: 0 }
  }
}

function publicResult(audit, cleanup, replayed) {
  return {
    action: audit.action,
    targetProfileId: audit.targetProfileId,
    securityVersion: Number(audit.resultSecurityVersion || 1),
    allDevicesRevoked: audit.allDevicesRevoked === true,
    cleanupStatus: cleanup?.status || audit.cleanupStatus || 'not_required',
    replayed: replayed === true,
    profile: audit.resultProfile || null
  }
}

async function createDormantStaffProfile({
  db,
  secret,
  requestData,
  currentActor,
  requestedTarget,
  fingerprint,
  auditRef,
  appCheckPresent,
  nowMs
}) {
  let profilePatch
  let nextPin
  let credential
  try {
    profilePatch = normalizeProfilePatch(requestData.profilePatch)
    nextPin = normalizeStaffPin(requestData.newPin)
    if (obviousPin(nextPin)) throw new Error('Choose a less obvious PIN. Repeated or sequential digits are not allowed.')
    credential = await createServerPinCredential(nextPin, secret)
  } catch (error) {
    throw new StaffAccountSecurityError('invalid-argument', String(error?.message || 'A complete profile and valid new PIN are required.'))
  }
  const profile = { ...profilePatch, active: profilePatch.active === true }
  if (!String(profile.name || '').trim()) {
    throw new StaffAccountSecurityError('invalid-argument', 'A staff name is required.')
  }
  if (!validateManagedProfile(profile).valid) {
    throw new StaffAccountSecurityError('failed-precondition', 'The staff profile has an invalid role or BHT home-location configuration.')
  }
  const authority = evaluateStaffAccountManagement({
    actor: currentActor,
    target: profile,
    action: STAFF_ACCOUNT_ACTIONS.CREATE_PROFILE,
    requestedRole: profile.role,
    requestedLocationId: requestedLocation(profile)
  })
  if (!authority.allowed) {
    throw new StaffAccountSecurityError('permission-denied', `This staff account action is not allowed (${authority.reason}).`)
  }

  const timestamp = Timestamp.fromMillis(nowMs)
  const targetRef = db.doc(`users/${requestedTarget}`)
  const credentialRef = db.doc(`staffPinCredentials/${requestedTarget}`)
  const lookupRef = db.doc(`staffPinLookup/${credential.lookupKey}`)
  const assignmentRef = db.doc(`shiftAssignments/asg_${requestedTarget}`)
  const legacyPinHash = deriveLegacyPinHash(nextPin)
  const legacyMatches = await db.collection('users').where('pinHash', '==', legacyPinHash).limit(3).get()

  const result = await db.runTransaction(async transaction => {
    const [configSnapshot, targetSnapshot, existingAudit, lookupSnapshot, credentialSnapshot, assignmentSnapshot] = await Promise.all([
      transaction.get(db.doc(CONFIG_PATH)),
      transaction.get(targetRef),
      transaction.get(auditRef),
      transaction.get(lookupRef),
      transaction.get(credentialRef),
      transaction.get(assignmentRef)
    ])
    if (!configSnapshot.exists || !protectedAccountActionsEnabled(configSnapshot.data())) {
      throw new StaffAccountSecurityError('failed-precondition', 'Protected staff account actions are not enabled.')
    }
    if (existingAudit.exists) return { audit: existingAudit.data(), replayed: true }
    if (targetSnapshot.exists || credentialSnapshot.exists || assignmentSnapshot.exists) {
      throw new StaffAccountSecurityError('already-exists', 'A staff profile with that internal ID already exists.')
    }
    if (lookupSnapshot.exists && lookupSnapshot.data()?.profileId !== requestedTarget) {
      throw new StaffAccountSecurityError('already-exists', 'That PIN is already in use. Choose a different PIN.')
    }
    for (const match of legacyMatches.docs) {
      if (match.id !== requestedTarget) throw new StaffAccountSecurityError('already-exists', 'That PIN is already in use. Choose a different PIN.')
    }

    const createdProfile = {
      ...profile,
      pinHash: legacyPinHash,
      pinVersion: 'v2_sha256_6digit',
      pinUpdatedAt: timestamp,
      securityVersion: 1,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    transaction.create(targetRef, createdProfile)
    transaction.create(credentialRef, { ...credential, active: true, createdAt: timestamp, updatedAt: timestamp })
    transaction.set(lookupRef, { profileId: requestedTarget, active: true, createdAt: timestamp, updatedAt: timestamp })

    const assignment = assignmentPayload(requestedTarget, createdProfile, timestamp)
    if (assignment.active) {
      transaction.create(assignmentRef, { ...assignment, version: 1, createdAt: timestamp, effectiveFrom: timestamp })
    }

    const audit = {
      schemaVersion: 4,
      action: STAFF_ACCOUNT_ACTIONS.CREATE_PROFILE,
      actorProfileId: currentActor.id,
      actorAuthUid: currentActor.authUid,
      actorRole: normalizeSecurityRole(currentActor.role),
      targetProfileId: requestedTarget,
      targetAuthUid: '',
      fingerprint,
      triggers: [],
      changes: auditSafeProfileChanges({}, createdProfile),
      reason: auditReason(requestData.reason),
      allDevicesRevoked: false,
      cleanupStatus: 'not_required',
      appCheckPresent: appCheckPresent === true,
      resultSecurityVersion: 1,
      resultProfile: sanitizeStaffProfile(requestedTarget, createdProfile),
      createdAt: timestamp
    }
    if (containsCredentialMaterial(audit)) throw new Error('Audit payload unexpectedly contains credential material.')
    transaction.create(auditRef, audit)
    return { audit, replayed: false }
  })
  return publicResult(result.audit, null, result.replayed)
}

export async function performDormantStaffSecurityAction({
  db,
  auth,
  secret,
  requestData = {},
  requestAuth,
  appCheckPresent = false,
  nowMs = Date.now()
}) {
  await requireConfig(db)
  const action = String(requestData.action || '').trim()
  if (!ACTION_VALUES.has(action)) throw new StaffAccountSecurityError('invalid-argument', 'The requested security action is not supported.')
  const operationId = cleanOperationId(requestData.operationId)
  const operationHash = `account_${derivePrivateIdentifier(operationId, 'staff-account-operation-v4', secret)}`
  const auditRef = db.doc(`securityAccountAudit/${operationHash}`)

  const priorAudit = await auditRef.get()
  if (priorAudit.exists) {
    const prior = priorAudit.data() || {}
    const replayAuthUid = String(requestAuth?.uid || '').trim()
    if (!replayAuthUid || replayAuthUid !== prior.actorAuthUid) {
      throw new StaffAccountSecurityError('permission-denied', 'That protected operation does not belong to this Firebase identity.')
    }
    const replayTarget = [STAFF_ACCOUNT_ACTIONS.SELF_CHANGE_PIN, STAFF_ACCOUNT_ACTIONS.CLOSE_DEVICE_SESSION].includes(action)
      ? prior.actorProfileId
      : cleanId(requestData.targetProfileId || prior.actorProfileId, 'Target profile ID')
    const replayFingerprint = derivePrivateIdentifier(operationFingerprint({
      actorProfileId: prior.actorProfileId,
      targetProfileId: replayTarget,
      action,
      requestData
    }), 'staff-account-fingerprint-v4', secret)
    if (prior.fingerprint !== replayFingerprint) {
      throw new StaffAccountSecurityError('already-exists', 'That operation ID was already used for a different request.')
    }
    let cleanup = null
    if (prior.allDevicesRevoked === true) {
      cleanup = await closeAllSessionsAndTokens({
        db,
        auth,
        targetProfileId: prior.targetProfileId,
        authUid: prior.targetAuthUid,
        operationHash,
        nowMs
      })
    }
    return publicResult(prior, cleanup, true)
  }

  const actor = await loadMappedActor({ db, requestAuth, nowMs, requireCurrentSession: false })
  const requestedTarget = [STAFF_ACCOUNT_ACTIONS.SELF_CHANGE_PIN, STAFF_ACCOUNT_ACTIONS.CLOSE_DEVICE_SESSION].includes(action)
    ? actor.id
    : cleanId(requestData.targetProfileId || actor.id, 'Target profile ID')
  const fingerprint = derivePrivateIdentifier(operationFingerprint({
    actorProfileId: actor.id,
    targetProfileId: requestedTarget,
    action,
    requestData
  }), 'staff-account-fingerprint-v4', secret)
  const currentActor = await loadMappedActor({ db, requestAuth, nowMs, requireCurrentSession: true })
  if (action === STAFF_ACCOUNT_ACTIONS.CREATE_PROFILE) {
    return createDormantStaffProfile({
      db,
      secret,
      requestData,
      currentActor,
      requestedTarget,
      fingerprint,
      auditRef,
      appCheckPresent,
      nowMs
    })
  }
  const targetRef = db.doc(`users/${requestedTarget}`)
  const targetSnapshot = await targetRef.get()
  const target = targetSnapshot.data() || {}
  if (!targetSnapshot.exists || target.deleted === true || target.deletedAt) {
    throw new StaffAccountSecurityError('not-found', 'The staff profile is unavailable.')
  }

  if (action === STAFF_ACCOUNT_ACTIONS.CLOSE_DEVICE_SESSION) {
    const sessionId = cleanId(requestData.sessionId || currentActor.sessionId, 'Session ID')
    const sessionRef = db.doc(`staffSessions/${sessionId}`)
    const result = await db.runTransaction(async transaction => {
      const [existingAudit, sessionSnapshot] = await Promise.all([transaction.get(auditRef), transaction.get(sessionRef)])
      if (existingAudit.exists) return { audit: existingAudit.data(), replayed: true }
      const session = sessionSnapshot.data() || {}
      if (!sessionSnapshot.exists || session.profileId !== currentActor.id || session.authUid !== currentActor.authUid) {
        throw new StaffAccountSecurityError('permission-denied', 'That device session does not belong to this staff account.')
      }
      transaction.set(sessionRef, {
        active: false,
        revokedAt: Timestamp.fromMillis(nowMs),
        revocationReason: 'ordinary_logout',
        revocationOperationHash: operationHash,
        updatedAt: Timestamp.fromMillis(nowMs)
      }, { merge: true })
      const audit = {
        schemaVersion: 4,
        action,
        actorProfileId: currentActor.id,
        actorAuthUid: currentActor.authUid,
        targetProfileId: currentActor.id,
        targetAuthUid: currentActor.authUid,
        sessionId,
        fingerprint,
        allDevicesRevoked: false,
        cleanupStatus: 'not_required',
        appCheckPresent: appCheckPresent === true,
        resultSecurityVersion: Number(target.securityVersion || 1),
        resultProfile: sanitizeStaffProfile(currentActor.id, target),
        createdAt: Timestamp.fromMillis(nowMs)
      }
      transaction.create(auditRef, audit)
      return { audit, replayed: false }
    })
    return publicResult(result.audit, null, result.replayed)
  }

  let nextPin = null
  let currentPin = null
  let newCredential = null
  let legacyPinHash = null
  if ([STAFF_ACCOUNT_ACTIONS.SELF_CHANGE_PIN, STAFF_ACCOUNT_ACTIONS.RESET_PIN].includes(action) || requestData.newPin) {
    try {
      nextPin = normalizeStaffPin(requestData.newPin)
      if (obviousPin(nextPin)) throw new Error('Choose a less obvious PIN. Repeated or sequential digits are not allowed.')
      newCredential = await createServerPinCredential(nextPin, secret)
      legacyPinHash = deriveLegacyPinHash(nextPin)
    } catch (error) {
      throw new StaffAccountSecurityError('invalid-argument', String(error?.message || 'A valid new PIN is required.'))
    }
  }

  if (action === STAFF_ACCOUNT_ACTIONS.SELF_CHANGE_PIN) {
    try { currentPin = normalizeStaffPin(requestData.currentPin) } catch {
      throw new StaffAccountSecurityError('invalid-argument', 'Your current six-digit PIN is required.')
    }
    if (currentPin === nextPin) throw new StaffAccountSecurityError('invalid-argument', 'New PIN must be different from current PIN.')
    if (!await verifyCurrentPin({ db, profileId: currentActor.id, profile: target, pin: currentPin, secret })) {
      throw new StaffAccountSecurityError('permission-denied', 'Current PIN is incorrect.')
    }
  }

  let profilePatch = {}
  if (action === STAFF_ACCOUNT_ACTIONS.SAVE_PROFILE) {
    try { profilePatch = normalizeProfilePatch(requestData.profilePatch) } catch (error) {
      throw new StaffAccountSecurityError('invalid-argument', error.message)
    }
  }
  if (action === STAFF_ACCOUNT_ACTIONS.SOFT_DELETE) profilePatch = { active: false, deleted: true }
  const proposed = { ...target, ...profilePatch }

  if (target.active !== true && !(action === STAFF_ACCOUNT_ACTIONS.SAVE_PROFILE && proposed.active === true)) {
    throw new StaffAccountSecurityError('failed-precondition', 'Inactive staff profiles must be reactivated before other account actions.')
  }
  const actorRole = normalizeSecurityRole(currentActor.role)
  const targetValidation = validateManagedProfile(target)
  const proposedValidation = validateManagedProfile(proposed)
  if (!proposedValidation.valid) {
    throw new StaffAccountSecurityError('failed-precondition', 'The staff profile has an invalid role or BHT home-location configuration.')
  }
  if (!targetValidation.valid && !(actorRole === 'admin' && action === STAFF_ACCOUNT_ACTIONS.SAVE_PROFILE)) {
    throw new StaffAccountSecurityError('failed-precondition', 'This staff profile configuration needs administrator correction.')
  }

  if (action !== STAFF_ACCOUNT_ACTIONS.SELF_CHANGE_PIN) {
    const delegatedAction = action === STAFF_ACCOUNT_ACTIONS.SAVE_PROFILE
      ? managementActionForSave(target, proposed)
      : action
    const authority = evaluateStaffAccountManagement({
      actor: currentActor,
      target,
      action: delegatedAction,
      requestedRole: proposed.role,
      requestedLocationId: requestedLocation(proposed)
    })
    if (!authority.allowed) throw new StaffAccountSecurityError('permission-denied', `This staff account action is not allowed (${authority.reason}).`)
    if (currentActor.id === requestedTarget && action === STAFF_ACCOUNT_ACTIONS.SOFT_DELETE) {
      throw new StaffAccountSecurityError('failed-precondition', 'You cannot delete the account you are currently using.')
    }
  }

  const lookupRef = newCredential ? db.doc(`staffPinLookup/${newCredential.lookupKey}`) : null
  const legacyMatches = legacyPinHash
    ? await db.collection('users').where('pinHash', '==', legacyPinHash).limit(3).get()
    : null
  const targetSessions = await db.collection('staffSessions').where('profileId', '==', requestedTarget).get()
  const targetCredentialRef = db.doc(`staffPinCredentials/${requestedTarget}`)
  const targetIdentitySnapshot = await db.doc(`staffAuthIdentities/${requestedTarget}`).get()
  const targetAuthUid = String(target.authUid || targetIdentitySnapshot.data()?.authUid || '').trim()
  const cleanupRef = db.doc(`securityCleanupJobs/${operationHash}`)
  const assignmentRef = [STAFF_ACCOUNT_ACTIONS.SAVE_PROFILE, STAFF_ACCOUNT_ACTIONS.SOFT_DELETE].includes(action)
    ? db.doc(`shiftAssignments/asg_${requestedTarget}`)
    : null
  const timestamp = Timestamp.fromMillis(nowMs)

  const transactionResult = await db.runTransaction(async transaction => {
    const reads = [transaction.get(db.doc(CONFIG_PATH)), transaction.get(targetRef), transaction.get(auditRef)]
    if (lookupRef) reads.push(transaction.get(lookupRef), transaction.get(targetCredentialRef))
    if (assignmentRef) reads.push(transaction.get(assignmentRef))
    const results = await Promise.all(reads)
    const [configSnapshot, freshTargetSnapshot, existingAudit] = results
    let cursor = 3
    const lookupSnapshot = lookupRef ? results[cursor++] : null
    const currentCredentialSnapshot = lookupRef ? results[cursor++] : null
    const assignmentSnapshot = assignmentRef ? results[cursor] : null
    if (!configSnapshot.exists || !protectedAccountActionsEnabled(configSnapshot.data())) {
      throw new StaffAccountSecurityError('failed-precondition', 'Protected staff account actions are not enabled.')
    }
    if (existingAudit.exists) return { audit: existingAudit.data(), replayed: true }
    const freshTarget = freshTargetSnapshot.data() || {}
    if (!freshTargetSnapshot.exists || freshTarget.deleted === true || freshTarget.deletedAt) {
      throw new StaffAccountSecurityError('not-found', 'The staff profile is unavailable.')
    }
    const expectedVersion = Number(requestData.expectedVersion || 0)
    if (expectedVersion > 0 && Number(freshTarget.version || 0) !== expectedVersion) {
      throw new StaffAccountSecurityError('aborted', 'This staff profile changed in another session. Reload it before saving.')
    }
    if (lookupSnapshot?.exists && lookupSnapshot.data()?.profileId !== requestedTarget) {
      throw new StaffAccountSecurityError('already-exists', 'That PIN is already in use. Choose a different PIN.')
    }
    for (const match of legacyMatches?.docs || []) {
      if (match.id !== requestedTarget) throw new StaffAccountSecurityError('already-exists', 'That PIN is already in use. Choose a different PIN.')
    }
    if (action === STAFF_ACCOUNT_ACTIONS.SELF_CHANGE_PIN) {
      const freshCredential = currentCredentialSnapshot?.exists ? currentCredentialSnapshot.data() : null
      const currentPinStillValid = Boolean(freshCredential) && freshCredential.active !== false
        ? await verifyServerPinCredential(currentPin, secret, freshCredential)
        : false
      const legacyPinStillValid = !freshCredential
        && typeof freshTarget.pinHash === 'string'
        && freshTarget.pinHash === deriveLegacyPinHash(currentPin)
      if (!currentPinStillValid && !legacyPinStillValid) {
        throw new StaffAccountSecurityError('aborted', 'Your PIN changed in another session. Sign in again before changing it.')
      }
    }

    const freshProposed = { ...freshTarget, ...profilePatch }
    if (!validateManagedProfile(freshProposed).valid) {
      throw new StaffAccountSecurityError('failed-precondition', 'The staff profile has an invalid role or BHT home-location configuration.')
    }
    const triggers = accountMutationRevocationTriggers({
      action,
      before: freshTarget,
      after: freshProposed,
      pinChanged: Boolean(newCredential)
    })
    const allDevicesRevoked = triggers.length > 0
    const nextSecurityVersion = Number(freshTarget.securityVersion || 1) + (allDevicesRevoked ? 1 : 0)
    const nextVersion = Number(freshTarget.version || 0) + 1
    const userUpdate = {
      ...profilePatch,
      securityVersion: nextSecurityVersion,
      version: nextVersion,
      updatedAt: timestamp
    }
    if (action === STAFF_ACCOUNT_ACTIONS.SOFT_DELETE) {
      userUpdate.active = false
      userUpdate.deleted = true
      userUpdate.deletedAt = timestamp
      userUpdate.deleteReason = 'Protected staff account action'
    }
    if (newCredential) {
      userUpdate.pinHash = legacyPinHash
      userUpdate.pinVersion = 'v2_sha256_6digit'
      userUpdate.pinUpdatedAt = timestamp
      transaction.set(targetCredentialRef, {
        ...newCredential,
        active: true,
        updatedAt: timestamp,
        createdAt: currentCredentialSnapshot?.exists ? currentCredentialSnapshot.data()?.createdAt || timestamp : timestamp
      })
      transaction.set(lookupRef, { profileId: requestedTarget, active: true, updatedAt: timestamp }, { merge: true })
      const oldLookupKey = currentCredentialSnapshot?.data()?.lookupKey
      if (oldLookupKey && oldLookupKey !== newCredential.lookupKey) {
        transaction.set(db.doc(`staffPinLookup/${oldLookupKey}`), { active: false, replacedBy: newCredential.lookupKey, updatedAt: timestamp }, { merge: true })
      }
    }
    transaction.set(targetRef, userUpdate, { merge: true })

    const resultingProfile = { ...freshTarget, ...userUpdate }
    if (assignmentRef) {
      const assignment = assignmentPayload(requestedTarget, resultingProfile, timestamp)
      if (!assignmentSnapshot.exists && assignment.active) {
        transaction.set(assignmentRef, { ...assignment, version: 1, createdAt: timestamp, effectiveFrom: timestamp })
      } else if (assignmentSnapshot.exists) {
        transaction.set(assignmentRef, { ...assignment, version: Number(assignmentSnapshot.data()?.version || 0) + 1 }, { merge: true })
      }
    }

    if (allDevicesRevoked) {
      for (const sessionSnapshot of targetSessions.docs) {
        transaction.set(sessionSnapshot.ref, {
          active: false,
          revokedAt: timestamp,
          revocationReason: triggers.join(','),
          revocationOperationHash: operationHash,
          updatedAt: timestamp
        }, { merge: true })
      }
      transaction.set(cleanupRef, {
        schemaVersion: 4,
        targetProfileId: requestedTarget,
        targetAuthUid,
        operationHash,
        status: 'pending',
        attempts: 0,
        createdAt: timestamp,
        updatedAt: timestamp
      })
    }

    const audit = {
      schemaVersion: 4,
      action,
      actorProfileId: currentActor.id,
      actorAuthUid: currentActor.authUid,
      actorRole: normalizeSecurityRole(currentActor.role),
      targetProfileId: requestedTarget,
      targetAuthUid,
      fingerprint,
      triggers,
      changes: auditSafeProfileChanges(freshTarget, resultingProfile),
      reason: auditReason(requestData.reason),
      allDevicesRevoked,
      cleanupStatus: allDevicesRevoked ? 'pending' : 'not_required',
      appCheckPresent: appCheckPresent === true,
      resultSecurityVersion: nextSecurityVersion,
      resultProfile: sanitizeStaffProfile(requestedTarget, resultingProfile),
      createdAt: timestamp
    }
    if (containsCredentialMaterial(audit)) throw new Error('Audit payload unexpectedly contains credential material.')
    transaction.create(auditRef, audit)
    return { audit, replayed: false }
  })

  let cleanup = null
  if (transactionResult.audit.allDevicesRevoked === true) {
    cleanup = await closeAllSessionsAndTokens({
      db,
      auth,
      targetProfileId: requestedTarget,
      authUid: targetAuthUid,
      operationHash,
      nowMs
    })
  }
  return publicResult(transactionResult.audit, cleanup, transactionResult.replayed)
}
