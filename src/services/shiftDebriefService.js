import { db } from '../firebase'
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  limit,
  orderBy,
  Timestamp,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch
} from 'firebase/firestore'
import { getShiftLabel } from '../data/eocConstants'
import { isAdminRole, isBhtRole, isSupervisorRole, locationIdToMainLocation } from '../utils/orgModel'
import {
  getFallbackShiftTimingConfig,
  getNextShiftId,
  getShiftTimingConfig,
  getShiftTimingDetails
} from './shiftTimingService'
import { assertExpectedVersion, getVersionNumber } from './versioning'
import {
  CLIENT_NOTE_SECTIONS,
  DEBRIEF_SCHEMA_VERSION,
  GENERAL_HANDOFF_SECTIONS,
  cleanDebriefToken,
  appendUniqueDebriefRecord,
  canUserConfirmDebrief,
  getDebriefCorrectionCount,
  getDebriefReceivingUserIds,
  getDebriefSectionLabel,
  hasValidIncomingSignoff,
  mergeDebriefConfirmation,
  mergeUniqueDebriefItems,
  removeDebriefRecordById,
  sanitizeDebriefItems,
  sanitizeReviewedIssues,
  normalizeDebriefClientName
} from './shiftDebriefModel'
import { ACTIVE_ISSUE_STATUSES } from '../utils/issueModel'
import { markIssueAlertsReadThrough } from './notificationService'

export {
  CLIENT_NOTE_SECTIONS,
  canUserConfirmDebrief,
  DEBRIEF_READ_SECTION_ORDER,
  DEBRIEF_SCHEMA_VERSION,
  GENERAL_HANDOFF_SECTIONS,
  getDebriefCorrectionCount,
  getDebriefReceivingUserIds,
  getDebriefSectionLabel,
  getGeneralHandoffSection,
  groupDebriefItemsForReadView,
  hasValidIncomingSignoff
} from './shiftDebriefModel'

export const DEBRIEF_DRAFTS_COLLECTION = 'shiftDebriefDrafts'
export const DEBRIEFS_COLLECTION = 'shiftDebriefs'
export const CLOSED_DEBRIEF_MESSAGE = 'This debrief has already been reviewed and is now closed. No more corrections can be added.'

export const DEBRIEF_LOCATION_IDS = new Set(['mesquite', 'lone_mountain', 'test_house'])

export const CONFIRMATION_ITEMS = [
  { id: 'keysAccountedFor', label: 'Keys accounted for' },
  { id: 'sharpsRestrictedVerified', label: 'Sharps/restricted items verified' },
  { id: 'clientRoundCompleted', label: 'Client round completed and clients present' },
  { id: 'controlledMedicationLogReviewed', label: 'Controlled medication log reviewed/signed' },
  { id: 'questionsClarificationsAddressed', label: 'Questions/clarifications addressed' }
]

const cleanToken = cleanDebriefToken
const normalizeClientLabel = normalizeDebriefClientName

function makeId(prefix = 'item') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getDebriefLocationLabel(locationId) {
  if (locationId === 'mesquite') return 'Mesquite House'
  if (locationId === 'lone_mountain') return 'Lone Mountain'
  if (locationId === 'test_house') return 'Test House'
  return cleanToken(locationId)
}

export function isDebriefLocation(locationId) {
  return DEBRIEF_LOCATION_IDS.has(cleanToken(locationId).toLowerCase())
}

