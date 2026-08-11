export const RECURRENCE_WINDOW_DAYS = 90
export const RECURRENCE_THRESHOLD = 3
export const RECURRENCE_WINDOW_MS = RECURRENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000

function trim(value) {
  return String(value || '').trim()
}

function hashText(value) {
  let hash = 2166136261
  const input = trim(value)
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function safePart(value) {
  return trim(value).toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 45) || 'unknown'
}

export function buildIssuePatternId(locationId, trackingId) {
  const source = `${trim(locationId)}\u0000${trim(trackingId)}`
  return `${safePart(locationId)}__${safePart(trackingId)}__${hashText(source)}`
}

export function isRecurrenceEligibleIssue(issue) {
  return issue?.source === 'eoc_checklist'
    && issue?.recurrenceEligible !== false
    && !!trim(issue?.sourceTrackingId || issue?.trackingId)
    && String(issue?.status || 'open').toLowerCase() !== 'voided'
    && issue?.recurrenceInvalidated !== true
}

export function normalizePatternObservations(summary, nowMs = Date.now()) {
  const minimumMs = Number(nowMs) - RECURRENCE_WINDOW_MS
  return (Array.isArray(summary?.observations) ? summary.observations : [])
    .filter(item => trim(item?.issueId) && Number(item?.observedAtMs) >= minimumMs)
    .map(item => ({ issueId: trim(item.issueId), observedAtMs: Number(item.observedAtMs) }))
    .sort((a, b) => a.observedAtMs - b.observedAtMs)
}

export function addPatternObservation(summary, { issueId, observedAtMs = Date.now() }) {
  const normalizedIssueId = trim(issueId)
  if (!normalizedIssueId) throw new Error('Issue ID is required for recurrence tracking.')
  const existing = normalizePatternObservations(summary, observedAtMs)
  const withoutDuplicate = existing.filter(item => item.issueId !== normalizedIssueId)
  const observations = [...withoutDuplicate, { issueId: normalizedIssueId, observedAtMs: Number(observedAtMs) }]
    .sort((a, b) => a.observedAtMs - b.observedAtMs)
  const recentCount = observations.length
  return {
    observations,
    recentCount,
    lifetimeCount: Math.max(Number(summary?.lifetimeCount || 0) + (existing.some(item => item.issueId === normalizedIssueId) ? 0 : 1), recentCount),
    reportedBefore: recentCount > 1,
    recurringIssue: recentCount >= RECURRENCE_THRESHOLD
  }
}

export function removePatternObservation(summary, issueId, nowMs = Date.now()) {
  const normalizedIssueId = trim(issueId)
  const observations = normalizePatternObservations(summary, nowMs)
    .filter(item => item.issueId !== normalizedIssueId)
  return {
    observations,
    recentCount: observations.length,
    lifetimeCount: Math.max(0, Number(summary?.lifetimeCount || 0) - 1),
    reportedBefore: observations.length > 1,
    recurringIssue: observations.length >= RECURRENCE_THRESHOLD
  }
}

export function validateFollowUpRelationship({ child, parent, reopenParent = false, reason }) {
  if (!child?.id || !parent?.id) throw new Error('Choose both issues before linking.')
  if (child.id === parent.id) throw new Error('An issue cannot be linked to itself.')
  if (trim(child.locationId) !== trim(parent.locationId)) throw new Error('Issues must belong to the same location.')
  if (child.parentIssueId) throw new Error('This issue is already linked to a parent issue.')
  if (['resolved', 'voided'].includes(String(child.status || '').toLowerCase())) throw new Error('Only an active report can be linked.')
  const parentStatus = String(parent.status || 'open').toLowerCase()
  if (parentStatus === 'voided') throw new Error('A voided issue cannot become the active parent.')
  if (parentStatus === 'resolved' && !reopenParent) throw new Error('Reopen the resolved issue before adding this follow-up.')
  if (parentStatus === 'resolved' && !trim(reason)) throw new Error('A reason is required to reopen and add a follow-up.')
  return true
}
