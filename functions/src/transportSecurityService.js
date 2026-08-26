import { Timestamp } from 'firebase-admin/firestore'
import { loadMappedActor, StaffAccountSecurityError } from './staffAccountSecurityService.js'
import { derivePrivateIdentifier } from './staffPinCredentialModel.js'
import { actorCanCreateTransport, newProtectedTransport, normalizeTransportSite } from './transportSecurityModel.js'
import { workflowSecurityEnabled } from './workflowSecurityModel.js'

function cleanOperationId(value) {
  const normalized = String(value || '').trim()
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(normalized)) {
    throw new StaffAccountSecurityError('invalid-argument', 'A unique transport operation ID is required.')
  }
  return normalized
}

export async function createProtectedTransport({ db, secret, requestAuth, requestData = {}, appCheckPresent = false, nowMs = Date.now() }) {
  const configSnapshot = await db.doc('appSettings/securityWorkflows').get()
  if (!configSnapshot.exists || !workflowSecurityEnabled(configSnapshot.data(), 'transports')) {
    throw new StaffAccountSecurityError('failed-precondition', 'Protected transport mutations are not enabled.')
  }
  const actor = await loadMappedActor({ db, requestAuth, nowMs, requireCurrentSession: true })
  const site = normalizeTransportSite(requestData.site)
  if (!actorCanCreateTransport(actor, site)) {
    throw new StaffAccountSecurityError('permission-denied', 'You cannot create a transport for that site.')
  }
  const operationHash = derivePrivateIdentifier(cleanOperationId(requestData.operationId), 'transport-create-v6', secret)
  const transportRef = db.doc(`transports/secure_transport_${operationHash}`)
  const lockRef = db.doc(`securityWorkflowLocks/activeTransport_${actor.id}`)
  const auditRef = db.doc(`securityWorkflowAudit/transport_create_${operationHash}`)
  const timestamp = Timestamp.fromMillis(nowMs)
  return db.runTransaction(async transaction => {
    const activeQuery = db.collection('transports')
      .where('createdByUserId', '==', actor.id)
      .where('status', 'in', ['open', 'arrived'])
      .limit(2)
    const [auditSnapshot, lockSnapshot, transportSnapshot, activeSnapshot] = await Promise.all([
      transaction.get(auditRef),
      transaction.get(lockRef),
      transaction.get(transportRef),
      transaction.get(activeQuery)
    ])
    if (auditSnapshot.exists) return auditSnapshot.data().result
    const active = activeSnapshot.docs.find(snapshot => snapshot.id !== transportRef.id)
    if (active) {
      throw new StaffAccountSecurityError('failed-precondition', `An active transport already exists (${active.id}).`)
    }
    if (lockSnapshot.exists) {
      const lockedId = String(lockSnapshot.data()?.transportId || '').trim()
      if (lockedId && lockedId !== transportRef.id) {
        const lockedSnapshot = await transaction.get(db.doc(`transports/${lockedId}`))
        if (lockedSnapshot.exists && ['open', 'arrived'].includes(lockedSnapshot.data()?.status)) {
          throw new StaffAccountSecurityError('failed-precondition', `An active transport already exists (${lockedId}).`)
        }
      }
    }
    const record = transportSnapshot.exists
      ? transportSnapshot.data()
      : newProtectedTransport({ actor, site, now: timestamp })
    if (!transportSnapshot.exists) transaction.create(transportRef, record)
    transaction.set(lockRef, {
      schemaVersion: 6,
      profileId: actor.id,
      transportId: transportRef.id,
      active: true,
      updatedAt: timestamp
    })
    const result = { transportId: transportRef.id, record: { ...record, departedAtMs: nowMs, createdAtMs: nowMs, updatedAtMs: nowMs } }
    transaction.create(auditRef, {
      schemaVersion: 6,
      action: 'protected_transport_created',
      actorProfileId: actor.id,
      actorAuthUid: actor.authUid,
      sessionId: actor.sessionId,
      transportId: transportRef.id,
      site,
      appCheckPresent: appCheckPresent === true,
      result,
      immutable: true,
      createdAt: timestamp
    })
    return result
  })
}
