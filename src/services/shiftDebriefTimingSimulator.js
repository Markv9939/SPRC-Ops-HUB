import {
  DEFAULT_SHIFT_TIMING,
  formatPhoenixDateKey,
  getNextShiftId,
  getShiftTimingDetails,
  hasTimestampPassed,
  toDate
} from './shiftTimingCore.js'

function cleanToken(value) {
  return String(value || '').trim()
}

export function buildSimulatedDebriefId({ userId, dateKey, locationId, shiftId }) {
  return [
    cleanToken(userId),
    cleanToken(dateKey),
    cleanToken(locationId).toLowerCase(),
    cleanToken(shiftId)
  ].join('_')
}

export function isDebriefAcknowledgedBy(debrief, userId) {
  const normalizedUserId = cleanToken(userId)
  if (!normalizedUserId) return false
  const acknowledgments = debrief?.confirmation?.acknowledgments || {}
  if (acknowledgments?.[normalizedUserId]?.confirmed === true) return true
  return debrief?.confirmed === true && cleanToken(debrief?.confirmation?.confirmedByUserId) === normalizedUserId
}

function findSubmittedOutgoingDebrief({ assignment, submittedDebriefs, dateKey }) {
  const expectedId = buildSimulatedDebriefId({
    userId: assignment.bhtUserId,
    dateKey,
    locationId: assignment.locationId,
    shiftId: assignment.shiftId
  })
  return submittedDebriefs.find(debrief => (
    debrief.id === expectedId
    || (
      debrief.submittedByUserId === assignment.bhtUserId
      && debrief.dateKey === dateKey
      && debrief.locationId === assignment.locationId
      && debrief.shiftId === assignment.shiftId
      && debrief.status === 'submitted'
    )
  )) || null
}

function findIncomingDebriefs({ assignment, submittedDebriefs }) {
  const userId = cleanToken(assignment.bhtUserId)
  return submittedDebriefs.filter(debrief => (
    debrief.status === 'submitted'
    && debrief.locationId === assignment.locationId
    && (Array.isArray(debrief.receivingUserIds) ? debrief.receivingUserIds : []).map(cleanToken).includes(userId)
  ))
}

function subtractMinutes(date, minutes) {
  return new Date(date.getTime() - Number(minutes || 0) * 60 * 1000)
}

function getReceivingShiftStartFromDebrief(debrief, config) {
  const explicitStart = toDate(debrief.receivingShiftStartAt)
  if (explicitStart) return explicitStart
  const lateAt = toDate(debrief.incomingAcknowledgmentLateAt)
  if (!lateAt) return null
  return subtractMinutes(lateAt, config.incomingAcknowledgmentGraceMinutes)
}

export function evaluateDebriefTimingState({
  now = new Date(),
  assignment,
  submittedDebriefs = [],
  config = DEFAULT_SHIFT_TIMING
}) {
  const nowDate = toDate(now) || new Date()
  const timing = getShiftTimingDetails(assignment?.shiftId, nowDate, config)
  if (!assignment || !timing) {
    return {
      available: false,
      reason: 'Assignment is missing or shift is not timed.'
    }
  }

  const expectedDebriefId = buildSimulatedDebriefId({
    userId: assignment.bhtUserId,
    dateKey: timing.shiftStartDateKey,
    locationId: assignment.locationId,
    shiftId: assignment.shiftId
  })
  const submittedOutgoingDebrief = findSubmittedOutgoingDebrief({
    assignment,
    submittedDebriefs,
    dateKey: timing.shiftStartDateKey
  })
  const incomingDebriefs = findIncomingDebriefs({ assignment, submittedDebriefs })
  const incoming = incomingDebriefs.map(debrief => {
    const receivingShiftId = debrief.receivingShiftId || getNextShiftId(debrief.shiftId)
    const receivingShiftStartAt = getReceivingShiftStartFromDebrief(debrief, config)
    return {
      debriefId: debrief.id,
      submittedByUserId: debrief.submittedByUserId,
      receivingShiftId,
      appAlertVisibleAfterSubmit: true,
      shiftStartGateOpen: receivingShiftStartAt ? nowDate.getTime() >= receivingShiftStartAt.getTime() : false,
      acknowledgmentLate: hasTimestampPassed(debrief.incomingAcknowledgmentLateAt, nowDate)
        && !isDebriefAcknowledgedBy(debrief, assignment.bhtUserId),
      acknowledged: isDebriefAcknowledgedBy(debrief, assignment.bhtUserId),
      receivingShiftStartAt,
      incomingAcknowledgmentLateAt: toDate(debrief.incomingAcknowledgmentLateAt)
    }
  })

  return {
    available: true,
    now: nowDate,
    assignment,
    timing,
    expectedDebriefId,
    expectedDateKey: timing.shiftStartDateKey,
    outgoingDebriefDueAt: timing.outgoingDebriefDueAt,
    outgoingDebriefSubmitted: Boolean(submittedOutgoingDebrief),
    missingOutgoingDebrief: !submittedOutgoingDebrief && hasTimestampPassed(timing.outgoingDebriefDueAt, nowDate),
    incoming
  }
}

export function makeSubmittedDebriefFixture({
  now = new Date(),
  outgoingAssignment,
  receivingAssignment,
  config = DEFAULT_SHIFT_TIMING,
  acknowledged = false
}) {
  const nowDate = toDate(now) || new Date()
  const outgoingTiming = getShiftTimingDetails(outgoingAssignment.shiftId, nowDate, config)
  const receivingShiftId = receivingAssignment.shiftId || getNextShiftId(outgoingAssignment.shiftId)
  const receivingTiming = getShiftTimingDetails(receivingShiftId, outgoingTiming?.shiftEndAt || nowDate, config)
  const dateKey = outgoingTiming?.shiftStartDateKey || formatPhoenixDateKey(nowDate)
  const id = buildSimulatedDebriefId({
    userId: outgoingAssignment.bhtUserId,
    dateKey,
    locationId: outgoingAssignment.locationId,
    shiftId: outgoingAssignment.shiftId
  })

  return {
    id,
    status: 'submitted',
    locationId: outgoingAssignment.locationId,
    shiftId: outgoingAssignment.shiftId,
    dateKey,
    submittedByUserId: outgoingAssignment.bhtUserId,
    submittedByName: outgoingAssignment.bhtUserName,
    receivingShiftId,
    receivingUserIds: [receivingAssignment.bhtUserId],
    receivingUserNames: {
      [receivingAssignment.bhtUserId]: receivingAssignment.bhtUserName
    },
    receivingShiftStartAt: receivingTiming?.shiftStartAt || null,
    incomingAcknowledgmentLateAt: receivingTiming?.incomingAcknowledgmentLateAt || null,
    confirmed: acknowledged,
    confirmation: {
      confirmed: acknowledged,
      confirmedByUserId: acknowledged ? receivingAssignment.bhtUserId : null,
      acknowledgments: acknowledged
        ? {
            [receivingAssignment.bhtUserId]: {
              confirmed: true,
              confirmedByUserId: receivingAssignment.bhtUserId
            }
          }
        : {}
    }
  }
}
