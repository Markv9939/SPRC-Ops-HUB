export function isOfflineMode() {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

export function requireOnline(actionLabel = 'perform this action') {
  if (!isOfflineMode()) return true
  alert(`Offline mode: ${actionLabel} is unavailable. Reconnect and retry.`)
  return false
}
