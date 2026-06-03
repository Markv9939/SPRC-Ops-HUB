import { auth, db } from '../firebase'
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore'
import { getShiftLabel } from '../data/eocConstants'
import { isAdminRole, isBhtRole, isSupervisorRole, locationIdToMainLocation } from '../utils/orgModel'

export const DEBRIEF_DRAFTS_COLLECTION = 'shiftDebriefDrafts'
export const DEBRIEFS_COLLECTION = 'shiftDebriefs'

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

const SHIFT_SEQUENCE = ['shift_1', 'shift_2']

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
  const dateKey = getLocalDateKey(date)

  if (!isDebriefLocation(locationId) || !shiftId) return null

  return {
    id: buildShiftDebriefId({ userId: user.id, locationId, shiftId, dateKey }),
    dateKey,
    locationId,
    locationLabel: getDebriefLocationLabel(locationId),
    mainLocation: locationIdToMainLocation(locationId) || 'OTC',
    shiftId,
    shiftLabel: getShiftLabel(shiftId),
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
    confirmedByName: null
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

export async function saveDebriefDraft(context, items) {
  const draftRef = doc(db, DEBRIEF_DRAFTS_COLLECTION, context.id)
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
      version: 1
    },
    { merge: true }
  )
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

  const payload = {
    ...context,
    status: 'submitted',
    items,
    itemCount: items.length,
    extraNotes: [],
    confirmation: createEmptyConfirmation(),
    confirmed: false,
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
  await createShiftDebriefSubmittedAlerts({ debrief: { ...payload, id: context.id }, user })
}

export async function appendExtraDebriefNote(debriefId, extraNote) {
  const debriefSnap = await getDoc(doc(db, DEBRIEFS_COLLECTION, debriefId))
  if (!debriefSnap.exists()) throw new Error('Submitted debrief was not found.')
  const existing = debriefSnap.data()
  const extraNotes = Array.isArray(existing.extraNotes) ? existing.extraNotes : []
  await updateDoc(doc(db, DEBRIEFS_COLLECTION, debriefId), {
    extraNotes: [...extraNotes, extraNote],
    updatedAt: serverTimestamp()
  })
}

export async function saveDebriefConfirmation(debriefId, confirmation, user) {
  const confirmed = CONFIRMATION_ITEMS.every(item => confirmation?.[item.id] === true)
    && cleanToken(confirmation?.incomingStaffInitials).length > 0

  await updateDoc(doc(db, DEBRIEFS_COLLECTION, debriefId), {
    confirmation: {
      ...confirmation,
      incomingStaffInitials: cleanToken(confirmation?.incomingStaffInitials),
      confirmed,
      confirmedAt: confirmed ? serverTimestamp() : null,
      confirmedByUserId: confirmed ? user?.id || null : null,
      confirmedByName: confirmed ? user?.name || null : null
    },
    confirmed,
    updatedAt: serverTimestamp()
  })
}

export async function saveQuickDebriefNote(context, item, user) {
  const submitted = await getCurrentSubmittedDebrief(context)
  if (submitted) {
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

function getNextShiftId(shiftId) {
  const index = SHIFT_SEQUENCE.indexOf(cleanToken(shiftId))
  if (index === -1) return ''
  return SHIFT_SEQUENCE[(index + 1) % SHIFT_SEQUENCE.length]
}

async function createShiftDebriefSubmittedAlerts({ debrief, user }) {
  const batch = writeBatch(db)
  const nextShiftId = getNextShiftId(debrief.shiftId)
  let batchWrites = 0

  if (nextShiftId) {
    const usersSnap = await getDocs(query(collection(db, 'users'), where('active', '==', true)))
    usersSnap.docs
      .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
      .filter(row => isBhtRole(row.role))
      .filter(row => cleanToken(row.locationId).toLowerCase() === debrief.locationId)
      .filter(row => cleanToken(row.shiftId) === nextShiftId)
      .filter(row => row.id !== user?.id)
      .forEach(row => {
        const alertRef = doc(collection(db, 'alerts'))
        batch.set(alertRef, {
          type: 'shift_debrief_submitted',
          debriefId: debrief.id,
          locationId: debrief.locationId,
          shiftId: debrief.shiftId,
          targetUserId: row.id,
          targetUserName: row.name || null,
          audience: 'bht',
          severity: 'medium',
          message: `${debrief.submittedByName || 'BHT'} submitted ${debrief.locationLabel} shift debrief.`,
          bhtName: debrief.submittedByName || null,
          read: false,
          version: 1,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        })
        batchWrites += 1
      })
  }

  await addDoc(collection(db, 'alerts'), {
    type: 'shift_debrief_submitted',
    debriefId: debrief.id,
    locationId: debrief.locationId,
    shiftId: debrief.shiftId,
    audience: 'supervisor',
    severity: 'medium',
    message: `${debrief.submittedByName || 'BHT'} submitted ${debrief.locationLabel} shift debrief.`,
    bhtName: debrief.submittedByName || null,
    read: false,
    version: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  })

  if (batchWrites > 0) {
    await batch.commit()
  }
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
