import { collection, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { getBlob, ref, uploadBytes } from 'firebase/storage'
import { db, storage } from '../firebase'
import { buildAttachmentMetadata } from '../utils/photoModel'

export function observeIssueAttachments(issueId, onValue, onError) {
  return onSnapshot(
    query(collection(db, 'eocIssues', issueId, 'attachments'), orderBy('createdAt', 'asc')),
    snap => onValue(snap.docs.map(item => ({ id: item.id, ...item.data() }))),
    onError
  )
}

export async function uploadIssueAttachment({ issueId, locationId, photo, kind, uploader }) {
  const attachmentId = photo.id
  const metadata = buildAttachmentMetadata({
    attachmentId,
    issueId,
    locationId,
    kind,
    processed: photo,
    uploader,
    state: 'uploading'
  })
  const attachmentRef = doc(db, 'eocIssues', issueId, 'attachments', attachmentId)
  const existing = await getDoc(attachmentRef)
  await setDoc(attachmentRef, {
    ...metadata,
    ...(existing.exists() ? {} : { createdAt: serverTimestamp() }),
    updatedAt: serverTimestamp(),
    version: Number(existing.data()?.version || 0) + 1
  }, { merge: true })

  try {
    const isE2eHost = globalThis.location?.hostname === '127.0.0.1' && globalThis.location?.port === '4176'
    if (isE2eHost && globalThis.sessionStorage?.getItem('sprc_e2e_fail_photo_upload') === 'true') {
      throw new Error('Synthetic E2E photo upload failure.')
    }
    await uploadBytes(ref(storage, metadata.storagePath), photo.blob, {
      contentType: 'image/jpeg',
      customMetadata: { locationId, issueId, attachmentId, kind }
    })
    await updateDoc(attachmentRef, {
      state: 'uploaded',
      uploadedAt: serverTimestamp(),
      lastError: null,
      updatedAt: serverTimestamp(),
      version: Number(existing.data()?.version || 0) + 2
    })
    return { attachmentId, issueId, state: 'uploaded' }
  } catch (error) {
    await updateDoc(attachmentRef, {
      state: 'failed',
      lastError: String(error?.message || 'Upload failed.').slice(0, 500),
      updatedAt: serverTimestamp(),
      version: Number(existing.data()?.version || 0) + 2
    })
    throw error
  }
}

export async function uploadIssuePhotos({ issueId, locationId, photos, kind, uploader }) {
  const results = []
  for (const photo of Array.isArray(photos) ? photos : []) {
    try {
      results.push(await uploadIssueAttachment({ issueId, locationId, photo, kind, uploader }))
    } catch (error) {
      results.push({ attachmentId: photo.id, issueId, state: 'failed', error: error?.message || 'Upload failed.' })
    }
  }
  return results
}

export function getIssueAttachmentBlob(storagePath) {
  if (!storagePath) throw new Error('Attachment path is missing.')
  return getBlob(ref(storage, storagePath))
}

export async function setAttachmentHidden({ issueId, attachmentId, hidden, actorUser }) {
  await updateDoc(doc(db, 'eocIssues', issueId, 'attachments', attachmentId), {
    hiddenFromBht: hidden === true,
    visibility: hidden === true ? 'management_only' : 'location',
    hiddenAt: hidden === true ? serverTimestamp() : null,
    hiddenByUserId: hidden === true ? actorUser?.id || null : null,
    hiddenByName: hidden === true ? actorUser?.name || null : null,
    updatedAt: serverTimestamp()
  })
}
