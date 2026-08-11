import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronRight, MapPin, Plus, Search } from 'lucide-react'
import { LOCATIONS, VANS } from '../data/eocConstants'
import { BHT_HOME_ISSUE_TYPES } from '../services/bhtIssueReportService'
import useScopedIssues from '../hooks/useScopedIssues'
import { getIssueSourceLabel, getIssueTypeMeta, inferIssueType } from '../utils/issueModel'
import IssuePhotoPicker from './IssuePhotoPicker'
import useEocIssueFeatures from '../hooks/useEocIssueFeatures'

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
  const normalized = String(status || 'open').toLowerCase()
  if (normalized === 'in_progress') return 'IN PROGRESS'
  if (normalized === 'resolved') return 'RESOLVED'
  if (normalized === 'voided') return 'VOIDED'
  return 'OPEN'
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
  isOffline = false,
  onOpenIssue,
  onReportIssue,
  assignment
}) {
  const [tab, setTab] = useState('active')
  const [searchText, setSearchText] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [reportOpen, setReportOpen] = useState(false)
  const [form, setForm] = useState({
    issueType: BHT_HOME_ISSUE_TYPES[0].value,
    description: '',
    vanId: ''
  })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [photos, setPhotos] = useState([])
  const { enabledForLocation } = useEocIssueFeatures()

  const { issues, resolvedIssues, loadMoreResolved } = useScopedIssues({
    user,
    inEocScope: inIssueScope,
    inIssueScope,
    issueLocationIds: locationIds,
    includeResolved: true,
    enabled: !!user
  })

  const primaryLocation = locationIds[0] || user?.locationId || ''
  const photosEnabled = enabledForLocation('photos', primaryLocation)
  const locationText = locationIds.length === 1
    ? locationLabel(primaryLocation)
    : locationIds.map(locationLabel).join(', ')

  const activeCounts = useMemo(() => {
    return issues.reduce((acc, issue) => {
      const status = String(issue.status || 'open').toLowerCase()
      if (status === 'in_progress') acc.inProgress += 1
      else acc.open += 1
      return acc
    }, { open: 0, inProgress: 0 })
  }, [issues])

  const issueIsVan = form.issueType === 'van_vehicle'
  const assignedVanIds = [
    ...(Array.isArray(assignment?.vanIds) ? assignment.vanIds : []),
    ...(Array.isArray(user?.vanIds) ? user.vanIds : []),
    assignment?.vanId,
    user?.vanId
  ].map(v => String(v || '').trim()).filter(Boolean)
  const uniqueVanIds = [...new Set(assignedVanIds)]

  const submitReport = async (event) => {
    event?.preventDefault()
    const description = String(form.description || '').trim()
    const vanId = issueIsVan ? String(form.vanId || uniqueVanIds[0] || '').trim() : ''
    if (!description) {
      setError('Describe the issue before submitting.')
      return
    }
    if (issueIsVan && !vanId) {
      setError('Choose the van for this issue.')
      return
    }

    setSubmitting(true)
    setError('')
    try {
      await onReportIssue?.({
        issueType: form.issueType,
        description,
        vanId,
        assignment,
        photos
      })
      setReportOpen(false)
      setForm({ issueType: BHT_HOME_ISSUE_TYPES[0].value, description: '', vanId: '' })
      setPhotos([])
    } catch (err) {
      setError(err?.message || 'Issue report failed.')
    } finally {
      setSubmitting(false)
    }
  }

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
        <button className="location-issues-report-btn" onClick={() => setReportOpen(true)}>
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
          {activeCounts.open} open - {activeCounts.inProgress} in progress
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

      {reportOpen && (
        <div className="modal-backdrop">
          <div className="modal-content location-report-modal">
            <h2>Report Issue</h2>
            <form onSubmit={submitReport}>
              <label>Issue type</label>
              <select value={form.issueType} onChange={(event) => setForm(prev => ({ ...prev, issueType: event.target.value, vanId: '' }))}>
                {BHT_HOME_ISSUE_TYPES.map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
              {issueIsVan && uniqueVanIds.length > 1 && (
                <>
                  <label>Van</label>
                  <select value={form.vanId} onChange={(event) => setForm(prev => ({ ...prev, vanId: event.target.value }))}>
                    <option value="">Choose van</option>
                    {uniqueVanIds.map(vanId => (
                      <option key={vanId} value={vanId}>{VANS.find(van => van.id === vanId)?.label || vanId}</option>
                    ))}
                  </select>
                </>
              )}
              {form.issueType === 'safety_concern' && (
                <div className="location-report-safety-warning" role="alert">
                  If anyone is in immediate danger, follow emergency procedures and contact a supervisor before submitting this report.
                </div>
              )}
              <label>Describe the issue</label>
              <textarea
                rows={4}
                value={form.description}
                onChange={(event) => setForm(prev => ({ ...prev, description: event.target.value }))}
                placeholder="Include any details staff or supervisors should know."
              />
              <div className="location-report-helper">Provide all relevant details so the issue can be understood and addressed.</div>
              {photosEnabled && <IssuePhotoPicker value={photos} onChange={setPhotos} disabled={submitting} />}
              {isOffline && <div className="location-report-warning">Offline: this report will send when internet returns.</div>}
              {error && <div className="location-report-error">{error}</div>}
              <div className="location-report-actions">
                <button type="button" onClick={() => setReportOpen(false)} disabled={submitting}>Cancel</button>
                <button type="submit" disabled={submitting}>{submitting ? 'Submitting...' : 'Submit Issue'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default LocationIssuesBoard
