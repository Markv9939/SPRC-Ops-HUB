export const EOC_ISSUE_FEATURE_DEFAULTS = Object.freeze({
  recurrence: false,
  photos: false,
  offlinePhotos: false,
  supervisorTools: false,
  retention: false,
  strictAuthentication: false
})

export function normalizeEocIssueFeatureFlags(value) {
  const source = value && typeof value === 'object' ? value : {}
  return Object.fromEntries(Object.entries(EOC_ISSUE_FEATURE_DEFAULTS).map(([key, fallback]) => [
    key,
    typeof source[key] === 'boolean' ? source[key] : fallback
  ]))
}

export function isFeatureEnabled(flags, key) {
  return normalizeEocIssueFeatureFlags(flags)[key] === true
}
