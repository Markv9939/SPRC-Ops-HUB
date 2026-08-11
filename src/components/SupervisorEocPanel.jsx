import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Search } from 'lucide-react'
import { LOCATIONS, VANS } from '../data/eocConstants'
import useScopedIssues from '../hooks/useScopedIssues'
import useUserScope from '../hooks/useUserScope'
import { getIssueSourceLabel, getIssueTypeMeta, inferIssueType, ISSUE_TYPES } from '../utils/issueModel'
import EocTemplateManager from './EocTemplateManager'

function statusLabel(status) {
  const normalized = String(status || 'open').toLowerCase()
  if (normalized === 'in_progress') return 'IN PROGRESS'
  if (normalized === 'resolved') return 'RESOLVED'
  if (normalized === 'voided') return 'VOIDED'
  return 'OPEN'
}

function SupervisorEocPanel({
  user,
  isOffline = false,
  targetIssueId = null,
  onTargetIssueHandled,
  onOpenIssue
}) {
  const [subTab, setSubTab] = useState('template')
  const [filterLocation, setFilterLocation] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [filterStatus, setFilterStatus] = useState('active')
  const [searchText, setSearchText] = useState('')
  const [highlightedIssueId, setHighlightedIssueId] = useState(null)
  const { exactIssueLocationIds, inEocScope, inIssueScope } = useUserScope(user)
  const { issues: activeIssues, resolvedIssues } = useScopedIssues({
    user,
    inEocScope,
    inIssueScope,
    issueLocationIds: exactIssueLocationIds,
    includeResolved: true,
    enabled: !!user
  })
  const issues = useMemo(() => [...activeIssues, ...resolvedIssues], [activeIssues, resolvedIssues])

  useEffect(() => {
    if (!targetIssueId) return
    const timerId = setTimeout(() => {
      setSubTab('issues')
      setFilterLocation('all')
      setFilterType('all')
      setFilterStatus('all')
      setHighlightedIssueId(targetIssueId)
    }, 0)
    return () => clearTimeout(timerId)
  }, [targetIssueId])

  useEffect(() => {
    if (!highlightedIssueId) return
    const timerId = setTimeout(() => {
      const issueEl = document.getElementById(`eoc-issue-${highlightedIssueId}`)
      if (issueEl) {
        issueEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
        onTargetIssueHandled?.()
      }
    }, 100)
    return () => clearTimeout(timerId)
  }, [highlightedIssueId, issues, onTargetIssueHandled])

  const filteredIssues = useMemo(() => {
    const search = searchText.trim().toLowerCase()
    return issues.filter((issue) => {
      const status = String(issue.status || 'open').toLowerCase()
      const inferredType = inferIssueType(issue)
      if (filterLocation !== 'all' && issue.locationId !== filterLocation) return false
      if (filterType !== 'all' && inferredType !== filterType) return false
      if (filterStatus === 'active' && !['open', 'in_progress'].includes(status)) return false
      if (filterStatus === 'resolved' && !['resolved', 'voided'].includes(status)) return false
      if (!search) return true
      return [issue.label, issue.description, issue.reportedByName, issue.category, issue.vanId]
        .some(value => String(value || '').toLowerCase().includes(search))
    })
  }, [filterLocation, filterStatus, filterType, issues, searchText])

  const locationLabel = (locationId) => LOCATIONS.find(location => location.id === locationId)?.label || locationId
  const vanLabel = (vanId) => VANS.find(van => van.id === vanId)?.label || vanId || 'None'

  const tabBtnStyle = (active) => ({
    padding: '8px 16px',
    backgroundColor: active ? '#CD4E42' : 'rgba(17,47,82,0.10)',
    color: active ? 'white' : 'var(--text-secondary)',
    border: 'none',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer'
  })

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button style={tabBtnStyle(subTab === 'template')} onClick={() => setSubTab('template')}>
          Template
        </button>
        <button style={tabBtnStyle(subTab === 'issues')} onClick={() => setSubTab('issues')}>
          Issues ({activeIssues.length})
        </button>
      </div>

      {subTab === 'issues' && (
        <div className="supervisor-issues-panel">
          <div className="supervisor-issue-filters">
            <label className="location-issues-search">
              <Search size={16} />
              <span className="sr-only">Search issues</span>
              <input value={searchText} onChange={event => setSearchText(event.target.value)} placeholder="Search issues" />
            </label>
            <select value={filterLocation} onChange={event => setFilterLocation(event.target.value)} aria-label="Filter by location">
              <option value="all">All locations</option>
              {LOCATIONS.map(location => <option key={location.id} value={location.id}>{location.label}</option>)}
            </select>
            <select value={filterType} onChange={event => setFilterType(event.target.value)} aria-label="Filter by issue type">
              <option value="all">All types</option>
              {ISSUE_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
            <select value={filterStatus} onChange={event => setFilterStatus(event.target.value)} aria-label="Filter by status">
              <option value="active">Active</option>
              <option value="resolved">Resolved</option>
              <option value="all">All statuses</option>
            </select>
          </div>

          {filteredIssues.length === 0 ? (
            <div className="supervisor-issues-empty">No issues found.</div>
          ) : (
            <div className="supervisor-issues-list">
              {filteredIssues.map(issue => (
                <button
                  type="button"
                  key={issue.id}
                  id={`eoc-issue-${issue.id}`}
                  className={`supervisor-issue-row${highlightedIssueId === issue.id ? ' is-highlighted' : ''}`}
                  onClick={() => onOpenIssue?.(issue.id)}
                >
                  <div className="supervisor-issue-row-main">
                    <div className="supervisor-issue-row-title">
                      <strong>{issue.label || 'Issue'}</strong>
                      <span className={`location-issue-pill location-issue-pill-${String(issue.status || 'open').toLowerCase()}`}>
                        {statusLabel(issue.status)}
                      </span>
                    </div>
                    <div className="supervisor-issue-row-description">{issue.description || 'No details provided.'}</div>
                    <div className="supervisor-issue-row-meta">
                      {locationLabel(issue.locationId)} - {issue.issueTypeLabel || getIssueTypeMeta(inferIssueType(issue)).label} - {getIssueSourceLabel(issue.source)}
                      {issue.vanId ? ` - ${vanLabel(issue.vanId)}` : ''}
                      {issue.reportedByName ? ` - ${issue.reportedByName}` : ''}
                    </div>
                  </div>
                  <ChevronRight size={18} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {subTab === 'template' && (
        <EocTemplateManager user={user} isOffline={isOffline} />
      )}
    </div>
  )
}

export default SupervisorEocPanel
