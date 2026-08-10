export const CORE_RESET_VERSION = '2026-08-09-core-v1'
export const CORE_RESET_STORAGE_KEY = 'sprcCoreResetVersion'

const KNOWN_DATABASES = new Set([
  'sprc_ops_offline_v1',
  'firebaseLocalStorageDb',
  'firebase-heartbeat-database',
  'firebase-installations-database'
])

function isResetDatabase(name) {
  const normalized = String(name || '').trim()
  return KNOWN_DATABASES.has(normalized)
}

function deleteDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error || new Error(`Unable to clear ${name}.`))
    request.onblocked = () => reject(new Error('Close other SPRC Ops Hub tabs, then reload this page to finish the reset.'))
  })
}

async function listResetDatabases() {
  if (typeof indexedDB === 'undefined') return []
  if (typeof indexedDB.databases !== 'function') return [...KNOWN_DATABASES]

  const databases = await indexedDB.databases()
  return databases
    .map(database => database?.name)
    .filter(isResetDatabase)
}

export function browserNeedsCoreReset(storage = globalThis.localStorage) {
  return storage?.getItem(CORE_RESET_STORAGE_KEY) !== CORE_RESET_VERSION
}

export async function applyCoreResetCutover() {
  if (!browserNeedsCoreReset()) return false

  globalThis.sessionStorage?.clear()
  globalThis.localStorage?.clear()

  const databaseNames = await listResetDatabases()
  for (const databaseName of databaseNames) {
    await deleteDatabase(databaseName)
  }

  const [{ db, auth }, { clearIndexedDbPersistence }, { signOut }] = await Promise.all([
    import('../firebase'),
    import('firebase/firestore'),
    import('firebase/auth')
  ])
  await clearIndexedDbPersistence(db)
  await signOut(auth)

  globalThis.localStorage?.setItem(CORE_RESET_STORAGE_KEY, CORE_RESET_VERSION)
  return true
}
