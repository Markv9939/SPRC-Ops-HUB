import { useMemo, useState } from 'react'
import { APP_FEEDBACK_STATUSES, getAppFeedbackStatusLabel } from '../utils/appFeedbackModel'
import { updateAppFeedbackStatus } from '../services/appFeedbackService'
import { useAdminAppFeedback } from '../hooks/useAppFeedback'

function formatDate(value) {
  const date = value?.toDate?.() || (value ? new Date(value) : null)
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : 'Unknown time'
}

export default function AppFeedbackPanel({ user, isOffline = false }) {
  const { rows, loading } = useAdminAppFeedback(true)
  const [statusFilter, setStatusFilter] = useState('active')
  const [drafts, setDrafts] = useState({})
  const [savingId, setSavingId] = useState('')

  const visible = useMemo(() => rows.filter(row => {
    if (statusFilter === 'all') return true
    if (statusFilter === 'active') return !['completed', 'duplicate', 'not_actionable'].includes(row.status)
    return row.status === statusFilter
  }), [rows, statusFilter])

  const save = async feedback => {
    if (isOffline) {
      alert('Feedback review requires an internet connection.')
      return
    }
    const draft = drafts[feedback.id] || { status: feedback.status || 'new', adminNote: feedback.adminNote || '' }
    setSavingId(feedback.id)
    try {
      await updateAppFeedbackStatus({ feedback, ...draft, actorUser: user })
    } catch (error) {
      alert(error?.message || 'Feedback status could not be saved.')
    } finally {
      setSavingId('')
    }
  }

  return (
    <section className="admin-feedback-panel">
      <div className="admin-feedback-header">
        <div>
          <h1>App Feedback</h1>
          <p>Bug reports and suggestions from BHT staff. This queue is separate from operational issues.</p>
        </div>
        <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
          <option value="active">Needs attention</option>
          <option value="all">All feedback</option>
          {APP_FEEDBACK_STATUSES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      {loading ? <div className="issue-detail-empty">Loading feedback...</div> : visible.length === 0 ? (
        <div className="issue-detail-empty">No feedback in this view.</div>
      ) : (
        <div className="admin-feedback-list">
          {visible.map(feedback => {
            const draft = drafts[feedback.id] || { status: feedback.status || 'new', adminNote: feedback.adminNote || '' }
            return (
              <article key={feedback.id}>
                <header>
                  <strong>{feedback.submittedByName || 'Staff'}</strong>
                  <span>{getAppFeedbackStatusLabel(feedback.status)} · {formatDate(feedback.createdAt)}</span>
                </header>
                <p>{feedback.originalText}</p>
                <small>{feedback.locationId || 'No location'} · {feedback.route || 'Unknown page'} · {feedback.appVersion || 'Unknown app version'}</small>
                <div className="admin-feedback-controls">
                  <select value={draft.status} onChange={event => setDrafts(previous => ({ ...previous, [feedback.id]: { ...draft, status: event.target.value } }))}>
                    {APP_FEEDBACK_STATUSES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <textarea rows={2} value={draft.adminNote} onChange={event => setDrafts(previous => ({ ...previous, [feedback.id]: { ...draft, adminNote: event.target.value } }))} placeholder="Optional update visible to the employee" />
                  <button type="button" onClick={() => save(feedback)} disabled={savingId === feedback.id}>{savingId === feedback.id ? 'Saving...' : 'Save status'}</button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

