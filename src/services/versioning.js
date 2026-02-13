export const VERSION_CONFLICT_CODE = 'version-conflict'

export function getVersionNumber(data) {
  const raw = Number(data?.version)
  return Number.isFinite(raw) && raw >= 0 ? raw : 0
}

export function assertExpectedVersion({
  expectedVersion,
  currentVersion,
  documentId = '',
  recordLabel = 'Record'
}) {
  const normalizedExpected = Number.isFinite(Number(expectedVersion))
    ? Number(expectedVersion)
    : currentVersion

  if (normalizedExpected !== currentVersion) {
    const error = new Error(
      `${recordLabel} was updated by another session (expected v${normalizedExpected}, found v${currentVersion}).`
    )
    error.code = VERSION_CONFLICT_CODE
    error.documentId = documentId
    error.recordLabel = recordLabel
    error.expectedVersion = normalizedExpected
    error.currentVersion = currentVersion
    throw error
  }

  return {
    expectedVersion: normalizedExpected,
    currentVersion,
    nextVersion: currentVersion + 1
  }
}

export function formatVersionConflictMessage(error, fallback = 'This record changed in another session. Reload and retry.') {
  if (error?.code !== VERSION_CONFLICT_CODE) return fallback
  return `${error.recordLabel || 'Record'} changed (expected v${error.expectedVersion}, found v${error.currentVersion}). Reload and retry.`
}
