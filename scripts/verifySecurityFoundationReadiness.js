import { readFileSync, existsSync } from 'node:fs'
import process from 'node:process'

const requiredFiles = [
  'MASTER_PLAN.md',
  'PROGRESS_LOG.md',
  'docs/security/PHASE_1_SECURITY_FOUNDATION_BASELINE.md',
  'docs/security/PHASE_2_DORMANT_SERVER_FOUNDATION.md',
  'docs/security/PHASE_3_DORMANT_CLIENT_BOOTSTRAP.md',
  'docs/security/PHASE_4_TO_8_LOCAL_SECURITY_READINESS.md',
  'docs/security/PHASE_9_PROTECTED_OPERATIONAL_MUTATIONS.md',
  'docs/security/SECURITY_CANARY_AND_ROLLBACK.md',
  'scripts/manageSecurityFoundationCanary.js',
  'scripts/appCheckObservationModel.js',
  'scripts/securityCanaryEvidenceModel.js',
  'scripts/securityCanaryStageModel.js',
  'scripts/startSecurityE2eServer.js',
  'playwright.security.templates.config.js',
  'tests/e2e/securityTemplatesPhotosStage.spec.js',
  'playwright.security.eoc.config.js',
  'tests/e2e/securityEocOfflineStage.spec.js',
  'playwright.security.debriefs.config.js',
  'tests/e2e/securityDebriefsAlertsStage.spec.js',
  'playwright.security.issues.config.js',
  'tests/e2e/securityIssuesFeedbackAuditStage.spec.js',
  'playwright.security.transports.config.js',
  'tests/e2e/securityTransportsStage.spec.js',
  'playwright.security.operations.config.js',
  'tests/e2e/securityOperationsAdminStage.spec.js',
  'playwright.security.settings.config.js',
  'tests/e2e/securitySettingsStage.spec.js',
  'playwright.security.offline.config.js',
  'tests/e2e/securityOfflineReconnectMatrix.spec.js',
  'playwright.security.offline-shell.config.js',
  'tests/e2e/securityOfflineProductionShell.spec.js',
  'tests/e2e/support/securityProductionOfflineServer.js',
  'tests/e2e/support/securityOfflineProcessRestartRunner.js',
  'scripts/verifySecurityOfflineProcessRestart.js',
  'playwright.security.compatibility.config.js',
  'tests/e2e/securityCompatibilityCanary.spec.js',
  'tests/e2e/support/securityViteGlobalServer.js',
  'tests/offlineReconnectMatrix.test.js',
  'tests/appCheckObservationModel.test.js',
  'tests/securityCanaryEvidenceModel.test.js',
  'functions/src/staffPinLoginService.js',
  'functions/src/staffAccountSecurityService.js',
  'functions/src/accessScopeSecurityService.js',
  'functions/src/offlineReplaySecurityService.js',
  'functions/src/workflowSecurityModel.js',
  'functions/src/transportSecurityService.js',
  'functions/src/operationalMutationSecurityService.js',
  'src/services/securityClientRuntime.js',
  'src/services/offlineActionCatalog.js',
  'src/services/offlineSecurityModel.js',
  'src/services/protectedOperationalMutationService.js',
  'src/services/scopedSnapshotService.js',
  'src/services/appCheckMonitoringModel.js'
]

const missingFiles = requiredFiles.filter(path => !existsSync(path))
const functionsPackage = JSON.parse(readFileSync('functions/package.json', 'utf8'))
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const indexSource = readFileSync('functions/src/index.js', 'utf8')
const firebaseSource = readFileSync('src/firebase.js', 'utf8')
const ruleSource = readFileSync('firestore.rules', 'utf8')
const canaryManagerSource = readFileSync('scripts/manageSecurityFoundationCanary.js', 'utf8')
const declaredNode = String(functionsPackage.engines?.node || '')
const currentNode = process.versions.node
const nodeMajor = currentNode.split('.')[0]

