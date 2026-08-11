import { useEffect, useMemo, useRef, useState } from 'react'
import { EyeOff, ShieldX, X } from 'lucide-react'
import { getIssueAttachmentBlob, observeIssueAttachments, setAttachmentHidden } from '../services/issueAttachmentService'
import { isAdminRole, isSupervisorRole } from '../utils/orgModel'
import { emergencyPrivacyRemove } from '../services/privacyRemovalService'

function IssuePhotoGallery({ issue, user }) {
  const [attachments, setAttachments] = useState([])
  const [urls, setUrls] = useState({})
  const urlsRef = useRef({})
  const [focusedId, setFocusedId] = useState('')
  const [removeTargetId, setRemoveTargetId] = useState('')
  const [removePin, setRemovePin] = useState('')
  const [removeReason, setRemoveReason] = useState('')
  const [removing, setRemoving] = useState(false)
  const canManage = isSupervisorRole(user?.role) || isAdminRole(user?.role)

  useEffect(() => {
    if (!issue?.id) return undefined
    return observeIssueAttachments(issue.id, setAttachments, error => console.warn('Issue photos failed:', error))
  }, [issue?.id])

  const visible = useMemo(() => attachments.filter(item => item.state === 'uploaded' && (canManage || !item.hiddenFromBht)), [attachments, canManage])

  useEffect(() => {
    let cancelled = false
    const created = []
    Promise.all(visible.filter(item => !urls[item.id]).map(async item => {
      const blob = await getIssueAttachmentBlob(item.storagePath)
      const url = URL.createObjectURL(blob)
      created.push(url)
      return [item.id, url]
    })).then(entries => {
      if (cancelled) created.forEach(url => URL.revokeObjectURL(url))
      else if (entries.length) setUrls(current => ({ ...current, ...Object.fromEntries(entries) }))
    }).catch(error => console.warn('Photo byte read failed:', error))
    return () => { cancelled = true }
  }, [visible, urls])

  useEffect(() => { urlsRef.current = urls }, [urls])
  useEffect(() => () => Object.values(urlsRef.current).forEach(url => URL.revokeObjectURL(url)), [])

  if (!visible.length) return null
  const focused = visible.find(item => item.id === focusedId)
  const removeForPrivacy = async () => {
    if (!removeTargetId || !/^\d{6}$/.test(removePin) || !removeReason.trim()) return
    setRemoving(true)
    try {
      await emergencyPrivacyRemove({ issueId: issue.id, attachmentId: removeTargetId, adminProfileId: user.id, pin: removePin, reason: removeReason })
      setRemoveTargetId('')
      setRemovePin('')
      setRemoveReason('')
    } catch (error) {
      alert(error?.message || 'Emergency privacy removal failed.')
    } finally {
      setRemoving(false)
    }
  }
  return (
    <div className="issue-photo-gallery">
      <h2 className="issue-detail-section-title">Photos</h2>
      <div className="issue-photo-gallery-grid">
        {visible.map(item => (
          <div key={item.id} className="issue-photo-gallery-item">
            <button type="button" onClick={() => setFocusedId(item.id)}>{urls[item.id] ? <img src={urls[item.id]} alt={`${item.kind} issue evidence`} /> : <span>Loading...</span>}</button>
            <small>{item.kind === 'resolution' ? 'Resolution' : 'Report'}{item.hiddenFromBht ? ' - Hidden from BHTs' : ''}</small>
            {canManage && <button type="button" className="issue-photo-hide" onClick={() => setAttachmentHidden({ issueId: issue.id, attachmentId: item.id, hidden: !item.hiddenFromBht, actorUser: user })}><EyeOff size={14} /> {item.hiddenFromBht ? 'Show to BHTs' : 'Hide'}</button>}
            {isAdminRole(user?.role) && <button type="button" className="issue-photo-hide issue-photo-remove" onClick={() => setRemoveTargetId(item.id)}><ShieldX size={14} /> Privacy removal</button>}
          </div>
        ))}
      </div>
      {focused && urls[focused.id] && (
        <div className="issue-photo-fullscreen" onClick={() => setFocusedId('')}>
          <button type="button" aria-label="Close photo"><X size={20} /></button>
          <img src={urls[focused.id]} alt="Issue evidence full screen" />
        </div>
      )}
      {removeTargetId && (
        <div className="modal-backdrop issue-photo-privacy-backdrop">
          <div className="issue-photo-privacy" role="dialog" aria-modal="true">
            <h2>Emergency Privacy Removal</h2>
            <p>This physically removes the photo and cannot be undone. The audit record remains.</p>
            <label>Admin PIN<input type="password" inputMode="numeric" maxLength={6} value={removePin} onChange={event => setRemovePin(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
            <label>Required reason<textarea rows={3} value={removeReason} onChange={event => setRemoveReason(event.target.value)} /></label>
            <div className="issue-photo-privacy-actions">
              <button type="button" onClick={() => { setRemoveTargetId(''); setRemovePin(''); setRemoveReason('') }} disabled={removing}>Cancel</button>
              <button type="button" onClick={removeForPrivacy} disabled={removing || !/^\d{6}$/.test(removePin) || !removeReason.trim()}>{removing ? 'Removing...' : 'Remove photo'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default IssuePhotoGallery
