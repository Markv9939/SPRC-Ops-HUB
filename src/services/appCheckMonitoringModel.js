export const APP_CHECK_MONITORING_VERSION = 7

export function appCheckMonitoringDecision({
  compileEnabled,
  version,
  siteKey,
  useEmulators = false,
  enforcementEnabled = false
} = {}) {
  if (compileEnabled !== true) return { initialize: false, reason: 'compile_disabled' }
  if (Number(version) !== APP_CHECK_MONITORING_VERSION) return { initialize: false, reason: 'version_mismatch' }
  if (useEmulators === true) return { initialize: false, reason: 'emulator' }
  if (enforcementEnabled === true) return { initialize: false, reason: 'enforcement_not_authorized' }
  if (!String(siteKey || '').trim()) return { initialize: false, reason: 'site_key_missing' }
  return { initialize: true, reason: 'monitoring_only' }
}

export function parseBooleanFlag(value) {
  return String(value || '').trim().toLowerCase() === 'true'
}