const checks = {
  requiredFilesPresent: missingFiles.length === 0,
  declaredNode22: declaredNode === '22',
  runtimeParity: nodeMajor === declaredNode,
  securityUnitCommandPresent: Boolean(packageJson.scripts?.['test:security-foundation']),
  securityEmulatorCommandPresent: Boolean(packageJson.scripts?.['test:security-foundation:emulator']),
  guardedStageTransitionPresent: Boolean(packageJson.scripts?.['test:security-canary-stage'])
    && canaryManagerSource.includes("mode === 'stage-preview'")
    && canaryManagerSource.includes("mode === 'stage-advance'")
    && canaryManagerSource.includes("mode === 'stage-rollback'")
    && canaryManagerSource.includes('closeCanarySessions')
    && canaryManagerSource.includes('revokeCanaryRefreshTokens'),
  operationsDataPreflightPresent: canaryManagerSource.includes('requireOperationsAdminDataReadiness')
    && canaryManagerSource.includes('Correct it through a separately approved, backed-up data migration before advancing.'),
  templatesPhotosBrowserCommandPresent: Boolean(packageJson.scripts?.['test:security-templates-photos:browser']),
  eocOfflineBrowserCommandPresent: Boolean(packageJson.scripts?.['test:security-eoc-offline:browser']),
  debriefsAlertsBrowserCommandPresent: Boolean(packageJson.scripts?.['test:security-debriefs-alerts:browser']),
  issuesFeedbackAuditBrowserCommandPresent: Boolean(packageJson.scripts?.['test:security-issues-feedback-audit:browser']),
  transportsBrowserCommandPresent: Boolean(packageJson.scripts?.['test:security-transports:browser']),
  operationsAdminBrowserCommandPresent: Boolean(packageJson.scripts?.['test:security-operations-admin:browser']),
  settingsBrowserCommandPresent: Boolean(packageJson.scripts?.['test:security-settings:browser']),
  completeOfflineReconnectMatrixPresent: Boolean(packageJson.scripts?.['test:security-offline-matrix:browser'])
    && Boolean(packageJson.scripts?.['test:security-offline-matrix:emulator'])
    && readFileSync('src/services/offlineActionCatalog.js', 'utf8').includes('SUPPORTED_SECURE_OFFLINE_ACTION_TYPES'),
  productionOfflineColdStartGatePresent: Boolean(packageJson.scripts?.['test:security-offline-shell:browser'])
    && Boolean(packageJson.scripts?.['test:security-offline-shell:process'])
    && readFileSync('tests/e2e/securityOfflineProductionShell.spec.js', 'utf8').includes('sprc-ops-shell-v13')
    && readFileSync('tests/e2e/support/securityOfflineProcessRestartRunner.js', 'utf8').includes('launchPersistentContext')
    && readFileSync('src/main.jsx', 'utf8').includes('offlineShellReady')
    && readFileSync('public/sw.js', 'utf8').includes("fetch('/asset-manifest.json'")
    && readFileSync('vite.config.js', 'utf8').includes("manifest: 'asset-manifest.json'"),
  secureClientAndCompatibilityBrowserGatesPresent: Boolean(packageJson.scripts?.['test:security-client:emulator'])
    && Boolean(packageJson.scripts?.['test:security-compatibility:emulator'])
    && readFileSync('tests/e2e/securityCompatibilityCanary.spec.js', 'utf8').includes('stableProfileClaim'),
  appCheckNotEnforced: indexSource.includes('enforceAppCheck: false') && !indexSource.includes('enforceAppCheck: true'),
  appCheckClientExactGate: firebaseSource.includes('VITE_APP_CHECK_MONITORING_VERSION')
    && firebaseSource.includes('VITE_ENABLE_APP_CHECK_MONITORING'),
  appCheckReadOnlyObservationGatePresent: canaryManagerSource.includes("mode === 'app-check-observe'")
    && canaryManagerSource.includes('summarizeAppCheckObservation')
    && canaryManagerSource.includes('Monitoring-only observation refuses to continue.'),
  identityReadOnlyStatusGatePresent: canaryManagerSource.includes("mode === 'identity-status'")
    && canaryManagerSource.includes('summarizeIdentityCanaryEvidence')
    && canaryManagerSource.includes('Identity status requires the verified --backup path'),
  serverIssuedWorkflowScopeClaims: indexSource.includes('manageStaffSecurityV4')
    && readFileSync('functions/src/staffPinLoginService.js', 'utf8').includes('authorizedLocations')
    && readFileSync('functions/src/staffPinLoginService.js', 'utf8').includes('issueLocationIds'),
  noAnonymousAuthShortcut: !indexSource.includes('signInAnonymously'),
  workflowBoundaryPresent: ruleSource.includes('workflowSecurityVersion == 6')
    && ruleSource.includes('hasCurrentSecuritySession()')
    && ruleSource.includes('session.scopeExpiresAt > request.time'),
  directScopeWritesRetiredInStrictMode: ruleSource.includes("allow create: if !workflowSecurityEnabled('identity_users')")
    && ruleSource.includes("allow create, update: if !workflowSecurityEnabled('identity_users')"),
  serverOnlySecurityCollections: ruleSource.includes('match /securityWorkflowAudit/{auditId}')
    && ruleSource.includes('allow read, write: if false;'),
  protectedOperationalMutationsPresent: indexSource.includes('submitProtectedEocV9')
    && indexSource.includes('mutateProtectedIssueV9')
    && ruleSource.includes("allow create: if !workflowSecurityEnabled('issues_feedback_audit')")
}

const releaseBlockers = []
if (!checks.runtimeParity) releaseBlockers.push(`Node runtime parity not verified: declared ${declaredNode}, local ${currentNode}.`)
releaseBlockers.push('Broad staff rollout and compatibility-retirement approval are intentionally outside this local verifier; the completed synthetic canary does not authorize either change.')

const report = {
  generatedAt: new Date().toISOString(),
  localDormantImplementationReady: Object.entries(checks)
    .filter(([name]) => name !== 'runtimeParity')
    .every(([, passed]) => passed),
  productionReleaseScope: 'broad_staff_rollout',
  productionReleaseReady: false,
  declaredNode,
  currentNode,
  checks,
  missingFiles,
  releaseBlockers
}

console.log(JSON.stringify(report, null, 2))
if (!report.localDormantImplementationReady) process.exitCode = 1
