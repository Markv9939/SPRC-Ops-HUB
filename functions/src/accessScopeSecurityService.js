import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { derivePrivateIdentifier } from './staffPinCredentialModel.js'
import { StaffAccountSecurityError, loadMappedActor } from './staffAccountSecurityService.js'
import { protectedAccountActionsEnabled, validateManagedProfile } from './staffAccountSecurityModel.js'

const CONFIG_PATH = 'appSettings/securityFoundation'

export const ACCESS_SCOPE_ACTIONS = Object.freeze({
  GRANT_BACKUP_ACCESS: 'grant_backup_access',
  REVOKE_BACKUP_ACCESS: 'revoke_backup_access',
  SAVE_ISSUE_ACCESS: 'save_issue_access'
})

const ACTION_VALUES = new Set(Object.values(ACCESS_SCOPE_ACTIONS))

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

function cleanReason(value) {
  const reason = String(value || '').trim().slice(0, 500).replace(/\b\d{6}\b/g, '[redacted]')
  if (!reason) throw new StaffAccountSecurityError('invalid-argument', 'A reason is required.')
  return reason
}

function cleanLocation(value) {
  const locationId = String(value || '').trim().toUpperCase()
  if (!['OTC', 'RES'].includes(locationId)) {
    throw new StaffAccountSecurityError('invalid-argument', 'Location is invalid.')
  }
  return locationId
}

function cleanIssueLocations(value) {
  if (!Array.isArray(value)) throw new StaffAccountSecurityError('invalid-argument', 'Issue locations must be a list.')
  const normalized = [...new Set(value.map(item => String(item || '').trim().toLowerCase()).filter(Boolean))]
  if (normalized.some(item => !['mesquite', 'lone_mountain', 'test_house', 'res'].includes(item))) {
    throw new StaffAccountSecurityError('invalid-argument', 'One or more issue locations are invalid.')
  }
  return normalized
}

function millis(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (value instanceof Date) return value.getTime()
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function fingerprint({ actorProfileId, targetProfileId, action, requestData }) {
  return JSON.stringify({
    actorProfileId,
    targetProfileId,
    action,
    grantId: String(requestData.grantId || ''),
    locationId: String(requestData.locationId || ''),
    startsAtMs: millis(requestData.startsAt || requestData.startsOn),
    expiresAtMs: millis(requestData.expiresAt || requestData.expiresOn),
    locationIds: Array.isArray(requestData.locationIds) ? requestData.locationIds : null,
    active: requestData.active === true,
    reason: String(requestData.reason || '').trim()
  })
}

async function closeAllTargetSessions({ db, auth, targetProfileId, authUid, operationHash, nowMs }) {
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
          revocationReason: 'authorization_scope_changed',
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
    grantId: audit.grantId || null,
    securityVersion: Number(audit.resultSecurityVersion || 1),
    allDevicesRevoked: true,
    cleanupStatus: cleanup?.status || audit.cleanupStatus || 'pending',
    replayed: replayed === true
  }
}

