import { Timestamp } from 'firebase-admin/firestore'
import {
  PIN_ATTEMPT_WINDOW_MS,
  PIN_MAX_FAILED_ATTEMPTS,
  SESSION_ABSOLUTE_MAX_MS,
  evaluateDeviceSession,
  validateBhtHomeLocation
} from './securityFoundationModel.js'
import {
  STAFF_PIN_LOGIN_CONFIG_VERSION,
  createServerPinCredential,
  deriveLegacyPinHash,
  derivePinLookupKey,
  derivePrivateIdentifier,
  deriveStableStaffAuthUid,
  normalizeStaffPin,
  sanitizeStaffProfile,
  verifyServerPinCredential
} from './staffPinCredentialModel.js'
import { workflowTokenClaims } from './workflowSecurityModel.js'

const CONFIG_PATH = 'appSettings/securityFoundation'
const NETWORK_ATTEMPT_LIMIT = 100

export class StaffPinLoginError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'StaffPinLoginError'
    this.code = code
  }
}

function publicLoginFailure() {
  return new StaffPinLoginError('permission-denied', 'PIN verification failed.')
}

function millis(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis()
  return Number(value || 0)
}

function activeConfig(data = {}) {
  return data.schemaVersion === STAFF_PIN_LOGIN_CONFIG_VERSION && data.serverPinLoginEnabled === true
}

function validateRequest(data = {}) {
  let pin
  try {
    pin = normalizeStaffPin(data.pin)
  } catch {
    throw new StaffPinLoginError('invalid-argument', 'A six-digit PIN is required.')
  }
  const deviceId = String(data.deviceId || '').trim()
  const operationId = String(data.operationId || '').trim()
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(deviceId)) {
    throw new StaffPinLoginError('invalid-argument', 'A valid device ID is required.')
  }
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(operationId)) {
    throw new StaffPinLoginError('invalid-argument', 'A unique operation ID is required.')
  }
  return { pin, deviceId, operationId }
}

async function requireEnabledConfig(db) {
  const snapshot = await db.doc(CONFIG_PATH).get()
  if (!snapshot.exists || !activeConfig(snapshot.data())) {
    throw new StaffPinLoginError('failed-precondition', 'Server PIN login is not enabled.')
  }
  return snapshot.data()
}

function bucketState(snapshot, nowMs, maximumAttempts) {
  const data = snapshot.data() || {}
  const windowStartedAtMs = millis(data.windowStartedAt)
  const lockedUntilMs = millis(data.lockedUntil)
  const inWindow = windowStartedAtMs > 0 && nowMs - windowStartedAtMs < PIN_ATTEMPT_WINDOW_MS
  const attemptCount = inWindow ? Number(data.attemptCount || 0) : 0
  return { attemptCount, windowStartedAtMs, lockedUntilMs, maximumAttempts }
}

async function reserveRateCapacity({ db, deviceRateId, networkRateId, nowMs }) {
  const deviceRef = db.doc(`securityRateLimits/staffPinV2_device_${deviceRateId}`)
  const networkRef = db.doc(`securityRateLimits/staffPinV2_network_${networkRateId}`)
  const result = await db.runTransaction(async transaction => {
    const [deviceSnapshot, networkSnapshot] = await Promise.all([
      transaction.get(deviceRef),
      transaction.get(networkRef)
    ])
    const buckets = [
      { ref: deviceRef, state: bucketState(deviceSnapshot, nowMs, PIN_MAX_FAILED_ATTEMPTS) },
      { ref: networkRef, state: bucketState(networkSnapshot, nowMs, NETWORK_ATTEMPT_LIMIT) }
    ]
    if (buckets.some(bucket => bucket.state.lockedUntilMs > nowMs || bucket.state.attemptCount >= bucket.state.maximumAttempts)) {
      return { locked: true, deviceAtLimit: true }
    }
    for (const bucket of buckets) {
      const nextCount = bucket.state.attemptCount + 1
      transaction.set(bucket.ref, {
        attemptCount: nextCount,
        windowStartedAt: Timestamp.fromMillis(bucket.state.attemptCount > 0 ? bucket.state.windowStartedAtMs : nowMs),
        lockedUntil: nextCount >= bucket.state.maximumAttempts ? Timestamp.fromMillis(nowMs + PIN_ATTEMPT_WINDOW_MS) : null,
        updatedAt: Timestamp.fromMillis(nowMs)
      }, { merge: true })
    }
    return { locked: false, deviceAtLimit: buckets[0].state.attemptCount + 1 >= PIN_MAX_FAILED_ATTEMPTS }
  })
  if (result.locked) throw new StaffPinLoginError('resource-exhausted', 'Too many failed attempts. Try again later.')
  return { ...result, deviceRef }
}

