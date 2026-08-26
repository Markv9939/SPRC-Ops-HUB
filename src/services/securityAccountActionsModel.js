export const SECURITY_ACCOUNT_ACTION_VERSION = 4

export function securityAccountActionsConfigEnabled(config = {}) {
  return config.schemaVersion === 2
    && config.serverPinLoginEnabled === true
    && config.protectedAccountActionsVersion === SECURITY_ACCOUNT_ACTION_VERSION
    && config.protectedAccountActionsEnabled === true
}

export function securityOperationId(createId) {
  return `account_${String(createId()).replace(/[^a-zA-Z0-9_-]/g, '_')}`.slice(0, 128)
}

function isTransient(error) {
  const code = String(error?.code || '').replace(/^functions\//, '')
  return ['unavailable', 'deadline-exceeded', 'internal'].includes(code)
}

function accountActionError(error) {
  const code = String(error?.code || '').replace(/^functions\//, '')
  const message = String(error?.message || '').replace(/^FirebaseError:\s*/i, '')
  if (['permission-denied', 'failed-precondition', 'invalid-argument', 'already-exists', 'aborted', 'not-found'].includes(code)) {
    return new Error(message || 'This protected account action was not allowed.')
  }
  return new Error('The protected account action could not be completed. Check the connection and try again.')
}

export async function performSecurityAccountActionWithAdapters(request, adapters) {
  const config = await adapters.loadConfig()
  if (!securityAccountActionsConfigEnabled(config)) return { status: 'disabled' }
  const operationId = request.operationId || securityOperationId(adapters.createId)
  const payload = { ...request, operationId }
  let lastError
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return { status: 'completed', operationId, ...(await adapters.callAction(payload)) }
    } catch (error) {
      lastError = error
      if (!isTransient(error) || attempt > 0) break
    }
  }
  throw accountActionError(lastError)
}
