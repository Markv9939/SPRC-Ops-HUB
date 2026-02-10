import { useState, useEffect } from 'react'
import { db } from '../firebase'
import {
  collection, query, where, orderBy, onSnapshot, getDocs,
  doc, updateDoc, serverTimestamp
} from 'firebase/firestore'
import { LOCATIONS, SHIFTS, VANS } from '../data/eocConstants'

function SupervisorEocPanel() {
  const [subTab, setSubTab] = useState('compliance') // compliance | assignments | issues
  const [assignments, setAssignments] = useState([])
  const [issues, setIssues] = useState([])
  const [loadingAssignments, setLoadingAssignments] = useState(true)
  const [loadingIssues, setLoadingIssues] = useState(true)

  // Filters
  const [filterLocation, setFilterLocation] = useState('all')
  const [filterShift, setFilterShift] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterSeverity, setFilterSeverity] = useState('all')
  const [filterIssueStatus, setFilterIssueStatus] = useState('open')

  // Resolve modal
  const [resolvingIssue, setResolvingIssue] = useState(null)
  const [resolveNotes, setResolveNotes] = useState('')

  // Load assignments
  useEffect(() => {
    const q = query(collection(db, 'eocAssignments'), orderBy('dueDate', 'desc'))
    const unsub = onSnapshot(q, (snap) => {
      setAssignments(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoadingAssignments(false)
    })
    return unsub
  }, [])

  // Load issues
  useEffect(() => {
    const q = query(collection(db, 'eocIssues'), orderBy('createdAt', 'desc'))
    const unsub = onSnapshot(q, (snap) => {
      setIssues(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoadingIssues(false)
    })
    return unsub
  }, [])

  const filteredAssignments = assignments.filter(a => {
    if (filterLocation !== 'all' && a.locationId !== filterLocation) return false
    if (filterShift !== 'all' && a.shiftId !== filterShift) return false
    if (filterStatus !== 'all' && a.status !== filterStatus) return false
    return true
  })

  const filteredIssues = issues.filter(i => {
    if (filterLocation !== 'all' && i.locationId !== filterLocation) return false
    if (filterSeverity !== 'all' && i.severity !== filterSeverity) return false
    if (filterIssueStatus !== 'all' && i.status !== filterIssueStatus) return false
    return true
  })

  const handleResolveIssue = async () => {
    if (!resolvingIssue) return
    try {
      await updateDoc(doc(db, 'eocIssues', resolvingIssue.id), {
        status: 'resolved',
        resolvedNotes: resolveNotes,
        resolvedAt: serverTimestamp()
      })
      setResolvingIssue(null)
      setResolveNotes('')
    } catch (err) {
      console.error('Error resolving issue:', err)
      alert('Failed to resolve issue')
    }
  }

  const handleReassignTech = async (assignmentId, techId, techName) => {
    try {
      await updateDoc(doc(db, 'eocAssignments', assignmentId), {
        assignedTechId: techId,
        assignedTechName: techName,
        updatedAt: serverTimestamp()
      })
    } catch (err) {
      console.error('Error reassigning:', err)
      alert('Failed to reassign')
    }
  }

  const handleUpdateVan = async (assignmentId, vanId) => {
    try {
      await updateDoc(doc(db, 'eocAssignments', assignmentId), {
        vanId,
        updatedAt: serverTimestamp()
      })
    } catch (err) {
      console.error('Error updating van:', err)
      alert('Failed to update van')
    }
  }

  const locationLabel = (id) => LOCATIONS.find(l => l.id === id)?.label || id
  const shiftLabel = (id) => SHIFTS.find(s => s.id === id)?.label || id
  const vanLabel = (id) => VANS.find(v => v.id === id)?.label || id || 'None'

  const statusBadge = (status) => {
    const cls = {
      pending: 'badge-eoc-pending',
      completed: 'badge-eoc-completed',
      missed: 'badge-eoc-missed'
    }
    return <span className={`badge ${cls[status] || ''}`}>{status}</span>
  }

  const severityBadge = (severity) => (
    <span className={`chip severity-${severity}`} style={{ fontSize: '11px', textTransform: 'capitalize' }}>
      {severity}
    </span>
  )

  const selectStyle = {
    padding: '6px 10px',
    border: '2px solid #eee',
    borderRadius: '6px',
    fontSize: '13px',
    background: 'white'
  }

  const tabBtnStyle = (active) => ({
    padding: '8px 16px',
    backgroundColor: active ? '#2196F3' : '#f0f0f0',
    color: active ? 'white' : '#666',
    border: 'none',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer'
  })

  return (
    <div>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button style={tabBtnStyle(subTab === 'compliance')} onClick={() => setSubTab('compliance')}>
          Compliance
        </button>
        <button style={tabBtnStyle(subTab === 'assignments')} onClick={() => setSubTab('assignments')}>
          Assignments
        </button>
        <button style={tabBtnStyle(subTab === 'issues')} onClick={() => setSubTab('issues')}>
          Issues ({issues.filter(i => i.status === 'open').length})
        </button>
      </div>

      {/* ===== COMPLIANCE TAB ===== */}
      {subTab === 'compliance' && (
        <div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <select value={filterLocation} onChange={e => setFilterLocation(e.target.value)} style={selectStyle}>
              <option value="all">All Locations</option>
              {LOCATIONS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
            <select value={filterShift} onChange={e => setFilterShift(e.target.value)} style={selectStyle}>
              <option value="all">All Shifts</option>
              {SHIFTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={selectStyle}>
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="completed">Completed</option>
              <option value="missed">Missed</option>
            </select>
          </div>

          {loadingAssignments ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#999' }}>Loading...</div>
          ) : filteredAssignments.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#aaa' }}>No assignments found</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredAssignments.map(a => (
                <div key={a.id} style={{
                  padding: '14px',
                  borderRadius: '8px',
                  border: '1px solid #eee',
                  backgroundColor: 'white'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 700, fontSize: '14px' }}>
                      {locationLabel(a.locationId)} — {shiftLabel(a.shiftId)}
                    </span>
                    {statusBadge(a.status)}
                  </div>
                  <div style={{ fontSize: '13px', color: '#666' }}>
                    Due: {a.dueDate} &bull; Tech: {a.assignedTechName || 'Unassigned'}
                    {a.vanId ? ` \u00B7 ${vanLabel(a.vanId)}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== ASSIGNMENTS TAB ===== */}
      {subTab === 'assignments' && (
        <div>
          <p style={{ fontSize: '13px', color: '#888', marginBottom: '16px' }}>
            Manage upcoming assignments — reassign techs or override van assignments.
          </p>
          {loadingAssignments ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#999' }}>Loading...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {assignments.filter(a => a.status === 'pending').map(a => (
                <div key={a.id} style={{
                  padding: '14px',
                  borderRadius: '8px',
                  border: '1px solid #eee',
                  backgroundColor: 'white'
                }}>
                  <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '8px' }}>
                    {locationLabel(a.locationId)} — {shiftLabel(a.shiftId)}
                  </div>
                  <div style={{ fontSize: '13px', color: '#666', marginBottom: '8px' }}>
                    Due: {a.dueDate}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <div>
                      <label style={{ fontSize: '11px', color: '#999' }}>Tech</label>
                      <div style={{ fontSize: '13px', fontWeight: 600 }}>
                        {a.assignedTechName || 'Unassigned'}
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', color: '#999', display: 'block' }}>Van</label>
                      <select
                        value={a.vanId || ''}
                        onChange={e => handleUpdateVan(a.id, e.target.value || null)}
                        style={selectStyle}
                      >
                        <option value="">None</option>
                        {VANS.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
              {assignments.filter(a => a.status === 'pending').length === 0 && (
                <div style={{ textAlign: 'center', padding: '30px', color: '#aaa' }}>
                  No pending assignments
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===== ISSUES TAB ===== */}
      {subTab === 'issues' && (
        <div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <select value={filterLocation} onChange={e => setFilterLocation(e.target.value)} style={selectStyle}>
              <option value="all">All Locations</option>
              {LOCATIONS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
            <select value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)} style={selectStyle}>
              <option value="all">All Severity</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <select value={filterIssueStatus} onChange={e => setFilterIssueStatus(e.target.value)} style={selectStyle}>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="all">All</option>
            </select>
          </div>

          {loadingIssues ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#999' }}>Loading...</div>
          ) : filteredIssues.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#aaa' }}>No issues found</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredIssues.map(issue => (
                <div key={issue.id} style={{
                  padding: '14px',
                  borderRadius: '8px',
                  border: issue.severity === 'high' ? '2px solid #FF5722' : '1px solid #eee',
                  backgroundColor: 'white'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 700, fontSize: '14px' }}>
                      {issue.label}
                    </span>
                    {severityBadge(issue.severity)}
                  </div>
                  <div style={{ fontSize: '13px', color: '#666', marginBottom: '4px' }}>
                    {issue.description}
                  </div>
                  <div style={{ fontSize: '12px', color: '#999', marginBottom: '8px' }}>
                    {locationLabel(issue.locationId)} &bull; {issue.reportedByName}
                    {issue.vanId ? ` \u00B7 ${vanLabel(issue.vanId)}` : ''}
                  </div>

                  {issue.status === 'open' ? (
                    resolvingIssue?.id === issue.id ? (
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input
                          className="input"
                          placeholder="Resolution notes..."
                          value={resolveNotes}
                          onChange={e => setResolveNotes(e.target.value)}
                          style={{ flex: 1, padding: '6px 10px', fontSize: '13px' }}
                        />
                        <button
                          onClick={handleResolveIssue}
                          style={{
                            padding: '6px 14px', backgroundColor: '#4CAF50', color: 'white',
                            border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
                            cursor: 'pointer'
                          }}
                        >
                          Resolve
                        </button>
                        <button
                          onClick={() => { setResolvingIssue(null); setResolveNotes('') }}
                          style={{
                            padding: '6px 14px', backgroundColor: '#eee', color: '#666',
                            border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer'
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setResolvingIssue(issue)}
                        style={{
                          padding: '6px 14px', backgroundColor: '#f0f0f0', color: '#333',
                          border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        Mark Resolved
                      </button>
                    )
                  ) : (
                    <div style={{ fontSize: '12px', color: '#4CAF50', fontWeight: 600 }}>
                      Resolved {issue.resolvedNotes ? `— ${issue.resolvedNotes}` : ''}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default SupervisorEocPanel
