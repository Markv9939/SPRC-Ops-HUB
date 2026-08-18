import test from 'node:test'
import assert from 'node:assert/strict'
import { commitFirestoreWritesInChunks } from '../src/utils/firestoreBatching.js'

function fakeBatchFactory(commits) {
  return () => {
    const writes = []
    return {
      record(value) {
        writes.push(value)
      },
      async commit() {
        commits.push(writes)
      }
    }
  }
}

test('Firestore writes are committed in small ordered chunks', async () => {
  const commits = []
  const operations = Array.from({ length: 10 }, (_, index) => batch => batch.record(index + 1))

  const commitCount = await commitFirestoreWritesInChunks(operations, fakeBatchFactory(commits), 4)

  assert.equal(commitCount, 3)
  assert.deepEqual(commits, [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10]])
})

test('Firestore batching skips empty write lists', async () => {
  let factoryCalled = false
  const commits = await commitFirestoreWritesInChunks([], () => {
    factoryCalled = true
  })

  assert.equal(commits, 0)
  assert.equal(factoryCalled, false)
})

test('Firestore batching stops after the first failed chunk', async () => {
  const committed = []
  let batchNumber = 0
  const operations = Array.from({ length: 9 }, (_, index) => batch => batch.record(index + 1))

  await assert.rejects(
    commitFirestoreWritesInChunks(operations, () => {
      const currentBatch = batchNumber
      batchNumber += 1
      const writes = []
      return {
        record(value) {
          writes.push(value)
        },
        async commit() {
          if (currentBatch === 1) throw new Error('Network unavailable')
          committed.push(writes)
        }
      }
    }, 4),
    /Network unavailable/
  )

  assert.deepEqual(committed, [[1, 2, 3, 4]])
  assert.equal(batchNumber, 2)
})
