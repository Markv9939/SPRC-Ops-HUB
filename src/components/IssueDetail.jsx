import { useEffect, useMemo, useState } from 'react'
import { doc, collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { ArrowLeft, CheckCircle2, Clock, Link2, RotateCcw, ShieldAlert, Unlink } from 'lucide-react'
import { db } from '../firebase'
import { LOCATIONS, VANS } from '../data/eocConstants'
import { addBhtIssueFollowUp, addIssueNote, requestIssueReopen, updateIssueStatus } from '../services/issueStatusService'
import { isAdminRole, isSupervisorRole } from '../utils/orgModel'
import { getIssueSourceLabel, getIssueTypeMeta, hasPendingProblemReturned, inferIssueType } from '../utils/issueModel'
import useEocIssueFeatures from '../hooks/useEocIssueFeatures'
import { getChecklistChoicesForLocation, getRelationshipCandidates } from '../services/issueRecurrenceService'
import { classifyQuickReport, keepIssueSeparate, linkIssueAsFollowUp, unlinkIssueRelationship } from '../services/issueRelationshipService'
import IssuePhotoPicker from './IssuePhotoPicker'
import IssuePhotoGallery from './IssuePhotoGallery'
import { uploadIssuePhotos } from '../services/issueAttachmentService'
import { queueIssuePhotoRetry } from '../services/offlineSyncService'

function toDate(value) {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function relativeTime(value) {
  const date = toDate(value)
  if (!date) return 'unknown time'
  const deltaMs = Date.now() - date.getTime()
  const minutes = Math.max(1, Math.round(deltaMs / 60000))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function statusLabel(status) {
  const normalized = String(status || 'open').toLowerCase()
  if (normalized === 'in_progress') return 'IN PROGRESS'
  if (normalized === 'resolved') return 'RESOLVED'
  if (normalized === 'voided') return 'VOIDED'
  return 'OPEN'
}

function locationLabel(locationId) {
  return LOCATIONS.find(location => location.id === locationId)?.label || locationId || 'Unknown location'
}

function IssueDetail({ user, issueId, inIssueScope, isOffline = false, onBack }) {
  const [issue, setIssue] = useState(null)
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [action, setAction] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [returnNote, setReturnNote] = useState('')
  const [requestingReturn, setRequestingReturn] = useState(false)
  const [followUpNote, setFollowUpNote] = useState('')
  const [savingFollowUp, setSavingFollowUp] = useState(false)
  const [relationshipCandidates, setRelationshipCandidates] = useState([])
  const [checklistChoices, setChecklistChoices] = useState([])
  const [relationshipTargetId, setRelationshipTargetId] = useState('')
  const [checklistTrackingId, setChecklistTrackingId] = useState('')
  const [relationshipReason, setRelationshipReason] = useState('')
  const [savingRelationship, setSavingRelationship] = useState(false)
  const [resolutionPhotos, setResolutionPhotos] = useState([])
  const [returnPhotos, setReturnPhotos] = useState([])
  const { enabledForLocation } = useEocIssueFeatures()

  useEffect(() => {
    if (!issueId) return undefined
    setLoading(true)
    setDenied(false)
    const unsubIssue = onSnapshot(
      doc(db, 'eocIssues', issueId),
      (snap) => {
        if (!snap.exists()) {
          setIssue(null)
          setLoading(false)
          return
        }
        const nextIssue = { id: snap.id, ...snap.data() }
        if (inIssueScope && !inIssueScope(nextIssue.locationId)) {
          setDenied(true)
          setIssue(null)
        } else {
          setIssue(nextIssue)
        }
        setLoading(false)
      },
      (error) => {
        console.error('Issue detail load failed:', error)
        setDenied(error?.code === 'permission-denied')
        setLoading(false)
      }
    )

    const unsubActivity = onSnapshot(
      query(collection(db, 'eocIssues', issueId, 'activity'), orderBy('createdAt', 'desc')),
      (snap) => setActivities(snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))),
      (error) => {
        console.warn('Issue activity load failed:', error)
        if (error?.code === 'permission-denied') setDenied(true)
      }
    )

    return () => {
      unsubIssue()
      unsubActivity()
    }
  }, [inIssueScope, issueId])

  const canManage = useMemo(() => isSupervisorRole(user?.role) || isAdminRole(user?.role), [user?.role])
  const isClosed = ['resolved', 'voided'].includes(String(issue?.status || '').toLowerCase())
  const canReportReturned = !canManage && issue?.status === 'resolved'
  const returnAlreadyRequested = hasPendingProblemReturned(activities)
  const canAddFollowUp = !canManage && !isClosed

  const retainFailedPhotos = async ({ photos, results, kind }) => {
    const failedIds = new Set((results || []).filter(item => item.state !== 'uploaded').map(item => item.attachmentId))
    const failedPhotos = photos.filter(photo => failedIds.has(photo.id))
    if (failedPhotos.length === 0) return false
    try {
      await queueIssuePhotoRetry({ issueId: issue.id, locationId: issue.locationId, photos: failedPhotos, kind, user })
      return true
    } catch (queueError) {
      console.error('Issue updated, but failed photos could not be queued:', queueError)
      alert('The issue update was saved, but this device could not retain a failed photo upload. Do not clear browser data and notify a supervisor.')
      return false
    }
  }
  const recurrenceEnabled = enabledForLocation('recurrence', issue?.locationId)
  const photosEnabled = enabledForLocation('photos', issue?.locationId)

  useEffect(() => {
    let cancelled = false
    if (!issue || !canManage || !recurrenceEnabled) {
      setRelationshipCandidates([])
      setChecklistChoices([])
      return undefined
    }
    Promise.all([
      getRelationshipCandidates({ issue }),
      issue.source === 'eoc_checklist' ? Promise.resolve([]) : getChecklistChoicesForLocation(issue.locationId)
    ]).then(([candidates, choices]) => {
      if (cancelled) return
      setRelationshipCandidates(candidates)
      setChecklistChoices(choices)
    }).catch(error => console.warn('Issue relationship options failed:', error))
    return () => { cancelled = true }
  }, [canManage, issue, recurrenceEnabled])

  const submitStatus = async (event) => {
    event?.preventDefault()
    if (!action || !issue) return
    if (isOffline) {
      alert('Issue updates are unavailable until the connection returns.')
      return
    }
    setSaving(true)
    try {
      if (action === 'note_added') {
        await addIssueNote({ issueId: issue.id, expectedIssue: issue, note, actorUser: user })
      } else {
        await updateIssueStatus({
          issueId: issue.id,
          expectedIssue: issue,
          nextStatus: action,
          note,
          actorUser: user
        })
        if (action === 'resolved' && resolutionPhotos.length > 0) {
          const results = await uploadIssuePhotos({ issueId: issue.id, locationId: issue.locationId, photos: resolutionPhotos, kind: 'resolution', uploader: user })
          if (await retainFailedPhotos({ photos: resolutionPhotos, results, kind: 'resolution' })) {
            alert('The issue was resolved. A failed resolution photo will retry automatically from this device.')
          }
          setResolutionPhotos([])
        }
      }
      setAction('')
      setNote('')
    } catch (error) {
      alert(error?.message || 'Failed to update issue.')
    } finally {
      setSaving(false)
    }
  }

  const submitProblemReturned = async (event) => {
    event?.preventDefault()
    if (!issue || !returnNote.trim()) return
    if (isOffline) {
      alert('This request needs an internet connection. Please try again when service returns.')
      return
    }
    setRequestingReturn(true)
    try {
      await requestIssueReopen({
        issueId: issue.id,
        issue,
        note: returnNote,
        actorUser: user
      })
      if (returnPhotos.length > 0) {
        const results = await uploadIssuePhotos({ issueId: issue.id, locationId: issue.locationId, photos: returnPhotos, kind: 'report', uploader: user })
        if (await retainFailedPhotos({ photos: returnPhotos, results, kind: 'report' })) {
          alert('The returned problem was reported. A failed photo will retry automatically from this device.')
        }
        setReturnPhotos([])
      }
      setReturnNote('')
    } catch (error) {
      alert(error?.message || 'Failed to report that the problem returned.')
    } finally {
      setRequestingReturn(false)
    }
  }

  const submitFollowUp = async (event) => {
    event?.preventDefault()
    if (!issue || !followUpNote.trim()) return
    if (isOffline) {
      alert('Follow-ups are unavailable until the connection returns.')
      return
    }
    setSavingFollowUp(true)
    try {
      await addBhtIssueFollowUp({
        issueId: issue.id,
        expectedIssue: issue,
        note: followUpNote,
        actorUser: user
      })
      setFollowUpNote('')
    } catch (error) {
      alert(error?.message || 'Failed to add follow-up.')
    } finally {
      setSavingFollowUp(false)
    }
  }

  const runRelationshipAction = async (actionName) => {
    if (!issue || isOffline) {
      alert('Relationship updates require an internet connection.')
      return
    }
    setSavingRelationship(true)
    try {
      if (actionName === 'separate') {
        await keepIssueSeparate({ issueId: issue.id, reason: relationshipReason, actorUser: user })
      } else if (actionName === 'link') {
        const parent = relationshipCandidates.find(item => item.id === relationshipTargetId)
        if (!parent) throw new Error('Choose the related active or recently resolved issue.')
        await linkIssueAsFollowUp({
          childIssueId: issue.id,
          parentIssueId: parent.id,
          reason: relationshipReason,
          reopenParent: parent.status === 'resolved',
          actorUser: user
        })
      } else if (actionName === 'classify') {
        const choice = checklistChoices.find(item => item.trackingId === checklistTrackingId)
        if (!choice) throw new Error('Choose a checklist item.')
        await classifyQuickReport({
          issueId: issue.id,
          trackingId: choice.trackingId,
          checklistLabel: choice.label,
          categoryLabel: choice.category,
          reason: relationshipReason,
          actorUser: user
        })
      } else if (actionName === 'unlink') {
        await unlinkIssueRelationship({ issueId: issue.id, reason: relationshipReason, actorUser: user })
      }
      setRelationshipReason('')
      setRelationshipTargetId('')
      setChecklistTrackingId('')
    } catch (error) {
      alert(error?.message || 'Failed to update issue relationship.')
    } finally {
      setSavingRelationship(false)
    }
  }

  if (loading) {
    return <div className="issue-detail-page"><div className="issue-detail-empty">Loading issue...</div></div>
  }

  if (denied || !issue) {
    return (
      <div className="issue-detail-page">
        <button className="issue-detail-back" onClick={onBack}><ArrowLeft size={16} /> Back</button>
        <div className="issue-detail-empty">
          <ShieldAlert size={30} />
          <h2>Issue not available</h2>
          <p>This issue may be outside your assigned location or no longer available.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="issue-detail-page">
      <button className="issue-detail-back" onClick={onBack}><ArrowLeft size={16} /> Issues</button>

      <div className="issue-detail-badges">
        <span className={`location-issue-pill location-issue-pill-${String(issue.status || 'open').toLowerCase()}`}>{statusLabel(issue.status)}</span>
        <span className="location-issue-pill">{issue.issueTypeLabel || getIssueTypeMeta(inferIssueType(issue)).label}</span>
        <span className="location-issue-pill">{getIssueSourceLabel(issue.source)}</span>
      </div>

      <h1>{issue.label || 'Issue'}</h1>
      <div className="issue-detail-meta">
        Reported by {issue.reportedByName || 'staff'} - {relativeTime(issue.createdAt)} - {locationLabel(issue.locationId)}
        {issue.vanId ? ` - ${VANS.find(van => van.id === issue.vanId)?.label || issue.vanId}` : ''}
      </div>

      {issue.source === 'eoc_checklist' && (
        <div className="issue-detail-context">
          Checklist item: {issue.category ? `${issue.category} - ` : ''}{issue.label || 'Issue'}
        </div>
      )}

      <div className="issue-detail-description">
        {issue.description || 'No description provided.'}
      </div>

      {recurrenceEnabled && (issue.reportedBefore || issue.recurringIssue) && (
        <div className="issue-pattern-badges">
          {issue.reportedBefore && <span>Reported before</span>}
          {issue.recurringIssue && <strong>Recurring issue</strong>}
          {issue.recurrenceCountAtReport > 0 && <small>{issue.recurrenceCountAtReport} observations in 90 days when reported</small>}
        </div>
      )}

      {canManage && (
        <form className="issue-detail-actions" onSubmit={submitStatus}>
          <select value={action} onChange={(event) => setAction(event.target.value)}>
            <option value="">Choose action</option>
            <option value="note_added">Add note</option>
            {!isClosed && issue.status === 'open' && <option value="in_progress">Mark in progress</option>}
            {!isClosed && <option value="resolved">Resolve</option>}
            {!isClosed && <option value="voided">Void</option>}
            {isClosed && <option value="open">Reopen</option>}
          </select>
          <textarea
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={action === 'open' ? 'Explain why the issue is being reopened.' : 'Add the relevant update or action taken.'}
          />
          {photosEnabled && action === 'resolved' && <IssuePhotoPicker value={resolutionPhotos} onChange={setResolutionPhotos} disabled={saving} label="Add resolution photos" />}
          <button type="submit" disabled={!action || !note.trim() || saving}>{saving ? 'Saving...' : 'Save update'}</button>
        </form>
      )}

      {canManage && recurrenceEnabled && (
        <div className="issue-relationship-tools">
          <div className="issue-relationship-heading"><Link2 size={17} /> Related reports</div>
          <p>Review possible repeats. Reports stay separate unless you choose an action.</p>
          {relationshipCandidates.length > 0 && !isClosed && (
            <select value={relationshipTargetId} onChange={event => setRelationshipTargetId(event.target.value)}>
              <option value="">Choose a related report</option>
              {relationshipCandidates.map(candidate => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.status === 'resolved' ? 'Resolved - ' : ''}{candidate.label || candidate.description || 'Issue'}
                </option>
              ))}
            </select>
          )}
          {issue.source !== 'eoc_checklist' && checklistChoices.length > 0 && (
            <select value={checklistTrackingId} onChange={event => setChecklistTrackingId(event.target.value)}>
              <option value="">Choose assigned checklist item</option>
              {checklistChoices.map(choice => <option key={choice.trackingId} value={choice.trackingId}>{choice.category} - {choice.label}</option>)}
            </select>
          )}
          <textarea rows={2} value={relationshipReason} onChange={event => setRelationshipReason(event.target.value)} placeholder="Reason or review note" />
          <div className="issue-relationship-actions">
            {!isClosed && <button type="button" onClick={() => runRelationshipAction('separate')} disabled={savingRelationship}>Keep separate</button>}
            {!isClosed && relationshipCandidates.length > 0 && <button type="button" onClick={() => runRelationshipAction('link')} disabled={savingRelationship || !relationshipTargetId || !relationshipReason.trim()}>Link as follow-up</button>}
            {issue.source !== 'eoc_checklist' && checklistChoices.length > 0 && <button type="button" onClick={() => runRelationshipAction('classify')} disabled={savingRelationship || !checklistTrackingId}>Link checklist item</button>}
            {isAdminRole(user?.role) && (issue.parentIssueId || issue.linkedTrackingId) && <button type="button" onClick={() => runRelationshipAction('unlink')} disabled={savingRelationship || !relationshipReason.trim()}><Unlink size={15} /> Unlink</button>}
          </div>
        </div>
      )}

      {canAddFollowUp && (
        <form className="issue-detail-actions issue-follow-up-form" onSubmit={submitFollowUp}>
          <div className="issue-follow-up-heading">Add follow-up</div>
          <textarea
            rows={3}
            value={followUpNote}
            onChange={(event) => setFollowUpNote(event.target.value)}
            placeholder="Include new information about this issue."
          />
          {photosEnabled && <IssuePhotoPicker value={returnPhotos} onChange={setReturnPhotos} disabled={requestingReturn} />}
          <button type="submit" disabled={!followUpNote.trim() || savingFollowUp}>
            {savingFollowUp ? 'Adding...' : 'Add follow-up'}
          </button>
        </form>
      )}

      {canReportReturned && returnAlreadyRequested && (
        <div className="issue-returned-status">
          <RotateCcw size={17} /> A supervisor has been notified that this problem returned.
        </div>
      )}

      {canReportReturned && !returnAlreadyRequested && (
        <form className="issue-detail-actions issue-returned-form" onSubmit={submitProblemReturned}>
          <div className="issue-returned-heading"><RotateCcw size={17} /> Did this problem return?</div>
          <textarea
            rows={3}
            value={returnNote}
            onChange={(event) => setReturnNote(event.target.value)}
            placeholder="Describe what is happening now and include all relevant details."
          />
          <button type="submit" disabled={!returnNote.trim() || requestingReturn}>
            {requestingReturn ? 'Sending...' : 'Report problem returned'}
          </button>
        </form>
      )}

      <h2 className="issue-detail-section-title">Activity</h2>
      {photosEnabled && <IssuePhotoGallery issue={issue} user={user} />}
      <div className="issue-timeline">
        {activities.length === 0 ? (
          <div className="issue-detail-empty">No activity yet.</div>
        ) : activities.map((activity, index) => (
          <div className="issue-timeline-item" key={activity.id}>
            <div className="issue-timeline-dot">
              {index === 0 ? <CheckCircle2 size={15} /> : <Clock size={14} />}
            </div>
            <div>
              <div className="issue-timeline-when">{relativeTime(activity.createdAt)} - {activity.actorName || 'Ops Hub'}</div>
              <div className="issue-timeline-title">{activity.label || statusLabel(activity.status)}</div>
              {activity.note && <div className="issue-timeline-note">{activity.note}</div>}
            </div>
          </div>
        ))}
      </div>

      {!canManage && (
        <div className="location-issues-note">
          Everyone assigned to {locationLabel(issue.locationId)} can see this issue and its updates. Supervisors control issue status.
        </div>
      )}
    </div>
  )
}

export default IssueDetail
