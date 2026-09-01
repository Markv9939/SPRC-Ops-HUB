const contains = (source, pattern) => pattern instanceof RegExp
  ? pattern.test(String(source || ''))
  : String(source || '').includes(pattern)

const absent = (source, patterns) => patterns.every(pattern => !contains(source, pattern))
const present = (source, patterns) => patterns.every(pattern => contains(source, pattern))

export function evaluateCompatibilityRetirementSources(sources = {}) {
  const checks = {
    sixDigitPinExperiencePreserved: present(sources.pinLogin, [
      'Enter PIN to access',
      'PIN_LENGTH',
      'beginSecurityClientPinLogin'
    ]),
    browserPinTrustRemoved: absent(sources.pinLogin, [
      'signInAnonymously',
      "from '../utils/pinHash'",
      "where('pinHash'",
      'toSecurityCompatibilityUser',
      'establishPinSession'
    ]),
    compatibilitySessionMarkerRemoved: absent(sources.sessionModel, [
      'SECURITY_COMPATIBILITY_SESSION_VERSION',
      'toSecurityCompatibilityUser',
      'isSecurityCompatibilityUser',
      'compatibilitySessionRequiresFreshLogin'
    ]) && absent(sources.app, [
      'securityCompatibilityVersion',
      'compatibilitySessionRequiresFreshLogin',
      'isSecurityCompatibilityUser'
    ]),
    directBrowserPinMutationRemoved: absent(sources.userPinService, [
      "from '../utils/pinHash'",
      'findDuplicatePinUser',
      'updateDoc(userRef',
      'pinHash:'
    ]) && absent(sources.supervisorDashboard, [
      "from '../utils/pinHash'",
      'await hashPin('
    ]),
    serverLegacyPinMigrationRemoved: absent(sources.staffPinLoginService, [
      "where('pinHash'",
      "source: 'legacy_pin_hash'",
      "migratedFrom: 'legacy_pin_hash_v2'"
    ]),
    privateLegacyPinEndpointsRemoved: absent(sources.functionsIndex, [
      'establishPinSessionHandler',
      'requireAdminPin(',
      'profile?.pinHash === hashPin(pin)',
      'profile.pinHash === hashPin(pin)'
    ]),
    firestoreCompatibilityBypassesRemoved: absent(sources.firestoreRules, [
      'function hasLegacyAuthSession()',
      '!workflowSecurityEnabled(',
      ': authRoleAllowed(roles)',
      /allow\s+(?:read|write|get|list|create|update|delete)(?:\s*,\s*(?:read|write|get|list|create|update|delete))*\s*:\s*if\s+true\s*;/
    ]),
    storageCompatibilityBypassesRemoved: absent(sources.storageRules, [
      'function strictAuthEnabled()',
      ': locationAllowed(locationId)',
      '!strictAuthEnabled()'
    ]),
    secureServerLoginPreserved: present(sources.staffPinLoginService, [
      'staffPinCredentials',
      'createCustomToken',
      'staffSessions'
    ]),
    secureAccountActionsPreserved: present(sources.userPinService, [
      'performSecurityAccountAction',
      "action: 'self_change_pin'"
    ]),
    absolute84HourSessionPreserved: present(sources.sessionModel, [
      'SECURITY_SESSION_MAX_MS = 84 * 60 * 60 * 1000',
      'validateStoredSecuritySession'
    ]),
    strictCurrentSessionRulesPreserved: present(sources.firestoreRules, [
      'function hasCurrentSecuritySession()',
      'session.scopeExpiresAt > request.time',
      'match /securityWorkflowAudit/{auditId}'
    ])
  }

  const blockers = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name)

  return {
    retired: blockers.length === 0,
    checks,
    blockers
  }
}