export function getBhtDebriefContext(user, date = new Date(), assignment = null) {
  const source = assignment || user || {}
  const locationId = cleanToken(source?.locationId).toLowerCase()
  const shiftId = cleanToken(source?.shiftId)
  const timing = getShiftTimingDetails(shiftId, date, getFallbackShiftTimingConfig())
  const dateKey = timing?.shiftStartDateKey || getLocalDateKey(date)

  if (!isDebriefLocation(locationId) || !shiftId) return null

  return {
    id: buildShiftDebriefId({ userId: user.id, locationId, shiftId, dateKey }),
    schemaVersion: DEBRIEF_SCHEMA_VERSION,
    dateKey,
    locationId,
    locationLabel: getDebriefLocationLabel(locationId),
    mainLocation: locationIdToMainLocation(locationId) || 'OTC',
    shiftId,
    shiftLabel: getShiftLabel(shiftId),
    shiftStartAt: timing?.shiftStartAt || null,
    shiftEndAt: timing?.shiftEndAt || null,
    outgoingDebriefDueAt: timing?.outgoingDebriefDueAt || null,
    incomingAcknowledgmentLateAt: timing?.incomingAcknowledgmentLateAt || null,
    draftByUserId: user.id,
    draftByName: user.name || 'BHT'
  }
}

export function buildShiftDebriefId({ userId, locationId, shiftId, dateKey }) {
  return [
    cleanToken(userId),
    cleanToken(dateKey),
    cleanToken(locationId).toLowerCase(),
    cleanToken(shiftId)
  ].join('_')
}

export function createDebriefItem({ type, section, clientName = '', note, user, source = 'editor' }) {
  const nowIso = new Date().toISOString()
  return {
    id: makeId('debrief_item'),
    type,
    section,
    clientName: cleanToken(clientName),
    note: cleanToken(note),
    source: source === 'quick_note' ? 'quick_note' : 'editor',
    createdAtIso: nowIso,
    updatedAtIso: nowIso,
    createdByUserId: user?.id || null,
    createdByName: user?.name || 'BHT'
  }
}

export function createExtraNote({ note, user, source = 'quick_note' }) {
  const nowIso = new Date().toISOString()
  return {
    id: makeId('extra_note'),
    note: cleanToken(note),
    source,
    createdAtIso: nowIso,
    createdByUserId: user?.id || null,
    createdByName: user?.name || 'BHT'
  }
}

export function createEmptyConfirmation() {
  return {
    keysAccountedFor: false,
    sharpsRestrictedVerified: false,
    clientRoundCompleted: false,
    controlledMedicationLogReviewed: false,
    questionsClarificationsAddressed: false,
    incomingStaffInitials: '',
    confirmed: false,
    confirmedAt: null,
    confirmedByUserId: null,
    confirmedByName: null,
    acknowledgments: {}
  }
}

export async function upsertSharedClientName(clientName) {
  const label = cleanToken(clientName)
  if (!label) return
  const normalizedLabel = normalizeClientLabel(label)
  const clientRef = doc(db, 'clients', normalizedLabel)
  await runTransaction(db, async transaction => {
    const existing = await transaction.get(clientRef)
    transaction.set(clientRef, {
      label,
      normalizedLabel,
      active: true,
      lastUsedAt: serverTimestamp(),
      ...(existing.exists() ? {} : { createdAt: serverTimestamp() })
    }, { merge: true })
  })
}

export async function getCurrentSubmittedDebrief(context) {
  const submittedSnap = await getDoc(doc(db, DEBRIEFS_COLLECTION, context.id))
  return submittedSnap.exists() ? { id: submittedSnap.id, ...submittedSnap.data() } : null
}

export async function getCurrentDraftDebrief(context) {
  const draftSnap = await getDoc(doc(db, DEBRIEF_DRAFTS_COLLECTION, context.id))
  return draftSnap.exists() ? { id: draftSnap.id, ...draftSnap.data() } : null
}