async function resetDeviceRateLimit(db, deviceRef, nowMs) {
  await deviceRef.set({
    attemptCount: 0,
    windowStartedAt: null,
    lockedUntil: null,
    lastSucceededAt: Timestamp.fromMillis(nowMs),
    updatedAt: Timestamp.fromMillis(nowMs)
  }, { merge: true })
}

async function writeFailureAudit(db, { reason, deviceRateId, networkRateId, nowMs }) {
  await db.collection('securityLoginAudit').add({
    action: 'staff_pin_login_failed',
    reason,
    deviceRateId,
    networkRateId,
    createdAt: Timestamp.fromMillis(nowMs)
  })
}

async function findCandidateProfiles({ db, pin, secret }) {
  const lookupKey = derivePinLookupKey(pin, secret)
  const preferredSnapshot = await db.collection('staffPinCredentials').where('lookupKey', '==', lookupKey).limit(3).get()
  if (!preferredSnapshot.empty) {
    const matches = []
    for (const credentialSnapshot of preferredSnapshot.docs) {
      const credential = credentialSnapshot.data()
      if (credential.active === true && await verifyServerPinCredential(pin, secret, credential)) {
        const profileSnapshot = await db.doc(`users/${credentialSnapshot.id}`).get()
        if (profileSnapshot.exists) {
          matches.push({
            profileId: credentialSnapshot.id,
            profile: profileSnapshot.data(),
            source: 'server_credential'
          })
        }
      }
    }
    return { matches, ambiguous: matches.length > 1, source: 'server_credential' }
  }

  const legacyHash = deriveLegacyPinHash(pin)
  const legacySnapshot = await db.collection('users').where('pinHash', '==', legacyHash).limit(3).get()
  const matches = legacySnapshot.docs.map(profileSnapshot => ({
    profileId: profileSnapshot.id,
    profile: profileSnapshot.data(),
    source: 'legacy_pin_hash'
  }))
  return { matches, ambiguous: matches.length > 1, source: 'legacy_pin_hash' }
}

function validateCandidate(candidate) {
  if (!candidate || candidate.profile?.active !== true || candidate.profile?.deleted === true || candidate.profile?.deletedAt) {
    throw publicLoginFailure()
  }
  const homeValidation = validateBhtHomeLocation(candidate.profile)
  if (!homeValidation.valid) throw publicLoginFailure()
}

async function loadEffectiveAccessScope(db, profileId, profile, nowMs) {
  const [grantSnapshot, issueSnapshot] = await Promise.all([
    db.collection('accessGrants').where('userId', '==', profileId).get(),
    db.doc(`issueAccess/${profileId}`).get()
  ])
  const activeGrants = grantSnapshot.docs
    .map(snapshot => snapshot.data() || {})
    .filter(grant => grant.revoked !== true
      && !grant.revokedAt
      && millis(grant.startsAt) <= nowMs
      && millis(grant.expiresAt) > nowMs)
  const backupLocations = activeGrants.map(grant => String(grant.locationId || '').trim()).filter(Boolean)
  const issueAccess = issueSnapshot.data() || {}
  const issueLocations = issueSnapshot.exists && issueAccess.active === true && Array.isArray(issueAccess.locationIds)
    ? issueAccess.locationIds.map(value => String(value || '').trim()).filter(Boolean)
    : []
  const unique = values => [...new Set(values)]
  const scopeExpiryMs = activeGrants.reduce((earliest, grant) => {
    const expiresAtMs = millis(grant.expiresAt)
    return expiresAtMs > 0 && (!earliest || expiresAtMs < earliest) ? expiresAtMs : earliest
  }, 0)
  return {
    authorizedLocations: unique([
      ...(Array.isArray(profile.authorizedLocations) ? profile.authorizedLocations : []),
      ...backupLocations
    ]),
    issueLocationIds: unique([
      ...(Array.isArray(profile.issueLocationIds) ? profile.issueLocationIds : []),
      ...issueLocations
    ]),
    scopeExpiryMs
  }
}

