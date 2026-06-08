import { auth, db } from '../firebase'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore'
import { getShiftLabel } from '../data/eocConstants'
import { isAdminRole, isBhtRole, isSupervisorRole, locationIdToMainLocation } from '../utils/orgModel'
import {
  getFallbackShiftTimingConfig,
  getNextShiftId,
  getShiftTimingConfig,
  getShiftTimingDetails,
  toDate
} from './shiftTimingService'
import { assertExpectedVersion, getVersionNumber } from './versioning'

export const DEBRIEF_DRAFTS_COLLECTION = 'shiftDebriefDrafts'
export const DEBRIEFS_COLLECTION = 'shiftDebriefs'
export const CLOSED_DEBRIEF_MESSAGE = 'This debrief has already been reviewed and is now closed. No more corrections can be added.'

export const DEBRIEF_LOCATION_IDS = new Set(['mesquite', 'lone_mountain'])

export const CLIENT_NOTE_SECTIONS = [
  { id: 'client_progress_concerns', label: 'Client Progress & Concerns' },
  { id: 'medication_health_updates', label: 'Medication & Health Updates' }
]

export const GENERAL_HANDOFF_SECTIONS = [
  { id: 'pending_task', label: 'Pending task' },
  { id: 'urgent_time_sensitive_task', label: 'Urgent/time-sensitive task' },
  { id: 'maintenance_van_facility_operational', label: 'Maintenance/van/facility/operational concern' },
  { id: 'notes_discrepancies', label: 'Notes/discrepancies' }
]

export const DEBRIEF_READ_SECTION_ORDER = [
  'medication_health_updates',
  'client_progress_concerns'
]

export const CONFIRMATION_ITEMS = [
  { id: 'keysAccountedFor', label: 'Keys accounted for' },
  { id: 'sharpsRestrictedVerified', label: 'Sharps/restricted items verified' },
  { id: 'clientRoundCompleted', label: 'Client round completed and clients present' },
  { id: 'controlledMedicationLogReviewed', label: 'Controlled medication log reviewed/signed' },
  { id: 'questionsClarificationsAddressed', label: 'Questions/clarifications addressed' }
]

function cleanToken(value) {
  return String(value || '').trim()
}

function normalizeClientLabel(value) {
  return cleanToken(value).toLowerCase().replace(/\s+/g, ' ')
}

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

export function getDebriefSectionLabel(sectionId) {
  return [...CLIENT_NOTE_SECTIONS, ...GENERAL_HANDOFF_SECTIONS]
    .find(section => section.id === sectionId)?.label || sectionId
}

export function groupDebriefItemsForReadView(items) {
  const sortedItems = [...(Array.isArray(items) ? items : [])].sort((a, b) => (
    String(a.createdAtIso || '').localeCompare(String(b.createdAtIso || ''))
  ))
  const clientItems = sortedItems.filter(item => item?.type === 'client')
  const generalNotes = sortedItems.filter(item => item?.type === 'general')
  const sectionMap = new Map()

  clientItems.forEach(item => {
    const sectionKey = cleanToken(item.section)
    const nameKey = normalizeClientLabel(item.clientName || 'Client')
    const displayName = cleanToken(item.clientName) || 'Client'

    if (!sectionMap.has(sectionKey)) {
      sectionMap.set(sectionKey, new Map())
    }

    const clientMap = sectionMap.get(sectionKey)
    if (!clientMap.has(nameKey)) {
      clientMap.set(nameKey, {
        key: nameKey,
        label: displayName,
        firstCreatedAtIso: item.createdAtIso || '',
        notes: []
      })
    }

    clientMap.get(nameKey).notes.push(item)
  })

  const orderedSectionKeys = [
    ...DEBRIEF_READ_SECTION_ORDER,
    ...Array.from(sectionMap.keys())
      .filter(key => !DEBRIEF_READ_SECTION_ORDER.includes(key))
      .sort((a, b) => getDebriefSectionLabel(a).localeCompare(getDebriefSectionLabel(b)))
  ]

  const sections = orderedSectionKeys
    .filter(key => sectionMap.has(key))
    .map(key => ({
      key,
      label: getDebriefSectionLabel(key),
      clients: Array.from(sectionMap.get(key).values())
        .sort((a, b) => a.label.localeCompare(b.label))
    }))

  return { sections, generalNotes }
}

