export const PHOTO_RETENTION_DAYS = 90
export const PHOTO_RETENTION_MS = PHOTO_RETENTION_DAYS * 24 * 60 * 60 * 1000

export function photoDeletionDueMs(closedAtMs) {
  const closed = Number(closedAtMs)
  if (!Number.isFinite(closed) || closed <= 0) return null
  return closed + PHOTO_RETENTION_MS
}

export function attachmentNeedsDeletion(attachment) {
  return ['uploaded', 'hidden'].includes(String(attachment?.state || ''))
    && String(attachment?.storagePath || '').length > 0
}

export function summarizeCleanupResults(results) {
  return (Array.isArray(results) ? results : []).reduce((summary, result) => {
    if (result.status === 'deleted') summary.deleted += 1
    if (result.status === 'failed') summary.failed += 1
    if (result.status === 'missing') summary.missing += 1
    return summary
  }, { deleted: 0, failed: 0, missing: 0 })
}
