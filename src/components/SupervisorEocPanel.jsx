import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronRight, Download, Search } from 'lucide-react'
import { LOCATIONS, VANS } from '../data/eocConstants'
import useScopedIssues from '../hooks/useScopedIssues'
import useUserScope from '../hooks/useUserScope'
import { getIssueSourceLabel, getIssueTypeMeta, inferIssueType, ISSUE_TYPES } from '../utils/issueModel'
import EocTemplateManager from './EocTemplateManager'
import useOfflinePhotoQueue from '../hooks/useOfflinePhotoQueue'
import useSupervisorEocOverview from '../hooks/useSupervisorEocOverview'
import { buildEocExportRows, buildIssueExportRows } from '../utils/supervisorEocModel'
import { addMissedEocNote } from '../services/missedEocNoteService'
import usePhotoRetentionMetrics from '../hooks/usePhotoRetentionMetrics'
import { isAdminRole } from '../utils/orgModel'

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
  const [filterSource, setFilterSource] = useState('all')
  const [filterRecurrence, setFilterRecurrence] = useState('all')
  const [filterReporter, setFilterReporter] = useState('all')
  const [filterStartDate, setFilterStartDate] = useState('')
  const [filterEndDate, setFilterEndDate] = useState('')
  const [missedNotes, setMissedNotes] = useState({})
  const [highlightedIssueId, setHighlightedIssueId] = useState(null)
  const { exactIssueLocationIds, inEocScope, inIssueScope } = useUserScope(user)
  const pendingPhotos = useOfflinePhotoQueue(user)
  const { statusRows, historyRows, missingAssignments, loadMoreHistory } = useSupervisorEocOverview(inEocScope)
  const retentionMetrics = usePhotoRetentionMetrics(isAdminRole(user?.role))
  const { issues: activeIssues, resolvedIssues, loadMoreResolved } = useScopedIssues({
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
      if (filterSource !== 'all' && issue.source !== filterSource) return false
      if (filterRecurrence === 'recurring' && issue.recurringIssue !== true) return false
      if (filterRecurrence === 'reported_before' && issue.reportedBefore !== true) return false
      if (filterReporter !== 'all' && issue.reportedByUserId !== filterReporter) return false
      const createdDate = issue.createdAt?.toDate?.() || (issue.createdAt ? new Date(issue.createdAt) : null)
      if (filterStartDate && createdDate && createdDate < new Date(`${filterStartDate}T00:00:00`)) return false
      if (filterEndDate && createdDate && createdDate > new Date(`${filterEndDate}T23:59:59`)) return false
      if (!search) return true
      return [issue.label, issue.description, issue.reportedByName, issue.category, issue.vanId]
        .some(value => String(value || '').toLowerCase().includes(search))
    })
  }, [filterEndDate, filterLocation, filterRecurrence, filterReporter, filterSource, filterStartDate, filterStatus, filterType, issues, searchText])

  const reporters = useMemo(() => {
    const values = new Map()
    issues.forEach(issue => { if (issue.reportedByUserId) values.set(issue.reportedByUserId, issue.reportedByName || issue.reportedByUserId) })
    return Array.from(values, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [issues])

  const downloadRows = async (rows, sheetName, fileName) => {
    const XLSX = await import('xlsx')
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), sheetName)
    XLSX.writeFile(workbook, fileName)
  }

  const saveMissedNote = async (row) => {
    const text = String(missedNotes[row.id] || '').trim()
    if (!text) return
    await addMissedEocNote({ task: row, text, actorUser: user })
    setMissedNotes(current => ({ ...current, [row.id]: '' }))
  }

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
      <div className="eoc-supervisor-tabs">
        <button style={tabBtnStyle(subTab === 'template')} onClick={() => setSubTab('template')}>
          Template
        </button>
        <button style={tabBtnStyle(subTab === 'issues')} onClick={() => setSubTab('issues')}>
          Issues ({activeIssues.length})
        </button>
        <button style={tabBtnStyle(subTab === 'status')} onClick={() => setSubTab('status')}>Status</button>
        <button style={tabBtnStyle(subTab === 'history')} onClick={() => setSubTab('history')}>History</button>
      </div>

      {subTab === 'issues' && (
        <div className="supervisor-issues-panel">
          {pendingPhotos.total > 0 && (
            <div className="pending-photo-banner">
              <div><strong>{pendingPhotos.total} pending photo{pendingPhotos.total === 1 ? '' : 's'} on this device</strong><span>{pendingPhotos.failed > 0 ? `${pendingPhotos.failed} failed.` : 'Waiting to upload.'}</span></div>
              <button type="button" onClick={pendingPhotos.retry} disabled={pendingPhotos.retrying || isOffline}>Retry</button>
            </div>
          )}
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
            <select value={filterSource} onChange={event => setFilterSource(event.target.value)} aria-label="Filter by source"><option value="all">All sources</option><option value="eoc_checklist">EOC checklist</option><option value="quick_report">Staff report</option></select>
            <select value={filterRecurrence} onChange={event => setFilterRecurrence(event.target.value)} aria-label="Filter recurrence"><option value="all">All recurrence</option><option value="reported_before">Reported before</option><option value="recurring">Recurring issue</option></select>
            <select value={filterReporter} onChange={event => setFilterReporter(event.target.value)} aria-label="Filter reporter"><option value="all">All reporters</option>{reporters.map(reporter => <option key={reporter.id} value={reporter.id}>{reporter.name}</option>)}</select>
            <input type="date" value={filterStartDate} onChange={event => setFilterStartDate(event.target.value)} aria-label="Issues from date" />
            <input type="date" value={filterEndDate} onChange={event => setFilterEndDate(event.target.value)} aria-label="Issues through date" />
            <button type="button" className="supervisor-export-button" onClick={() => downloadRows(buildIssueExportRows(filteredIssues), 'Issues', 'Issue Report.xlsx')}><Download size={15} /> Export</button>
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
              {filterStatus !== 'active' && resolvedIssues.length >= 50 && (
                <button type="button" className="location-issues-load-more" onClick={loadMoreResolved}>Load more history</button>
              )}
            </div>
          )}
        </div>
      )}

      {subTab === 'status' && (
        <div className="eoc-overview-panel">
          {isAdminRole(user?.role) && retentionMetrics && <div className="photo-retention-metrics"><strong>Photo cleanup</strong><span>{retentionMetrics.dueIssues || 0} due issues</span><span>{retentionMetrics.deleted || 0} deleted</span><span>{retentionMetrics.failed || 0} failed</span></div>}
          {missingAssignments.map(row => <div key={`${row.locationId}-${row.shiftId}`} className="eoc-assignment-warning"><AlertTriangle size={17} /> Missing BHT Assignment: {locationLabel(row.locationId)} - {row.shiftId}</div>)}
          <div className="eoc-overview-table">
            <div className="eoc-overview-header"><span>Property / Shift</span><span>Type</span><span>Status</span></div>
            {statusRows.map(row => <div className="eoc-overview-row" key={row.id}><span>{locationLabel(row.locationId)}<small>{row.shiftLabel || row.shiftId}</small></span><span>{row.taskType === 'van' ? `Van - ${vanLabel(row.vanId)}` : 'House'}{row.templateFallbackUsed && <small>Standard fallback</small>}</span><strong className={`eoc-status-${row.status}`}>{String(row.status || '').toUpperCase()}</strong></div>)}
          </div>
        </div>
      )}

      {subTab === 'history' && (
        <div className="eoc-overview-panel">
          <button type="button" className="supervisor-export-button" onClick={() => downloadRows(buildEocExportRows(historyRows), 'EOC Completion', 'EOC Completion.xlsx')}><Download size={15} /> Export current history</button>
          <div className="eoc-history-list">
            {historyRows.map(row => (
              <div className="eoc-history-row" key={`${row.recordType}-${row.id}`}>
                <div><strong>{locationLabel(row.locationId)} - {row.eocType}</strong><span>{row.dueDate} - {row.shiftId} - {row.status}{row.completedByName ? ` - ${row.completedByName}` : ''}</span><small>{row.templateName}{row.templateVersion ? ` v${row.templateVersion}` : ''} - {row.issueCount} issues</small></div>
                {row.status === 'missed' && <div className="missed-eoc-note"><input value={missedNotes[row.id] || ''} onChange={event => setMissedNotes(current => ({ ...current, [row.id]: event.target.value }))} placeholder="Add supervisor note" /><button type="button" onClick={() => saveMissedNote(row)} disabled={!String(missedNotes[row.id] || '').trim()}>Save note</button></div>}
              </div>
            ))}
          </div>
          {historyRows.length >= 50 && <button type="button" className="location-issues-load-more" onClick={loadMoreHistory}>Load more history</button>}
        </div>
      )}

      {subTab === 'template' && (
        <EocTemplateManager user={user} isOffline={isOffline} />
      )}
    </div>
  )
}

export default SupervisorEocPanel
