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
  'functions/src/staffPinLoginService.js',
  'functions/src/staffAccountSecurityService.js',
  'functions/src/accessScopeSecurityService.js',
  'functions/src/offlineReplaySecurityService.js',
  'functions/src/workflowSecurityModel.js',
  'functions/src/transportSecurityService.js',
  'functions/src/operationalMutationSecurityService.js',
  'src/services/securityClientRuntime.js',
  'src/services/offlineSecurityModel.js',
  'src/services/protectedOperationalMutationService.js',
  'src/services/appCheckMonitoringModel.js'
]

const missingFiles = requiredFiles.filter(path => !existsSync(path))
const functionsPackage = JSON.parse(readFileSync('functions/package.json', 'utf8'))
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const indexSource = readFileSync('functions/src/index.js', 'utf8')
const firebaseSource = readFileSync('src/firebase.js', 'utf8')
const ruleSource = readFileSync('firestore.rules', 'utf8')
const declaredNode = String(functionsPackage.engines?.node || '')
const currentNode = process.versions.node
const nodeMajor = currentNode.split('.')[0]

const checks = {
  requiredFilesPresent: missingFiles.length === 0,
  declaredNode22: declaredNode === '22',
  runtimeParity: nodeMajor === declaredNode,
  securityUnitCommandPresent: Boolean(packageJson.scripts?.['test:security-foundation']),
  securityEmulatorCommandPresent: Boolean(packageJson.scripts?.['test:security-foundation:emulator']),
  appCheckNotEnforced: indexSource.includes('enforceAppCheck: false') && !indexSource.includes('enforceAppCheck: true'),
  appCheckClientExactGate: firebaseSource.includes('VITE_APP_CHECK_MONITORING_VERSION')
    && firebaseSource.includes('VITE_ENABLE_APP_CHECK_MONITORING'),
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
releaseBlockers.push('Production release approval, Firebase configuration, secrets, canary selection, activation, deployment, and rollback authority are intentionally absent.')

const report = {
  generatedAt: new Date().toISOString(),
  localDormantImplementationReady: Object.entries(checks)
    .filter(([name]) => name !== 'runtimeParity')
    .every(([, passed]) => passed),
  productionReleaseReady: false,
  declaredNode,
  currentNode,
  checks,
  missingFiles,
  releaseBlockers
}

console.log(JSON.stringify(report, null, 2))
if (!report.localDormantImplementationReady) process.exitCode = 1
