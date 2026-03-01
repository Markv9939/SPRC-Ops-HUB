import { useState, useEffect } from 'react'
import { db } from '../firebase'
import {
  collection, query, orderBy, onSnapshot,
  doc, updateDoc, serverTimestamp, addDoc, deleteDoc
} from 'firebase/firestore'
import {
  LOCATIONS,
  SHIFTS,
  VANS,
  getShiftLabel
} from '../data/eocConstants'
import { notifySuccess } from '../utils/toast'
import { showConfirmDialog } from '../utils/dialogs'
import EocTemplateManager from './EocTemplateManager'

function SupervisorEocPanel({ user, isOffline = false }) {
  const [subTab, setSubTab] = useState('compliance') // compliance | issues | template | vehicles
  const [assignments, setAssignments] = useState([])
  const [issues, setIssues] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [loadingAssignments, setLoadingAssignments] = useState(true)
  const [loadingIssues, setLoadingIssues] = useState(true)
  const [loadingVehicles, setLoadingVehicles] = useState(true)

  // Filters
  const [filterLocation, setFilterLocation] = useState('all')
  const [filterShift, setFilterShift] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterSeverity, setFilterSeverity] = useState('all')
  const [filterIssueStatus, setFilterIssueStatus] = useState('open')
  const [filterEocType, setFilterEocType] = useState('all')

  const [editingVehicleId, setEditingVehicleId] = useState(null)
  const [vehicleForm, setVehicleForm] = useState({ name: '', vin: '', vanId: '', locationId: '', active: true })

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

  // Load vehicles
  useEffect(() => {
    const q = query(collection(db, 'eocVehicles'), orderBy('name', 'asc'))
    const unsub = onSnapshot(q, (snap) => {
      setVehicles(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoadingVehicles(false)
    })
    return unsub
  }, [])

  const filteredAssignments = assignments.filter(a => {
    if (filterLocation !== 'all' && a.locationId !== filterLocation) return false
    if (filterShift !== 'all' && a.shiftId !== filterShift) return false
    if (filterStatus !== 'all' && a.status !== filterStatus) return false
    if (filterEocType !== 'all' && a.eocType !== filterEocType) return false
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
    if (!resolveNotes.trim()) {
      alert('Resolution note is required.')
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
      if (resolvingIssue?.locationId && resolvingIssue?.reportedByUserId) {
        await addDoc(collection(db, 'alerts'), {
          type: 'eoc_issue_update',
          issueId: resolvingIssue.id,
          taskId: resolvingIssue.taskId || null,
          locationId: resolvingIssue.locationId,
          eocType: resolvingIssue.eocType || null,
          severity: resolvingIssue.severity || 'medium',
          targetUserId: resolvingIssue.reportedByUserId,
          targetUserName: resolvingIssue.reportedByName || null,
          status: 'resolved',
          statusNote: resolveNotes.trim(),
          actorUserId: user?.id || null,
          actorName: user?.name || 'Supervisor',
          message: `${user?.name || 'Supervisor'} marked "${resolvingIssue.label || 'Issue'}" as resolved.`,
          read: false,
          version: 1,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        })
      }
      setResolvingIssue(null)
      setResolveNotes('')
      notifySuccess('Issue resolved')
    } catch (err) {
      console.error('Error resolving issue:', err)
      alert('Failed to resolve issue')
    }
  }

  const handleSaveVehicle = async () => {
    if (!vehicleForm.name.trim() || !vehicleForm.vin.trim()) {
      alert('Vehicle name and VIN are required')
      return
    }
    const payload = {
      name: vehicleForm.name.trim(),
      vin: vehicleForm.vin.trim(),
      vanId: vehicleForm.vanId || null,
      locationId: vehicleForm.locationId || null,
      active: vehicleForm.active !== false
    }
    try {
      if (editingVehicleId) {
        await updateDoc(doc(db, 'eocVehicles', editingVehicleId), payload)
      } else {
        await addDoc(collection(db, 'eocVehicles'), payload)
      }
      setEditingVehicleId(null)
      setVehicleForm({ name: '', vin: '', vanId: '', locationId: '', active: true })
      notifySuccess(editingVehicleId ? 'Vehicle updated' : 'Vehicle added')
    } catch (err) {
      console.error('Error saving vehicle:', err)
      alert('Failed to save vehicle')
    }
  }

  const handleEditVehicle = (v) => {
    setEditingVehicleId(v.id)
    setVehicleForm({
      name: v.name || '',
      vin: v.vin || '',
      vanId: v.vanId || '',
      locationId: v.locationId || '',
      active: v.active !== false
    })
  }

  const handleDeleteVehicle = async (id) => {
    if (!(await showConfirmDialog('Delete this vehicle?', {
      title: 'Delete Vehicle',
      tone: 'danger',
      confirmText: 'Delete'
    }))) return
    try {
      await deleteDoc(doc(db, 'eocVehicles', id))
      notifySuccess('Vehicle deleted')
    } catch (err) {
      console.error('Error deleting vehicle:', err)
      alert('Failed to delete vehicle')
    }
  }

  const locationLabel = (id) => LOCATIONS.find(l => l.id === id)?.label || id
  const shiftLabel = (id) => getShiftLabel(id)
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
      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button style={tabBtnStyle(subTab === 'compliance')} onClick={() => setSubTab('compliance')}>
          Compliance
        </button>
        <button style={tabBtnStyle(subTab === 'issues')} onClick={() => setSubTab('issues')}>
          Issues ({issues.filter(i => i.status === 'open').length})
        </button>
        <button style={tabBtnStyle(subTab === 'template')} onClick={() => setSubTab('template')}>
          Template
        </button>
        <button style={tabBtnStyle(subTab === 'vehicles')} onClick={() => setSubTab('vehicles')}>
          Vehicles
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
            <select value={filterEocType} onChange={e => setFilterEocType(e.target.value)} style={selectStyle}>
              <option value="all">All Types</option>
              <option value="house">House</option>
              <option value="van">Van</option>
            </select>
          </div>

          {loadingAssignments ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#556677' }}>Loading...</div>
          ) : filteredAssignments.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#556677' }}>No assignments found</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredAssignments.map(a => (
                <div key={a.id} style={{
                  padding: '14px',
                  borderRadius: '8px',
                  border: '1px solid rgba(17,47,82,0.14)',
                  backgroundColor: 'rgba(17,47,82,0.08)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 700, fontSize: '14px' }}>
                      {locationLabel(a.locationId)} — {shiftLabel(a.shiftId)}
                    </span>
                    {statusBadge(a.status)}
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    Due: {a.dueDate} &bull; BHT: {a.assignedTechName || 'Unassigned'}
                    {a.eocType ? ` \u00B7 ${a.eocType.toUpperCase()}` : ''}
                    {a.vanId ? ` \u00B7 ${vanLabel(a.vanId)}` : ''}
                  </div>
                </div>
              ))}
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
            <div style={{ textAlign: 'center', padding: '30px', color: '#556677' }}>Loading...</div>
          ) : filteredIssues.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#556677' }}>No issues found</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredIssues.map(issue => (
                <div key={issue.id} style={{
                  padding: '14px',
                  borderRadius: '8px',
                  border: issue.severity === 'high' ? '2px solid #B75E54' : '1px solid rgba(17,47,82,0.14)',
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
                            padding: '6px 14px', backgroundColor: '#2F7D57', color: 'white',
                            border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
                            cursor: 'pointer'
                          }}
                        >
                          Resolve
                        </button>
                        <button
                          onClick={() => { setResolvingIssue(null); setResolveNotes('') }}
                          style={{
                            padding: '6px 14px', backgroundColor: 'rgba(17,47,82,0.10)', color: 'var(--text-secondary)',
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
                          padding: '6px 14px', backgroundColor: 'rgba(17,47,82,0.10)', color: 'var(--text-primary)',
                          border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        Mark Resolved
                      </button>
                    )
                  ) : (
                    <div style={{ fontSize: '12px', color: '#2F7D57', fontWeight: 600 }}>
                      Resolved {issue.resolvedNotes ? `— ${issue.resolvedNotes}` : ''}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== TEMPLATE TAB ===== */}
      {subTab === 'template' && (
        <EocTemplateManager user={user} isOffline={isOffline} />
      )}

      {/* ===== VEHICLES TAB ===== */}
      {subTab === 'vehicles' && (
        <div>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
            Manage vehicle details (name, VIN) and assign vans to locations.
          </p>

          <div style={{
            backgroundColor: 'rgba(17,47,82,0.08)',
            borderRadius: '12px',
            padding: '16px',
            marginBottom: '16px',
            border: '1px solid rgba(17,47,82,0.14)'
          }}>
            <h4 style={{ margin: '0 0 12px 0', color: 'var(--text-primary)', fontSize: '14px' }}>
              {editingVehicleId ? 'Edit Vehicle' : 'Add Vehicle'}
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '11px', color: '#556677' }}>Vehicle Name</label>
                <input
                  className="input"
                  value={vehicleForm.name}
                  onChange={e => setVehicleForm({ ...vehicleForm, name: e.target.value })}
                  placeholder="Girls Php Van"
                  style={{ fontSize: '13px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#556677' }}>VIN</label>
                <input
                  className="input"
                  value={vehicleForm.vin}
                  onChange={e => setVehicleForm({ ...vehicleForm, vin: e.target.value })}
                  placeholder="VIN number"
                  style={{ fontSize: '13px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#556677', display: 'block' }}>Van</label>
                <select
                  value={vehicleForm.vanId}
                  onChange={e => setVehicleForm({ ...vehicleForm, vanId: e.target.value })}
                  style={selectStyle}
                >
                  <option value="">None</option>
                  {VANS.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#556677', display: 'block' }}>Location</label>
                <select
                  value={vehicleForm.locationId}
                  onChange={e => setVehicleForm({ ...vehicleForm, locationId: e.target.value })}
                  style={selectStyle}
                >
                  <option value="">Unassigned</option>
                  {LOCATIONS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#556677', display: 'block' }}>Active</label>
                <select
                  value={vehicleForm.active ? 'true' : 'false'}
                  onChange={e => setVehicleForm({ ...vehicleForm, active: e.target.value === 'true' })}
                  style={selectStyle}
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button onClick={handleSaveVehicle} style={tabBtnStyle(true)}>
                {editingVehicleId ? 'Save Changes' : 'Add Vehicle'}
              </button>
              {editingVehicleId && (
                <button
                  onClick={() => { setEditingVehicleId(null); setVehicleForm({ name: '', vin: '', vanId: '', locationId: '', active: true }) }}
                  style={tabBtnStyle(false)}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>

          {loadingVehicles ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#556677' }}>Loading...</div>
          ) : vehicles.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#556677' }}>No vehicles found</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {vehicles.map(v => (
                <div key={v.id} style={{
                  padding: '12px',
                  borderRadius: '8px',
                  border: '1px solid rgba(17,47,82,0.14)',
                  backgroundColor: 'rgba(17,47,82,0.08)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ fontWeight: 700, fontSize: '14px' }}>{v.name}</span>
                    <span className="badge" style={{ background: v.active === false ? 'rgba(17,47,82,0.10)' : 'rgba(76,175,80,0.15)', color: 'var(--text-primary)' }}>
                      {v.active === false ? 'Inactive' : 'Active'}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    VIN: {v.vin || '--'} &bull; Van: {vanLabel(v.vanId)} &bull; Location: {v.locationId ? locationLabel(v.locationId) : 'Unassigned'}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => handleEditVehicle(v)} style={tabBtnStyle(false)}>Edit</button>
                    <button onClick={() => handleDeleteVehicle(v.id)} style={tabBtnStyle(false)}>Delete</button>
                  </div>
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




