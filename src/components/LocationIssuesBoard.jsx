import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronRight, MapPin, Plus, Search } from 'lucide-react'
import { LOCATIONS, VANS } from '../data/eocConstants'
import { BHT_HOME_ISSUE_TYPES } from '../services/bhtIssueReportService'
import useScopedIssues from '../hooks/useScopedIssues'
import { getIssueSourceLabel, getIssueStatusLabel, getIssueTypeMeta, inferIssueType } from '../utils/issueModel'
import { useMyAppFeedback } from '../hooks/useAppFeedback'
import { getAppFeedbackStatusLabel } from '../utils/appFeedbackModel'

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

function locationLabel(locationId) {
  return LOCATIONS.find(location => location.id === locationId)?.label || locationId || 'Unknown location'
}

function statusLabel(status) {
  return getIssueStatusLabel(status).toUpperCase()
}

function IssueCard({ issue, onOpenIssue }) {
  const latest = issue.latestActivity || null
  const vanLabel = issue.vanId ? (VANS.find(van => van.id === issue.vanId)?.label || issue.vanId) : ''

  return (
    <button className="location-issue-card" onClick={() => onOpenIssue?.(issue.id)}>
      <div className="location-issue-card-top">
        <div className="location-issue-title">{issue.label || 'Issue'}</div>
        <span className={`location-issue-pill location-issue-pill-${String(issue.status || 'open').toLowerCase()}`}>
          {statusLabel(issue.status)}
        </span>
      </div>
      <div className="location-issue-meta">
        <span>{issue.issueTypeLabel || getIssueTypeMeta(inferIssueType(issue)).label}</span>
        <span>- {getIssueSourceLabel(issue.source)}</span>
        <span>Reported by {issue.reportedByName || 'staff'} - {relativeTime(issue.createdAt)}</span>
        {vanLabel && <span>- {vanLabel}</span>}
      </div>
      <div className="location-issue-description">{issue.description || 'No description provided.'}</div>
      {latest?.note && (
        <div className="location-issue-update">
          <strong>{latest.actorName || 'Update'}, {relativeTime(latest.createdAt)}:</strong> {latest.note}
        </div>
      )}
      <div className="location-issue-action">
        View full activity <ChevronRight size={16} />
      </div>
    </button>
  )
}

function LocationIssuesBoard({
  user,
  locationIds = [],
  inIssueScope,
  onOpenIssue,
  onOpenReportIssue
}) {
  const [tab, setTab] = useState('active')
  const [searchText, setSearchText] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [showMyFeedback, setShowMyFeedback] = useState(false)
  const { rows: myFeedback, loading: feedbackLoading } = useMyAppFeedback(user?.id, showMyFeedback)

  const { issues, resolvedIssues, loadMoreResolved } = useScopedIssues({
    user,
    inEocScope: inIssueScope,
    inIssueScope,
    issueLocationIds: locationIds,
    includeResolved: true,
    enabled: !!user
  })

  const primaryLocation = locationIds[0] || user?.locationId || ''
  const locationText = locationIds.length === 1
    ? locationLabel(primaryLocation)
    : locationIds.map(locationLabel).join(', ')

  const activeCounts = useMemo(() => {
    return issues.reduce((acc, issue) => {
      const status = String(issue.status || 'open').toLowerCase()
      if (status === 'in_progress') acc.inProgress += 1
      else if (status === 'pending_supervisor_review') acc.pendingReview += 1
      else acc.open += 1
      return acc
    }, { open: 0, inProgress: 0, pendingReview: 0 })
  }, [issues])

  const visibleIssues = useMemo(() => {
    const source = tab === 'active' ? issues : resolvedIssues
    const search = searchText.trim().toLowerCase()
    return source.filter((issue) => {
      if (typeFilter !== 'all' && inferIssueType(issue) !== typeFilter) return false
      if (!search) return true
      return [
        issue.label,
        issue.description,
        issue.reportedByName,
        issue.category,
        issue.issueTypeLabel,
        issue.vanId
      ].some(value => String(value || '').toLowerCase().includes(search))
    })
  }, [issues, resolvedIssues, searchText, tab, typeFilter])

  if (!locationIds.length) {
    return (
      <div className="location-issues-page">
        <div className="location-issues-empty">
          <AlertTriangle size={30} />
          <h2>No issue location assigned</h2>
          <p>Contact a supervisor before reporting or viewing location issues.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="location-issues-page">
      <div className="location-issues-header">
        <div>
          <h1>Issues</h1>
          <div className="location-issues-subtitle">
            <MapPin size={15} /> {locationText} - Shared across all shifts
          </div>
        </div>
        <button className="location-issues-report-btn" onClick={onOpenReportIssue}>
          <Plus size={16} /> Report
        </button>
      </div>

      <div className="location-issues-tabs">
        <button className={tab === 'active' ? 'is-active' : ''} onClick={() => setTab('active')}>
          Active {issues.length}
        </button>
        <button className={tab === 'resolved' ? 'is-active' : ''} onClick={() => setTab('resolved')}>
          Resolved
        </button>
      </div>

      <div className="location-issues-filters">
        <label className="location-issues-search">
          <Search size={16} />
          <span className="sr-only">Search issues</span>
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search issues"
          />
        </label>
        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Filter by issue type">
          <option value="all">All types</option>
          {BHT_HOME_ISSUE_TYPES.map(type => (
            <option key={type.value} value={type.value}>{type.label}</option>
          ))}
        </select>
      </div>

      {tab === 'active' && (
        <div className="location-issues-counts">
          {activeCounts.open} open - {activeCounts.inProgress} in progress - {activeCounts.pendingReview} awaiting supervisor review
        </div>
      )}

      {visibleIssues.length === 0 ? (
        <div className="location-issues-empty">
          <AlertTriangle size={28} />
          <h2>No {tab === 'active' ? 'active' : 'resolved'} issues</h2>
          <p>{tab === 'active' ? 'Report property, van, safety, or other issues when they come up.' : 'Resolved and voided issues will show here.'}</p>
        </div>
      ) : (
        <div className="location-issues-list">
          {visibleIssues.map(issue => (
            <IssueCard key={issue.id} issue={issue} onOpenIssue={onOpenIssue} />
          ))}
          {tab === 'resolved' && resolvedIssues.length >= 50 && (
            <button type="button" className="location-issues-load-more" onClick={loadMoreResolved}>Load more history</button>
          )}
        </div>
      )}

      <div className="location-issues-note">
        Everyone assigned to {locationText || 'this location'} can see these issues and supervisor updates, regardless of shift.
      </div>

      <section className="my-app-feedback">
        <button type="button" className="my-app-feedback-toggle" onClick={() => setShowMyFeedback(value => !value)}>
          My app feedback <ChevronRight size={16} className={showMyFeedback ? 'is-open' : ''} />
        </button>
        {showMyFeedback && (
          <div className="my-app-feedback-list">
            {feedbackLoading ? <div>Loading feedback...</div> : myFeedback.length === 0 ? (
              <div>No app feedback submitted yet.</div>
            ) : myFeedback.map(feedback => (
              <article key={feedback.id}>
                <span>{getAppFeedbackStatusLabel(feedback.status)}</span>
                <p>{feedback.originalText}</p>
                {feedback.adminNote && <small>Admin update: {feedback.adminNote}</small>}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export default LocationIssuesBoard
