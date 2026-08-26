export const WORKFLOW_SECURITY_CONFIG_VERSION = 6

export const SECURITY_WORKFLOWS = Object.freeze([
  'identity_users',
  'templates_photos',
  'eoc',
  'debriefs_alerts',
  'issues_feedback_audit',
  'transports',
  'operations_admin',
  'settings'
])

const WORKFLOW_SET = new Set(SECURITY_WORKFLOWS)

export function activeSecureWorkflows(config = {}) {
  if (config.schemaVersion !== WORKFLOW_SECURITY_CONFIG_VERSION || config.enabled !== true) return []
  if (!Array.isArray(config.workflows)) return []
  return [...new Set(config.workflows.map(value => String(value || '').trim()))]
    .filter(value => WORKFLOW_SET.has(value))
    .sort()
}

export function workflowSecurityEnabled(config, workflowId) {
  return activeSecureWorkflows(config).includes(String(workflowId || '').trim())
}

export function workflowTokenClaims(config = {}) {
  const secureWorkflows = activeSecureWorkflows(config)
  return secureWorkflows.length > 0
    ? { workflowSecurityVersion: WORKFLOW_SECURITY_CONFIG_VERSION, secureWorkflows }
    : {}
}

export function validateWorkflowRollout(config = {}) {
  const requested = Array.isArray(config.workflows) ? config.workflows : []
  const secureWorkflows = activeSecureWorkflows(config)
  const unknown = requested.map(value => String(value || '').trim()).filter(value => !WORKFLOW_SET.has(value))
  return {
    valid: config.schemaVersion === WORKFLOW_SECURITY_CONFIG_VERSION
      && typeof config.enabled === 'boolean'
      && Array.isArray(config.workflows)
      && unknown.length === 0,
    enabled: config.enabled === true,
    secureWorkflows,
    unknown
  }
}

export function appCheckMonitoringReady(config = {}) {
  return config.schemaVersion === 7
    && config.monitoringEnabled === true
    && config.enforcementEnabled !== true
}

export function compatibilityRetirementReady({
  workflowConfig,
  appCheckConfig,
  gates = {}
} = {}) {
  const workflow = validateWorkflowRollout(workflowConfig)
  const requiredGates = [
    'runtimeParity',
    'emulatorMatrix',
    'browserMatrix',
    'offlineReplay',
    'roleAndNegativeSecurity',
    'canaryRollback'
  ]
  const missingGates = requiredGates.filter(gate => gates[gate] !== true)
  return {
    ready: workflow.valid
      && workflow.enabled
      && workflow.secureWorkflows.length === SECURITY_WORKFLOWS.length
      && appCheckMonitoringReady(appCheckConfig)
      && missingGates.length === 0,
    missingWorkflows: SECURITY_WORKFLOWS.filter(value => !workflow.secureWorkflows.includes(value)),
    missingGates
  }
}
