import { useState, useEffect } from 'react'
import { db } from '../firebase'
import {
  collection, query, where, orderBy, onSnapshot, getDocs,
  doc, updateDoc, serverTimestamp, addDoc, deleteDoc, writeBatch
} from 'firebase/firestore'
import { LOCATIONS, SHIFTS, VANS, EOC_CHECKLIST_TEMPLATE } from '../data/eocConstants'

function SupervisorEocPanel() {
  const [subTab, setSubTab] = useState('compliance') // compliance | assignments | issues | template
  const [assignments, setAssignments] = useState([])
  const [issues, setIssues] = useState([])
  const [templateItems, setTemplateItems] = useState([])
  const [loadingAssignments, setLoadingAssignments] = useState(true)
  const [loadingIssues, setLoadingIssues] = useState(true)
  const [loadingTemplate, setLoadingTemplate] = useState(true)

  // Filters
  const [filterLocation, setFilterLocation] = useState('all')
  const [filterShift, setFilterShift] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterSeverity, setFilterSeverity] = useState('all')
  const [filterIssueStatus, setFilterIssueStatus] = useState('open')

  // Template editor
  const [editingTemplateId, setEditingTemplateId] = useState(null)
  const [templateForm, setTemplateForm] = useState({ category: '', label: '', order: 0, active: true })

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

  // Load template items
  useEffect(() => {
    const q = query(collection(db, 'eocChecklistTemplate'), orderBy('order', 'asc'))
    const unsub = onSnapshot(q, (snap) => {
      setTemplateItems(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoadingTemplate(false)
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

  const handleSaveTemplateItem = async () => {
    if (!templateForm.category.trim() || !templateForm.label.trim()) {
      alert('Category and label are required')
      return
    }
    const payload = {
      category: templateForm.category.trim(),
      label: templateForm.label.trim(),
      order: Number(templateForm.order) || 0,
      active: templateForm.active !== false
    }
    try {
      if (editingTemplateId) {
        await updateDoc(doc(db, 'eocChecklistTemplate', editingTemplateId), payload)
      } else {
        await addDoc(collection(db, 'eocChecklistTemplate'), payload)
      }
      setEditingTemplateId(null)
      setTemplateForm({ category: '', label: '', order: 0, active: true })
    } catch (err) {
      console.error('Error saving template item:', err)
      alert('Failed to save template item')
    }
  }

  const handleEditTemplateItem = (item) => {
    setEditingTemplateId(item.id)
    setTemplateForm({
      category: item.category || '',
      label: item.label || '',
      order: item.order || 0,
      active: item.active !== false
    })
  }

  const handleDeleteTemplateItem = async (id) => {
    if (!confirm('Delete this checklist item?')) return
    try {
      await deleteDoc(doc(db, 'eocChecklistTemplate', id))
    } catch (err) {
      console.error('Error deleting template item:', err)
      alert('Failed to delete template item')
    }
  }

  const handleSeedTemplate = async () => {
    if (!confirm('Seed template from defaults? This will add new items, not replace existing ones.')) return
    try {
      const batch = writeBatch(db)
      EOC_CHECKLIST_TEMPLATE.forEach((item, idx) => {
        const ref = doc(collection(db, 'eocChecklistTemplate'))
        batch.set(ref, {
          category: item.category,
          label: item.label,
          order: idx + 1,
          active: true
        })
      })
      await batch.commit()
    } catch (err) {
      console.error('Error seeding template:', err)
      alert('Failed to seed template')
    }
  }

  const handleReplaceTemplate = async () => {
    if (!confirm('Replace template with defaults? This will delete existing items.')) return
    try {
      const existing = await getDocs(collection(db, 'eocChecklistTemplate'))
      const batch = writeBatch(db)
      existing.docs.forEach(d => batch.delete(d.ref))
      EOC_CHECKLIST_TEMPLATE.forEach((item, idx) => {
        const ref = doc(collection(db, 'eocChecklistTemplate'))
        batch.set(ref, {
          category: item.category,
          label: item.label,
          order: idx + 1,
          active: true
        })
      })
      await batch.commit()
    } catch (err) {
      console.error('Error replacing template:', err)
      alert('Failed to replace template')
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
    border: '2px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    fontSize: '13px',
    background: 'rgba(255,255,255,0.06)',
    color: '#e8e8e8'
  }

  const tabBtnStyle = (active) => ({
    padding: '8px 16px',
    backgroundColor: active ? '#E53935' : 'rgba(255,255,255,0.06)',
    color: active ? 'white' : '#8899aa',
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
        <button style={tabBtnStyle(subTab === 'template')} onClick={() => setSubTab('template')}>
          Template
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
            <div style={{ textAlign: 'center', padding: '30px', color: '#556677' }}>Loading...</div>
          ) : filteredAssignments.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#556677' }}>No assignments found</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredAssignments.map(a => (
                <div key={a.id} style={{
                  padding: '14px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.08)',
                  backgroundColor: 'rgba(255,255,255,0.05)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 700, fontSize: '14px' }}>
                      {locationLabel(a.locationId)} — {shiftLabel(a.shiftId)}
                    </span>
                    {statusBadge(a.status)}
                  </div>
                  <div style={{ fontSize: '13px', color: '#8899aa' }}>
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
          <p style={{ fontSize: '13px', color: '#8899aa', marginBottom: '16px' }}>
            Manage upcoming assignments — reassign techs or override van assignments.
          </p>
          {loadingAssignments ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#556677' }}>Loading...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {assignments.filter(a => a.status === 'pending').map(a => (
                <div key={a.id} style={{
                  padding: '14px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.08)',
                  backgroundColor: 'rgba(255,255,255,0.05)'
                }}>
                  <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '8px' }}>
                    {locationLabel(a.locationId)} — {shiftLabel(a.shiftId)}
                  </div>
                  <div style={{ fontSize: '13px', color: '#8899aa', marginBottom: '8px' }}>
                    Due: {a.dueDate}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <div>
                      <label style={{ fontSize: '11px', color: '#556677' }}>Tech</label>
                      <div style={{ fontSize: '13px', fontWeight: 600 }}>
                        {a.assignedTechName || 'Unassigned'}
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', color: '#556677', display: 'block' }}>Van</label>
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
                <div style={{ textAlign: 'center', padding: '30px', color: '#556677' }}>
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
            <div style={{ textAlign: 'center', padding: '30px', color: '#556677' }}>Loading...</div>
          ) : filteredIssues.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#556677' }}>No issues found</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredIssues.map(issue => (
                <div key={issue.id} style={{
                  padding: '14px',
                  borderRadius: '8px',
                  border: issue.severity === 'high' ? '2px solid #FF5722' : '1px solid rgba(255,255,255,0.08)',
                  backgroundColor: 'rgba(255,255,255,0.05)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 700, fontSize: '14px' }}>
                      {issue.label}
                    </span>
                    {severityBadge(issue.severity)}
                  </div>
                  <div style={{ fontSize: '13px', color: '#8899aa', marginBottom: '4px' }}>
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
                            padding: '6px 14px', backgroundColor: 'rgba(255,255,255,0.06)', color: '#8899aa',
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
                          padding: '6px 14px', backgroundColor: 'rgba(255,255,255,0.06)', color: '#e8e8e8',
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

      {/* ===== TEMPLATE TAB ===== */}
      {subTab === 'template' && (
        <div>
          <p style={{ fontSize: '13px', color: '#8899aa', marginBottom: '16px' }}>
            Edit the EOC checklist items that techs complete. Changes apply immediately.
          </p>

          {loadingTemplate ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#556677' }}>Loading...</div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                {templateItems.length === 0 && (
                  <button onClick={handleSeedTemplate} style={tabBtnStyle(true)}>
                    Seed From Default Template
                  </button>
                )}
                {templateItems.length > 0 && (
                  <button onClick={handleReplaceTemplate} style={tabBtnStyle(true)}>
                    Replace With Default Template
                  </button>
                )}
              </div>

              <div style={{
                backgroundColor: 'rgba(255,255,255,0.05)',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '16px',
                border: '1px solid rgba(255,255,255,0.08)'
              }}>
                <h4 style={{ margin: '0 0 12px 0', color: '#e8e8e8', fontSize: '14px' }}>
                  {editingTemplateId ? 'Edit Item' : 'Add Item'}
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '11px', color: '#556677' }}>Category</label>
                    <input
                      className="input"
                      value={templateForm.category}
                      onChange={e => setTemplateForm({ ...templateForm, category: e.target.value })}
                      placeholder="Exterior"
                      style={{ fontSize: '13px' }}
                    />
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <label style={{ fontSize: '11px', color: '#556677' }}>Label</label>
                    <input
                      className="input"
                      value={templateForm.label}
                      onChange={e => setTemplateForm({ ...templateForm, label: e.target.value })}
                      placeholder="Tire condition and pressure"
                      style={{ fontSize: '13px' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: '#556677' }}>Order</label>
                    <input
                      className="input"
                      type="number"
                      value={templateForm.order}
                      onChange={e => setTemplateForm({ ...templateForm, order: e.target.value })}
                      style={{ fontSize: '13px' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: '#556677', display: 'block' }}>Active</label>
                    <select
                      value={templateForm.active ? 'true' : 'false'}
                      onChange={e => setTemplateForm({ ...templateForm, active: e.target.value === 'true' })}
                      style={selectStyle}
                    >
                      <option value="true">Active</option>
                      <option value="false">Inactive</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <button onClick={handleSaveTemplateItem} style={tabBtnStyle(true)}>
                    {editingTemplateId ? 'Save Changes' : 'Add Item'}
                  </button>
                  {editingTemplateId && (
                    <button
                      onClick={() => { setEditingTemplateId(null); setTemplateForm({ category: '', label: '', order: 0, active: true }) }}
                      style={tabBtnStyle(false)}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>

              {templateItems.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', color: '#556677' }}>
                  No template items yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {templateItems.map(item => (
                    <div key={item.id} style={{
                      padding: '12px',
                      borderRadius: '8px',
                      border: '1px solid rgba(255,255,255,0.08)',
                      backgroundColor: 'rgba(255,255,255,0.05)'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontWeight: 700, fontSize: '14px' }}>
                          {item.category} — {item.label}
                        </span>
                        <span className="badge" style={{ background: item.active === false ? 'rgba(255,255,255,0.06)' : 'rgba(76,175,80,0.15)', color: '#e8e8e8' }}>
                          {item.active === false ? 'Inactive' : 'Active'}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: '#8899aa', marginBottom: '8px' }}>
                        Order: {item.order || 0}
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => handleEditTemplateItem(item)} style={tabBtnStyle(false)}>Edit</button>
                        <button onClick={() => handleDeleteTemplateItem(item.id)} style={tabBtnStyle(false)}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default SupervisorEocPanel
