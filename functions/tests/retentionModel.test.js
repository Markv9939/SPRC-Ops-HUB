import assert from 'node:assert/strict'
import test from 'node:test'
import { attachmentNeedsDeletion, photoDeletionDueMs, PHOTO_RETENTION_MS, summarizeCleanupResults } from '../src/retentionModel.js'

test('photo deletion is due 90 days after closure', () => {
  assert.equal(photoDeletionDueMs(1000), 1000 + PHOTO_RETENTION_MS)
  assert.equal(photoDeletionDueMs(null), null)
})

test('only uploaded or hidden objects with a path need deletion', () => {
  assert.equal(attachmentNeedsDeletion({ state: 'uploaded', storagePath: 'a' }), true)
  assert.equal(attachmentNeedsDeletion({ state: 'privacy_removed', storagePath: null }), false)
})

test('cleanup summaries keep deleted missing and failed separate', () => {
  assert.deepEqual(summarizeCleanupResults([{ status: 'deleted' }, { status: 'missing' }, { status: 'failed' }]), { deleted: 1, failed: 1, missing: 1 })
})

test('cleanup summary handles a synthetic thousand-object retention batch', () => {
  const results = Array.from({ length: 1000 }, (_, index) => ({ status: index % 10 === 0 ? 'failed' : index % 5 === 0 ? 'missing' : 'deleted' }))
  assert.deepEqual(summarizeCleanupResults(results), { deleted: 800, failed: 100, missing: 100 })
})