async function ensureStableAuthUser(auth, profileId, profile, secret) {
  const authUid = deriveStableStaffAuthUid(profileId, secret)
  let authUser
  try {
    authUser = await auth.getUser(authUid)
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error
    authUser = await auth.createUser({ uid: authUid, displayName: String(profile.name || '').slice(0, 128) || undefined })
  }
  if (authUser.disabled === true) throw publicLoginFailure()
  return authUid
}

function sessionResponse(sessionId, session) {
  const absoluteExpiresAtMs = millis(session.expiresAt)
  const scopeExpiresAtMs = millis(session.scopeExpiresAt)
  return {
    id: sessionId,
    issuedAtMs: millis(session.issuedAt),
    expiresAtMs: absoluteExpiresAtMs,
    absoluteExpiresAtMs,
    scopeExpiresAtMs: scopeExpiresAtMs || null,
    absoluteMaxHours: 84,
    securityVersion: Number(session.securityVersion || 1)
  }
}

export async function beginDormantStaffPinSession({
  db,
  auth,
  secret,
  requestData,
  sourceAddress = 'unknown',
  appCheckPresent = false,
  nowMs = Date.now()
}) {
  await requireEnabledConfig(db)
  const { pin, deviceId, operationId } = validateRequest(requestData)
  const deviceRateId = derivePrivateIdentifier(deviceId, 'staff-pin-device-rate-v2', secret, 32)
  const networkRateId = derivePrivateIdentifier(sourceAddress || 'unknown', 'staff-pin-network-rate-v2', secret, 32)
  const rate = await reserveRateCapacity({ db, deviceRateId, networkRateId, nowMs })

  const candidates = await findCandidateProfiles({ db, pin, secret })
  if (candidates.ambiguous || candidates.matches.length !== 1) {
    await writeFailureAudit(db, { reason: candidates.ambiguous ? 'ambiguous_profile' : 'invalid_credentials', deviceRateId, networkRateId, nowMs })
    if (rate.deviceAtLimit) throw new StaffPinLoginError('resource-exhausted', 'Too many failed attempts. Try again later.')
    throw publicLoginFailure()
  }

  const candidate = candidates.matches[0]
  try {
    validateCandidate(candidate)
  } catch (error) {
    await writeFailureAudit(db, { reason: 'inactive_deleted_or_invalid_profile', deviceRateId, networkRateId, nowMs })
    if (rate.deviceAtLimit) throw new StaffPinLoginError('resource-exhausted', 'Too many failed attempts. Try again later.')
    throw error
  }

  const authUid = await ensureStableAuthUser(auth, candidate.profileId, candidate.profile, secret)
  const deviceHash = derivePrivateIdentifier(deviceId, 'staff-device-session-v2', secret)
  const sessionId = `session_${derivePrivateIdentifier(`${candidate.profileId}:${deviceHash}`, 'staff-session-id-v2', secret)}`
  const operationHash = derivePrivateIdentifier(operationId, 'staff-login-operation-v2', secret)
  const sessionRef = db.doc(`staffSessions/${sessionId}`)
  const identityRef = db.doc(`staffAuthIdentities/${candidate.profileId}`)
  const mappingRef = db.doc(`usersByAuthUid/${authUid}`)
  const profileRef = db.doc(`users/${candidate.profileId}`)
  const credentialRef = db.doc(`staffPinCredentials/${candidate.profileId}`)
  const auditRef = db.doc(`securityLoginAudit/login_${operationHash}`)
  const upgradedCredential = candidate.source === 'legacy_pin_hash'
    ? await createServerPinCredential(pin, secret)
    : null

  const transactionResult = await db.runTransaction(async transaction => {
    const [configSnapshot, profileSnapshot, credentialSnapshot, identitySnapshot, mappingSnapshot, existingSessionSnapshot] = await Promise.all([
      transaction.get(db.doc(CONFIG_PATH)),
      transaction.get(profileRef),
      transaction.get(credentialRef),
      transaction.get(identityRef),
      transaction.get(mappingRef),
      transaction.get(sessionRef)
    ])
    if (!configSnapshot.exists || !activeConfig(configSnapshot.data())) {
      throw new StaffPinLoginError('failed-precondition', 'Server PIN login is not enabled.')
    }
    const currentProfile = profileSnapshot.data() || {}
    validateCandidate({ profileId: candidate.profileId, profile: currentProfile })
    if (candidate.source === 'server_credential') {
      const currentCredential = credentialSnapshot.data() || {}
      if (!credentialSnapshot.exists || currentCredential.active !== true || !await verifyServerPinCredential(pin, secret, currentCredential)) {
        throw publicLoginFailure()
      }
    } else if (currentProfile.pinHash !== deriveLegacyPinHash(pin)) {
      throw publicLoginFailure()
    }
    if (identitySnapshot.exists && identitySnapshot.data().authUid !== authUid) {
      throw new StaffPinLoginError('failed-precondition', 'Staff identity mapping needs administrator review.')
    }
    if (mappingSnapshot.exists && mappingSnapshot.data().userId !== candidate.profileId) {
      throw new StaffPinLoginError('failed-precondition', 'Staff identity mapping needs administrator review.')
    }
    if (currentProfile.authUid && currentProfile.authUid !== authUid) {
      throw new StaffPinLoginError('failed-precondition', 'Staff identity mapping needs administrator review.')
    }

    const securityVersion = Number(currentProfile.securityVersion || 1)
    const existingSession = existingSessionSnapshot.data() || null
    let session
    let replayed = false
    if (existingSession && existingSession.operationHash === operationHash) {
      const sessionValidation = evaluateDeviceSession({
        ...existingSession,
        issuedAtMs: millis(existingSession.issuedAt),
        expiresAtMs: millis(existingSession.expiresAt),
        scopeExpiresAtMs: millis(existingSession.scopeExpiresAt),
        revokedAtMs: millis(existingSession.revokedAt)
      }, {
        nowMs,
        authUid,
        profileId: candidate.profileId,
        currentSecurityVersion: securityVersion
      })
      if (!sessionValidation.valid) {
        throw new StaffPinLoginError('failed-precondition', 'This login attempt can no longer be replayed. Start a new sign-in.')
      }
      session = existingSession
      replayed = true
    } else {
      session = {
        schemaVersion: 2,
        profileId: candidate.profileId,
        authUid,
        deviceHash,
        operationHash,
        securityVersion,
        issuedAt: Timestamp.fromMillis(nowMs),
        expiresAt: Timestamp.fromMillis(nowMs + SESSION_ABSOLUTE_MAX_MS),
        revokedAt: null,
        revocationReason: '',
        active: true,
        updatedAt: Timestamp.fromMillis(nowMs)
      }
      transaction.set(sessionRef, session)
    }

    transaction.set(identityRef, {
      schemaVersion: 2,
      profileId: candidate.profileId,
      authUid,
      updatedAt: Timestamp.fromMillis(nowMs)
    }, { merge: true })
    transaction.set(mappingRef, {
      userId: candidate.profileId,
      linkedBy: 'server_verified_pin_v2',
      linkedAt: Timestamp.fromMillis(nowMs),
      updatedAt: Timestamp.fromMillis(nowMs),
      version: 2
    }, { merge: true })
    const profileUpdate = { authUid, securityVersion, updatedAt: Timestamp.fromMillis(nowMs) }
    transaction.set(profileRef, profileUpdate, { merge: true })
    if (upgradedCredential) {
      transaction.set(credentialRef, {
        ...upgradedCredential,
        active: true,
        migratedFrom: 'legacy_pin_hash_v2',
        createdAt: Timestamp.fromMillis(nowMs),
        updatedAt: Timestamp.fromMillis(nowMs)
      })
      transaction.set(db.doc(`staffPinLookup/${upgradedCredential.lookupKey}`), {
        profileId: candidate.profileId,
        active: true,
        migratedFrom: 'legacy_pin_hash_v2',
        updatedAt: Timestamp.fromMillis(nowMs)
      }, { merge: true })
    }
    transaction.set(auditRef, {
      action: 'staff_pin_session_created',
      profileId: candidate.profileId,
      authUid,
      sessionId,
      deviceHash,
      operationHash,
      replayed,
      credentialSource: candidate.source,
      appCheckPresent: appCheckPresent === true,
      createdAt: Timestamp.fromMillis(nowMs)
    }, { merge: true })
    return { currentProfile, securityVersion, session, replayed }
  })

  await resetDeviceRateLimit(db, rate.deviceRef, nowMs)
  const workflowConfigSnapshot = await db.doc('appSettings/securityWorkflows').get()
  const rolloutClaims = workflowTokenClaims(workflowConfigSnapshot.data() || {})
  const effectiveScope = await loadEffectiveAccessScope(db, candidate.profileId, transactionResult.currentProfile, nowMs)
  const sanitizedProfile = sanitizeStaffProfile(candidate.profileId, {
    ...transactionResult.currentProfile,
    authorizedLocations: effectiveScope.authorizedLocations,
    issueLocationIds: effectiveScope.issueLocationIds
  })
  const absoluteExpiryMs = millis(transactionResult.session.expiresAt)
  const scopeExpiresAtMs = effectiveScope.scopeExpiryMs > 0
    ? Math.min(effectiveScope.scopeExpiryMs, absoluteExpiryMs)
    : 0
  if (scopeExpiresAtMs > 0) {
    transactionResult.session.scopeExpiresAt = Timestamp.fromMillis(scopeExpiresAtMs)
    await sessionRef.set({ scopeExpiresAt: transactionResult.session.scopeExpiresAt, updatedAt: Timestamp.fromMillis(nowMs) }, { merge: true })
  } else if (transactionResult.session.scopeExpiresAt) {
    transactionResult.session.scopeExpiresAt = null
    await sessionRef.set({ scopeExpiresAt: null, updatedAt: Timestamp.fromMillis(nowMs) }, { merge: true })
  }
  let customToken
  try {
    customToken = await auth.createCustomToken(authUid, {
      profileId: candidate.profileId,
      role: String(transactionResult.currentProfile.role || ''),
      authorizedLocations: Array.isArray(sanitizedProfile.authorizedLocations) ? sanitizedProfile.authorizedLocations : [],
      issueLocationIds: Array.isArray(sanitizedProfile.issueLocationIds) ? sanitizedProfile.issueLocationIds : [],
      locationId: String(sanitizedProfile.locationId || ''),
      securityVersion: transactionResult.securityVersion,
      sessionId,
      sessionVersion: 2,
      ...rolloutClaims
    })
  } catch (error) {
    await auditRef.set({ tokenIssueFailedAt: Timestamp.fromMillis(nowMs), tokenIssueError: String(error?.code || 'token_issue_failed') }, { merge: true })
    throw new StaffPinLoginError('internal', 'A secure session could not be issued. Try again.')
  }
  await auditRef.set({ tokenIssuedAt: Timestamp.fromMillis(nowMs) }, { merge: true })

  return {
    customToken,
    profile: sanitizedProfile,
    session: sessionResponse(sessionId, transactionResult.session),
    replayed: transactionResult.replayed
  }
}

export function sessionRecordIsCurrent(sessionId, session, { nowMs, authUid, profileId, currentSecurityVersion }) {
  return evaluateDeviceSession({
    ...session,
    sessionId,
    issuedAtMs: millis(session?.issuedAt),
    expiresAtMs: millis(session?.expiresAt),
    scopeExpiresAtMs: millis(session?.scopeExpiresAt),
    revokedAtMs: millis(session?.revokedAt)
  }, { nowMs, authUid, profileId, currentSecurityVersion })
}
