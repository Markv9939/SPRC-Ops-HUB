const DIALOG_EVENT = 'sprc:dialog'

let dialogCounter = 0
const pendingResolvers = new Map()

function nextDialogId() {
  dialogCounter += 1
  return `${Date.now()}-${dialogCounter}`
}

function fallbackValueForType(type) {
  if (type === 'confirm') return false
  if (type === 'prompt') return null
  return undefined
}

function enqueueDialog(request) {
  const type = request?.type || 'alert'
  if (typeof window === 'undefined') {
    return Promise.resolve(fallbackValueForType(type))
  }

  return new Promise((resolve) => {
    const id = nextDialogId()
    pendingResolvers.set(id, resolve)
    window.dispatchEvent(new CustomEvent(DIALOG_EVENT, {
      detail: {
        id,
        type,
        title: request?.title || '',
        message: String(request?.message || '').trim(),
        tone: request?.tone || 'danger',
        confirmText: request?.confirmText || '',
        cancelText: request?.cancelText || '',
        placeholder: request?.placeholder || '',
        defaultValue: request?.defaultValue ?? ''
      }
    }))
  })
}

export function getDialogEventName() {
  return DIALOG_EVENT
}

export function resolveDialogRequest(dialogId, value) {
  const resolver = pendingResolvers.get(dialogId)
  if (!resolver) return
  pendingResolvers.delete(dialogId)
  resolver(value)
}

export function dismissAllPendingDialogs() {
  pendingResolvers.forEach(resolve => resolve(undefined))
  pendingResolvers.clear()
}

export function showAlertDialog(message, options = {}) {
  return enqueueDialog({
    ...options,
    type: 'alert',
    message
  })
}

export function showConfirmDialog(message, options = {}) {
  return enqueueDialog({
    ...options,
    type: 'confirm',
    message
  })
}

export function showPromptDialog(message, options = {}) {
  return enqueueDialog({
    ...options,
    type: 'prompt',
    message
  })
}

export function installAlertDialogBridge() {
  if (typeof window === 'undefined') return () => {}
  if (window.__sprcAlertDialogBridgeInstalled) return () => {}

  const nativeAlert = window.alert.bind(window)
  window.__sprcNativeAlert = nativeAlert
  window.__sprcAlertDialogBridgeInstalled = true

  window.alert = (message) => {
    void showAlertDialog(message, { title: 'Notice', tone: 'danger' })
  }

  return () => {
    if (window.__sprcNativeAlert) {
      window.alert = window.__sprcNativeAlert
      delete window.__sprcNativeAlert
    }
    window.__sprcAlertDialogBridgeInstalled = false
    dismissAllPendingDialogs()
  }
}