export async function saveDebriefDraft(context, items, options = {}) {
  const draftRef = doc(db, DEBRIEF_DRAFTS_COLLECTION, context.id)
  const expectedVersion = options.expectedVersion
  if (expectedVersion === undefined || expectedVersion === null) {
    const existing = await getDoc(draftRef)
    await setDoc(
      draftRef,
      {
        ...context,
        schemaVersion: DEBRIEF_SCHEMA_VERSION,
        status: 'draft',
        items,
        itemCount: items.length,
        ...(existing.exists() ? {} : { createdAt: serverTimestamp() }),
        updatedAt: serverTimestamp(),
        version: existing.exists() ? getVersionNumber(existing.data()) + 1 : 1
      },
      { merge: true }
    )
    return
  }

  await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(draftRef)
    const currentVersion = existing.exists() ? getVersionNumber(existing.data()) : 0
    const { nextVersion } = assertExpectedVersion({
      expectedVersion,
      currentVersion,
      documentId: context.id,
      recordLabel: 'Shift debrief draft'
    })
    transaction.set(draftRef, {
      ...context,
      schemaVersion: DEBRIEF_SCHEMA_VERSION,
      status: 'draft',
      items,
      itemCount: items.length,
      ...(existing.exists() ? {} : { createdAt: serverTimestamp() }),
      updatedAt: serverTimestamp(),
      version: nextVersion
    }, { merge: true })
  })
}

export async function addDraftItem(context, item) {
  const draftRef = doc(db, DEBRIEF_DRAFTS_COLLECTION, context.id)
  await runTransaction(db, async transaction => {
    const draftSnap = await transaction.get(draftRef)
    const draft = draftSnap.exists() ? draftSnap.data() : null
    const items = Array.isArray(draft?.items) ? draft.items : []
    if (items.some(existing => existing?.id === item?.id)) return

    transaction.set(draftRef, {
      ...context,
      schemaVersion: DEBRIEF_SCHEMA_VERSION,
      status: 'draft',
      items: [...items, item],
      itemCount: items.length + 1,
      ...(draftSnap.exists() ? {} : { createdAt: serverTimestamp() }),
      updatedAt: serverTimestamp(),
      version: draftSnap.exists() ? getVersionNumber(draft) + 1 : 1
    }, { merge: true })
  })
}