export function getDebriefLocationLabel(locationId) {
  if (locationId === 'mesquite') return 'Mesquite House'
  if (locationId === 'lone_mountain') return 'Lone Mountain'
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
    draftByName: user.name || 'BHT',
    draftByAuthUid: user.authUid || auth.currentUser?.uid || ''
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

export function createDebriefItem({ type, section, clientName = '', note, user }) {
  const nowIso = new Date().toISOString()
  return {
    id: makeId('debrief_item'),
    type,
    section,
    clientName: cleanToken(clientName),
    note: cleanToken(note),
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
  await setDoc(
    doc(db, 'clients', normalizedLabel),
    {
      label,
      normalizedLabel,
      active: true,
      lastUsedAt: serverTimestamp(),
      createdAt: serverTimestamp()
    },
    { merge: true }
  )
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
  const draft = await getCurrentDraftDebrief(context)
  const items = Array.isArray(draft?.items) ? draft.items : []
  await saveDebriefDraft(context, [...items, item])
}

export async function submitShiftDebrief(context, items, user) {
  const submittedRef = doc(db, DEBRIEFS_COLLECTION, context.id)
  const existing = await getDoc(submittedRef)
  if (existing.exists()) {
    throw new Error('This debrief has already been submitted.')
  }

  const timingConfig = await getShiftTimingConfig()
  const outgoingTiming = getShiftTimingDetails(context.shiftId, new Date(), timingConfig)
  const receivingShiftId = getNextShiftId(context.shiftId)
  const receivingTiming = receivingShiftId
    ? getShiftTimingDetails(receivingShiftId, outgoingTiming?.shiftEndAt || new Date(), timingConfig)
    : null
  const receivingUsers = receivingShiftId
    ? await getReceivingBhtUsers({ locationId: context.locationId, shiftId: receivingShiftId, submittedByUserId: user?.id })
    : []
  const receivingUserNames = receivingUsers.reduce((acc, row) => {
    acc[row.id] = row.name || 'BHT'
    return acc
  }, {})

  const payload = {
    ...context,
    status: 'submitted',
    items,
    itemCount: items.length,
    extraNotes: [],
    confirmation: createEmptyConfirmation(),
    confirmed: false,
    receivingShiftId,
    receivingShiftLabel: receivingShiftId ? getShiftLabel(receivingShiftId) : '',
    receivingUserIds: receivingUsers.map(row => row.id),
    receivingUserNames,
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

  await setDoc(submittedRef, payload)
  await setDoc(
    doc(db, DEBRIEF_DRAFTS_COLLECTION, context.id),
    {
      ...context,
      status: 'submitted',
      submittedDebriefId: context.id,
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      version: 1
    },
    { merge: true }
  )
  await createShiftDebriefSubmittedAlerts({ debrief: { ...payload, id: context.id }, receivingUsers })
}

export async function appendExtraDebriefNote(debriefId, extraNote) {
  const debriefSnap = await getDoc(doc(db, DEBRIEFS_COLLECTION, debriefId))
  if (!debriefSnap.exists()) throw new Error('Submitted debrief was not found.')
  const existing = debriefSnap.data()
  if (isDebriefClosedForCorrections(existing)) {
    throw new Error(CLOSED_DEBRIEF_MESSAGE)
  }
  const extraNotes = Array.isArray(existing.extraNotes) ? existing.extraNotes : []
  await updateDoc(doc(db, DEBRIEFS_COLLECTION, debriefId), {
    extraNotes: [...extraNotes, extraNote],
    updatedAt: serverTimestamp()
  })
}

export async function saveDebriefConfirmation(debriefId, confirmation, user) {
  const debriefRef = doc(db, DEBRIEFS_COLLECTION, debriefId)
  const debriefSnap = await getDoc(debriefRef)
  if (!debriefSnap.exists()) throw new Error('Submitted debrief was not found.')

  const debrief = { id: debriefSnap.id, ...debriefSnap.data() }
  const receivingUserIds = Array.isArray(debrief.receivingUserIds) ? debrief.receivingUserIds.map(v => cleanToken(v)) : []
  const currentUserId = cleanToken(user?.id)
  const currentAcknowledged = CONFIRMATION_ITEMS.every(item => confirmation?.[item.id] === true)
    && cleanToken(confirmation?.incomingStaffInitials).length > 0
  const existingConfirmation = debrief.confirmation || {}
  const existingAcknowledgments = existingConfirmation.acknowledgments || {}
  const nextAcknowledgments = {
    ...existingAcknowledgments,
    ...(currentUserId
      ? {
          [currentUserId]: {
            keysAccountedFor: confirmation?.keysAccountedFor === true,
            sharpsRestrictedVerified: confirmation?.sharpsRestrictedVerified === true,
            clientRoundCompleted: confirmation?.clientRoundCompleted === true,
            controlledMedicationLogReviewed: confirmation?.controlledMedicationLogReviewed === true,
            questionsClarificationsAddressed: confirmation?.questionsClarificationsAddressed === true,
            incomingStaffInitials: cleanToken(confirmation?.incomingStaffInitials),
            confirmed: currentAcknowledged,
            confirmedAt: currentAcknowledged ? new Date() : null,
            confirmedByUserId: currentAcknowledged ? currentUserId : null,
            confirmedByName: currentAcknowledged ? user?.name || null : null
          }
        }
      : {})
  }

  const allReceivingAcknowledged = receivingUserIds.length > 0
    ? receivingUserIds.every(userId => nextAcknowledgments[userId]?.confirmed === true)
    : currentAcknowledged
  const latestUserAcknowledgment = currentUserId ? nextAcknowledgments[currentUserId] : null

  await updateDoc(debriefRef, {
    confirmation: {
      ...existingConfirmation,
      ...confirmation,
      incomingStaffInitials: cleanToken(confirmation?.incomingStaffInitials),
      confirmed: allReceivingAcknowledged,
      confirmedAt: allReceivingAcknowledged ? (toDate(existingConfirmation.confirmedAt) || new Date()) : null,
      confirmedByUserId: latestUserAcknowledgment?.confirmedByUserId || existingConfirmation.confirmedByUserId || null,
      confirmedByName: latestUserAcknowledgment?.confirmedByName || existingConfirmation.confirmedByName || null,
      acknowledgments: nextAcknowledgments
    },
    confirmed: allReceivingAcknowledged,
    updatedAt: serverTimestamp()
  })

  if (currentAcknowledged && currentUserId) {
    await markCurrentUserHandoffAlertsRead({ debriefId, userId: currentUserId })
  }
}

export async function saveQuickDebriefNote(context, item, user) {
  const submitted = await getCurrentSubmittedDebrief(context)
  if (submitted) {
    if (isDebriefClosedForCorrections(submitted)) {
      throw new Error(CLOSED_DEBRIEF_MESSAGE)
    }
    await appendExtraDebriefNote(submitted.id, createExtraNote({
      note: item.type === 'client'
        ? `${item.clientName} - ${getDebriefSectionLabel(item.section)}: ${item.note}`
        : `${getDebriefSectionLabel(item.section)}: ${item.note}`,
      user,
      source: 'post_submit_quick_note'
    }))
    return { mode: 'extra', debriefId: submitted.id }
  }
  await addDraftItem(context, item)
  return { mode: 'draft', debriefId: context.id }
}

export function isDebriefClosedForCorrections(debrief) {
  return debrief?.confirmed === true
}

async function getReceivingBhtUsers({ locationId, shiftId, submittedByUserId }) {
  const usersSnap = await getDocs(query(collection(db, 'users'), where('active', '==', true)))
  return usersSnap.docs
    .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
    .filter(row => isBhtRole(row.role))
    .filter(row => cleanToken(row.locationId).toLowerCase() === cleanToken(locationId).toLowerCase())
    .filter(row => cleanToken(row.shiftId) === cleanToken(shiftId))
    .filter(row => row.id !== submittedByUserId)
}

function cleanAlertIdPart(value) {
  return cleanToken(value).toLowerCase().replace(/[^a-z0-9_-]+/g, '_')
}

async function queueUniqueAlert(batch, alertId, payload) {
  const alertRef = doc(db, 'alerts', alertId)
  const existingSnap = await getDoc(alertRef)
  if (existingSnap.exists()) return false
  batch.set(alertRef, {
    ...payload,
    alertKey: alertId,
    read: false,
    version: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  })
  return true
}

async function createShiftDebriefSubmittedAlerts({ debrief, receivingUsers = [] }) {
  const batch = writeBatch(db)
  let batchWrites = 0

  for (const row of receivingUsers) {
    const alertId = [
      'shift_debrief_submitted',
      cleanAlertIdPart(debrief.id),
      cleanAlertIdPart(row.id)
    ].join('__')
    const queued = await queueUniqueAlert(batch, alertId, {
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
    if (queued) batchWrites += 1
  }

  const supervisorAlertId = [
    'shift_debrief_submitted_supervisor',
    cleanAlertIdPart(debrief.id)
  ].join('__')
  if (await queueUniqueAlert(batch, supervisorAlertId, {
    type: 'shift_debrief_submitted',
    debriefId: debrief.id,
    locationId: debrief.locationId,
    shiftId: debrief.shiftId,
    audience: 'supervisor',
    severity: 'medium',
    message: `${debrief.submittedByName || 'BHT'} submitted ${debrief.locationLabel} shift debrief.`,
    bhtName: debrief.submittedByName || null
  })) {
    batchWrites += 1
  }

  if (receivingUsers.length === 0) {
    const noReceiversAlertId = [
      'shift_debrief_no_receivers',
      cleanAlertIdPart(debrief.id)
    ].join('__')
    if (await queueUniqueAlert(batch, noReceiversAlertId, {
      type: 'shift_debrief_no_receivers',
      debriefId: debrief.id,
      locationId: debrief.locationId,
      shiftId: debrief.receivingShiftId || getNextShiftId(debrief.shiftId),
      audience: 'supervisor',
      severity: 'high',
      message: `No receiving BHT is assigned for ${debrief.locationLabel || debrief.locationId} ${debrief.receivingShiftLabel || 'incoming shift'} handoff.`,
      bhtName: debrief.submittedByName || null
    })) {
      batchWrites += 1
    }
  }

  if (batchWrites > 0) {
    await batch.commit()
  }
}

async function markCurrentUserHandoffAlertsRead({ debriefId, userId }) {
  const alertsSnap = await getDocs(query(collection(db, 'alerts'), where('debriefId', '==', debriefId)))
  const batch = writeBatch(db)
  let writes = 0
  alertsSnap.docs.forEach(alertDoc => {
    const alert = alertDoc.data()
    if (alert.targetUserId !== userId) return
    if (alert.read === true) return
    if (alert.type !== 'shift_debrief_submitted') return
    batch.update(alertDoc.ref, {
      read: true,
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
