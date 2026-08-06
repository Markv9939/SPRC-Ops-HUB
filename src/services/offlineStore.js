const DB_NAME = 'sprc_ops_offline_v1'
const DB_VERSION = 1
const DRAFTS_STORE = 'drafts'
const OUTBOX_STORE = 'outbox'

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

let dbPromise = null

function openOfflineDb() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('Offline storage is not available in this browser.'))
  }
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(DRAFTS_STORE)) {
        db.createObjectStore(DRAFTS_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        const outbox = db.createObjectStore(OUTBOX_STORE, { keyPath: 'id' })
        outbox.createIndex('status', 'status', { unique: false })
        outbox.createIndex('createdAtIso', 'createdAtIso', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  return dbPromise
}

async function withStore(storeName, mode, callback) {
  const db = await openOfflineDb()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode)
    const store = transaction.objectStore(storeName)
    let result
    transaction.oncomplete = () => resolve(result)
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
    result = callback(store)
  })
}

function makeId(type) {
  const suffix = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`
  return `${type}:${suffix}`
}

export async function saveOfflineDraft(id, type, payload) {
  if (!id) return
  await withStore(DRAFTS_STORE, 'readwrite', (store) => {
    store.put({ id, type, payload, updatedAtIso: new Date().toISOString() })
  })
}

export async function getOfflineDraft(id) {
  if (!id) return null
  return withStore(DRAFTS_STORE, 'readonly', (store) => requestToPromise(store.get(id)))
}

export async function listOfflineDrafts(type = '') {
  const drafts = await withStore(DRAFTS_STORE, 'readonly', (store) => requestToPromise(store.getAll()))
  const normalizedType = String(type || '').trim()
  return (Array.isArray(drafts) ? drafts : [])
    .filter(draft => !normalizedType || draft?.type === normalizedType)
    .sort((a, b) => String(b?.updatedAtIso || '').localeCompare(String(a?.updatedAtIso || '')))
}

export async function deleteOfflineDraft(id) {
  if (!id) return
  await withStore(DRAFTS_STORE, 'readwrite', (store) => {
    store.delete(id)
  })
}

export async function deleteOfflineAction(id) {
  if (!id) return
  await withStore(OUTBOX_STORE, 'readwrite', (store) => {
    store.delete(id)
  })
  window.dispatchEvent(new CustomEvent('offline-outbox-changed'))
}

export async function queueOfflineAction({ id, type, payload }) {
  const nowIso = new Date().toISOString()
  const action = {
    id: id || makeId(type),
    type,
    payload,
    status: 'pending',
    attempts: 0,
    createdAtIso: nowIso,
    updatedAtIso: nowIso,
    lastError: ''
  }
  await withStore(OUTBOX_STORE, 'readwrite', (store) => {
    store.put(action)
  })
  window.dispatchEvent(new CustomEvent('offline-outbox-changed'))
  return action
}

export async function listOfflineActions(statuses = ['pending', 'failed', 'syncing']) {
  const wanted = new Set(statuses)
  const actions = await withStore(OUTBOX_STORE, 'readonly', (store) => requestToPromise(store.getAll()))
  return (Array.isArray(actions) ? actions : [])
    .filter(action => wanted.has(action.status))
    .sort((a, b) => String(a.createdAtIso || '').localeCompare(String(b.createdAtIso || '')))
}

export async function listAllOfflineActions() {
  return withStore(OUTBOX_STORE, 'readonly', (store) => requestToPromise(store.getAll()))
}

export async function updateOfflineAction(id, patch) {
  if (!id) return null
  let updated = null
  await withStore(OUTBOX_STORE, 'readwrite', (store) => {
    const request = store.get(id)
    request.onsuccess = () => {
      const existing = request.result
      if (!existing) return
      updated = { ...existing, ...patch, updatedAtIso: new Date().toISOString() }
      store.put(updated)
    }
  })
  window.dispatchEvent(new CustomEvent('offline-outbox-changed'))
  return updated
}

export function markOfflineActionSynced(id, patch = {}) {
  return updateOfflineAction(id, { status: 'synced', lastError: '', ...patch })
}

export function markOfflineActionNeedsReview(id, message) {
  return updateOfflineAction(id, { status: 'needsReview', lastError: message || 'Needs supervisor review.' })
}

export function markOfflineActionFailed(id, message, attempts) {
  return updateOfflineAction(id, {
    status: 'failed',
    attempts: Number(attempts || 0),
    lastError: message || 'Sync failed.'
  })
}
