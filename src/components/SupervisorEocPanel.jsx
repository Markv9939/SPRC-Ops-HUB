import { useEffect, useMemo, useState } from 'react'
import { db } from '../firebase'
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc
} from 'firebase/firestore'
import { LOCATIONS, VANS } from '../data/eocConstants'
import { notifySuccess } from '../utils/toast'
import { createIssueStatusNotification } from '../services/notificationService'
import EocTemplateManager from './EocTemplateManager'

function SupervisorEocPanel({ user, isOffline = false, targetIssueId = null, onTargetIssueHandled }) {
  const [subTab, setSubTab] = useState('template') // template | issues
  const [issues, setIssues] = useState([])
  const [loadingIssues, setLoadingIssues] = useState(true)
  const [highlightedIssueId, setHighlightedIssueId] = useState(null)

  const [filterLocation, setFilterLocation] = useState('all')
  const [filterSeverity, setFilterSeverity] = useState('all')
  const [filterIssueStatus, setFilterIssueStatus] = useState('open')

  const [resolvingIssue, setResolvingIssue] = useState(null)
  const [resolveNotes, setResolveNotes] = useState('')

  useEffect(() => {
    const q = query(collection(db, 'eocIssues'), orderBy('createdAt', 'desc'))
    const unsub = onSnapshot(q, (snap) => {
      setIssues(snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })))
      setLoadingIssues(false)
    })
    return unsub
  }, [])

  useEffect(() => {
    if (!targetIssueId) return
    const timerId = setTimeout(() => {
      setSubTab('issues')
      setFilterLocation('all')
      setFilterSeverity('all')
      setFilterIssueStatus('all')
      setHighlightedIssueId(targetIssueId)
    }, 0)
    return () => clearTimeout(timerId)
  }, [targetIssueId])

  useEffect(() => {
    if (!highlightedIssueId || loadingIssues) return
    const timerId = setTimeout(() => {
      const issueEl = document.getElementById(`eoc-issue-${highlightedIssueId}`)
      if (issueEl) {
        issueEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
        onTargetIssueHandled?.()
      }
    }, 100)
    return () => clearTimeout(timerId)
  }, [highlightedIssueId, loadingIssues, onTargetIssueHandled])

  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      if (filterLocation !== 'all' && issue.locationId !== filterLocation) return false
      if (filterSeverity !== 'all' && issue.severity !== filterSeverity) return false
      if (filterIssueStatus !== 'all' && issue.status !== filterIssueStatus) return false
      return true
    })
  }, [filterIssueStatus, filterLocation, filterSeverity, issues])

  const handleResolveIssue = async () => {
    if (!resolvingIssue) return
    if (!resolveNotes.trim()) {
      alert('Resolution note is required.')
      return
    }
    if (isOffline) {
      alert('Offline mode: resolving issues is unavailable until connection is restored.')
      return
    }

    try {
      await updateDoc(doc(db, 'eocIssues', resolvingIssue.id), {
        status: 'resolved',
        resolvedNotes: resolveNotes.trim(),
        resolvedAt: serverTimestamp(),
        resolvedByUserId: user?.id || null,
        resolvedByName: user?.name || null,
        updatedAt: serverTimestamp()
      })
      await createIssueStatusNotification({
        issue: resolvingIssue,
        nextStatus: 'resolved',
        note: resolveNotes.trim(),
        actorUser: user
      })
      setResolvingIssue(null)
      setResolveNotes('')
      notifySuccess('Issue resolved')
    } catch (error) {
      console.error('Error resolving issue:', error)
      alert('Failed to resolve issue')
    }
  }

  const locationLabel = (locationId) => LOCATIONS.find(location => location.id === locationId)?.label || locationId
  const vanLabel = (vanId) => VANS.find(van => van.id === vanId)?.label || vanId || 'None'

  const severityBadge = (severity) => (
    <span className={`chip severity-${severity}`} style={{ fontSize: '11px', textTransform: 'capitalize' }}>
      {severity}
    </span>
  )

  const selectStyle = {
    padding: '6px 10px',
    border: '2px solid rgba(17,47,82,0.20)',
    borderRadius: '6px',
    fontSize: '13px',
    background: 'rgba(17,47,82,0.10)',
    color: 'var(--text-primary)'
  }

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
          Issues ({issues.filter(issue => issue.status === 'open').length})
        </button>
      </div>

      {subTab === 'issues' && (
        <div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <select value={filterLocation} onChange={event => setFilterLocation(event.target.value)} style={selectStyle}>
              <option value="all">All Locations</option>
              {LOCATIONS.map(location => <option key={location.id} value={location.id}>{location.label}</option>)}
            </select>
            <select value={filterSeverity} onChange={event => setFilterSeverity(event.target.value)} style={selectStyle}>
              <option value="all">All Severity</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <select value={filterIssueStatus} onChange={event => setFilterIssueStatus(event.target.value)} style={selectStyle}>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="all">All</option>
            </select>
          </div>

          {loadingIssues ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#556677' }}>Loading...</div>
          ) : filteredIssues.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#556677' }}>No issues found</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredIssues.map(issue => (
                <div key={issue.id} id={`eoc-issue-${issue.id}`} style={{
                  padding: '14px',
                  borderRadius: '8px',
                  border: highlightedIssueId === issue.id
                    ? '3px solid #CD4E42'
                    : (issue.severity === 'high' ? '2px solid #B75E54' : '1px solid rgba(17,47,82,0.14)'),
                  backgroundColor: 'rgba(17,47,82,0.08)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 700, fontSize: '14px' }}>
                      {issue.label}
                    </span>
                    {severityBadge(issue.severity)}
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    {issue.description}
                  </div>
                  <div style={{ fontSize: '12px', color: '#556677', marginBottom: '8px' }}>
                    {locationLabel(issue.locationId)} | {issue.reportedByName}
                    {issue.vanId ? ` | ${vanLabel(issue.vanId)}` : ''}
                  </div>

                  {issue.status === 'open' ? (
                    resolvingIssue?.id === issue.id ? (
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input
                          className="input"
                          placeholder="Resolution notes..."
                          value={resolveNotes}
                          onChange={event => setResolveNotes(event.target.value)}
                          style={{ flex: 1, padding: '6px 10px', fontSize: '13px' }}
                        />
                        <button
                          onClick={handleResolveIssue}
                          style={{
                            padding: '6px 14px',
                            backgroundColor: '#2F7D57',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '13px',
                            fontWeight: 600,
                            cursor: 'pointer'
                          }}
                        >
                          Resolve
                        </button>
                        <button
                          onClick={() => { setResolvingIssue(null); setResolveNotes('') }}
                          style={{
                            padding: '6px 14px',
                            backgroundColor: 'rgba(17,47,82,0.10)',
                            color: 'var(--text-secondary)',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '13px',
                            cursor: 'pointer'
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setResolvingIssue(issue)}
                        style={{
                          padding: '6px 14px',
                          backgroundColor: 'rgba(17,47,82,0.10)',
                          color: 'var(--text-primary)',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        Mark Resolved
                      </button>
                    )
                  ) : (
                    <div style={{ fontSize: '12px', color: '#2F7D57', fontWeight: 600 }}>
                      Resolved {issue.resolvedNotes ? `| ${issue.resolvedNotes}` : ''}
                    </div>
                  )}
                </div>
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
