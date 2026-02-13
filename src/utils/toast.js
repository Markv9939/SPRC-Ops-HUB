const TOAST_EVENT = 'sprc:toast'

let toastCounter = 0

function nextToastId() {
  toastCounter += 1
  return `${Date.now()}-${toastCounter}`
}

export function notify(message, options = {}) {
  if (typeof window === 'undefined') return
  const text = String(message || '').trim()
  if (!text) return

  const detail = {
    id: nextToastId(),
    message: text,
    type: options.type || 'info',
    duration: Number.isFinite(options.duration) ? options.duration : 2600
  }

  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail }))
}

export function notifySuccess(message, duration = 2200) {
  notify(message, { type: 'success', duration })
}

export function notifyWarning(message, duration = 2800) {
  notify(message, { type: 'warning', duration })
}

export function notifyError(message, duration = 3400) {
  notify(message, { type: 'error', duration })
}

export function getToastEventName() {
  return TOAST_EVENT
}

export function installAlertToastBridge() {
  if (typeof window === 'undefined') return () => {}
  if (window.__sprcAlertToastBridgeInstalled) return () => {}

  const nativeAlert = window.alert.bind(window)
  window.__sprcNativeAlert = nativeAlert
  window.__sprcAlertToastBridgeInstalled = true

  window.alert = (message) => {
    notifyWarning(message)
  }

  return () => {
    if (window.__sprcNativeAlert) {
      window.alert = window.__sprcNativeAlert
      delete window.__sprcNativeAlert
    }
    delete window.__sprcAlertToastBridgeInstalled
  }
}
