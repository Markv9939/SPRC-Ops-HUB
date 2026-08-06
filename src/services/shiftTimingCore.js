export const PHOENIX_TIME_ZONE = 'America/Phoenix'

export const DEFAULT_SHIFT_TIMING = {
  timezone: PHOENIX_TIME_ZONE,
  eocDueHour: 22,
  eocDueMinute: 0,
  outgoingDebriefDueBeforeEndMinutes: 60,
  incomingAcknowledgmentGraceMinutes: 30,
  reminderIntervalMinutes: 60,
  otcShiftIds: ['shift_1', 'shift_2'],
  shifts: {
    shift_1: {
      label: '1st Shift',
      startDayOfWeek: 0,
      startHour: 9,
      startMinute: 0,
      endDayOfWeek: 3,
      endHour: 18,
      endMinute: 0
    },
    shift_2: {
      label: '2nd Shift',
      startDayOfWeek: 3,
      startHour: 18,
      startMinute: 0,
      endDayOfWeek: 0,
      endHour: 9,
      endMinute: 0
    }
  }
}

function cleanNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function mergeShiftConfig(defaultShift, configuredShift = {}) {
  return {
    ...defaultShift,
    ...configuredShift,
    startDayOfWeek: cleanNumber(configuredShift.startDayOfWeek, defaultShift.startDayOfWeek),
    startHour: cleanNumber(configuredShift.startHour, defaultShift.startHour),
    startMinute: cleanNumber(configuredShift.startMinute, defaultShift.startMinute),
    endDayOfWeek: cleanNumber(configuredShift.endDayOfWeek, defaultShift.endDayOfWeek),
    endHour: cleanNumber(configuredShift.endHour, defaultShift.endHour),
    endMinute: cleanNumber(configuredShift.endMinute, defaultShift.endMinute)
  }
}

export function normalizeShiftTimingConfig(raw = {}) {
  const configuredShifts = raw?.shifts && typeof raw.shifts === 'object' ? raw.shifts : {}
  return {
    ...DEFAULT_SHIFT_TIMING,
    ...raw,
    timezone: raw?.timezone || PHOENIX_TIME_ZONE,
    eocDueHour: cleanNumber(raw?.eocDueHour, DEFAULT_SHIFT_TIMING.eocDueHour),
    eocDueMinute: cleanNumber(raw?.eocDueMinute, DEFAULT_SHIFT_TIMING.eocDueMinute),
    outgoingDebriefDueBeforeEndMinutes: cleanNumber(
      raw?.outgoingDebriefDueBeforeEndMinutes,
      DEFAULT_SHIFT_TIMING.outgoingDebriefDueBeforeEndMinutes
    ),
    incomingAcknowledgmentGraceMinutes: cleanNumber(
      raw?.incomingAcknowledgmentGraceMinutes,
      DEFAULT_SHIFT_TIMING.incomingAcknowledgmentGraceMinutes
    ),
    reminderIntervalMinutes: cleanNumber(raw?.reminderIntervalMinutes, DEFAULT_SHIFT_TIMING.reminderIntervalMinutes),
    otcShiftIds: Array.isArray(raw?.otcShiftIds) && raw.otcShiftIds.length > 0
      ? raw.otcShiftIds.map(v => String(v || '').trim()).filter(Boolean)
      : DEFAULT_SHIFT_TIMING.otcShiftIds,
    shifts: {
      ...DEFAULT_SHIFT_TIMING.shifts,
      ...configuredShifts,
      shift_1: mergeShiftConfig(DEFAULT_SHIFT_TIMING.shifts.shift_1, configuredShifts.shift_1),
      shift_2: mergeShiftConfig(DEFAULT_SHIFT_TIMING.shifts.shift_2, configuredShifts.shift_2)
    }
  }
}

export function getFallbackShiftTimingConfig() {
  return normalizeShiftTimingConfig({})
}

