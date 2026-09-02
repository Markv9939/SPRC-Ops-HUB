import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

const read = path => readFileSync(path, 'utf8')
const packageJson = JSON.parse(read('package.json'))
const functionsPackage = JSON.parse(read('functions/package.json'))

const requiredFiles = [
  'MASTER_PLAN.md',
  'PROGRESS_LOG.md',
  'docs/security/PHASE_1_SECURITY_FOUNDATION_BASELINE.md',
  'docs/security/PHASE_2_DORMANT_SERVER_FOUNDATION.md',
  'docs/security/PHASE_3_DORMANT_CLIENT_BOOTSTRAP.md',
  'docs/security/PHASE_4_TO_8_LOCAL_SECURITY_READINESS.md',
  'docs/security/PHASE_9_PROTECTED_OPERATIONAL_MUTATIONS.md',
  'docs/security/SECURITY_CANARY_AND_ROLLBACK.md',
  'scripts/verifySecurityCompatibilityRetirement.js',
  'tests/e2e/support/securityViteGlobalServer.js',
  'tests/e2e/securityOfflineProductionShell.spec.js',
  'functions/src/staffPinLoginService.js',
  'functions/src/staffAccountSecurityService.js',
  'functions/src/offlineReplaySecurityService.js',
  'functions/src/operationalMutationSecurityService.js',
  'src/services/securityClientRuntime.js',
  'src/services/securityClientBootstrap.js',
  'src/services/offlineActionCatalog.js',
  'src/services/appCheckMonitoringModel.js'
]

const retiredFiles = [
  'playwright.security.compatibility.config.js',
  'tests/e2e/securityCompatibilityCanary.spec.js',
  'scripts/verifyProductionStorageSmoke.js',
  'scripts/manageSecurityStaffRollout.js',
  'scripts/inspectSecurityCompatibilityReadiness.js',
  'scripts/manageSecurityCompatibilityCutover.js',
  'scripts/resetProductionCore.js'
]

const retiredCommands = [
  'test:storage:production-smoke',
  'test:security-compatibility:browser',
  'test:security-compatibility:emulator',
  'security:staff-rollout',
  'security:compatibility-readiness',
  'security:compatibility-cutover',
  'reset:core:preview',
  'reset:core:backup',
  'reset:core:verify'
]

const missingFiles = requiredFiles.filter(path => !existsSync(path))
const remainingRetiredFiles = retiredFiles.filter(existsSync)
const remainingRetiredCommands = retiredCommands.filter(name => packageJson.scripts?.[name])
const declaredNode = String(functionsPackage.engines?.node || '')
const currentNode = process.versions.node
const indexSource = read('functions/src/index.js')
const pinLoginSource = read('src/components/PinLogin.jsx')
const appSource = read('src/App.jsx')
const staffLoginSource = read('functions/src/staffPinLoginService.js')
const firestoreRules = read('firestore.rules')
const storageRules = read('storage.rules')
const packageSource = read('package.json')

const browserCommands = [
  'test:security-client:emulator',
  'test:security-templates-photos:browser',
  'test:security-eoc-offline:browser',
  'test:security-debriefs-alerts:browser',
  'test:security-issues-feedback-audit:browser',
  'test:security-transports:browser',
  'test:security-operations-admin:browser',
  'test:security-settings:browser',
  'test:security-offline-matrix:emulator',
  'test:security-offline-shell:browser',
  'test:security-offline-shell:process'
]

const checks = {
  requiredFilesPresent: missingFiles.length === 0,
  declaredNode22: declaredNode === '22',
  localRuntimeParity: currentNode.split('.')[0] === declaredNode,
  coreVerificationCommandsPresent: [
    'test:security-foundation',
    'test:security-foundation:emulator',
    'test:rules',
    'test:storage-rules',
    'verify:security-compatibility-retired'
  ].every(name => Boolean(packageJson.scripts?.[name])),
  completeBrowserMatrixPresent: browserCommands.every(name => Boolean(packageJson.scripts?.[name])),
  retiredToolsRemoved: remainingRetiredFiles.length === 0 && remainingRetiredCommands.length === 0,
  noAnonymousAuthShortcut: !packageSource.includes('signInAnonymously')
    && !pinLoginSource.includes('signInAnonymously')
    && !indexSource.includes('signInAnonymously'),
  browserPinTrustRemoved: !pinLoginSource.includes("where('pinHash'")
    && !pinLoginSource.includes("from '../utils/pinHash'")
    && !appSource.includes('compatibilitySessionRequiresFreshLogin'),
  serverOnlyCredentialVerification: staffLoginSource.includes('staffPinCredentials')
    && !staffLoginSource.includes("where('pinHash'")
    && !staffLoginSource.includes('legacy_pin_hash'),
  protectedAccountAndWorkflowFunctionsPresent: [
    'beginStaffPinSessionV2',
    'manageStaffSecurityV4',
    'authorizeOfflineReplayV5',
    'createProtectedTransportV6',
    'submitProtectedEocV9',
    'mutateProtectedIssueV9'
  ].every(name => indexSource.includes(name)),
  strictFirestoreCurrentSessionRequired: firestoreRules.includes('hasCurrentSecuritySession()')
    && firestoreRules.includes('allow create, update, delete: if false;')
    && !firestoreRules.includes('authScopeEnforced'),
  strictStorageCurrentSessionRequired: storageRules.includes('currentWorkflowSession(locationId)')
    && !storageRules.includes('compatibility'),
  appCheckMonitoringOnly: indexSource.includes('enforceAppCheck: false')
    && !indexSource.includes('enforceAppCheck: true'),
  absolute84HourAndOfflineShellPreserved: read('src/services/securityClientSessionModel.js').includes('84 * 60 * 60 * 1000')
    && read('public/sw.js').includes("fetch('/asset-manifest.json'")
    && read('tests/e2e/securityOfflineProductionShell.spec.js').includes('cold offline restart')
}

const localReleaseCandidateReady = Object.entries(checks)
  .filter(([name]) => name !== 'localRuntimeParity')
  .every(([, passed]) => passed)
const releaseBlockers = []
if (!checks.localRuntimeParity) {
  releaseBlockers.push(`Local Functions emulator uses Node ${currentNode}; the declared and production runtime is Node ${declaredNode}. Reconfirm deployment/runtime checks during release.`)
}

const report = {
  generatedAt: new Date().toISOString(),
  mode: 'security_compatibility_retirement_readiness',
  localReleaseCandidateReady,
  productionReleaseReady: localReleaseCandidateReady && checks.localRuntimeParity,
  declaredNode,
  currentNode,
  checks,
  missingFiles,
  remainingRetiredFiles,
  remainingRetiredCommands,
  releaseBlockers
}

console.log(JSON.stringify(report, null, 2))
if (!localReleaseCandidateReady) process.exitCode = 1
