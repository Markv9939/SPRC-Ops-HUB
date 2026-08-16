export const DEBRIEF_SCHEMA_VERSION = 2

export const DEBRIEF_CONFIRMATION_FIELD_IDS = [
  'keysAccountedFor',
  'sharpsRestrictedVerified',
  'clientRoundCompleted',
  'controlledMedicationLogReviewed',
  'questionsClarificationsAddressed'
]

export const CLIENT_NOTE_SECTIONS = [
  {
    id: 'medication_changes',
    label: 'Medication Changes',
    prompt: 'Medication changes, new prescriptions, or refills needed.'
  },
  {
    id: 'medical_concerns',
    label: 'Client Medical Concerns',
    prompt: 'Current medical concerns or issues that need follow-up.'
  },
  {
    id: 'client_progress_concerns',
    label: 'Client Progress & Concerns',
    prompt: 'Notable progress, participation, mood, regression, or concerns.'
  }
]

export const GENERAL_HANDOFF_SECTIONS = [
  {
    id: 'pending_task',
    label: 'Pending Tasks',
    prompt: 'Tasks that still need to be completed.',
    tone: 'pending'
  },
  {
    id: 'urgent_time_sensitive_task',
    label: 'Urgent / Time-Sensitive Tasks',
    prompt: 'Urgent items that need attention during the incoming shift.',
    tone: 'urgent'
  },
  {
    id: 'maintenance_van_facility_operational',
    label: 'Maintenance & Facility Concerns',
    prompt: 'Maintenance, vehicle, facility, or operational concerns.',
    tone: 'maintenance'
  }
]

export const DEBRIEF_READ_SECTION_ORDER = [
  ...CLIENT_NOTE_SECTIONS.map(section => section.id),
  ...GENERAL_HANDOFF_SECTIONS.map(section => section.id)
]

export function cleanDebriefToken(value) {
  return String(value || '').trim()
}

export function normalizeDebriefClientName(value) {
  return cleanDebriefToken(value).toLowerCase().replace(/\s+/g, ' ')
}

export function getDebriefClientGroupKey(sectionId, clientName) {
  return `${cleanDebriefToken(sectionId)}::${normalizeDebriefClientName(clientName)}`
}

export function getDebriefSectionLabel(sectionId) {
  return [...CLIENT_NOTE_SECTIONS, ...GENERAL_HANDOFF_SECTIONS]
    .find(section => section.id === sectionId)?.label || cleanDebriefToken(sectionId)
}

export function getGeneralHandoffSection(sectionId) {
  return GENERAL_HANDOFF_SECTIONS.find(section => section.id === sectionId) || {
    id: sectionId,
    label: getDebriefSectionLabel(sectionId),
    tone: 'general'
  }
}

export function sortDebriefItems(items) {
  return [...(Array.isArray(items) ? items : [])].sort((left, right) => (
    String(left?.createdAtIso || '').localeCompare(String(right?.createdAtIso || ''))
  ))
}

export function mergeUniqueDebriefItems(...groups) {
  const byId = new Map()
  groups.flat().forEach(item => {
    if (item?.id) byId.set(item.id, item)
  })
  return sortDebriefItems(Array.from(byId.values()))
}

export function appendUniqueDebriefRecord(records, record) {
  const existing = Array.isArray(records) ? records : []
  return record?.id && !existing.some(row => row?.id === record.id)
    ? [...existing, record]
    : existing
}

export function removeDebriefRecordById(records, recordId) {
  return (Array.isArray(records) ? records : []).filter(row => row?.id !== recordId)
}

export function getDebriefReceivingUserIds(debrief) {
  return [...new Set(
    (Array.isArray(debrief?.receivingUserIds) ? debrief.receivingUserIds : [])
      .map(cleanDebriefToken)
      .filter(Boolean)
  )]
}

export function canUserConfirmDebrief(user, debrief) {
  const userId = cleanDebriefToken(user?.id)
  const submittedByUserId = cleanDebriefToken(debrief?.submittedByUserId || debrief?.draftByUserId)
  return Boolean(
    userId
    && userId !== submittedByUserId
    && getDebriefReceivingUserIds(debrief).includes(userId)
  )
}

export function hasValidIncomingSignoff(debrief) {
  if (debrief?.confirmed === true) return true
  const acknowledgments = debrief?.confirmation?.acknowledgments || {}
  return getDebriefReceivingUserIds(debrief)
    .some(userId => acknowledgments[userId]?.confirmed === true)
}

export function getDebriefCorrectionCount(debrief) {
  return Array.isArray(debrief?.extraNotes) ? debrief.extraNotes.length : 0
}