export function isOtcTimedShift(shiftId, config = DEFAULT_SHIFT_TIMING) {
  return (config.otcShiftIds || DEFAULT_SHIFT_TIMING.otcShiftIds).includes(String(shiftId || '').trim())
}

export function getPhoenixParts(date = new Date()) {
  const parts = {}
  new Intl.DateTimeFormat('en-US', {
    timeZone: PHOENIX_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).forEach(part => {
    parts[part.type] = part.value
  })

  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday)
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    dayOfWeek: weekdayIndex < 0 ? 0 : weekdayIndex,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  }
}

export function formatPhoenixDateKey(date = new Date()) {
  const parts = getPhoenixParts(date)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

export function phoenixDateFromParts({ year, month, day, hour = 0, minute = 0, second = 0 }) {
  // Phoenix is UTC-7 year-round; using UTC avoids browser-local timezone drift.
  return new Date(Date.UTC(year, month - 1, day, hour + 7, minute, second, 0))
}

function addDays(date, days) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000)
}

function getRecentPhoenixDayDate(dayOfWeek, now = new Date()) {
  const parts = getPhoenixParts(now)
  const todayStart = phoenixDateFromParts(parts)
  let diff = parts.dayOfWeek - dayOfWeek
  if (diff < 0) diff += 7
  return addDays(todayStart, -diff)
}

function buildShiftBoundary(dayDate, hour, minute) {
  const parts = getPhoenixParts(dayDate)
  return phoenixDateFromParts({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour,
    minute
  })
}

export function getShiftTimingDetails(shiftId, now = new Date(), config = DEFAULT_SHIFT_TIMING) {
  const normalizedShiftId = String(shiftId || '').trim()
  const shift = config.shifts?.[normalizedShiftId]
  if (!shift || !isOtcTimedShift(normalizedShiftId, config)) return null

  let startDayDate = getRecentPhoenixDayDate(shift.startDayOfWeek, now)
  let shiftStartAt = buildShiftBoundary(startDayDate, shift.startHour, shift.startMinute)
  if (shiftStartAt.getTime() > now.getTime()) {
    startDayDate = addDays(startDayDate, -7)
    shiftStartAt = buildShiftBoundary(startDayDate, shift.startHour, shift.startMinute)
  }

  let daysToEnd = shift.endDayOfWeek - shift.startDayOfWeek
  if (daysToEnd <= 0) daysToEnd += 7
  const endDayDate = addDays(startDayDate, daysToEnd)
  const shiftEndAt = buildShiftBoundary(endDayDate, shift.endHour, shift.endMinute)
  const eocDueAt = buildShiftBoundary(startDayDate, config.eocDueHour, config.eocDueMinute)
  const outgoingDebriefDueAt = addMinutes(shiftEndAt, -config.outgoingDebriefDueBeforeEndMinutes)
  const incomingAcknowledgmentLateAt = addMinutes(shiftStartAt, config.incomingAcknowledgmentGraceMinutes)
  const shiftStartDateKey = formatPhoenixDateKey(shiftStartAt)

  return {
    shiftId: normalizedShiftId,
    shiftLabel: shift.label || normalizedShiftId,
    timezone: config.timezone || PHOENIX_TIME_ZONE,
    shiftStartAt,
    shiftEndAt,
    shiftStartDateKey,
    eocAvailableAt: shiftStartAt,
    eocDueAt,
    eocDueDate: shiftStartDateKey,
    outgoingDebriefDueAt,
    incomingAcknowledgmentLateAt,
    reminderIntervalMinutes: config.reminderIntervalMinutes
  }
}

export function getNextShiftId(shiftId) {
  const normalizedShiftId = String(shiftId || '').trim()
  if (normalizedShiftId === 'shift_1') return 'shift_2'
  if (normalizedShiftId === 'shift_2') return 'shift_1'
  return ''
}

export function toDate(value) {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate()
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function hasTimestampPassed(value, now = new Date()) {
  const date = toDate(value)
  return Boolean(date && date.getTime() <= now.getTime())
}
