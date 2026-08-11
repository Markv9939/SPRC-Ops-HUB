import { useEffect, useMemo, useState } from 'react'
import { doc, collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { ArrowLeft, CheckCircle2, Clock, RotateCcw, ShieldAlert } from 'lucide-react'
import { db } from '../firebase'
import { LOCATIONS, VANS } from '../data/eocConstants'
import { addBhtIssueFollowUp, addIssueNote, requestIssueReopen, updateIssueStatus } from '../services/issueStatusService'
import { isAdminRole, isSupervisorRole } from '../utils/orgModel'
import { getIssueSourceLabel, getIssueTypeMeta, hasPendingProblemReturned, inferIssueType } from '../utils/issueModel'

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
          <button type="submit" disabled={!action || !note.trim() || saving}>{saving ? 'Saving...' : 'Save update'}</button>
        </form>
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