export async function submitShiftDebrief(context, items, user) {
  const submittedRef = doc(db, DEBRIEFS_COLLECTION, context.id)
  const draftRef = doc(db, DEBRIEF_DRAFTS_COLLECTION, context.id)

  const timingConfig = await getShiftTimingConfig()
  const outgoingTiming = getShiftTimingDetails(context.shiftId, new Date(), timingConfig)
  const receivingShiftId = getNextShiftId(context.shiftId)
  const receivingTiming = receivingShiftId
    ? getShiftTimingDetails(receivingShiftId, outgoingTiming?.shiftEndAt || new Date(), timingConfig)
    : null
  const receivingUsers = receivingShiftId
    ? await listReceivingShiftUsers({ locationId: context.locationId, shiftId: receivingShiftId, submittedByUserId: user?.id })
    : []
  const receivingUserNames = receivingUsers.reduce((acc, row) => {
    acc[row.id] = row.name || 'BHT'
    return acc
  }, {})
  let issueSnapshot = []
  try {
    const [activeSnap, resolvedSnap] = await Promise.all([
      getDocs(query(
        collection(db, 'eocIssues'),
        where('locationId', '==', context.locationId),
        where('status', 'in', ACTIVE_ISSUE_STATUSES),
        orderBy('createdAt', 'desc'),
        limit(25)
      )),
      getDocs(query(
        collection(db, 'eocIssues'),
        where('locationId', '==', context.locationId),
        where('status', '==', 'resolved'),
        where('closedAt', '>=', Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000)),
        orderBy('closedAt', 'desc'),
        limit(25)
      ))
    ])
    issueSnapshot = [...activeSnap.docs, ...resolvedSnap.docs].map(item => {
      const issue = item.data()
      return {
        issueId: item.id,
        label: issue.label || 'Issue',
        description: issue.description || '',
        status: issue.status || 'open',
        issueType: issue.issueType || '',
        reportedByName: issue.reportedByName || '',
        createdAt: issue.createdAt || null,
        closedAt: issue.closedAt || null,
        version: Number(issue.version || 1),
        latestActivityId: issue.latestActivity?.id || null,
        latestActivity: issue.latestActivity || null,
        updatedAt: issue.updatedAt || null
      }
    })
  } catch (error) {
    console.warn('Issue snapshot unavailable for shift handoff:', error)
  }

  await runTransaction(db, async transaction => {
    const submittedSnap = await transaction.get(submittedRef)
    const draftSnap = await transaction.get(draftRef)
    if (submittedSnap.exists()) throw new Error('This debrief has already been submitted.')

    const draft = draftSnap.exists() && draftSnap.data()?.schemaVersion === DEBRIEF_SCHEMA_VERSION
      ? draftSnap.data()
      : null
    const submittedItems = sanitizeDebriefItems(mergeUniqueDebriefItems(draft?.items || [], items))
    if (submittedItems.length === 0) throw new Error('Add at least one complete debrief note before submitting.')

    const payload = {
      ...context,
      schemaVersion: DEBRIEF_SCHEMA_VERSION,
      status: 'submitted',
      items: submittedItems,
      itemCount: submittedItems.length,
      extraNotes: [],
      confirmation: createEmptyConfirmation(),
      confirmed: false,
      receivingShiftId,
      receivingShiftLabel: receivingShiftId ? getShiftLabel(receivingShiftId) : '',
      receivingUserIds: receivingUsers.map(row => row.id),
      receivingUserNames,
      issueSnapshot,
      issueSnapshotCapturedAt: serverTimestamp(),
      shiftStartAt: outgoingTiming?.shiftStartAt || context.shiftStartAt || null,
      shiftEndAt: outgoingTiming?.shiftEndAt || context.shiftEndAt || null,
      outgoingDebriefDueAt: outgoingTiming?.outgoingDebriefDueAt || context.outgoingDebriefDueAt || null,
      incomingAcknowledgmentLateAt: receivingTiming?.incomingAcknowledgmentLateAt || null,
      submittedByUserId: user?.id || context.draftByUserId,
      submittedByName: user?.name || context.draftByName,
      submittedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      version: 1
    }

    transaction.set(submittedRef, payload)
    transaction.set(draftRef, {
      ...context,
      schemaVersion: DEBRIEF_SCHEMA_VERSION,
      status: 'submitted',
      items: submittedItems,
      itemCount: submittedItems.length,
      submittedDebriefId: context.id,
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      version: draftSnap.exists() ? getVersionNumber(draftSnap.data()) + 1 : 1
    }, { merge: true })
    queueShiftDebriefSubmittedAlerts(transaction, { debrief: { ...payload, id: context.id }, receivingUsers })
  })
}

export async function appendExtraDebriefNote(debriefId, extraNote) {
  const debriefRef = doc(db, DEBRIEFS_COLLECTION, debriefId)
  await runTransaction(db, async transaction => {
    const debriefSnap = await transaction.get(debriefRef)
    if (!debriefSnap.exists()) throw new Error('Submitted debrief was not found.')
    const existing = debriefSnap.data()
    if (isDebriefClosedForCorrections(existing)) throw new Error(CLOSED_DEBRIEF_MESSAGE)
    if (cleanToken(extraNote?.createdByUserId) !== cleanToken(existing.submittedByUserId || existing.draftByUserId)) {
      throw new Error('Only the outgoing staff member who submitted this debrief can add a correction.')
    }

    const extraNotes = Array.isArray(existing.extraNotes) ? existing.extraNotes : []
    if (extraNotes.some(note => note?.id === extraNote?.id)) return
    transaction.update(debriefRef, {
      extraNotes: appendUniqueDebriefRecord(extraNotes, extraNote),
      updatedAt: serverTimestamp(),
      version: getVersionNumber(existing) + 1
    })
  })
}

