import { Timestamp } from 'firebase-admin/firestore'
import { derivePrivateIdentifier } from './staffPinCredentialModel.js'
import { loadMappedActor, StaffAccountSecurityError } from './staffAccountSecurityService.js'
import { evaluateOfflineReplayAuthorization, offlineReplayEnabled } from './offlineReplaySecurityModel.js'

const CONFIG_PATH = 'appSettings/securityFoundation'

function operationId(value) {
  const normalized = String(value || '').trim()
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(normalized)) {
    throw new StaffAccountSecurityError('invalid-argument', 'A unique offline replay operation ID is required.')
  }
  return normalized
}

export async function authorizeDormantOfflineReplay({ db, secret, requestAuth, requestData = {}, appCheckPresent = false, nowMs = Date.now() }) {
  const configSnapshot = await db.doc(CONFIG_PATH).get()
  if (!configSnapshot.exists || !offlineReplayEnabled(configSnapshot.data())) {
    throw new StaffAccountSecurityError('failed-precondition', 'Protected offline replay is not enabled.')
  }
  const actor = await loadMappedActor({ db, requestAuth, nowMs, requireCurrentSession: true })
  const rawOperationId = operationId(requestData.operationId)
  const operationHash = derivePrivateIdentifier(rawOperationId, 'offline-replay-operation-v5', secret)
  const auditRef = db.doc(`securityOfflineReplayAudit/replay_${operationHash}`)
  const fingerprint = derivePrivateIdentifier(JSON.stringify({
    actorProfileId: actor.id,
    actionId: String(requestData.actionId || ''),
    actionType: String(requestData.actionType || ''),
    ownerProfileId: String(requestData.ownerProfileId || ''),
    ownerAuthUid: String(requestData.ownerAuthUid || ''),
    locationId: String(requestData.locationId || ''),
    expectedVersion: Number(requestData.expectedVersion || 0)
  }), 'offline-replay-fingerprint-v5', secret)

  const prior = await auditRef.get()
  if (prior.exists) {
    if (prior.data()?.actorAuthUid !== actor.authUid || prior.data()?.fingerprint !== fingerprint) {
      throw new StaffAccountSecurityError('already-exists', 'That offline replay operation ID was already used.')
    }
    return prior.data().result
  }

  const decision = evaluateOfflineReplayAuthorization({ actor, request: requestData })
  if (!decision.allowed) throw new StaffAccountSecurityError('permission-denied', `Offline work cannot replay (${decision.reason}).`)
  const result = {
    authorizationId: auditRef.id,
    profileId: actor.id,
    authUid: actor.authUid,
    sessionId: actor.sessionId,
    securityVersion: Number(actor.securityVersion || 1),
    actionId: String(requestData.actionId || ''),
    actionType: String(requestData.actionType || ''),
    locationId: String(requestData.locationId || ''),
    authorizedAtMs: nowMs
  }
  await auditRef.create({
    schemaVersion: 5,
    action: 'offline_replay_authorized',
    actorProfileId: actor.id,
    actorAuthUid: actor.authUid,
    appCheckPresent: appCheckPresent === true,
    fingerprint,
    result,
    createdAt: Timestamp.fromMillis(nowMs)
  })
  return result
}
