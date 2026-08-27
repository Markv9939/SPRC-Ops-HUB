const ISSUE_ACTIONS = new Set([
  'create_report',
  'status_update',
  'add_note',
  'bht_follow_up',
  'request_reopen',
  'submit_resolution',
  'review_resolution',
  'keep_separate',
  'link_follow_up',
  'classify_report',
  'unlink_relationship'
])

export function normalizeOperationalRole(value) {
  const role = String(value || '').trim().toLowerCase()
  return role === 'tech' ? 'bht' : role
}

export function normalizeOperationalLocation(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export function operationalActorCanAccessLocation(actor = {}, locationId) {
  if (normalizeOperationalRole(actor.role) === 'admin') return true
  const location = normalizeOperationalLocation(locationId)
  const exact = new Set((Array.isArray(actor.issueLocationIds) ? actor.issueLocationIds : [])
    .map(normalizeOperationalLocation)
    .filter(Boolean))
  if (exact.has(location)) return true
  const broad = new Set((Array.isArray(actor.authorizedLocations) ? actor.authorizedLocations : [])
    .map(value => String(value || '').trim().toUpperCase()))
  if (location === 'res') return broad.has('RES')
  return ['mesquite', 'lone_mountain', 'test_house'].includes(location)
    && (broad.has('OTC') || broad.has('PHP') || broad.has('RTC'))
}

export function actorCanCompleteEocTask(actor = {}, task = {}) {
  if (!actor?.id || !operationalActorCanAccessLocation(actor, task.locationId)) return false
  const eligible = Array.isArray(task.eligibleUserIds)
    ? task.eligibleUserIds.map(value => String(value || '').trim()).filter(Boolean)
    : []
  if (eligible.length > 0) return eligible.includes(String(actor.id))
  const assignee = String(task.assigneeUserId || '').trim()
  return !assignee || assignee === String(actor.id)
}

export function actorCanPerformIssueAction(actor = {}, issue = {}, action) {
  if (!ISSUE_ACTIONS.has(String(action || '').trim())) return false
  const role = normalizeOperationalRole(actor.role)
  if (!['bht', 'supervisor', 'admin'].includes(role)) return false
  if (!operationalActorCanAccessLocation(actor, issue.locationId)) return false
  if (action === 'unlink_relationship') return role === 'admin'
  if (['status_update', 'add_note', 'review_resolution', 'keep_separate', 'link_follow_up', 'classify_report'].includes(action)) {
    return role === 'supervisor' || role === 'admin'
  }
  if (['bht_follow_up', 'request_reopen', 'submit_resolution'].includes(action)) {
    return role === 'bht' && String(issue.reportedByUserId || '') === String(actor.id || '')
  }
  return true
}

export function cleanOperationalOperationId(value) {
  const operationId = String(value || '').trim()
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(operationId)) throw new Error('A unique operation ID is required.')
  return operationId
}

export function assertExpectedOperationalVersion(expectedVersion, currentVersion, label = 'Record') {
  const expected = Number(expectedVersion || 0)
  const current = Number(currentVersion || 0)
  if (!Number.isInteger(expected) || expected < 1 || expected !== current) {
    throw new Error(`${label} changed. Review the latest information and try again.`)
  }
  return current + 1
}

export function sanitizeOperationalText(value, maximum = 1000) {
  return String(value || '').trim().slice(0, maximum)
}

export function isSupportedIssueAction(value) {
  return ISSUE_ACTIONS.has(String(value || '').trim())
}
