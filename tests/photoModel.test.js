import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAttachmentMetadata, buildAttachmentStoragePath, buildEocResponseAttachmentMetadata, buildEocResponseAttachmentStoragePath, MAX_PHOTO_BYTES, MAX_PHOTOS_PER_KIND, requiredPhotoSatisfied, validateProcessedPhoto } from '../src/utils/photoModel.js'

test('attachment paths are randomized-ID based and contain no public URL', () => {
  const path = buildAttachmentStoragePath({ locationId: 'test_house', issueId: 'issue_1', attachmentId: 'random_1' })
  assert.equal(path, 'issueAttachments/test_house/issue_1/random_1.jpg')
  const metadata = buildAttachmentMetadata({ attachmentId: 'random_1', issueId: 'issue_1', locationId: 'test_house', kind: 'report', processed: { width: 1200, height: 900, size: 1000, type: 'image/jpeg' }, uploader: { id: 'bht_1', name: 'BHT One' } })
  assert.equal('downloadUrl' in metadata, false)
  assert.equal(metadata.retentionDays, 90)
})

test('photo question attachments use submission-scoped private paths', () => {
  const path = buildEocResponseAttachmentStoragePath({ locationId: 'test_house', submissionId: 'submission_1', attachmentId: 'photo_1' })
  const metadata = buildEocResponseAttachmentMetadata({
    attachmentId: 'photo_1',
    submissionId: 'submission_1',
    locationId: 'test_house',
    itemId: 'question_photo',
    processed: { size: 1000, type: 'image/jpeg', width: 800, height: 600 },
    uploader: { id: 'staff_1', name: 'Staff One' }
  })

  assert.equal(path, 'eocSubmissionAttachments/test_house/submission_1/photo_1.jpg')
  assert.equal(metadata.storagePath, path)
  assert.equal(metadata.kind, 'response')
  assert.equal(metadata.itemId, 'question_photo')
})

test('processed photos enforce JPEG, dimensions, and 2 MB size', () => {
  assert.equal(validateProcessedPhoto({ width: 1600, height: 1200, size: MAX_PHOTO_BYTES, type: 'image/jpeg' }), true)
  assert.throws(() => validateProcessedPhoto({ width: 1601, height: 1200, size: 100, type: 'image/jpeg' }), /1600/)
  assert.throws(() => validateProcessedPhoto({ width: 100, height: 100, size: MAX_PHOTO_BYTES + 1, type: 'image/jpeg' }), /2 MB/)
})

test('required photos accept a queued photo or a safety exception with reason', () => {
  assert.equal(requiredPhotoSatisfied({ photos: [{ state: 'waiting' }] }), true)
  assert.equal(requiredPhotoSatisfied({ unableToTakePhoto: true, unableReason: 'Client information is visible.' }), true)
  assert.equal(requiredPhotoSatisfied({ unableToTakePhoto: true, unableReason: '' }), false)
})

test('six-photo issue metadata keeps three report and three resolution attachments separate', () => {
  assert.equal(MAX_PHOTOS_PER_KIND, 3)
  const records = ['report', 'resolution'].flatMap(kind => Array.from({ length: MAX_PHOTOS_PER_KIND }, (_, index) => buildAttachmentMetadata({
    attachmentId: `${kind}_${index}`,
    issueId: 'issue_volume',
    locationId: 'test_house',
    kind,
    processed: { width: 1600, height: 1200, size: 1000, type: 'image/jpeg' },
    uploader: { id: 'synthetic_user', name: 'Synthetic User' }
  })))
  assert.equal(records.length, 6)
  assert.equal(records.filter(record => record.kind === 'report').length, 3)
  assert.equal(records.filter(record => record.kind === 'resolution').length, 3)
})
