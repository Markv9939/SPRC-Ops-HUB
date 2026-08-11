export const MAX_PHOTOS_PER_KIND = 3
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024
export const MAX_PHOTO_EDGE = 1600
export const PHOTO_JPEG_QUALITY = 0.82
export const PHOTO_RETENTION_DAYS = 90

function trim(value) {
  return String(value || '').trim()
}

function safePart(value) {
  return trim(value).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)
}

export function makeAttachmentId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`
}

export function buildAttachmentStoragePath({ locationId, issueId, attachmentId }) {
  const location = safePart(locationId)
  const issue = safePart(issueId)
  const attachment = safePart(attachmentId)
  if (!location || !issue || !attachment) throw new Error('Location, issue, and attachment IDs are required.')
  return `issueAttachments/${location}/${issue}/${attachment}.jpg`
}

export function validateProcessedPhoto({ size, type, width, height }) {
  if (type !== 'image/jpeg') throw new Error('Photo processing must produce a JPEG image.')
  if (!Number.isFinite(size) || size <= 0) throw new Error('The processed photo is empty.')
  if (size > MAX_PHOTO_BYTES) throw new Error('Photo is still over 2 MB after processing. Choose a different photo.')
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Photo dimensions are invalid.')
  if (Math.max(width, height) > MAX_PHOTO_EDGE) throw new Error('Photo exceeds the 1600 pixel limit.')
  return true
}

export function buildAttachmentMetadata({ attachmentId, issueId, locationId, kind, processed, uploader, state = 'waiting' }) {
  if (!['report', 'resolution'].includes(kind)) throw new Error('Unsupported attachment kind.')
  validateProcessedPhoto(processed)
  return {
    schemaVersion: 1,
    attachmentId,
    issueId,
    locationId,
    kind,
    state,
    width: processed.width,
    height: processed.height,
    sizeBytes: processed.size,
    mimeType: 'image/jpeg',
    uploaderProfileId: trim(uploader?.id),
    uploaderName: trim(uploader?.name),
    storagePath: buildAttachmentStoragePath({ attachmentId, issueId, locationId }),
    visibility: 'location',
    hiddenFromBht: false,
    retentionDays: PHOTO_RETENTION_DAYS,
    version: 1
  }
}

export function requiredPhotoSatisfied({ photos, unableToTakePhoto, unableReason }) {
  const hasQueuedPhoto = (Array.isArray(photos) ? photos : []).some(photo => ['waiting', 'uploading', 'uploaded', 'ready'].includes(photo?.state))
  return hasQueuedPhoto || (unableToTakePhoto === true && trim(unableReason).length > 0)
}
