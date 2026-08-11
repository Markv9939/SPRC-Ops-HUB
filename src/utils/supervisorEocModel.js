function toMs(value) {
  if (!value) return 0
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

function key(row) {
  return `${row.locationId || ''}::${row.shiftId || ''}::${row.taskType || row.eocType || ''}::${row.vanId || ''}`
}

export function buildCurrentEocStatusRows(tasks) {
  const latest = new Map()
  ;(Array.isArray(tasks) ? tasks : []).forEach(task => {
    if (!['pending', 'overdue', 'completed', 'missed'].includes(task.status)) return
    const existing = latest.get(key(task))
    const taskOrder = `${task.dueDate || ''}:${toMs(task.updatedAt)}`
    const existingOrder = existing ? `${existing.dueDate || ''}:${toMs(existing.updatedAt)}` : ''
    if (!existing || taskOrder > existingOrder) latest.set(key(task), task)
  })
  return Array.from(latest.values()).sort((a, b) => key(a).localeCompare(key(b)))
}

export function buildEocCompletionHistory(submissions, missedTasks) {
  const completed = (Array.isArray(submissions) ? submissions : []).map(row => ({
    id: row.id,
    recordType: 'completed',
    status: 'completed',
    locationId: row.locationId,
    shiftId: row.shiftId,
    eocType: row.eocType,
    dueDate: row.dueDate,
    completedByName: row.submittedByName || row.staffCompleting || '',
    occurredAt: row.submittedAt,
    templateName: row.templateName || '',
    templateVersion: row.templateVersion || null,
    issueCount: Number(row.issueCount || 0)
  }))
  const missed = (Array.isArray(missedTasks) ? missedTasks : []).map(row => ({
    id: row.id,
    recordType: 'missed',
    status: 'missed',
    locationId: row.locationId,
    shiftId: row.shiftId,
    eocType: row.taskType || row.eocType,
    dueDate: row.dueDate,
    completedByName: '',
    occurredAt: row.missedAt || row.updatedAt,
    templateName: row.templateName || '',
    templateVersion: row.templateVersion || null,
    issueCount: 0
  }))
  return [...completed, ...missed].sort((a, b) => toMs(b.occurredAt) - toMs(a.occurredAt))
}

export function findMissingBhtAssignments(templateAssignments, shiftAssignments) {
  const activeKeys = new Set((Array.isArray(shiftAssignments) ? shiftAssignments : [])
    .filter(row => row.active === true && row.bhtUserId)
    .map(row => `${row.locationId || ''}::${row.shiftId || ''}`))
  const missing = new Map()
  ;(Array.isArray(templateAssignments) ? templateAssignments : []).forEach(row => {
    const assignmentKey = `${row.locationId || ''}::${row.shiftId || ''}`
    if (!row.locationId || !row.shiftId || activeKeys.has(assignmentKey)) return
    missing.set(assignmentKey, { locationId: row.locationId, shiftId: row.shiftId })
  })
  return Array.from(missing.values())
}

export function buildIssueExportRows(issues) {
  return (Array.isArray(issues) ? issues : []).map(issue => ({
    'Created': issue.createdAt?.toDate?.() || issue.createdAt || '',
    'Property': issue.locationId || '',
    'Type': issue.issueTypeLabel || issue.issueType || '',
    'Source': issue.source || '',
    'Status': issue.status || '',
    'Checklist Item': issue.linkedChecklistLabel || issue.label || '',
    'Reported By': issue.reportedByName || '',
    'Description': issue.description || '',
    'Reported Before': issue.reportedBefore === true ? 'Yes' : 'No',
    'Recurring Issue': issue.recurringIssue === true ? 'Yes' : 'No',
    'Closed': issue.closedAt?.toDate?.() || issue.closedAt || ''
  }))
}

export function buildEocExportRows(history) {
  return (Array.isArray(history) ? history : []).map(row => ({
    'Cycle Date': row.dueDate || '',
    'Property': row.locationId || '',
    'Shift': row.shiftId || '',
    'EOC Type': row.eocType || '',
    'Status': row.status || '',
    'Completed By': row.completedByName || '',
    'Completed/Missed At': row.occurredAt?.toDate?.() || row.occurredAt || '',
    'Template': row.templateName || '',
    'Template Version': row.templateVersion || '',
    'Issue Count': Number(row.issueCount || 0)
  }))
}
