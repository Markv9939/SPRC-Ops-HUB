import { SECURITY_WORKFLOWS } from '../functions/src/workflowSecurityModel.js'

export const SECURITY_CANARY_STAGES = Object.freeze([...SECURITY_WORKFLOWS])

export const STAGE_PROTECTED_ENDPOINTS = Object.freeze({
  templates_photos: [],
  eoc: ['authorizeOfflineReplayV5', 'submitProtectedEocV9'],
  debriefs_alerts: [],
  issues_feedback_audit: ['mutateProtectedIssueV9'],
  transports: ['createProtectedTransportV6'],
  operations_admin: [],
  settings: []
})

export const OPERATIONS_ADMIN_DATA_COLLECTIONS = Object.freeze([
  'eocProperties',
  'eocVehicles',
  'fleetMaintenanceTemplates',
  'fleetVehicleRuntime',
  'fleetTasks',
  'vehicleServiceRecords',
  'complianceEmployees',
  'complianceItems',
  'cintasServices'
])

function validMainLocation(value) {
  return ['OTC', 'RES'].includes(String(value || '').trim().toUpperCase())
}

function validOperationsRecord(collectionName, data = {}) {
  if (collectionName === 'complianceEmployees') return validMainLocation(data.site)
  if (collectionName === 'complianceItems') {
    const targetType = String(data.targetType || '').trim().toLowerCase()
    if (targetType === 'employee') return validMainLocation(data.employeeSite)
    if (targetType === 'location') return validMainLocation(data.mainLocation)
    return false
  }
  return validMainLocation(data.mainLocation)
}

export function evaluateOperationsAdminDataReadiness(documentsByCollection = {}) {
  const collections = OPERATIONS_ADMIN_DATA_COLLECTIONS.map((collectionName) => {
    const documents = Array.isArray(documentsByCollection[collectionName])
      ? documentsByCollection[collectionName]
      : []
    const invalidCount = documents.reduce(
      (count, document) => count + (validOperationsRecord(collectionName, document?.data || document) ? 0 : 1),
      0
    )
    return { collection: collectionName, scannedCount: documents.length, invalidCount }
  })
  return {
    ready: collections.every(result => result.invalidCount === 0),
    scannedCount: collections.reduce((count, result) => count + result.scannedCount, 0),
    invalidCount: collections.reduce((count, result) => count + result.invalidCount, 0),
    collections
  }
}

function normalizedWorkflows(config = {}) {
  return Array.isArray(config.workflows)
    ? config.workflows.map(value => String(value || '').trim())
    : []
}

function sameValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function workflowsThroughStage(stage) {
  const index = SECURITY_CANARY_STAGES.indexOf(String(stage || '').trim())
  if (index < 0) throw new Error(`Unknown security canary stage: ${stage || '(missing)'}`)
  return SECURITY_CANARY_STAGES.slice(0, index + 1)
}

export function configuredCanaryStage(workflowConfig = {}) {
  if (workflowConfig.schemaVersion !== 6
    || workflowConfig.enabled !== true
    || workflowConfig.rolloutState !== 'production_canary') return 'invalid'

  const configured = normalizedWorkflows(workflowConfig)
  const match = SECURITY_CANARY_STAGES.find(stage => sameValues(configured, workflowsThroughStage(stage)))
  return match || 'invalid'
}

export function planCanaryStageAdvance({
  foundationConfig = {},
  workflowConfig = {},
  targetStage,
  releaseId
} = {}) {
  const targetWorkflows = workflowsThroughStage(targetStage)
  const targetIndex = SECURITY_CANARY_STAGES.indexOf(targetStage)
  if (targetIndex === 0) throw new Error('Identity/Users is the existing first canary stage, not an advance target.')

  if (foundationConfig.rolloutState !== 'production_canary'
    || workflowConfig.rolloutState !== 'production_canary'
    || foundationConfig.releaseId !== releaseId
    || workflowConfig.releaseId !== releaseId) {
    throw new Error('Current protected settings do not match the active canary release.')
  }

  const currentStage = configuredCanaryStage(workflowConfig)
  const expectedCurrentStage = SECURITY_CANARY_STAGES[targetIndex - 1]
  if (currentStage !== expectedCurrentStage) {
    throw new Error(`Stage ${targetStage} requires the current stage to be ${expectedCurrentStage}; found ${currentStage}.`)
  }

  const enableOfflineReplay = targetIndex >= SECURITY_CANARY_STAGES.indexOf('eoc')
  return {
    currentStage,
    targetStage,
    targetWorkflows,
    protectedEndpointsToOpen: [...(STAGE_PROTECTED_ENDPOINTS[targetStage] || [])],
    foundationUpdates: enableOfflineReplay ? { offlineReplayEnabled: true } : {},
    endsCanarySessions: true,
    requiresRefreshTokenRevocation: true
  }
}

export function validateCanaryStageBackup(backup = {}, { projectId, releaseId, targetStage } = {}) {
  if (backup.projectId !== projectId
    || backup.releaseId !== releaseId
    || backup.targetStage !== targetStage
    || !backup.previousStage
    || !backup.config) {
    throw new Error('The rollback backup does not match this project, release, and stage transition.')
  }
  const savedWorkflowConfig = backup.config['appSettings/securityWorkflows']
  const savedFoundationConfig = backup.config['appSettings/securityFoundation']
  if (!savedWorkflowConfig?.exists
    || !savedFoundationConfig?.exists
    || configuredCanaryStage(savedWorkflowConfig.data) !== backup.previousStage
    || savedWorkflowConfig.data?.releaseId !== releaseId
    || savedFoundationConfig.data?.releaseId !== releaseId) {
    throw new Error('The rollback backup does not contain the exact recorded previous canary stage.')
  }
  return true
}
