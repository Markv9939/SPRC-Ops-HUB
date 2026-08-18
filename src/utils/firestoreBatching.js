// EOC authorization is intentionally thorough; one write per request keeps it
// below Firestore's expression ceiling in both emulator and production.
export const FIRESTORE_RULE_SAFE_BATCH_SIZE = 1

export async function commitFirestoreWritesInChunks(writeOperations, createBatch, maxWrites = FIRESTORE_RULE_SAFE_BATCH_SIZE) {
  if (!Array.isArray(writeOperations) || writeOperations.length === 0) return 0
  if (typeof createBatch !== 'function') throw new TypeError('A Firestore batch factory is required.')
  if (!Number.isInteger(maxWrites) || maxWrites < 1) throw new RangeError('Firestore batch size must be a positive integer.')

  let commits = 0
  for (let offset = 0; offset < writeOperations.length; offset += maxWrites) {
    const batch = createBatch()
    writeOperations.slice(offset, offset + maxWrites).forEach(operation => operation(batch))
    await batch.commit()
    commits += 1
  }
  return commits
}