export async function performDormantAccessScopeAction({
  db,
  auth,
  secret,
  requestData = {},
  requestAuth,
  appCheckPresent = false,
  nowMs = Date.now()
}) {
  const action = String(requestData.action || '').trim()
  if (!ACTION_VALUES.has(action)) throw new StaffAccountSecurityError('invalid-argument', 'The requested access action is not supported.')
  const operationId = cleanOperationId(requestData.operationId)
  const operationHash = `scope_${derivePrivateIdentifier(operationId, 'access-scope-operation-v4', secret)}`
  const auditRef = db.doc(`securityAccountAudit/${operationHash}`)
  const actor = await loadMappedActor({ db, requestAuth, nowMs, requireCurrentSession: true })
  if (String(actor.role || '').toLowerCase() !== 'admin') {
    throw new StaffAccountSecurityError('permission-denied', 'Only administrators may change temporary or issue access.')
  }

  const priorAudit = await auditRef.get()
  if (priorAudit.exists) {
    const prior = priorAudit.data() || {}
    if (prior.actorAuthUid !== actor.authUid) throw new StaffAccountSecurityError('permission-denied', 'That protected operation belongs to another Firebase identity.')
    const expected = derivePrivateIdentifier(fingerprint({
      actorProfileId: actor.id,
      targetProfileId: prior.targetProfileId,
      action,
      requestData
    }), 'access-scope-fingerprint-v4', secret)
    if (prior.fingerprint !== expected) throw new StaffAccountSecurityError('already-exists', 'That operation ID was already used for a different request.')
    const cleanup = await closeAllTargetSessions({ db, auth, targetProfileId: prior.targetProfileId, authUid: prior.targetAuthUid, operationHash, nowMs })
    return publicResult(prior, cleanup, true)
  }

  let grantSnapshot = null
  let grantRef = null
  let targetProfileId = String(requestData.targetProfileId || requestData.userId || '').trim()
  if (action === ACCESS_SCOPE_ACTIONS.REVOKE_BACKUP_ACCESS) {
    grantRef = db.doc(`accessGrants/${cleanId(requestData.grantId, 'Grant ID')}`)
    grantSnapshot = await grantRef.get()
    if (!grantSnapshot.exists) throw new StaffAccountSecurityError('not-found', 'The backup access grant is unavailable.')
    targetProfileId = String(grantSnapshot.data()?.userId || '').trim()
  }
  targetProfileId = cleanId(targetProfileId, 'Target profile ID')
  const targetRef = db.doc(`users/${targetProfileId}`)
  const [targetSnapshot, identitySnapshot] = await Promise.all([
    targetRef.get(),
    db.doc(`staffAuthIdentities/${targetProfileId}`).get()
  ])
  const target = targetSnapshot.data() || {}
  if (!targetSnapshot.exists || target.deleted === true || target.deletedAt) {
    throw new StaffAccountSecurityError('not-found', 'The staff profile is unavailable.')
  }
  if (!validateManagedProfile(target).valid) {
    throw new StaffAccountSecurityError('failed-precondition', 'This staff profile configuration needs administrator correction.')
  }
  const targetAuthUid = String(target.authUid || identitySnapshot.data()?.authUid || '').trim()
  const requestFingerprint = derivePrivateIdentifier(fingerprint({ actorProfileId: actor.id, targetProfileId, action, requestData }), 'access-scope-fingerprint-v4', secret)
  const timestamp = Timestamp.fromMillis(nowMs)

  let scopeRef
  let scopePayload
  let grantId = ''
  if (action === ACCESS_SCOPE_ACTIONS.GRANT_BACKUP_ACCESS) {
    const startsAtMs = millis(requestData.startsAt || requestData.startsOn)
    const expiresAtMs = millis(requestData.expiresAt || requestData.expiresOn)
    if (!startsAtMs || !expiresAtMs || startsAtMs > expiresAtMs) {
      throw new StaffAccountSecurityError('invalid-argument', 'A valid backup-access date range is required.')
    }
    grantId = `grant_${derivePrivateIdentifier(operationId, 'access-grant-id-v4', secret, 32)}`
    scopeRef = db.doc(`accessGrants/${grantId}`)
    scopePayload = {
      userId: targetProfileId,
      userName: String(target.name || targetProfileId).trim().slice(0, 160),
      locationId: cleanLocation(requestData.locationId),
      startsAt: Timestamp.fromMillis(startsAtMs),
      expiresAt: Timestamp.fromMillis(expiresAtMs),
      reason: cleanReason(requestData.reason),
      revoked: false,
      revokedAt: null,
      revokedReason: null,
      version: 1,
      createdByUserId: actor.id,
      createdByName: String(actor.name || actor.id).trim().slice(0, 160),
      createdAt: timestamp,
      updatedAt: timestamp
    }
  } else if (action === ACCESS_SCOPE_ACTIONS.REVOKE_BACKUP_ACCESS) {
    grantId = grantRef.id
    scopeRef = grantRef
    scopePayload = {
      revoked: true,
      revokedAt: timestamp,
      revokedReason: cleanReason(requestData.reason),
      revokedByUserId: actor.id,
      revokedByName: String(actor.name || actor.id).trim().slice(0, 160),
      updatedAt: timestamp
    }
  } else {
    scopeRef = db.doc(`issueAccess/${targetProfileId}`)
    scopePayload = {
      userId: targetProfileId,
      locationIds: cleanIssueLocations(requestData.locationIds),
      active: requestData.active === true,
      updatedByUserId: actor.id,
      updatedAt: timestamp
    }
  }

  const transactionResult = await db.runTransaction(async transaction => {
    const [configSnapshot, freshTargetSnapshot, existingAudit, freshScopeSnapshot] = await Promise.all([
      transaction.get(db.doc(CONFIG_PATH)), transaction.get(targetRef), transaction.get(auditRef), transaction.get(scopeRef)
    ])
    if (!configSnapshot.exists || !protectedAccountActionsEnabled(configSnapshot.data())) {
      throw new StaffAccountSecurityError('failed-precondition', 'Protected staff account actions are not enabled.')
    }
    if (existingAudit.exists) return { audit: existingAudit.data(), replayed: true }
    const freshTarget = freshTargetSnapshot.data() || {}
    if (!freshTargetSnapshot.exists || freshTarget.deleted === true || freshTarget.deletedAt) {
      throw new StaffAccountSecurityError('not-found', 'The staff profile is unavailable.')
    }
    if (action === ACCESS_SCOPE_ACTIONS.GRANT_BACKUP_ACCESS && freshScopeSnapshot.exists) {
      throw new StaffAccountSecurityError('already-exists', 'That backup access operation already exists.')
    }
    if (action === ACCESS_SCOPE_ACTIONS.REVOKE_BACKUP_ACCESS) {
      const freshGrant = freshScopeSnapshot.data() || {}
      if (!freshScopeSnapshot.exists || freshGrant.userId !== targetProfileId) {
        throw new StaffAccountSecurityError('not-found', 'The backup access grant is unavailable.')
      }
      if (freshGrant.revoked === true || freshGrant.revokedAt) {
        throw new StaffAccountSecurityError('failed-precondition', 'That backup access grant is already revoked.')
      }
      transaction.set(scopeRef, { ...scopePayload, version: Number(freshGrant.version || 0) + 1 }, { merge: true })
    } else if (action === ACCESS_SCOPE_ACTIONS.SAVE_ISSUE_ACCESS) {
      transaction.set(scopeRef, {
        ...scopePayload,
        version: Number(freshScopeSnapshot.data()?.version || 0) + 1,
        createdAt: freshScopeSnapshot.exists ? freshScopeSnapshot.data()?.createdAt || timestamp : timestamp
      }, { merge: true })
    } else {
      transaction.create(scopeRef, scopePayload)
    }

    const nextSecurityVersion = Number(freshTarget.securityVersion || 1) + 1
    transaction.set(targetRef, { securityVersion: nextSecurityVersion, version: Number(freshTarget.version || 0) + 1, updatedAt: timestamp }, { merge: true })
    const audit = {
      schemaVersion: 4,
      action,
      actorProfileId: actor.id,
      actorAuthUid: actor.authUid,
      actorRole: 'admin',
      targetProfileId,
      targetAuthUid,
      grantId: grantId || null,
      locationId: action === ACCESS_SCOPE_ACTIONS.SAVE_ISSUE_ACCESS ? null : (scopePayload.locationId || grantSnapshot?.data()?.locationId || null),
      issueLocationIds: action === ACCESS_SCOPE_ACTIONS.SAVE_ISSUE_ACCESS ? scopePayload.locationIds : null,
      reason: action === ACCESS_SCOPE_ACTIONS.SAVE_ISSUE_ACCESS ? cleanReason(requestData.reason) : scopePayload.reason || scopePayload.revokedReason,
      fingerprint: requestFingerprint,
      triggers: ['authorization_scope_changed'],
      allDevicesRevoked: true,
      cleanupStatus: 'pending',
      appCheckPresent: appCheckPresent === true,
      resultSecurityVersion: nextSecurityVersion,
      createdAt: timestamp
    }
    transaction.create(auditRef, audit)
    return { audit, replayed: false }
  })

  const cleanup = await closeAllTargetSessions({ db, auth, targetProfileId, authUid: targetAuthUid, operationHash, nowMs })
  await auditRef.set({ cleanupStatus: cleanup.status, cleanupCompletedAt: cleanup.status === 'completed' ? timestamp : null }, { merge: true })
  return publicResult(transactionResult.audit, cleanup, transactionResult.replayed)
}