export function mergeDebriefConfirmation(existingConfirmation, incomingConfirmation, options = {}) {
  const existing = existingConfirmation || {}
  const incoming = incomingConfirmation || {}
  const userId = cleanDebriefToken(options.userId)
  const userName = cleanDebriefToken(options.userName) || null
  const initials = cleanDebriefToken(incoming.incomingStaffInitials)
  const acknowledgedAt = options.acknowledgedAt || new Date()
  const receivingUserIds = (Array.isArray(options.receivingUserIds) ? options.receivingUserIds : [])
    .map(cleanDebriefToken)
    .filter(Boolean)
  const currentAcknowledged = DEBRIEF_CONFIRMATION_FIELD_IDS.every(field => incoming[field] === true)
    && initials.length > 0
  const acknowledgments = {
    ...(existing.acknowledgments || {}),
    ...(userId
      ? {
          [userId]: {
            ...Object.fromEntries(DEBRIEF_CONFIRMATION_FIELD_IDS.map(field => [field, incoming[field] === true])),
            incomingStaffInitials: initials,
            confirmed: currentAcknowledged,
            confirmedAt: currentAcknowledged ? acknowledgedAt : null,
            confirmedByUserId: currentAcknowledged ? userId : null,
            confirmedByName: currentAcknowledged ? userName : null
          }
        }
      : {})
  }
  const allReceivingAcknowledged = receivingUserIds.length > 0
    ? receivingUserIds.every(receivingUserId => acknowledgments[receivingUserId]?.confirmed === true)
    : currentAcknowledged
  const latestAcknowledgment = userId ? acknowledgments[userId] : null

  return {
    confirmation: {
      ...existing,
      ...incoming,
      incomingStaffInitials: initials,
      confirmed: allReceivingAcknowledged,
      confirmedAt: allReceivingAcknowledged ? (existing.confirmedAt || acknowledgedAt) : null,
      confirmedByUserId: latestAcknowledgment?.confirmedByUserId || existing.confirmedByUserId || null,
      confirmedByName: latestAcknowledgment?.confirmedByName || existing.confirmedByName || null,
      acknowledgments
    },
    confirmed: allReceivingAcknowledged,
    currentAcknowledged
  }
}

export function sanitizeDebriefItems(items) {
  return mergeUniqueDebriefItems(items)
    .map(item => ({
      ...item,
      clientName: item?.type === 'client' ? cleanDebriefToken(item.clientName) : '',
      note: cleanDebriefToken(item?.note),
      source: item?.source === 'quick_note' ? 'quick_note' : 'editor'
    }))
    .filter(item => (
      item.note
      && (item.type === 'general' || (item.type === 'client' && item.clientName))
    ))
}

export function isCurrentDebriefPayload(payload) {
  return Number(payload?.schemaVersion || payload?.context?.schemaVersion || 0) === DEBRIEF_SCHEMA_VERSION
}

export function getQuickNoteMergeState(items, sectionId, clientName) {
  const normalizedName = normalizeDebriefClientName(clientName)
  if (!normalizedName) return 'new'

  const clientItems = (Array.isArray(items) ? items : []).filter(item => (
    item?.type === 'client'
    && normalizeDebriefClientName(item.clientName) === normalizedName
  ))
  if (clientItems.some(item => item.section === sectionId)) return 'existing_section'
  if (clientItems.length > 0) return 'other_section'
  return 'new'
}

export function groupDebriefItemsForReadView(items) {
  const sortedItems = sortDebriefItems(items)
  const clientMaps = new Map(CLIENT_NOTE_SECTIONS.map(section => [section.id, new Map()]))
  const generalMaps = new Map(GENERAL_HANDOFF_SECTIONS.map(section => [section.id, []]))

  sortedItems.forEach(item => {
    if (item?.type === 'client' && clientMaps.has(item.section)) {
      const nameKey = normalizeDebriefClientName(item.clientName || 'Client')
      const clientMap = clientMaps.get(item.section)
      if (!clientMap.has(nameKey)) {
        clientMap.set(nameKey, {
          key: nameKey,
          label: cleanDebriefToken(item.clientName) || 'Client',
          notes: []
        })
      }
      clientMap.get(nameKey).notes.push(item)
    }

    if (item?.type === 'general' && generalMaps.has(item.section)) {
      generalMaps.get(item.section).push(item)
    }
  })

  const clientSections = CLIENT_NOTE_SECTIONS
    .map(section => ({
      key: section.id,
      label: section.label,
      clients: Array.from(clientMaps.get(section.id).values())
        .sort((left, right) => left.label.localeCompare(right.label))
    }))
    .filter(section => section.clients.length > 0)

  const generalSections = GENERAL_HANDOFF_SECTIONS
    .map(section => ({
      key: section.id,
      label: section.label,
      tone: section.tone,
      notes: generalMaps.get(section.id)
    }))
    .filter(section => section.notes.length > 0)

  return { clientSections, generalSections }
}