export async function saveDebriefConfirmation(debriefId, confirmation, user, options = {}) {
  const debriefRef = doc(db, DEBRIEFS_COLLECTION, debriefId)
  const currentUserId = cleanToken(user?.id)
  const expectedCorrectionCount = Number(options.expectedCorrectionCount)
  if (!Number.isInteger(expectedCorrectionCount) || expectedCorrectionCount < 0) {
    throw new Error('This confirmation needs review against the latest debrief before it can be saved.')
  }
  let currentAcknowledged = false
  const reviewedIssues = sanitizeReviewedIssues(confirmation?.reviewedIssues)
  await runTransaction(db, async transaction => {
    const debriefSnap = await transaction.get(debriefRef)
    if (!debriefSnap.exists()) throw new Error('Submitted debrief was not found.')

    const debrief = debriefSnap.data()
    if (!canUserConfirmDebrief(user, debrief)) {
      throw new Error('Only assigned incoming shift staff can complete this confirmation.')
    }
    if (expectedCorrectionCount !== getDebriefCorrectionCount(debrief)) {
      throw new Error('This debrief changed while you were reviewing it. Review the latest correction before signing off.')
    }

    const receivingUserIds = getDebriefReceivingUserIds(debrief)
    const existingAcknowledgments = debrief.confirmation?.acknowledgments || {}
    if (existingAcknowledgments[currentUserId]?.confirmed === true) {
      throw new Error('Your incoming shift confirmation is already complete.')
    }
    const allowedAcknowledgments = Object.fromEntries(
      receivingUserIds
        .filter(userId => existingAcknowledgments[userId])
        .map(userId => [userId, existingAcknowledgments[userId]])
    )
    const merged = mergeDebriefConfirmation({
      ...(debrief.confirmation || {}),
      acknowledgments: allowedAcknowledgments
    }, confirmation, {
      userId: currentUserId,
      userName: user?.name,
      receivingUserIds,
      acknowledgedAt: new Date()
    })
    currentAcknowledged = merged.currentAcknowledged

    transaction.update(debriefRef, {
      confirmation: merged.confirmation,
      confirmed: merged.confirmed,
      ...(options.offlineReplayAuthorization ? { lastOfflineReplayAuthorization: options.offlineReplayAuthorization } : {}),
      updatedAt: serverTimestamp(),
      version: getVersionNumber(debrief) + 1
    })
  })

  if (currentAcknowledged && currentUserId) {
    await markCurrentUserHandoffAlertsRead({ debriefId, userId: currentUserId })
    await markIssueAlertsReadThrough({ userId: currentUserId, userName: user?.name, reviewedIssues })
    await setDoc(doc(db, 'userHomeState', currentUserId), {
      reviewedDebriefIds: arrayUnion(debriefId),
      lastReviewedDebriefId: debriefId,
      lastReviewedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      version: 1
    }, { merge: true })
  }
}

export async function saveQuickDebriefNote(context, item, user) {
  const submittedRef = doc(db, DEBRIEFS_COLLECTION, context.id)
  const draftRef = doc(db, DEBRIEF_DRAFTS_COLLECTION, context.id)
  const extraNote = createExtraNote({
    note: item.type === 'client'
      ? `${item.clientName} - ${getDebriefSectionLabel(item.section)}: ${item.note}`
      : `${getDebriefSectionLabel(item.section)}: ${item.note}`,
    user,
    source: 'post_submit_quick_note'
  })
  extraNote.id = `quick_${item.id}`
  extraNote.createdAtIso = item.createdAtIso || extraNote.createdAtIso

  return runTransaction(db, async transaction => {
    const submittedSnap = await transaction.get(submittedRef)
    const draftSnap = await transaction.get(draftRef)
    if (submittedSnap.exists()) {
      const submitted = submittedSnap.data()
      if (isDebriefClosedForCorrections(submitted)) throw new Error(CLOSED_DEBRIEF_MESSAGE)
      if (cleanToken(user?.id) !== cleanToken(submitted.submittedByUserId || submitted.draftByUserId)) {
        throw new Error('Only the outgoing staff member who submitted this debrief can add a correction.')
      }
      const extraNotes = Array.isArray(submitted.extraNotes) ? submitted.extraNotes : []
      if (!extraNotes.some(note => note?.id === extraNote.id)) {
        transaction.update(submittedRef, {
          extraNotes: appendUniqueDebriefRecord(extraNotes, extraNote),
          updatedAt: serverTimestamp(),
          version: getVersionNumber(submitted) + 1
        })
      }
      return { mode: 'extra', debriefId: context.id }
    }

    const draft = draftSnap.exists() && draftSnap.data()?.schemaVersion === DEBRIEF_SCHEMA_VERSION
      ? draftSnap.data()
      : null
    const draftItems = Array.isArray(draft?.items) ? draft.items : []
    if (!draftItems.some(existing => existing?.id === item?.id)) {
      const nextItems = [...draftItems, item]
      transaction.set(draftRef, {
        ...context,
        schemaVersion: DEBRIEF_SCHEMA_VERSION,
        status: 'draft',
        items: nextItems,
        itemCount: nextItems.length,
        ...(draftSnap.exists() ? {} : { createdAt: serverTimestamp() }),
        updatedAt: serverTimestamp(),
        version: draftSnap.exists() ? getVersionNumber(draftSnap.data()) + 1 : 1
      }, { merge: true })
    }
    return { mode: 'draft', debriefId: context.id }
  })
}

