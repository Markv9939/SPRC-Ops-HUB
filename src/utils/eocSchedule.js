/* === EOC Schedule Utilities — America/Phoenix timezone === */

const TZ = 'America/Phoenix'

/** Get current date/time parts in Phoenix timezone */
export function phoenixNow() {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
  const parts = {}
  formatter.formatToParts(new Date()).forEach(p => { parts[p.type] = p.value })
  return {
    year: parseInt(parts.year),
    month: parseInt(parts.month),
    day: parseInt(parts.day),
    hour: parseInt(parts.hour),
    minute: parseInt(parts.minute)
  }
}

/** Format a JS Date as YYYY-MM-DD in Phoenix timezone */
export function formatPhoenixDate(date) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }) // en-CA gives YYYY-MM-DD
  return formatter.format(date)
}

/** Deterministic assignment ID */
export function getAssignmentId(locationId, shiftId, dueDateStr) {
  return `eoc_${locationId}_${shiftId}_${dueDateStr}`
}

/**
 * Get the current cycle's due date for a shift.
 * 1st shift (dueDayOfWeek=0) → most recent or current Sunday
 * 2nd shift (dueDayOfWeek=3) → most recent or current Wednesday
 */
export function getCurrentCycleDueDate(shift) {
  const now = phoenixNow()
  // Build a date in local terms, then find the most recent target day
  const today = new Date(now.year, now.month - 1, now.day)
  const currentDow = today.getDay() // 0=Sun
  const target = shift.dueDayOfWeek

  let diff = currentDow - target
  if (diff < 0) diff += 7

  const dueDate = new Date(today)
  dueDate.setDate(today.getDate() - diff)
  return formatAsDateStr(dueDate)
}

/** Get next cycle due date (7 days after current) */
export function getNextCycleDueDate(shift) {
  const currentStr = getCurrentCycleDueDate(shift)
  const [y, m, d] = currentStr.split('-').map(Number)
  const next = new Date(y, m - 1, d + 7)
  return formatAsDateStr(next)
}

/** Check if a due date string is in the past (Phoenix time) */
export function isDueDatePassed(dueDateStr) {
  const now = phoenixNow()
  const todayStr = `${now.year}-${String(now.month).padStart(2, '0')}-${String(now.day).padStart(2, '0')}`
  return dueDateStr < todayStr
}

/** Format Date object as YYYY-MM-DD (local, not UTC) */
function formatAsDateStr(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
