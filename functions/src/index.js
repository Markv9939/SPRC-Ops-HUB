import crypto from 'node:crypto'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { defineSecret } from 'firebase-functions/params'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { attachmentNeedsDeletion, summarizeCleanupResults } from './retentionModel.js'
import {
  actorCanAccessEocLocation,
  flattenPassIssueQuestions,
  normalizePublishedEocSection,
  normalizePublishedEocTemplate
} from './eocTemplateAdminModel.js'
import { StaffPinLoginError, beginDormantStaffPinSession } from './staffPinLoginService.js'
import {
  StaffAccountSecurityError,
  loadMappedActor,
  performDormantStaffSecurityAction
} from './staffAccountSecurityService.js'
import { authorizeDormantOfflineReplay } from './offlineReplaySecurityService.js'
import { workflowSecurityEnabled } from './workflowSecurityModel.js'
import { createProtectedTransport } from './transportSecurityService.js'
import { ACCESS_SCOPE_ACTIONS, performDormantAccessScopeAction } from './accessScopeSecurityService.js'
import { mutateProtectedIssue, submitProtectedEoc } from './operationalMutationSecurityService.js'

initializeApp()
const db = getFirestore()
const bucket = () => getStorage().bucket()
const PIN_PEPPER = 'sprc-pin-v2-6digit'
const PIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000
const PIN_MAX_ATTEMPTS = 5
const STAFF_PIN_AUTH_SECRET = defineSecret('STAFF_PIN_AUTH_SECRET')
const EOC_ASSIGNMENT_SHIFTS = new Set([
  'shift_1',
  'shift_2',
  'res_shift_1_day',
  'res_shift_1_night',
  'res_shift_2_day',
  'res_shift_2_night'
])

function cleanId(value, maximum = 160) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, maximum)
}

async function requireMappedActor(request, roles = ['supervisor', 'admin']) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'A Firebase session is required.')
  const workflowConfigSnapshot = await db.doc('appSettings/securityWorkflows').get()
  const workflowConfig = workflowConfigSnapshot.data() || {}
  if (workflowSecurityEnabled(workflowConfig, 'templates_photos')) {
    const claims = request.auth.token || {}
    if (claims.workflowSecurityVersion !== 6
      || !Array.isArray(claims.secureWorkflows)
      || !claims.secureWorkflows.includes('templates_photos')) {
      throw new HttpsError('permission-denied', 'Sign in again before using protected template tools.')
    }
    try {
      const actor = await loadMappedActor({ db, requestAuth: request.auth, nowMs: Date.now(), requireCurrentSession: true })
      if (!roles.includes(actor.role)) throw new HttpsError('permission-denied', 'You do not have permission for this template action.')
      return {
        id: actor.id,
        authUid: actor.authUid,
        name: String(actor.name || '').trim() || 'Staff user',
        role: actor.role,
        authorizedLocations: Array.isArray(actor.authorizedLocations) ? actor.authorizedLocations : [],
        organizationId: String(actor.organizationId || '').trim() || 'sprc'
      }
    } catch (error) {
      if (error instanceof HttpsError) throw error
      if (error instanceof StaffAccountSecurityError) throw new HttpsError(error.code, error.message)
      throw error
    }
  }
  const mappingSnap = await db.doc(`usersByAuthUid/${request.auth.uid}`).get()
  const profileId = String(mappingSnap.data()?.userId || '').trim()
  if (!mappingSnap.exists || !profileId) throw new HttpsError('permission-denied', 'Your signed-in account is not linked to an active staff profile.')
  const profileSnap = await db.doc(`users/${profileId}`).get()
  const profile = profileSnap.data() || {}
  if (!profileSnap.exists || profile.active !== true || profile.deleted === true || !roles.includes(profile.role)) {
    throw new HttpsError('permission-denied', 'You do not have permission for this template action.')
  }
  return {
    id: profileId,
    authUid: request.auth.uid,
    name: String(profile.name || '').trim() || 'Staff user',
    role: profile.role,
    authorizedLocations: Array.isArray(profile.authorizedLocations) ? profile.authorizedLocations : [],
    organizationId: String(profile.organizationId || '').trim() || 'sprc'
  }
}

function eocOperationId(value) {
  const operationId = cleanId(value, 120)
  if (!operationId) throw new HttpsError('invalid-argument', 'A unique operation ID is required.')
  return operationId
}

