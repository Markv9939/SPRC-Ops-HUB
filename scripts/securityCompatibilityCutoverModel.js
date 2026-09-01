import { SECURITY_WORKFLOWS, validateWorkflowRollout } from '../functions/src/workflowSecurityModel.js'

export const SECURITY_CUTOVER_TARGETS = Object.freeze(['all_active', 'strict_authorization'])

export function normalizeSecurityCutoverTarget(value) {
  const target = String(value || '').trim().toLowerCase()
  if (!SECURITY_CUTOVER_TARGETS.includes(target)) {
    throw new Error('Use target all_active or strict_authorization.')
  }
  return target
}

export function securityCutoverConfirmation(target, action = 'apply') {
  const normalized = normalizeSecurityCutoverTarget(target)
  if (action === 'rollback') {
    return normalized === 'all_active'
      ? 'ROLL BACK ALL-ACTIVE SECURE LOGIN'
      : 'ROLL BACK STRICT AUTHORIZATION'
  }
  return normalized === 'all_active'
    ? 'ACTIVATE SECURE LOGIN FOR ALL ACTIVE PROFILES'
    : 'ENABLE STRICT AUTHORIZATION'
}

function foundationReady(config = {}) {
  return config.schemaVersion === 2
    && config.serverPinLoginEnabled === true
    && config.clientBootstrapVersion === 3
    && config.clientBootstrapEnabled === true
}

function workflowsReady(config = {}) {
  const result = validateWorkflowRollout(config)
  return result.valid && result.enabled && result.secureWorkflows.length === SECURITY_WORKFLOWS.length
}

export function evaluateSecurityCutover({ target, foundationConfig = {}, workflowConfig = {}, authPolicy = {}, readiness = {} } = {}) {
  const normalized = normalizeSecurityCutoverTarget(target)
  const blockers = []
  if (!foundationReady(foundationConfig)) blockers.push('foundation_not_ready')
  if (!workflowsReady(workflowConfig)) blockers.push('workflows_not_ready')
  if (authPolicy.authScopeEnforced === true) blockers.push('strict_authorization_already_enabled')

  if (normalized === 'all_active') {
    if (foundationConfig.rolloutState !== 'production_canary') blockers.push('production_canary_required')
    if (readiness.broadActivationReady !== true) blockers.push('broad_activation_readiness_failed')
  } else {
    if (foundationConfig.rolloutState !== 'active') blockers.push('all_active_rollout_required')
    if (readiness.strictAuthorizationReady !== true) blockers.push('strict_authorization_readiness_failed')
  }

  return { target: normalized, ready: blockers.length === 0, blockers }
}

export function planSecurityCutover({ target, authPolicy = {} } = {}) {
  const normalized = normalizeSecurityCutoverTarget(target)
  if (normalized === 'all_active') {
    return {
      target: normalized,
      foundationPatch: { rolloutState: 'active' },
      authPolicyPatch: null
    }
  }
  return {
    target: normalized,
    foundationPatch: null,
    authPolicyPatch: { ...authPolicy, authScopeEnforced: true }
  }
}

export function validateSecurityCutoverBackup(backup = {}, { projectId, target, configHash } = {}) {
  const normalized = normalizeSecurityCutoverTarget(target)
  const valid = backup.schemaVersion === 1
    && backup.projectId === projectId
    && backup.target === normalized
    && backup.configHash === configHash
    && backup.config
    && typeof backup.capturedAt === 'string'
  if (!valid) throw new Error('The security cutover rollback package does not match the current target and configuration.')
  return true
}
