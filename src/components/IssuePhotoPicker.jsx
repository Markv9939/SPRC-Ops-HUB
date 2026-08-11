import { useEffect, useRef, useState } from 'react'
import { Camera, RotateCcw, Trash2, X } from 'lucide-react'
import { processIssuePhoto } from '../services/photoProcessingService'
import { getPhotoStorageReadiness, requestPersistentPhotoStorage } from '../services/offlineStore'
import { makeAttachmentId, MAX_PHOTOS_PER_KIND } from '../utils/photoModel'

function revokePhoto(photo) {
  if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl)
}

function IssuePhotoPicker({ value = [], onChange, disabled = false, label = 'Add photos' }) {
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)
  const latestPhotosRef = useRef(value)
  const previousPhotosRef = useRef(value)

  useEffect(() => { latestPhotosRef.current = value }, [value])
  useEffect(() => {
    const nextIds = new Set(value.map(photo => photo.id))
    previousPhotosRef.current.filter(photo => !nextIds.has(photo.id)).forEach(revokePhoto)
    previousPhotosRef.current = value
  }, [value])
  useEffect(() => () => latestPhotosRef.current.forEach(revokePhoto), [])

  const chooseFiles = async (event) => {
    const files = Array.from(event.target.files || []).slice(0, Math.max(0, MAX_PHOTOS_PER_KIND - value.length))
    event.target.value = ''
    if (!files.length) return
    setProcessing(true)
    setError('')
    const next = [...value]
    try {
      const readiness = await getPhotoStorageReadiness(files.length * 2 * 1024 * 1024)
      if (!readiness.enoughSpace) throw new Error('This device does not have enough browser storage for these photos.')
      if (readiness.supported && !readiness.persisted) await requestPersistentPhotoStorage()
      for (const file of files) {
        const processed = await processIssuePhoto(file)
        next.push({
          id: makeAttachmentId(),
          ...processed,
          state: 'ready',
          previewUrl: URL.createObjectURL(processed.blob)
        })
      }
      onChange?.(next)
    } catch (processingError) {
      setError(processingError?.message || 'Photo could not be processed.')
    } finally {
      setProcessing(false)
    }
  }

  const removePhoto = (photoId) => {
    const photo = value.find(item => item.id === photoId)
    revokePhoto(photo)
    onChange?.(value.filter(item => item.id !== photoId))
  }

  return (
    <div className="issue-photo-picker">
      {value.length > 0 && (
        <div className="issue-photo-previews">
          {value.map(photo => (
            <div className="issue-photo-preview" key={photo.id}>
              <img src={photo.previewUrl} alt="Issue preview" />
              <button type="button" onClick={() => removePhoto(photo.id)} disabled={disabled} aria-label="Remove photo"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}
      <button type="button" className="issue-photo-add" onClick={() => setPrivacyOpen(true)} disabled={disabled || processing || value.length >= MAX_PHOTOS_PER_KIND}>
        {processing ? <RotateCcw size={17} /> : <Camera size={17} />}
        {processing ? 'Processing...' : `${label} (${value.length}/${MAX_PHOTOS_PER_KIND})`}
      </button>
      {error && <div className="location-report-error">{error}</div>}
      <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={chooseFiles} />

      {privacyOpen && (
        <div className="modal-backdrop issue-photo-privacy-backdrop">
          <div className="issue-photo-privacy" role="dialog" aria-modal="true" aria-labelledby="photo-privacy-title">
            <button type="button" className="issue-photo-privacy-close" onClick={() => setPrivacyOpen(false)} aria-label="Close"><X size={18} /></button>
            <h2 id="photo-privacy-title">Protect client privacy</h2>
            <p>Do not photograph:</p>
            <ul>
              <li>Clients or staff</li>
              <li>Medication labels</li>
              <li>Documents, schedules, or computer screens</li>
              <li>Names or identifying information</li>
            </ul>
            <strong>Only photograph the problem.</strong>
            <div className="issue-photo-privacy-actions">
              <button type="button" onClick={() => setPrivacyOpen(false)}>Cancel</button>
              <button type="button" onClick={() => { setPrivacyOpen(false); inputRef.current?.click() }}>Continue to Camera</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default IssuePhotoPicker