export async function establishPinSessionHandler(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'A Firebase session is required.')
  const profileId = cleanId(request.data?.profileId)
  const pin = String(request.data?.pin || '').trim()
  if (!profileId || !/^\d{6}$/.test(pin)) throw new HttpsError('invalid-argument', 'Profile and six-digit PIN are required.')
  const profileRef = db.doc(`users/${profileId}`)
  const mappingRef = db.doc(`usersByAuthUid/${request.auth.uid}`)
  const rateKey = crypto.createHash('sha256').update(request.auth.uid).digest('hex').slice(0, 32)
  const rateRef = db.doc(`securityRateLimits/pinSession_${rateKey}`)
  const nowMs = Date.now()
  return db.runTransaction(async transaction => {
    const [profileSnap, rateSnap] = await Promise.all([transaction.get(profileRef), transaction.get(rateRef)])
    const profile = profileSnap.data() || {}
    const rate = rateSnap.data() || {}
    const lockedUntilMs = rate.lockedUntil?.toMillis?.() || 0
    if (lockedUntilMs > nowMs) throw new HttpsError('resource-exhausted', 'Too many failed attempts. Try again later.')
    const valid = profileSnap.exists && profile.active === true && profile.deleted !== true && profile.pinHash === hashPin(pin)
    if (!valid) {
      const windowStartedMs = rate.windowStartedAt?.toMillis?.() || 0
      const inWindow = windowStartedMs > 0 && nowMs - windowStartedMs < PIN_ATTEMPT_WINDOW_MS
      const failedAttempts = (inWindow ? Number(rate.failedAttempts || 0) : 0) + 1
      transaction.set(rateRef, {
        failedAttempts,
        windowStartedAt: inWindow ? rate.windowStartedAt : Timestamp.fromMillis(nowMs),
        lockedUntil: failedAttempts >= PIN_MAX_ATTEMPTS ? Timestamp.fromMillis(nowMs + PIN_ATTEMPT_WINDOW_MS) : null,
        lastFailedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true })
      return { valid: false, locked: failedAttempts >= PIN_MAX_ATTEMPTS }
    }
    transaction.set(mappingRef, {
      userId: profileId,
      linkedBy: 'verified_pin_session',
      linkedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      version: 1
    }, { merge: true })
    transaction.set(rateRef, { failedAttempts: 0, lockedUntil: null, lastSucceededAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    return { valid: true, profileId, role: profile.role || '' }
  }).then((result) => {
    if (result.locked) throw new HttpsError('resource-exhausted', 'Too many failed attempts. Try again later.')
    if (!result.valid) throw new HttpsError('permission-denied', 'PIN verification failed.')
    return { profileId: result.profileId, role: result.role }
  })
}

export const establishPinSession = onCall({ region: 'us-central1' }, establishPinSessionHandler)

const SECURITY_RUNTIME_SERVICE_ACCOUNT = 'sprc-security-runtime@sprc-tx-l.iam.gserviceaccount.com'

export async function beginStaffPinSessionV2Handler(request, dependencies = {}) {
  try {
    return await beginDormantStaffPinSession({
      db: dependencies.db || db,
      auth: dependencies.auth || getAuth(),
      secret: dependencies.secret || STAFF_PIN_AUTH_SECRET.value(),
      requestData: request.data,
      sourceAddress: dependencies.sourceAddress
        || request.rawRequest?.ip
        || String(request.rawRequest?.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
        || 'unknown',
      appCheckPresent: dependencies.appCheckPresent ?? Boolean(request.app),
      nowMs: dependencies.nowMs || Date.now()
    })
  } catch (error) {
    if (error instanceof StaffPinLoginError) throw new HttpsError(error.code, error.message)
    console.error('Dormant server PIN login failed without issuing a session.', {
      code: String(error?.code || 'unknown'),
      message: String(error?.message || 'Unknown server PIN login error')
    })
    throw new HttpsError('internal', 'A secure session could not be issued. Try again.')
  }
}

// This callable is off by default and also requires appSettings/securityFoundation
// schemaVersion 2 with serverPinLoginEnabled=true. The Phase 3 client reaches it
// only when its separate compile-time and versioned configuration gates also match.
export const beginStaffPinSessionV2 = onCall({
  region: 'us-central1',
  enforceAppCheck: false,
  serviceAccount: SECURITY_RUNTIME_SERVICE_ACCOUNT,
  secrets: [STAFF_PIN_AUTH_SECRET]
}, beginStaffPinSessionV2Handler)

export async function manageStaffSecurityV4Handler(request, dependencies = {}) {
  try {
    const action = String(request.data?.action || '').trim()
    const performer = Object.values(ACCESS_SCOPE_ACTIONS).includes(action)
      ? performDormantAccessScopeAction
      : performDormantStaffSecurityAction
    return await performer({
      db: dependencies.db || db,
      auth: dependencies.auth || getAuth(),
      secret: dependencies.secret || STAFF_PIN_AUTH_SECRET.value(),
      requestData: request.data,
      requestAuth: request.auth,
      appCheckPresent: dependencies.appCheckPresent ?? Boolean(request.app),
      nowMs: dependencies.nowMs || Date.now()
    })
  } catch (error) {
    if (error instanceof StaffAccountSecurityError) throw new HttpsError(error.code, error.message)
    console.error('Dormant protected staff security action failed.', {
      code: String(error?.code || 'unknown'),
      message: String(error?.message || 'Unknown protected staff security action error')
    })
    throw new HttpsError('internal', 'The protected staff account action could not be completed. Try again.')
  }
}

// Phase 4 remains dormant. Calls fail closed unless the versioned server setting
// explicitly enables protectedAccountActionsVersion=4 and protectedAccountActionsEnabled=true.
export const manageStaffSecurityV4 = onCall({
  region: 'us-central1',
  enforceAppCheck: false,
  serviceAccount: SECURITY_RUNTIME_SERVICE_ACCOUNT,
  secrets: [STAFF_PIN_AUTH_SECRET]
}, manageStaffSecurityV4Handler)

export async function authorizeOfflineReplayV5Handler(request, dependencies = {}) {
  try {
    return await authorizeDormantOfflineReplay({
      db: dependencies.db || db,
      secret: dependencies.secret || STAFF_PIN_AUTH_SECRET.value(),
      requestData: request.data,
      requestAuth: request.auth,
      appCheckPresent: dependencies.appCheckPresent ?? Boolean(request.app),
      nowMs: dependencies.nowMs || Date.now()
    })
  } catch (error) {
    if (error instanceof StaffAccountSecurityError) throw new HttpsError(error.code, error.message)
    console.error('Dormant protected offline replay authorization failed.', {
      code: String(error?.code || 'unknown'),
      message: String(error?.message || 'Unknown offline replay authorization error')
    })
    throw new HttpsError('internal', 'Offline work could not be authorized for replay. Try again.')
  }
}

export const authorizeOfflineReplayV5 = onCall({
  region: 'us-central1',
  enforceAppCheck: false,
  secrets: [STAFF_PIN_AUTH_SECRET]
}, authorizeOfflineReplayV5Handler)

export async function createProtectedTransportV6Handler(request, dependencies = {}) {
  try {
    return await createProtectedTransport({
      db: dependencies.db || db,
      secret: dependencies.secret || STAFF_PIN_AUTH_SECRET.value(),
      requestAuth: request.auth,
      requestData: request.data,
      appCheckPresent: dependencies.appCheckPresent ?? Boolean(request.app),
      nowMs: dependencies.nowMs || Date.now()
    })
  } catch (error) {
    if (error instanceof StaffAccountSecurityError) throw new HttpsError(error.code, error.message)
    console.error('Dormant protected transport creation failed.', {
      code: String(error?.code || 'unknown'),
      message: String(error?.message || 'Unknown protected transport error')
    })
    throw new HttpsError('internal', 'The protected transport could not be created. Try again.')
  }
}

export const createProtectedTransportV6 = onCall({
  region: 'us-central1',
  enforceAppCheck: false,
  secrets: [STAFF_PIN_AUTH_SECRET]
}, createProtectedTransportV6Handler)

export async function submitProtectedEocV9Handler(request, dependencies = {}) {
  try {
    return await submitProtectedEoc({
      db: dependencies.db || db,
      secret: dependencies.secret || STAFF_PIN_AUTH_SECRET.value(),
      requestAuth: request.auth,
      requestData: request.data,
      appCheckPresent: Boolean(request.app),
      nowMs: dependencies.nowMs || Date.now()
    })
  } catch (error) {
    if (error instanceof StaffAccountSecurityError) throw new HttpsError(error.code, error.message)
    console.error('Protected EOC submission failed', error)
    throw new HttpsError('internal', 'The EOC could not be submitted. Try again.')
  }
}

export const submitProtectedEocV9 = onCall({
  region: 'us-central1',
  enforceAppCheck: false,
  secrets: [STAFF_PIN_AUTH_SECRET]
}, submitProtectedEocV9Handler)

export async function mutateProtectedIssueV9Handler(request, dependencies = {}) {
  try {
    return await mutateProtectedIssue({
      db: dependencies.db || db,
      secret: dependencies.secret || STAFF_PIN_AUTH_SECRET.value(),
      requestAuth: request.auth,
      requestData: request.data,
      appCheckPresent: Boolean(request.app),
      nowMs: dependencies.nowMs || Date.now()
    })
  } catch (error) {
    if (error instanceof StaffAccountSecurityError) throw new HttpsError(error.code, error.message)
    console.error('Protected issue mutation failed', error)
    throw new HttpsError('internal', 'The issue could not be updated. Try again.')
  }
}

export const mutateProtectedIssueV9 = onCall({
  region: 'us-central1',
  enforceAppCheck: false,
  secrets: [STAFF_PIN_AUTH_SECRET]
}, mutateProtectedIssueV9Handler)

function assignmentDocId(locationId, shiftId, eocType) {
  return `asg_${cleanId(String(locationId || '').toLowerCase())}_${cleanId(shiftId)}_${eocType}`
}

function validShiftForEocLocation(locationId, shiftId) {
  if (!EOC_ASSIGNMENT_SHIFTS.has(shiftId)) return false
  const isRes = String(locationId || '').trim().toLowerCase() === 'res'
  return isRes ? shiftId.startsWith('res_shift_') : shiftId === 'shift_1' || shiftId === 'shift_2'
}

export async function publishEocTemplateHandler(request) {
  const actor = await requireMappedActor(request)
  let template
  try {
    template = normalizePublishedEocTemplate(request.data?.template)
  } catch (error) {
    throw new HttpsError('invalid-argument', String(error?.message || 'Invalid template.'))
  }
  if (template.organizationId !== actor.organizationId) {
    throw new HttpsError('permission-denied', 'Templates must remain inside your organization.')
  }

  const operationId = eocOperationId(request.data?.operationId)
  const requestedTemplateId = cleanId(request.data?.templateId)
  const templateRef = requestedTemplateId
    ? db.doc(`eocTemplateLibrary/${requestedTemplateId}`)
    : db.collection('eocTemplateLibrary').doc()
  const operationRef = db.doc(`eocTemplateOperations/publish_${operationId}`)
  const expectedVersion = Number(request.data?.expectedVersion || 0)
  const cloneMeta = request.data?.cloneMeta || null

  return db.runTransaction(async transaction => {
    const [operationSnap, existingSnap] = await Promise.all([
      transaction.get(operationRef),
      transaction.get(templateRef)
    ])
    if (operationSnap.exists) return operationSnap.data()?.result

    const existing = existingSnap.data() || null
    if (existing) {
      const ownsTemplate = existing.ownerAuthUid === actor.authUid || existing.ownerUserId === actor.id
      if (actor.role !== 'admin' && !ownsTemplate) throw new HttpsError('permission-denied', 'Copy shared templates before editing them.')
      if (existing.organizationId && existing.organizationId !== actor.organizationId) throw new HttpsError('permission-denied', 'This template belongs to another organization.')
      if (expectedVersion > 0 && Number(existing.version || 0) !== expectedVersion) {
        throw new HttpsError('aborted', 'This template changed in another session. Reload it before publishing.')
      }
      if (existing.eocType && existing.eocType !== template.eocType) throw new HttpsError('failed-precondition', 'A published template cannot change between House and Van.')
    }

    const versionNumber = Number(existing?.publishedVersion || 0) + 1
    const versionId = `${templateRef.id}__v${versionNumber}`
    const versionRef = db.doc(`eocTemplateVersions/${versionId}`)
    const items = flattenPassIssueQuestions(template.sections)
    const owner = existing ? {
      ownerUserId: existing.ownerUserId || actor.id,
      ownerName: existing.ownerName || actor.name,
      ownerAuthUid: existing.ownerAuthUid || actor.authUid,
      ownerRole: existing.ownerRole || actor.role
    } : {
      ownerUserId: actor.id,
      ownerName: actor.name,
      ownerAuthUid: actor.authUid,
      ownerRole: actor.role
    }
    const result = {
      templateId: templateRef.id,
      templateName: template.name,
      eocType: template.eocType,
      versionNumber,
      versionId,
      sections: template.sections,
      items
    }
    const common = {
      ...template,
      ...owner,
      items,
      itemSchemaVersion: 2,
      publishedVersion: versionNumber,
      publishedVersionId: versionId,
      updatedByUserId: actor.id,
      updatedByName: actor.name,
      updatedByAuthUid: actor.authUid,
      updatedAt: FieldValue.serverTimestamp(),
      version: Number(existing?.version || 0) + 1
    }
    if (existing) transaction.update(templateRef, common)
    else transaction.create(templateRef, {
      ...common,
      createdByUserId: actor.id,
      createdByName: actor.name,
      createdByAuthUid: actor.authUid,
      createdAt: FieldValue.serverTimestamp(),
      ...(cloneMeta ? {
        clonedFromTemplateId: cleanId(cloneMeta.clonedFromTemplateId) || null,
        clonedFromVersion: Number(cloneMeta.clonedFromVersion || 0) || null
      } : {})
    })
    transaction.create(versionRef, {
      templateId: templateRef.id,
      templateName: template.name,
      organizationId: template.organizationId,
      schemaVersion: template.schemaVersion,
      eocType: template.eocType,
      status: 'active',
      sections: template.sections,
      items,
      itemSchemaVersion: 2,
      questionCount: template.questionCount,
      versionNumber,
      ...owner,
      publishedByUserId: actor.id,
      publishedByName: actor.name,
      publishedByAuthUid: actor.authUid,
      publishedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      version: 1
    })
    transaction.create(operationRef, {
      action: 'eoc_template_published',
      actorUserId: actor.id,
      actorName: actor.name,
      organizationId: actor.organizationId,
      result,
      immutable: true,
      version: 1,
      createdAt: FieldValue.serverTimestamp()
    })
    return result
  })
}

export const publishEocTemplate = onCall({ region: 'us-central1', enforceAppCheck: false }, publishEocTemplateHandler)

export async function assignEocTemplateHandler(request) {
  const actor = await requireMappedActor(request)
  const locationId = String(request.data?.locationId || '').trim().toLowerCase()
  const shiftId = String(request.data?.shiftId || '').trim()
  const eocType = request.data?.eocType === 'van' ? 'van' : 'house'
  const templateId = cleanId(request.data?.templateId)
  const templateVersionId = cleanId(request.data?.templateVersionId)
  const operationId = eocOperationId(request.data?.operationId)
  if (!locationId || !templateId || !templateVersionId || !validShiftForEocLocation(locationId, shiftId)) {
    throw new HttpsError('invalid-argument', 'A valid location, shift, template, and published version are required.')
  }
  if (!actorCanAccessEocLocation(actor, locationId)) throw new HttpsError('permission-denied', 'You cannot assign templates outside your locations.')

  const assignmentRef = db.doc(`eocTemplateAssignments/${assignmentDocId(locationId, shiftId, eocType)}`)
  const templateRef = db.doc(`eocTemplateLibrary/${templateId}`)
  const versionRef = db.doc(`eocTemplateVersions/${templateVersionId}`)
  const operationRef = db.doc(`eocTemplateOperations/assign_${operationId}`)
  const expectedVersion = Number(request.data?.expectedVersion || 0)

  return db.runTransaction(async transaction => {
    const [operationSnap, assignmentSnap, templateSnap, versionSnap] = await Promise.all([
      transaction.get(operationRef),
      transaction.get(assignmentRef),
      transaction.get(templateRef),
      transaction.get(versionRef)
    ])
    if (operationSnap.exists) return operationSnap.data()?.result
    if (!templateSnap.exists || templateSnap.data()?.status !== 'active') throw new HttpsError('failed-precondition', 'Choose an active template.')
    if (!versionSnap.exists || versionSnap.data()?.templateId !== templateId) throw new HttpsError('failed-precondition', 'The selected published version does not belong to this template.')
    if (templateSnap.data()?.eocType !== eocType || versionSnap.data()?.eocType !== eocType) throw new HttpsError('failed-precondition', 'House and Van template types cannot be mixed.')
    if ((templateSnap.data()?.organizationId || 'sprc') !== actor.organizationId) throw new HttpsError('permission-denied', 'This template belongs to another organization.')
    const current = assignmentSnap.data() || null
    if (expectedVersion > 0 && Number(current?.version || 0) !== expectedVersion) throw new HttpsError('aborted', 'This assignment changed in another session. Reload before applying it.')

    const payload = {
      locationId,
      shiftId,
      eocType,
      organizationId: actor.organizationId,
      defaultTemplateId: templateId,
      defaultTemplateName: templateSnap.data()?.name || versionSnap.data()?.templateName || '',
      defaultTemplateVersion: Number(versionSnap.data()?.versionNumber || 0),
      defaultTemplateVersionId: templateVersionId,
      updatedByUserId: actor.id,
      updatedByName: actor.name,
      updatedByAuthUid: actor.authUid,
      updatedAt: FieldValue.serverTimestamp(),
      version: Number(current?.version || 0) + 1
    }
    if (current) transaction.update(assignmentRef, payload)
    else transaction.create(assignmentRef, {
      ...payload,
      createdByUserId: actor.id,
      createdByName: actor.name,
      createdByAuthUid: actor.authUid,
      createdAt: FieldValue.serverTimestamp()
    })
    const result = { assignmentId: assignmentRef.id, updatedTasks: 0, version: payload.version }
    transaction.create(operationRef, {
      action: 'eoc_template_assigned',
      actorUserId: actor.id,
      actorName: actor.name,
      organizationId: actor.organizationId,
      locationId,
      shiftId,
      eocType,
      result,
      immutable: true,
      version: 1,
      createdAt: FieldValue.serverTimestamp()
    })
    return result
  })
}

export const assignEocTemplate = onCall({ region: 'us-central1', enforceAppCheck: false }, assignEocTemplateHandler)

export async function saveEocSectionHandler(request) {
  const actor = await requireMappedActor(request)
  let section
  try {
    section = normalizePublishedEocSection(request.data?.section)
  } catch (error) {
    throw new HttpsError('invalid-argument', String(error?.message || 'Invalid section.'))
  }
  const operationId = eocOperationId(request.data?.operationId)
  const requestedSectionId = cleanId(request.data?.sectionId)
  const sectionRef = requestedSectionId
    ? db.doc(`eocSectionLibrary/${requestedSectionId}`)
    : db.collection('eocSectionLibrary').doc()
  const operationRef = db.doc(`eocTemplateOperations/section_${operationId}`)
  const expectedVersion = Number(request.data?.expectedVersion || 0)
  const eocType = request.data?.eocType === 'van' ? 'van' : 'house'

  return db.runTransaction(async transaction => {
    const [operationSnap, existingSnap] = await Promise.all([
      transaction.get(operationRef),
      transaction.get(sectionRef)
    ])
    if (operationSnap.exists) return operationSnap.data()?.result
    const existing = existingSnap.data() || null
    if (existing) {
      const ownsSection = existing.ownerAuthUid === actor.authUid || existing.ownerUserId === actor.id
      if (actor.role !== 'admin' && !ownsSection) throw new HttpsError('permission-denied', 'Save your customized section as a new library section.')
      if (expectedVersion > 0 && Number(existing.version || 0) !== expectedVersion) throw new HttpsError('aborted', 'This saved section changed in another session. Reload before saving.')
    }
    const versionNumber = Number(existing?.publishedVersion || 0) + 1
    const versionId = `${sectionRef.id}__v${versionNumber}`
    const versionRef = db.doc(`eocSectionVersions/${versionId}`)
    const owner = existing ? {
      ownerUserId: existing.ownerUserId || actor.id,
      ownerName: existing.ownerName || actor.name,
      ownerAuthUid: existing.ownerAuthUid || actor.authUid
    } : {
      ownerUserId: actor.id,
      ownerName: actor.name,
      ownerAuthUid: actor.authUid
    }
    const result = {
      sectionId: sectionRef.id,
      title: section.title,
      versionNumber,
      versionId,
      questionCount: section.questions.length
    }
    const payload = {
      ...section,
      ...owner,
      organizationId: actor.organizationId,
      schemaVersion: 3,
      eocType,
      status: 'active',
      questionCount: section.questions.length,
      publishedVersion: versionNumber,
      publishedVersionId: versionId,
      updatedByUserId: actor.id,
      updatedByName: actor.name,
      updatedAt: FieldValue.serverTimestamp(),
      version: Number(existing?.version || 0) + 1
    }
    if (existing) transaction.update(sectionRef, payload)
    else transaction.create(sectionRef, { ...payload, createdAt: FieldValue.serverTimestamp() })
    transaction.create(versionRef, {
      sectionId: sectionRef.id,
      ...section,
      ...owner,
      organizationId: actor.organizationId,
      schemaVersion: 3,
      eocType,
      status: 'active',
      questionCount: section.questions.length,
      versionNumber,
      publishedByUserId: actor.id,
      publishedByName: actor.name,
      publishedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      version: 1
    })
    transaction.create(operationRef, {
      action: 'eoc_section_saved',
      actorUserId: actor.id,
      actorName: actor.name,
      organizationId: actor.organizationId,
      result,
      immutable: true,
      version: 1,
      createdAt: FieldValue.serverTimestamp()
    })
    return result
  })
}

export const saveEocSection = onCall({ region: 'us-central1', enforceAppCheck: false }, saveEocSectionHandler)

export async function archiveEocTemplateHandler(request) {
  const actor = await requireMappedActor(request, ['admin'])
  const templateId = cleanId(request.data?.templateId)
  const replacementTemplateId = cleanId(request.data?.replacementTemplateId)
  const operationId = eocOperationId(request.data?.operationId)
  const archiveRequestId = cleanId(request.data?.archiveRequestId)
  if (!templateId) throw new HttpsError('invalid-argument', 'Template is required.')
  if (replacementTemplateId === templateId) throw new HttpsError('invalid-argument', 'Replacement template must be different.')

  const templateRef = db.doc(`eocTemplateLibrary/${templateId}`)
  const replacementRef = replacementTemplateId ? db.doc(`eocTemplateLibrary/${replacementTemplateId}`) : null
  const assignmentSnap = await db.collection('eocTemplateAssignments').where('defaultTemplateId', '==', templateId).get()
  if (!assignmentSnap.empty && !replacementRef) throw new HttpsError('failed-precondition', 'Choose a replacement before archiving an assigned template.')
  const operationRef = db.doc(`eocTemplateOperations/archive_${operationId}`)
  const archiveRequestRef = archiveRequestId ? db.doc(`eocTemplateArchiveRequests/${archiveRequestId}`) : null

  return db.runTransaction(async transaction => {
    const reads = [transaction.get(operationRef), transaction.get(templateRef)]
    if (replacementRef) reads.push(transaction.get(replacementRef))
    if (archiveRequestRef) reads.push(transaction.get(archiveRequestRef))
    for (const assignmentDoc of assignmentSnap.docs) reads.push(transaction.get(assignmentDoc.ref))
    const snapshots = await Promise.all(reads)
    const operationSnap = snapshots[0]
    const templateSnap = snapshots[1]
    if (operationSnap.exists) return operationSnap.data()?.result
    if (!templateSnap.exists) throw new HttpsError('not-found', 'Template was not found.')
    if ((templateSnap.data()?.organizationId || 'sprc') !== actor.organizationId) throw new HttpsError('permission-denied', 'This template belongs to another organization.')
    const replacementSnap = replacementRef ? snapshots[2] : null
    const archiveRequestIndex = 2 + (replacementRef ? 1 : 0)
    const archiveRequestSnap = archiveRequestRef ? snapshots[archiveRequestIndex] : null
    const assignmentStartIndex = archiveRequestIndex + (archiveRequestRef ? 1 : 0)
    const assignmentTransactionSnaps = snapshots.slice(assignmentStartIndex)
    if (replacementRef) {
      if (!replacementSnap?.exists || replacementSnap.data()?.status !== 'active') throw new HttpsError('failed-precondition', 'Choose an active replacement template.')
      if (replacementSnap.data()?.eocType !== templateSnap.data()?.eocType) throw new HttpsError('failed-precondition', 'Replacement template must use the same House or Van type.')
      if ((replacementSnap.data()?.organizationId || 'sprc') !== actor.organizationId) throw new HttpsError('permission-denied', 'Replacement template belongs to another organization.')
    }
    if (archiveRequestRef) {
      if (!archiveRequestSnap?.exists) throw new HttpsError('not-found', 'Archive request was not found.')
      if (archiveRequestSnap.data()?.status !== 'pending' || archiveRequestSnap.data()?.templateId !== templateId) {
        throw new HttpsError('failed-precondition', 'Archive request is no longer pending for this template.')
      }
      if ((archiveRequestSnap.data()?.organizationId || 'sprc') !== actor.organizationId) throw new HttpsError('permission-denied', 'Archive request belongs to another organization.')
    }

    assignmentTransactionSnaps.forEach((assignmentTransactionSnap) => {
      const data = assignmentTransactionSnap.data() || {}
      transaction.update(assignmentTransactionSnap.ref, {
        defaultTemplateId: replacementRef.id,
        defaultTemplateName: replacementSnap.data()?.name || '',
        defaultTemplateVersion: Number(replacementSnap.data()?.publishedVersion || 0) || null,
        defaultTemplateVersionId: replacementSnap.data()?.publishedVersionId || null,
        updatedByUserId: actor.id,
        updatedByName: actor.name,
        updatedByAuthUid: actor.authUid,
        updatedAt: FieldValue.serverTimestamp(),
        version: Number(data.version || 0) + 1
      })
    })
    if (archiveRequestRef) transaction.update(archiveRequestRef, {
      status: 'approved',
      reviewedByUserId: actor.id,
      reviewedByName: actor.name,
      reviewedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      version: Number(archiveRequestSnap.data()?.version || 0) + 1
    })
    transaction.update(templateRef, {
      status: 'archived',
      archivedByUserId: actor.id,
      archivedByName: actor.name,
      archivedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      version: Number(templateSnap.data()?.version || 0) + 1
    })
    const result = { templateId, reassignedScopeCount: assignmentSnap.size }
    transaction.create(operationRef, {
      action: 'eoc_template_archived',
      actorUserId: actor.id,
      actorName: actor.name,
      organizationId: actor.organizationId,
      reason: String(request.data?.reason || 'Template archived by admin').trim().slice(0, 500),
      result,
      immutable: true,
      version: 1,
      createdAt: FieldValue.serverTimestamp()
    })
    return result
  })
}

export const archiveEocTemplate = onCall({ region: 'us-central1', enforceAppCheck: false }, archiveEocTemplateHandler)

export async function requestEocTemplateArchiveHandler(request) {
  const actor = await requireMappedActor(request)
  const templateId = cleanId(request.data?.templateId)
  const reason = String(request.data?.reason || '').trim().slice(0, 500)
  if (!templateId || !reason) throw new HttpsError('invalid-argument', 'Template and archive reason are required.')
  const templateSnap = await db.doc(`eocTemplateLibrary/${templateId}`).get()
  if (!templateSnap.exists) throw new HttpsError('not-found', 'Template was not found.')
  const ownsTemplate = templateSnap.data()?.ownerAuthUid === actor.authUid || templateSnap.data()?.ownerUserId === actor.id
  if (actor.role !== 'admin' && !ownsTemplate) throw new HttpsError('permission-denied', 'You can request archive only for your own template.')
  if ((templateSnap.data()?.organizationId || 'sprc') !== actor.organizationId) throw new HttpsError('permission-denied', 'This template belongs to another organization.')
  const requestId = `archive_${templateId}_${Date.now()}`
  await db.doc(`eocTemplateArchiveRequests/${requestId}`).create({
    templateId,
    templateName: templateSnap.data()?.name || '',
    eocType: templateSnap.data()?.eocType || 'house',
    organizationId: actor.organizationId,
    reason,
    status: 'pending',
    requestedByUserId: actor.id,
    requestedByName: actor.name,
    requestedByAuthUid: actor.authUid,
    immutableRequest: true,
    version: 1,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  })
  return { requestId, status: 'pending' }
}

export const requestEocTemplateArchive = onCall({ region: 'us-central1', enforceAppCheck: false }, requestEocTemplateArchiveHandler)

export async function rejectEocTemplateArchiveRequestHandler(request) {
  const actor = await requireMappedActor(request, ['admin'])
  const archiveRequestId = cleanId(request.data?.archiveRequestId)
  const reason = String(request.data?.reason || '').trim().slice(0, 500)
  if (!archiveRequestId || !reason) throw new HttpsError('invalid-argument', 'Archive request and review reason are required.')
  const requestRef = db.doc(`eocTemplateArchiveRequests/${archiveRequestId}`)
  return db.runTransaction(async transaction => {
    const requestSnap = await transaction.get(requestRef)
    if (!requestSnap.exists) throw new HttpsError('not-found', 'Archive request was not found.')
    if ((requestSnap.data()?.organizationId || 'sprc') !== actor.organizationId) throw new HttpsError('permission-denied', 'Archive request belongs to another organization.')
    if (requestSnap.data()?.status === 'rejected') return { archiveRequestId, status: 'rejected' }
    if (requestSnap.data()?.status !== 'pending') throw new HttpsError('failed-precondition', 'Archive request is no longer pending.')
    transaction.update(requestRef, {
      status: 'rejected',
      reviewReason: reason,
      reviewedByUserId: actor.id,
      reviewedByName: actor.name,
      reviewedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      version: Number(requestSnap.data()?.version || 0) + 1
    })
    return { archiveRequestId, status: 'rejected' }
  })
}

export const rejectEocTemplateArchiveRequest = onCall({ region: 'us-central1', enforceAppCheck: false }, rejectEocTemplateArchiveRequestHandler)

function templateReferenceQueries(templateId) {
  return {
    assignments: db.collection('eocTemplateAssignments').where('defaultTemplateId', '==', templateId),
    tasks: db.collection('eocTasks').where('templateId', '==', templateId),
    submissions: db.collection('eocSubmissions').where('templateId', '==', templateId),
    issues: db.collection('eocIssues').where('templateId', '==', templateId),
    versions: db.collection('eocTemplateVersions').where('templateId', '==', templateId)
  }
}

function summarizeTemplateReferences(snapshots) {
  const counts = Object.fromEntries(Object.entries(snapshots).map(([key, snapshot]) => [key, snapshot.size]))
  return {
    ...counts,
    purgeAllowed: counts.assignments === 0 && counts.tasks === 0 && counts.submissions === 0 && counts.issues === 0
  }
}

export async function previewEocTemplatePurgeHandler(request) {
  const actor = await requireMappedActor(request, ['admin'])
  const templateId = cleanId(request.data?.templateId)
  if (!templateId) throw new HttpsError('invalid-argument', 'Template is required.')
  const templateSnap = await db.doc(`eocTemplateLibrary/${templateId}`).get()
  if (!templateSnap.exists) throw new HttpsError('not-found', 'Template was not found.')
  if ((templateSnap.data()?.organizationId || 'sprc') !== actor.organizationId) throw new HttpsError('permission-denied', 'This template belongs to another organization.')
  const queries = templateReferenceQueries(templateId)
  const entries = await Promise.all(Object.entries(queries).map(async ([key, referenceQuery]) => [key, await referenceQuery.get()]))
  return { templateId, templateName: templateSnap.data()?.name || '', status: templateSnap.data()?.status || 'active', ...summarizeTemplateReferences(Object.fromEntries(entries)) }
}

export const previewEocTemplatePurge = onCall({ region: 'us-central1', enforceAppCheck: false }, previewEocTemplatePurgeHandler)

export async function purgeEocTemplateHandler(request) {
  const actor = await requireMappedActor(request, ['admin'])
  const pinActor = await requireAdminPin(request)
  if (pinActor.id !== actor.id) throw new HttpsError('permission-denied', 'Use your own admin profile and PIN for this action.')
  const templateId = cleanId(request.data?.templateId)
  const operationId = eocOperationId(request.data?.operationId)
  const reason = String(request.data?.reason || '').trim().slice(0, 500)
  if (!templateId || reason.length < 8) throw new HttpsError('invalid-argument', 'Template and a specific deletion reason are required.')
  const templateRef = db.doc(`eocTemplateLibrary/${templateId}`)
  const operationRef = db.doc(`eocTemplateOperations/purge_${operationId}`)
  const queries = templateReferenceQueries(templateId)

  return db.runTransaction(async transaction => {
    const [operationSnap, templateSnap, ...referenceSnaps] = await Promise.all([
      transaction.get(operationRef),
      transaction.get(templateRef),
      ...Object.values(queries).map(referenceQuery => transaction.get(referenceQuery))
    ])
    if (operationSnap.exists) return operationSnap.data()?.result
    if (!templateSnap.exists) throw new HttpsError('not-found', 'Template was not found.')
    if ((templateSnap.data()?.organizationId || 'sprc') !== actor.organizationId) throw new HttpsError('permission-denied', 'This template belongs to another organization.')
    if (templateSnap.data()?.status !== 'archived') throw new HttpsError('failed-precondition', 'Archive the template before permanent deletion.')
    const referenceMap = Object.fromEntries(Object.keys(queries).map((key, index) => [key, referenceSnaps[index]]))
    const impact = summarizeTemplateReferences(referenceMap)
    if (!impact.purgeAllowed) throw new HttpsError('failed-precondition', 'Permanent deletion is blocked because operational records still reference this template.')
    if (impact.versions > 450) throw new HttpsError('resource-exhausted', 'This template has too many versions for safe deletion in one operation.')
    referenceMap.versions.docs.forEach(versionDoc => transaction.delete(versionDoc.ref))
    transaction.delete(templateRef)
    const result = { templateId, deletedVersionCount: impact.versions, purged: true }
    transaction.create(operationRef, {
      action: 'eoc_template_permanently_deleted', actorUserId: actor.id, actorName: actor.name,
      organizationId: actor.organizationId, templateId, templateName: templateSnap.data()?.name || '',
      reason, result, immutable: true, version: 1, createdAt: FieldValue.serverTimestamp()
    })
    return result
  })
}

export const purgeEocTemplate = onCall({ region: 'us-central1', enforceAppCheck: false }, purgeEocTemplateHandler)

function hashPin(pin) {
  return crypto.createHash('sha256').update(`${PIN_PEPPER}:${String(pin || '').trim()}`).digest('hex')
}

async function requireAdminPin(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'A Firebase session is required.')
  const profileId = String(request.data?.adminProfileId || '').trim()
  const pin = String(request.data?.pin || '').trim()
  if (!/^\d{6}$/.test(pin) || !profileId) throw new HttpsError('invalid-argument', 'Admin profile and six-digit PIN are required.')
  const profileRef = db.doc(`users/${profileId}`)
  const rateKey = crypto.createHash('sha256').update(profileId).digest('hex').slice(0, 32)
  const rateRef = db.doc(`securityRateLimits/privacyRemoval_${rateKey}`)
  const nowMs = Date.now()
  const result = await db.runTransaction(async transaction => {
    const [profileSnap, rateSnap] = await Promise.all([transaction.get(profileRef), transaction.get(rateRef)])
    const profile = profileSnap.data()
    const rate = rateSnap.data() || {}
    const lockedUntilMs = rate.lockedUntil?.toMillis?.() || 0
    if (lockedUntilMs > nowMs) return { locked: true }

    const valid = profileSnap.exists && profile?.active === true && profile?.role === 'admin' && profile?.pinHash === hashPin(pin)
    if (valid) {
      transaction.set(rateRef, { failedAttempts: 0, lockedUntil: null, lastSucceededAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      return { actor: { id: profileId, name: profile.name || 'Admin' } }
    }

    const windowStartedMs = rate.windowStartedAt?.toMillis?.() || 0
    const inWindow = windowStartedMs > 0 && nowMs - windowStartedMs < PIN_ATTEMPT_WINDOW_MS
    const failedAttempts = (inWindow ? Number(rate.failedAttempts || 0) : 0) + 1
    transaction.set(rateRef, {
      failedAttempts,
      windowStartedAt: inWindow ? rate.windowStartedAt : Timestamp.fromMillis(nowMs),
      lockedUntil: failedAttempts >= PIN_MAX_ATTEMPTS ? Timestamp.fromMillis(nowMs + PIN_ATTEMPT_WINDOW_MS) : null,
      lastFailedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true })
    return { locked: failedAttempts >= PIN_MAX_ATTEMPTS }
  })
  if (result.locked) throw new HttpsError('resource-exhausted', 'Too many failed attempts. Try again later.')
  if (!result.actor) throw new HttpsError('permission-denied', 'Admin PIN verification failed.')
  return result.actor
}

async function appendAttachmentHistory({ issueId, attachmentId, eventType, actor, reason, operationId = '' }) {
  const historyRef = operationId
    ? db.doc(`eocIssues/${issueId}/attachmentHistory/${operationId}`)
    : db.collection(`eocIssues/${issueId}/attachmentHistory`).doc()
  const auditRef = operationId ? db.doc(`auditLogs/${operationId}`) : db.collection('auditLogs').doc()
  const [historySnap, auditSnap] = await Promise.all([historyRef.get(), auditRef.get()])
  if (historySnap.exists && auditSnap.exists) return
  const batch = db.batch()
  if (!historySnap.exists) batch.set(historyRef, { issueId, attachmentId, eventType, reason, actorUserId: actor.id, actorName: actor.name, immutable: true, version: 1, createdAt: FieldValue.serverTimestamp() })
  if (!auditSnap.exists) batch.set(auditRef, { action: eventType, collectionPath: 'eocIssues', documentId: issueId, performedByUserId: actor.id, performedByName: actor.name, reason, attachmentId, version: 1, createdAt: FieldValue.serverTimestamp() })
  await batch.commit()
}

export async function emergencyPrivacyRemoveHandler(request) {
  const actor = await requireAdminPin(request)
  const issueId = String(request.data?.issueId || '').trim()
  const attachmentId = String(request.data?.attachmentId || '').trim()
  const reason = String(request.data?.reason || '').trim()
  if (!issueId || !attachmentId || !reason) throw new HttpsError('invalid-argument', 'Issue, attachment, and reason are required.')
  const attachmentRef = db.doc(`eocIssues/${issueId}/attachments/${attachmentId}`)
  const snap = await attachmentRef.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Attachment was not found.')
  const attachment = snap.data()
  if (attachment.state === 'privacy_removed') return { removed: true, alreadyRemoved: true }
  if (attachment.storagePath) await bucket().file(attachment.storagePath).delete({ ignoreNotFound: true })
  await appendAttachmentHistory({ issueId, attachmentId, eventType: 'attachment_privacy_removed', actor, reason, operationId: `privacy_${issueId}_${attachmentId}` })
  await attachmentRef.update({ state: 'privacy_removed', visibility: 'removed', storagePath: null, privacyRemovedAt: FieldValue.serverTimestamp(), privacyRemovedByUserId: actor.id, privacyRemovedByName: actor.name, privacyRemovalReason: reason, updatedAt: FieldValue.serverTimestamp(), version: Number(attachment.version || 1) + 1 })
  return { removed: true }
}

export const emergencyPrivacyRemove = onCall({ region: 'us-central1', enforceAppCheck: false }, emergencyPrivacyRemoveHandler)

export async function runPhotoRetentionCleanup({ now = Timestamp.now(), batchLimit = 100 } = {}) {
  const issuesSnap = await db.collection('eocIssues').where('photoDeletionDueAt', '<=', now).limit(batchLimit).get()
  const results = []
  for (const issueDoc of issuesSnap.docs) {
    if (!['resolved', 'voided'].includes(String(issueDoc.data()?.status || ''))) continue
    const attachments = await issueDoc.ref.collection('attachments').get()
    let issueFailed = false
    for (const attachmentDoc of attachments.docs) {
      const attachment = attachmentDoc.data()
      if (!attachmentNeedsDeletion(attachment)) continue
      try {
        const [metadata] = attachment.storagePath ? await bucket().file(attachment.storagePath).getMetadata().catch(error => error.code === 404 ? [null] : Promise.reject(error)) : [null]
        if (attachment.storagePath) await bucket().file(attachment.storagePath).delete({ ignoreNotFound: true })
        const status = metadata ? 'deleted' : 'missing'
        await appendAttachmentHistory({ issueId: issueDoc.id, attachmentId: attachmentDoc.id, eventType: 'attachment_retention_deleted', actor: { id: 'system_retention', name: 'Photo retention cleanup' }, reason: `Automatic deletion 90 days after issue closure (${status}).`, operationId: `retention_${issueDoc.id}_${attachmentDoc.id}` })
        await attachmentDoc.ref.update({ state: 'deleted', visibility: 'removed', storagePath: null, automaticallyDeletedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), version: Number(attachment.version || 1) + 1 })
        results.push({ issueId: issueDoc.id, attachmentId: attachmentDoc.id, status })
      } catch (error) {
        issueFailed = true
        await attachmentDoc.ref.update({ lastCleanupError: String(error?.message || 'Cleanup failed.').slice(0, 500), lastCleanupAttemptAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
        results.push({ issueId: issueDoc.id, attachmentId: attachmentDoc.id, status: 'failed' })
      }
    }
    if (!issueFailed) {
      await issueDoc.ref.update({ photoDeletionDueAt: null, photoRetentionCompletedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    }
  }
  const summary = { dueIssues: issuesSnap.size, ...summarizeCleanupResults(results), updatedAt: FieldValue.serverTimestamp() }
  await db.doc('appMetrics/photoRetention').set(summary, { merge: true })
  return { ...summary, results }
}

export const cleanupIssuePhotos = onSchedule({ schedule: 'every day 02:15', timeZone: 'America/Phoenix', region: 'us-central1' }, async () => runPhotoRetentionCleanup())
