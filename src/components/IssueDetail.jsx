import { useEffect, useMemo, useState } from 'react'
import { doc, collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { ArrowLeft, CheckCircle2, Clock, ShieldAlert } from 'lucide-react'
import { db } from '../firebase'
import { LOCATIONS } from '../data/eocConstants'
import { updateIssueStatus } from '../services/issueStatusService'
import { isAdminRole, isSupervisorRole } from '../utils/orgModel'

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

function IssueDetail({ user, issueId, inIssueScope, onBack }) {
  const [issue, setIssue] = useState(null)
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [action, setAction] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

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

  const submitStatus = async (event) => {
    event?.preventDefault()
    if (!action || !issue) return
    setSaving(true)
    try {
      await updateIssueStatus({
        issueId: issue.id,
        expectedIssue: issue,
        nextStatus: action,
        note,
        actorUser: user
      })
      setAction('')
      setNote('')
    } catch (error) {
      alert(error?.message || 'Failed to update issue.')
    } finally {
      setSaving(false)
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
      <button className="issue-detail-back" onClick={onBack}><ArrowLeft size={16} /> Location Issues</button>

      <div className="issue-detail-badges">
        <span className={`location-issue-pill location-issue-pill-${String(issue.status || 'open').toLowerCase()}`}>{statusLabel(issue.status)}</span>
        <span className="location-issue-pill location-issue-pill-severity">{String(issue.severity || 'medium').toUpperCase()}</span>
      </div>

      <h1>{issue.label || 'Issue'}</h1>
      <div className="issue-detail-meta">
        Reported by {issue.reportedByName || 'staff'} - {relativeTime(issue.createdAt)} - {locationLabel(issue.locationId)}
      </div>

      <div className="issue-detail-description">
        {issue.description || 'No description provided.'}
      </div>

      {canManage && !isClosed && (
        <form className="issue-detail-actions" onSubmit={submitStatus}>
          <select value={action} onChange={(event) => setAction(event.target.value)}>
            <option value="">Choose action</option>
            {issue.status === 'open' && <option value="in_progress">Mark in progress</option>}
            <option value="resolved">Resolve</option>
            <option value="voided">Void</option>
          </select>
          <textarea
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Required note..."
          />
          <button type="submit" disabled={!action || saving}>{saving ? 'Saving...' : 'Save update'}</button>
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
          Read-only. Everyone at {locationLabel(issue.locationId)} sees this record. Supervisor controls are not shown for BHTs.
        </div>
      )}
    </div>
  )
}

export default IssueDetail
