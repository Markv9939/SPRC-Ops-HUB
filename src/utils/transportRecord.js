export function toTransportRecordDate(value) {
  if (!value) return null
  const date = typeof value?.toDate === 'function'
    ? value.toDate()
    : value instanceof Date
      ? value
      : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function normalizeTransportRecordStatus(status) {
  return String(status || '').trim().toLowerCase()
}

export function isCompletedTransportRecord(transport) {
  const status = normalizeTransportRecordStatus(transport?.status)
  return status === 'returned' || status === 'closed'
}

export function isActiveTransportRecord(transport) {
  const status = normalizeTransportRecordStatus(transport?.status)
  return status === 'open' || status === 'arrived'
}

export function isOverdueTransportRecord(transport, nowMs = Date.now()) {
  if (isCompletedTransportRecord(transport)) return false
  const departedAt = toTransportRecordDate(transport?.departedAt)
  if (!departedAt) return false
  return nowMs - departedAt.getTime() > 8 * 60 * 60 * 1000
}

export function formatTransportRecordDate(value, options = {}) {
  const date = toTransportRecordDate(value)
  if (!date) return options.fallback || 'Not recorded'
  return date.toLocaleDateString('en-US', options.long
    ? { month: 'long', day: 'numeric', year: 'numeric' }
    : { month: '2-digit', day: '2-digit', year: 'numeric' })
}

export function formatTransportRecordTime(value, fallback = 'Not recorded') {
  const date = toTransportRecordDate(value)
  if (!date) return fallback
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  })
}

export function formatTransportElapsed(startValue, endValue = Date.now()) {
  const start = toTransportRecordDate(startValue)
  const end = toTransportRecordDate(endValue)
  if (!start || !end || end.getTime() < start.getTime()) return 'Not recorded'

  const totalMinutes = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} min`
  if (minutes === 0) return `${hours} hr`
  return `${hours} hr ${minutes} min`
}

export function getTransportDurationLabel(transport, nowMs = Date.now()) {
  if (!transport) return 'Not recorded'
  if (isActiveTransportRecord(transport)) {
    const elapsed = formatTransportElapsed(transport.departedAt, nowMs)
    return elapsed === 'Not recorded' ? 'In progress' : `In progress · ${elapsed}`
  }

  const end = transport.returnedAt || transport.closedAt
  return formatTransportElapsed(transport.departedAt, end)
}

export function getTransportStatusBadgeClass(status) {
  const normalized = normalizeTransportRecordStatus(status)
  if (normalized === 'open') return 'badge badge-open'
  if (normalized === 'arrived') return 'badge badge-arrived'
  if (normalized === 'returned') return 'badge badge-returned'
  if (normalized === 'closed') return 'badge badge-closed'
  return 'badge'
}

export function getTransportTimeline(transport) {
  if (!transport) return []
  const events = []
  const departedAt = toTransportRecordDate(transport.departedAt)
  if (departedAt) {
    events.push({
      key: 'departed',
      label: 'Departed',
      detail: transport.site ? `Left ${transport.site}` : '',
      date: departedAt
    })
  }

  const stops = Array.isArray(transport.stops) ? transport.stops : []
  stops.forEach((stop, index) => {
    const arrivedAt = toTransportRecordDate(stop?.arrivedAt)
    if (!arrivedAt) return
    const destination = String(
      stop?.destinationName
      || stop?.name
      || stop?.destinationAddress
      || stop?.address
      || ''
    ).trim()
    events.push({
      key: `arrival-${index}`,
      label: destination ? `Arrived at ${destination}` : 'Arrival recorded',
      detail: '',
      date: arrivedAt
    })
  })

  const returnedAt = toTransportRecordDate(transport.returnedAt)
  const closedAt = toTransportRecordDate(transport.closedAt)
  if (returnedAt && closedAt && returnedAt.getTime() === closedAt.getTime()) {
    events.push({
      key: 'returned-closed',
      label: 'Returned and closed',
      detail: transport.dcPaperworkStatus ? `DC paperwork: ${formatDcPaperworkStatus(transport.dcPaperworkStatus)}` : '',
      date: returnedAt
    })
  } else {
    if (returnedAt) {
      events.push({
        key: 'returned',
        label: 'Returned',
        detail: transport.site ? `Returned to ${transport.site}` : '',
        date: returnedAt
      })
    }
    if (closedAt) {
      events.push({
        key: 'closed',
        label: 'Closed',
        detail: transport.dcPaperworkStatus ? `DC paperwork: ${formatDcPaperworkStatus(transport.dcPaperworkStatus)}` : '',
        date: closedAt
      })
    }
  }

  return events.sort((a, b) => a.date.getTime() - b.date.getTime())
}

export function formatDcPaperworkStatus(status) {
  if (status === 'collected') return 'Collected'
  if (status === 'na') return 'N/A'
  if (status === 'other') return 'Other'
  return status ? String(status) : 'Not recorded'
}

export function hasCompleteTransportInformation(transport) {
  const clients = Array.isArray(transport?.clients) ? transport.clients.filter(Boolean) : []
  const reasons = Array.isArray(transport?.reasons) ? transport.reasons.filter(Boolean) : []
  const destinations = Array.isArray(transport?.destinations) ? transport.destinations : []
  const hasDestinations = destinations.length > 0 && destinations.every(destination => (
    String(destination?.address || destination?.name || '').trim()
  ))
  return clients.length > 0 && reasons.length > 0 && hasDestinations
}