export async function undoQuickDebriefNote(context, item, saveResult) {
  const mode = saveResult?.mode === 'extra' ? 'extra' : 'draft'
  const debriefRef = doc(
    db,
    mode === 'extra' ? DEBRIEFS_COLLECTION : DEBRIEF_DRAFTS_COLLECTION,
    saveResult?.debriefId || context.id
  )

  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(debriefRef)
    if (!snapshot.exists()) return false
    const existing = snapshot.data()

    if (mode === 'extra') {
      if (isDebriefClosedForCorrections(existing)) throw new Error(CLOSED_DEBRIEF_MESSAGE)
      const extraNotes = Array.isArray(existing.extraNotes) ? existing.extraNotes : []
      const nextExtraNotes = extraNotes.filter(note => note?.id !== `quick_${item.id}`)
      if (nextExtraNotes.length === extraNotes.length) return false
      transaction.update(debriefRef, {
        extraNotes: nextExtraNotes,
        updatedAt: serverTimestamp(),
        version: getVersionNumber(existing) + 1
      })
      return true
    }

    const items = Array.isArray(existing.items) ? existing.items : []
    const nextItems = removeDebriefRecordById(items, item?.id)
    if (nextItems.length === items.length) return false
    transaction.update(debriefRef, {
      items: nextItems,
      itemCount: nextItems.length,
      updatedAt: serverTimestamp(),
      version: getVersionNumber(existing) + 1
    })
    return true
  })
}

export function isDebriefClosedForCorrections(debrief) {
  return hasValidIncomingSignoff(debrief)
}

export async function listReceivingShiftUsers({ locationId, shiftId, submittedByUserId }) {
  const assignmentsSnap = await getDocs(query(
    collection(db, 'shiftAssignments'),
    where('locationId', '==', locationId),
    where('shiftId', '==', shiftId),
    where('active', '==', true)
  ))
  return assignmentsSnap.docs
    .map(docSnap => docSnap.data())
    .map(row => ({
      id: row.bhtUserId,
      name: row.bhtUserName || ''
    }))
    .filter(row => row.id && row.id !== submittedByUserId)
}

