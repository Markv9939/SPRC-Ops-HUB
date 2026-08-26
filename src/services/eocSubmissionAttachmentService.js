import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { ref, uploadBytes } from 'firebase/storage'
import { db, storage } from '../firebase'
import { buildEocResponseAttachmentMetadata } from '../utils/photoModel'

export async function uploadEocResponseAttachment({ submissionId, locationId, itemId, photo, uploader }) {
  const attachmentId = photo.id
  const metadata = buildEocResponseAttachmentMetadata({
    attachmentId,
    submissionId,
    locationId,
    itemId,
    processed: photo,
    uploader,
    state: 'uploading'
  })
  const attachmentRef = doc(db, 'eocSubmissions', submissionId, 'attachments', attachmentId)
  const existing = await getDoc(attachmentRef)
  await setDoc(attachmentRef, {
    ...metadata,
    ...(existing.exists() ? {} : { createdAt: serverTimestamp() }),
    updatedAt: serverTimestamp(),
    version: Number(existing.data()?.version || 0) + 1
  }, { merge: true })

  try {
    await uploadBytes(ref(storage, metadata.storagePath), photo.blob, {
      contentType: 'image/jpeg',
      customMetadata: { locationId, submissionId, attachmentId, itemId, kind: 'response' }
    })
    await updateDoc(attachmentRef, {
      state: 'uploaded',
      uploadedAt: serverTimestamp(),
      lastError: null,
      updatedAt: serverTimestamp(),
      version: Number(existing.data()?.version || 0) + 2
    })
    return { attachmentId, submissionId, itemId, responsePhoto: true, state: 'uploaded' }
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

export async function uploadEocResponsePhotos({ submissionId, locationId, itemId, photos, uploader }) {
  const results = []
  for (const photo of Array.isArray(photos) ? photos : []) {
    try {
      results.push(await uploadEocResponseAttachment({ submissionId, locationId, itemId, photo, uploader }))
    } catch (error) {
      results.push({
        attachmentId: photo.id,
        submissionId,
        itemId,
        responsePhoto: true,
        state: 'failed',
        error: error?.message || 'Upload failed.'
      })
    }
  }
  return results
}
