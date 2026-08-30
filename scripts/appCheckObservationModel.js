export const APP_CHECK_OBSERVATION_GROUPS = Object.freeze([
  'login',
  'account_access',
  'offline_replay',
  'transport',
  'eoc',
  'issues'
])

function emptyCount() {
  return { total: 0, present: 0, missing: 0, malformed: 0, validSamples: 0 }
}

export function appCheckWorkflowGroup(action) {
  const normalized = String(action || '').trim().toLowerCase()
  if (normalized.startsWith('protected_transport_')) return 'transport'
  if (normalized.startsWith('protected_eoc_')) return 'eoc'
  if (normalized.startsWith('protected_issue_')) return 'issues'
  return ''
}

function addRecord(count, record = {}) {
  count.total += 1
  if (record.appCheckPresent === true) {
    count.present += 1
    count.validSamples += 1
  } else if (record.appCheckPresent === false) {
    count.missing += 1
    count.validSamples += 1
  } else {
    count.malformed += 1
  }
}

export function summarizeAppCheckObservation({
  login = [],
  accountAccess = [],
  offlineReplay = [],
  workflow = [],
  enforcementEnabled = false
} = {}) {
  const groups = Object.fromEntries(APP_CHECK_OBSERVATION_GROUPS.map(group => [group, emptyCount()]))
  login.forEach(record => addRecord(groups.login, record))
  accountAccess.forEach(record => addRecord(groups.account_access, record))
  offlineReplay.forEach(record => addRecord(groups.offline_replay, record))
  workflow.forEach(record => {
    const group = appCheckWorkflowGroup(record?.action)
    if (group) addRecord(groups[group], record)
  })

  const missingGroups = APP_CHECK_OBSERVATION_GROUPS.filter(group => groups[group].validSamples < 1)
  const totals = Object.values(groups).reduce((sum, count) => ({
    total: sum.total + count.total,
    present: sum.present + count.present,
    missing: sum.missing + count.missing,
    malformed: sum.malformed + count.malformed,
    validSamples: sum.validSamples + count.validSamples
  }), emptyCount())

  return {
    monitoringOnly: enforcementEnabled !== true,
    ready: enforcementEnabled !== true && missingGroups.length === 0,
    missingGroups,
    totals,
    groups
  }
}