export async function reassignShiftDebriefReceivers({ debriefId, receivingUserIds, reason, actorUser }) {
  if (!isSupervisorRole(actorUser?.role) && !isAdminRole(actorUser?.role)) {
    throw new Error('Only a supervisor or administrator can correct incoming staff assignments.')
  }

  const normalizedReason = cleanToken(reason)
  if (!normalizedReason) throw new Error('Enter a reason for changing the incoming staff assignment.')

  const requestedUserIds = [...new Set(
    (Array.isArray(receivingUserIds) ? receivingUserIds : [])
      .map(cleanToken)
      .filter(Boolean)
  )]
  if (requestedUserIds.length === 0) throw new Error('Select at least one incoming staff member.')

  const debriefRef = doc(db, DEBRIEFS_COLLECTION, debriefId)
  const initialSnap = await getDoc(debriefRef)
  if (!initialSnap.exists()) throw new Error('Submitted debrief was not found.')
  const initialDebrief = initialSnap.data()
  if (isDebriefClosedForCorrections(initialDebrief)) {
    throw new Error('Incoming staff have already signed off, so the assignment can no longer be changed.')
  }

  const receivingShiftId = cleanToken(initialDebrief.receivingShiftId || getNextShiftId(initialDebrief.shiftId))
  const eligibleUsers = await listReceivingShiftUsers({
    locationId: initialDebrief.locationId,
    shiftId: receivingShiftId,
    submittedByUserId: initialDebrief.submittedByUserId
  })
  const eligibleById = new Map(eligibleUsers.map(row => [cleanToken(row.id), row]))
  const selectedUsers = requestedUserIds.map(userId => eligibleById.get(userId)).filter(Boolean)
  if (selectedUsers.length !== requestedUserIds.length) {
    throw new Error('One or more selected staff members are no longer assigned to the incoming shift.')
  }

  const previousAlertsSnap = await getDocs(query(
    collection(db, 'alerts'),
    where('audience', '==', 'bht'),
    where('type', '==', 'shift_debrief_submitted'),
    where('debriefId', '==', debriefId)
  ))
  const auditRef = doc(collection(db, 'auditLogs'))
  const newAlertRefs = selectedUsers.map(() => doc(collection(db, 'alerts')))

  await runTransaction(db, async transaction => {
    const latestSnap = await transaction.get(debriefRef)
    if (!latestSnap.exists()) throw new Error('Submitted debrief was not found.')
    const latest = latestSnap.data()
    if (isDebriefClosedForCorrections(latest)) {
      throw new Error('Incoming staff have already signed off, so the assignment can no longer be changed.')
    }
    if (
      cleanToken(latest.locationId) !== cleanToken(initialDebrief.locationId)
      || cleanToken(latest.receivingShiftId || getNextShiftId(latest.shiftId)) !== receivingShiftId
    ) {
      throw new Error('The debrief assignment changed. Reload it and try again.')
    }

    const previousUserIds = getDebriefReceivingUserIds(latest)
    const nextUserIds = selectedUsers.map(row => row.id)
    const nextUserNames = Object.fromEntries(selectedUsers.map(row => [row.id, row.name || '']))
    transaction.update(debriefRef, {
      receivingUserIds: nextUserIds,
      receivingUserNames: nextUserNames,
      confirmation: createEmptyConfirmation(),
      confirmed: false,
      reassignedAt: serverTimestamp(),
      reassignedByUserId: actorUser.id,
      reassignedByName: actorUser.name,
      reassignmentReason: normalizedReason,
      updatedAt: serverTimestamp(),
      version: getVersionNumber(latest) + 1
    })

    previousAlertsSnap.docs.forEach(alertDoc => {
      transaction.update(alertDoc.ref, {
        read: true,
        readAt: serverTimestamp(),
        readByUserId: actorUser.id,
        readByName: actorUser.name,
        handoffReassigned: true,
        version: getVersionNumber(alertDoc.data()) + 1,
        updatedAt: serverTimestamp()
      })
    })

    selectedUsers.forEach((row, index) => {
      transaction.set(newAlertRefs[index], {
        type: 'shift_debrief_submitted',
        debriefId,
        locationId: latest.locationId,
        shiftId: latest.shiftId,
        receivingShiftId,
        targetUserId: row.id,
        targetUserName: row.name || null,
        audience: 'bht',
        severity: 'medium',
        incomingAcknowledgmentLateAt: latest.incomingAcknowledgmentLateAt || null,
        message: `${latest.submittedByName || 'BHT'} submitted ${latest.locationLabel || getDebriefLocationLabel(latest.locationId)} shift debrief. Incoming staff assignment was corrected.`,
        bhtName: latest.submittedByName || null,
        read: false,
        version: 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    })

    transaction.set(auditRef, {
      action: 'shift_debrief_receivers_reassigned',
      collectionPath: DEBRIEFS_COLLECTION,
      documentId: debriefId,
      performedByUserId: actorUser.id,
      performedByName: actorUser.name,
      reason: normalizedReason,
      locationId: latest.locationId,
      receivingShiftId,
      previousReceivingUserIds: previousUserIds,
      newReceivingUserIds: nextUserIds,
      version: 1,
      createdAt: serverTimestamp()
    })
  })

  return selectedUsers
}

function queueAlert(batch, payload) {
  const alertRef = doc(collection(db, 'alerts'))
  batch.set(alertRef, {
    ...payload,
    read: false,
    version: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  })
}

function queueShiftDebriefSubmittedAlerts(batch, { debrief, receivingUsers = [] }) {
  for (const row of receivingUsers) {
    queueAlert(batch, {
      type: 'shift_debrief_submitted',
      debriefId: debrief.id,
      locationId: debrief.locationId,
      shiftId: debrief.shiftId,
      receivingShiftId: debrief.receivingShiftId || null,
      targetUserId: row.id,
      targetUserName: row.name || null,
      audience: 'bht',
      severity: 'medium',
      incomingAcknowledgmentLateAt: debrief.incomingAcknowledgmentLateAt || null,
      message: `${debrief.submittedByName || 'BHT'} submitted ${debrief.locationLabel} shift debrief.`,
      bhtName: debrief.submittedByName || null
    })
  }

  queueAlert(batch, {
    type: 'shift_debrief_submitted',
    debriefId: debrief.id,
    locationId: debrief.locationId,
    shiftId: debrief.shiftId,
    audience: 'supervisor',
    severity: 'medium',
    message: `${debrief.submittedByName || 'BHT'} submitted ${debrief.locationLabel} shift debrief.`,
    bhtName: debrief.submittedByName || null
  })

  if (receivingUsers.length === 0) {
    queueAlert(batch, {
      type: 'shift_debrief_no_receivers',
      debriefId: debrief.id,
      locationId: debrief.locationId,
      shiftId: debrief.receivingShiftId || getNextShiftId(debrief.shiftId),
      audience: 'supervisor',
      severity: 'high',
      message: `No receiving BHT is assigned for ${debrief.locationLabel || debrief.locationId} ${debrief.receivingShiftLabel || 'incoming shift'} handoff.`,
      bhtName: debrief.submittedByName || null
    })
  }
}

async function markCurrentUserHandoffAlertsRead({ debriefId, userId }) {
  const alertsSnap = await getDocs(query(
    collection(db, 'alerts'),
    where('audience', '==', 'bht'),
    where('debriefId', '==', debriefId),
    where('type', '==', 'shift_debrief_submitted'),
    where('targetUserId', '==', userId),
    where('read', '==', false)
  ))
  const batch = writeBatch(db)
  let writes = 0
  alertsSnap.docs.forEach(alertDoc => {
    batch.update(alertDoc.ref, {
      read: true,
      readAt: serverTimestamp(),
      readByUserId: userId,
      version: getVersionNumber(alertDoc.data()) + 1,
      updatedAt: serverTimestamp()
    })
    writes += 1
  })
  if (writes > 0) await batch.commit()
}

export function canUserSeeDebrief(user, debrief) {
  if (!user || !debrief) return false
  if (isAdminRole(user.role)) return true
  if (isSupervisorRole(user.role)) {
    return locationIdToMainLocation(debrief.locationId) === locationIdToMainLocation(user.location || user.site)
  }
  if (isBhtRole(user.role)) {
    return cleanToken(user.locationId).toLowerCase() === cleanToken(debrief.locationId).toLowerCase()
  }
  return false
}
