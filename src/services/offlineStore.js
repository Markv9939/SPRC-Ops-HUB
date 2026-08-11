const DB_NAME = 'sprc_ops_offline_v1'
const DB_VERSION = 2
const DRAFTS_STORE = 'drafts'
const OUTBOX_STORE = 'outbox'
const ATTACHMENTS_STORE = 'attachments'

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
        outbox.createIndex('ownerProfileId', 'ownerProfileId', { unique: false })
      } else {
        const outbox = request.transaction.objectStore(OUTBOX_STORE)
        if (!outbox.indexNames.contains('ownerProfileId')) outbox.createIndex('ownerProfileId', 'ownerProfileId', { unique: false })
        const cursorRequest = outbox.openCursor()
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result
          if (!cursor) return
          const action = cursor.value
          if (!action.ownerProfileId) cursor.update({ ...action, ownerProfileId: String(action.payload?.user?.id || action.payload?.normalizedUserId || '') })
          cursor.continue()
        }
      }
      if (!db.objectStoreNames.contains(ATTACHMENTS_STORE)) {
        const attachments = db.createObjectStore(ATTACHMENTS_STORE, { keyPath: 'id' })
        attachments.createIndex('ownerProfileId', 'ownerProfileId', { unique: false })
        attachments.createIndex('issueId', 'issueId', { unique: false })
        attachments.createIndex('actionId', 'actionId', { unique: false })
        attachments.createIndex('state', 'state', { unique: false })
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

export async function mutateOfflineDraft(id, type, mutatePayload) {
  if (!id) return null
  let updated = null
  await withStore(DRAFTS_STORE, 'readwrite', store => {
    const request = store.get(id)
    request.onsuccess = () => {
      const payload = mutatePayload(request.result?.payload || null)
      if (payload === null) {
        store.delete(id)
        return
      }
      updated = { id, type, payload, updatedAtIso: new Date().toISOString() }
      store.put(updated)
    }
  })
  return updated
}

export async function mutateOfflineDraftAndOutbox({
  draftId,
  draftType,
  mutatePayload,
  queueAction = null,
  deleteActionId = ''
}) {
  if (!draftId) return null
  const db = await openOfflineDb()
  let updatedDraft = null
  await new Promise((resolve, reject) => {
    const transaction = db.transaction([DRAFTS_STORE, OUTBOX_STORE], 'readwrite')
    const drafts = transaction.objectStore(DRAFTS_STORE)
    const outbox = transaction.objectStore(OUTBOX_STORE)
    const request = drafts.get(draftId)

    request.onsuccess = () => {
      const payload = mutatePayload(request.result?.payload || null)
      if (payload === null) drafts.delete(draftId)
      else {
        updatedDraft = { id: draftId, type: draftType, payload, updatedAtIso: new Date().toISOString() }
        drafts.put(updatedDraft)
      }

      if (queueAction) {
        const nowIso = new Date().toISOString()
        outbox.put({
          id: queueAction.id || makeId(queueAction.type),
          type: queueAction.type,
          payload: queueAction.payload,
          status: 'pending',
          attempts: 0,
          createdAtIso: nowIso,
          updatedAtIso: nowIso,
          lastError: ''
        })
      }
      if (deleteActionId) outbox.delete(deleteActionId)
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
  window.dispatchEvent(new CustomEvent('offline-outbox-changed'))
  return updatedDraft
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
    lastError: '',
    ownerProfileId: String(payload?.user?.id || payload?.normalizedUserId || '')
  }
  await withStore(OUTBOX_STORE, 'readwrite', (store) => {
    store.put(action)
  })
  window.dispatchEvent(new CustomEvent('offline-outbox-changed'))
  return action
}

export async function listOfflineActions(statuses = ['pending', 'failed', 'syncing'], ownerProfileId = '') {
  const wanted = new Set(statuses)
  const actions = await withStore(OUTBOX_STORE, 'readonly', (store) => requestToPromise(store.getAll()))
  return (Array.isArray(actions) ? actions : [])
    .filter(action => wanted.has(action.status))
    .filter(action => !ownerProfileId || action.ownerProfileId === ownerProfileId)
    .sort((a, b) => String(a.createdAtIso || '').localeCompare(String(b.createdAtIso || '')))
}

export async function listAllOfflineActions(ownerProfileId = '') {
  const actions = await withStore(OUTBOX_STORE, 'readonly', (store) => requestToPromise(store.getAll()))
  return (Array.isArray(actions) ? actions : []).filter(action => !ownerProfileId || action.ownerProfileId === ownerProfileId)
}

export async function queueOfflineActionWithAttachments({ id, type, payload, attachments = [] }) {
  const db = await openOfflineDb()
  const ownerProfileId = String(payload?.user?.id || payload?.normalizedUserId || '')
  const nowIso = new Date().toISOString()
  const action = {
    id: id || makeId(type),
    type,
    payload,
    ownerProfileId,
    status: 'pending',
    attempts: 0,
    createdAtIso: nowIso,
    updatedAtIso: nowIso,
    lastError: ''
  }
  await new Promise((resolve, reject) => {
    const transaction = db.transaction([OUTBOX_STORE, ATTACHMENTS_STORE], 'readwrite')
    transaction.objectStore(OUTBOX_STORE).put(action)
    const store = transaction.objectStore(ATTACHMENTS_STORE)
    attachments.forEach(attachment => store.put({
      ...attachment,
      ownerProfileId,
      actionId: action.id,
      state: attachment.state || 'waiting',
      attempts: Number(attachment.attempts || 0),
      createdAtIso: attachment.createdAtIso || nowIso,
      updatedAtIso: nowIso,
      lastError: attachment.lastError || ''
    }))
    transaction.oncomplete = resolve
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
  window.dispatchEvent(new CustomEvent('offline-outbox-changed'))
  window.dispatchEvent(new CustomEvent('offline-attachments-changed'))
  return action
}

export async function listOfflineAttachments({ ownerProfileId = '', actionId = '', states = [] } = {}) {
  const records = await withStore(ATTACHMENTS_STORE, 'readonly', store => requestToPromise(store.getAll()))
  const wantedStates = new Set(states)
  return (Array.isArray(records) ? records : [])
    .filter(record => !ownerProfileId || record.ownerProfileId === ownerProfileId)
    .filter(record => !actionId || record.actionId === actionId)
    .filter(record => wantedStates.size === 0 || wantedStates.has(record.state))
    .sort((a, b) => String(a.createdAtIso || '').localeCompare(String(b.createdAtIso || '')))
}

export async function updateOfflineAttachment(id, patch) {
  if (!id) return null
  let updated = null
  await withStore(ATTACHMENTS_STORE, 'readwrite', store => {
    const request = store.get(id)
    request.onsuccess = () => {
      if (!request.result) return
      updated = { ...request.result, ...patch, updatedAtIso: new Date().toISOString() }
      store.put(updated)
    }
  })
  window.dispatchEvent(new CustomEvent('offline-attachments-changed'))
  return updated
}

export async function deleteOfflineAttachment(id) {
  if (!id) return
  await withStore(ATTACHMENTS_STORE, 'readwrite', store => store.delete(id))
  window.dispatchEvent(new CustomEvent('offline-attachments-changed'))
}

export async function deleteOfflineAttachmentsForAction(actionId, states = []) {
  const records = await listOfflineAttachments({ actionId, states })
  for (const record of records) await deleteOfflineAttachment(record.id)
}

export async function getPhotoStorageReadiness(additionalBytes = 0) {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return { supported: false, enoughSpace: true, persisted: false }
  }
  const estimate = await navigator.storage.estimate()
  const available = Math.max(0, Number(estimate.quota || 0) - Number(estimate.usage || 0))
  const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false
  return { supported: true, enoughSpace: available >= Number(additionalBytes || 0), availableBytes: available, persisted }
}

export async function requestPersistentPhotoStorage() {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false
  return navigator.storage.persist()
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
