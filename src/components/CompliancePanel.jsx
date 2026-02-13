import { useState, useEffect, useMemo } from 'react'
import { db } from '../firebase'
import {
  collection, query, orderBy, onSnapshot,
  doc, addDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp, writeBatch
} from 'firebase/firestore'
import * as XLSX from 'xlsx'
import { notifySuccess } from '../utils/toast'
import { getStatus } from '../utils/complianceStatus'

const COMPLIANCE_CATEGORIES = {
  fpcc: { label: 'FPCC', icon: '\u{1FAAA}' },
  tb_test: { label: 'TB Test', icon: '\u{1FA7A}' },
  cpr_first_aid: { label: 'CPR & First Aid', icon: '\u2764\uFE0F' },
  food_handlers: { label: 'Food Handlers', icon: '\u{1F37D}\uFE0F' },
  drivers_license: { label: "Driver's License", icon: '\u{1F697}' },
  annual_orientation: { label: 'Annual Orientation', icon: '\u{1F4C5}' },
  performance_evaluation: { label: 'Performance Evaluation', icon: '\u{1F4DD}' },
  education: { label: 'Education Verification', icon: '\u{1F393}' },
  resume: { label: 'Resume', icon: '\u{1F4C4}' }
}

const CATEGORY_KEYS = Object.keys(COMPLIANCE_CATEGORIES)

const cardStyle = {
  backgroundColor: 'rgba(255,255,255,0.05)',
  borderRadius: '12px',
  padding: '20px',
  marginBottom: '20px',
  border: '1px solid rgba(229,57,53,0.2)',
  backdropFilter: 'blur(12px)'
}

const inputStyle = {
  width: '100%',
  padding: '8px',
  border: '2px solid rgba(255,255,255,0.1)',
  borderRadius: '6px',
  fontSize: '14px',
  boxSizing: 'border-box',
  backgroundColor: 'rgba(255,255,255,0.06)',
  color: '#e8e8e8'
}

const btnPrimary = {
  padding: '10px 20px',
  backgroundColor: '#4CAF50',
  color: 'white',
  border: 'none',
  borderRadius: '8px',
  fontSize: '14px',
  fontWeight: 'bold',
  cursor: 'pointer'
}

const btnSecondary = {
  padding: '8px 16px',
  backgroundColor: '#E53935',
  color: 'white',
  border: 'none',
  borderRadius: '6px',
  fontSize: '12px',
  fontWeight: 'bold',
  cursor: 'pointer'
}

const btnCancel = {
  padding: '10px 20px',
  backgroundColor: '#999',
  color: 'white',
  border: 'none',
  borderRadius: '8px',
  fontSize: '14px',
  fontWeight: 'bold',
  cursor: 'pointer'
}

const labelStyle = { fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }

function excelDateToJS(serial) {
  if (!serial || typeof serial !== 'number') return null
  return new Date((serial - 25569) * 86400000)
}

function toTimestamp(d) {
  if (!d) return null
  if (d instanceof Date && !isNaN(d)) return Timestamp.fromDate(d)
  return null
}

function formatDateShort(ts) {
  if (!ts) return '--'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  if (isNaN(d)) return '--'
  return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
}

function statusBadge(status) {
  const colors = { overdue: '#f44336', upcoming: '#FF9800', current: '#4CAF50', none: '#556677' }
  const labels = { overdue: 'OVERDUE', upcoming: 'DUE SOON', current: 'CURRENT', none: 'N/A' }
  return (
    <span style={{
      padding: '2px 8px',
      borderRadius: '10px',
      fontSize: '11px',
      fontWeight: 'bold',
      color: 'white',
      backgroundColor: colors[status] || colors.none
    }}>
      {labels[status] || 'N/A'}
    </span>
  )
}

// ─── SUB-TAB: EMPLOYEES ────────────────────────────────────────────────────────
function EmployeesTab({ employees, complianceItems, siteOptions }) {
  const defaultSite = siteOptions[0] || 'RTC'
  const [search, setSearch] = useState('')
  const [siteFilter, setSiteFilter] = useState('All')
  const [expandedId, setExpandedId] = useState(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', site: defaultSite })
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', site: defaultSite, active: true })

  useEffect(() => {
    if (!siteOptions.includes(form.site)) {
      setForm(prev => ({ ...prev, site: defaultSite }))
    }
    if (!siteOptions.includes(editForm.site)) {
      setEditForm(prev => ({ ...prev, site: defaultSite }))
    }
  }, [defaultSite, editForm.site, form.site, siteOptions])

  const itemsByEmployee = useMemo(() => {
    const map = {}
    complianceItems.forEach(item => {
      if (!map[item.employeeId]) map[item.employeeId] = []
      map[item.employeeId].push(item)
    })
    return map
  }, [complianceItems])

  const filtered = employees.filter(e => {
    if (siteFilter !== 'All' && e.site !== siteFilter) return false
    if (search && !e.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const handleAdd = async () => {
    if (!form.name.trim()) return alert('Name is required')
    await addDoc(collection(db, 'complianceEmployees'), {
      name: form.name.trim(),
      site: form.site,
      active: true,
      linkedUserId: null,
      createdAt: serverTimestamp()
    })
    setForm({ name: '', site: defaultSite })
    setAdding(false)
    notifySuccess('Employee added')
  }

  const handleEdit = async () => {
    if (!editForm.name.trim()) return alert('Name is required')
    await updateDoc(doc(db, 'complianceEmployees', editingId), {
      name: editForm.name.trim(),
      site: editForm.site,
      active: editForm.active
    })
    setEditingId(null)
    notifySuccess('Employee updated')
  }

  const getEmployeeStats = (empId) => {
    const items = itemsByEmployee[empId] || []
    let overdue = 0, upcoming = 0
    items.forEach(i => {
      const s = getStatus(i.dueDate)
      if (s === 'overdue') overdue++
      if (s === 'upcoming') upcoming++
    })
    return { overdue, upcoming, total: items.length }
  }

  return (
    <div>
      {/* Search + filters */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search employees..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...inputStyle, flex: 1, minWidth: '200px' }}
        />
        <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)} style={{ ...inputStyle, width: 'auto', minWidth: '100px' }}>
          <option value="All">All Sites</option>
          {siteOptions.map(site => <option key={site} value={site}>{site}</option>)}
        </select>
        <button onClick={() => setAdding(!adding)} style={btnPrimary}>+ Add Employee</button>
      </div>

      {/* Add form */}
      {adding && (
        <div style={{ ...cardStyle, border: '2px solid #E53935' }}>
          <h4 style={{ margin: '0 0 12px 0', color: '#e8e8e8' }}>Add Employee</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Name *</label>
              <input style={inputStyle} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Full Name" />
            </div>
            <div>
              <label style={labelStyle}>Site</label>
              <select style={inputStyle} value={form.site} onChange={e => setForm({ ...form, site: e.target.value })}>
                {siteOptions.map(site => <option key={site} value={site}>{site}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button onClick={handleAdd} style={btnPrimary}>Save</button>
            <button onClick={() => setAdding(false)} style={btnCancel}>Cancel</button>
          </div>
        </div>
      )}

      {/* Employee list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {filtered.map(emp => {
          const stats = getEmployeeStats(emp.id)
          const isExpanded = expandedId === emp.id
          const isEditing = editingId === emp.id

          return (
            <div key={emp.id} style={{
              padding: '14px',
              borderRadius: '8px',
              border: stats.overdue > 0 ? '2px solid #f44336' : '1px solid rgba(255,255,255,0.08)',
              backgroundColor: 'rgba(255,255,255,0.03)'
            }}>
              {isEditing ? (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={labelStyle}>Name</label>
                      <input style={inputStyle} value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
                    </div>
                    <div>
                      <label style={labelStyle}>Site</label>
                      <select style={inputStyle} value={editForm.site} onChange={e => setEditForm({ ...editForm, site: e.target.value })}>
                        {siteOptions.map(site => <option key={site} value={site}>{site}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Status</label>
                      <select style={inputStyle} value={editForm.active} onChange={e => setEditForm({ ...editForm, active: e.target.value === 'true' })}>
                        <option value="true">Active</option>
                        <option value="false">Inactive</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                    <button onClick={handleEdit} style={btnPrimary}>Save</button>
                    <button onClick={() => setEditingId(null)} style={btnCancel}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setExpandedId(isExpanded ? null : emp.id)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '15px', fontWeight: 'bold' }}>{emp.name}</span>
                      <span style={{ fontSize: '12px', color: '#8899aa', backgroundColor: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: '4px' }}>{emp.site}</span>
                      {!emp.active && <span style={{ fontSize: '11px', color: '#999' }}>INACTIVE</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {stats.overdue > 0 && <span style={{ color: '#f44336', fontWeight: 'bold', fontSize: '13px' }}>{stats.overdue} overdue</span>}
                      {stats.upcoming > 0 && <span style={{ color: '#FF9800', fontWeight: 'bold', fontSize: '13px' }}>{stats.upcoming} upcoming</span>}
                      <button onClick={(e) => { e.stopPropagation(); setEditingId(emp.id); setEditForm({ name: emp.name, site: emp.site, active: emp.active !== false }) }} style={btnSecondary}>Edit</button>
                      <span style={{ fontSize: '18px', color: '#8899aa' }}>{isExpanded ? '\u25B2' : '\u25BC'}</span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                      {(itemsByEmployee[emp.id] || []).length === 0 ? (
                        <div style={{ color: '#556677', fontSize: '13px' }}>No compliance items</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {(itemsByEmployee[emp.id] || []).map(item => (
                            <div key={item.id} style={{
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              padding: '8px 12px', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '6px'
                            }}>
                              <span style={{ fontSize: '13px' }}>
                                {COMPLIANCE_CATEGORIES[item.category]?.icon} {COMPLIANCE_CATEGORIES[item.category]?.label || item.category}
                                {item.subtype && <span style={{ color: '#8899aa' }}> ({item.subtype})</span>}
                              </span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '12px', color: '#8899aa' }}>Due: {formatDateShort(item.dueDate)}</span>
                                {statusBadge(getStatus(item.dueDate))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#556677' }}>No employees found</div>
        )}
      </div>
    </div>
  )
}

// ─── SUB-TAB: ITEMS ────────────────────────────────────────────────────────────
function ItemsTab({ employees, complianceItems, siteOptions }) {
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [siteFilter, setSiteFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [adding, setAdding] = useState(false)
  const [addForm, setAddForm] = useState({ employeeId: '', category: 'fpcc', subtype: '', lastCompleted: '', dueDate: '', notes: '' })

  const employeeMap = useMemo(() => {
    const m = {}
    employees.forEach(e => { m[e.id] = e })
    return m
  }, [employees])

  const filtered = complianceItems.filter(item => {
    const emp = employeeMap[item.employeeId]
    if (!emp) return false
    if (categoryFilter !== 'all' && item.category !== categoryFilter) return false
    if (siteFilter !== 'all') {
      if (emp.site !== siteFilter) return false
    }
    if (statusFilter !== 'all') {
      const s = getStatus(item.dueDate)
      if (statusFilter === 'overdue' && s !== 'overdue') return false
      if (statusFilter === 'upcoming' && s !== 'upcoming') return false
      if (statusFilter === 'current' && s !== 'current') return false
    }
    return true
  })

  const handleSaveEdit = async () => {
    const updates = { updatedAt: serverTimestamp() }
    if (editForm.lastCompleted) updates.lastCompleted = Timestamp.fromDate(new Date(editForm.lastCompleted))
    else updates.lastCompleted = null
    if (editForm.dueDate) updates.dueDate = Timestamp.fromDate(new Date(editForm.dueDate))
    else updates.dueDate = null
    updates.notes = editForm.notes || ''
    await updateDoc(doc(db, 'complianceItems', editingId), updates)
    setEditingId(null)
    notifySuccess('Compliance item updated')
  }

  const handleAdd = async () => {
    if (!addForm.employeeId) return alert('Select an employee')
    const emp = employeeMap[addForm.employeeId]
    await addDoc(collection(db, 'complianceItems'), {
      employeeId: addForm.employeeId,
      employeeName: emp?.name || '',
      employeeSite: emp?.site || null,
      category: addForm.category,
      subtype: addForm.subtype || null,
      lastCompleted: addForm.lastCompleted ? Timestamp.fromDate(new Date(addForm.lastCompleted)) : null,
      dueDate: addForm.dueDate ? Timestamp.fromDate(new Date(addForm.dueDate)) : null,
      notes: addForm.notes || '',
      source: 'manual',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    })
    setAddForm({ employeeId: '', category: 'fpcc', subtype: '', lastCompleted: '', dueDate: '', notes: '' })
    setAdding(false)
    notifySuccess('Compliance item added')
  }

  const handleDelete = async (itemId) => {
    if (!confirm('Delete this compliance item?')) return
    await deleteDoc(doc(db, 'complianceItems', itemId))
    notifySuccess('Compliance item deleted')
  }

  const tsToInputDate = (ts) => {
    if (!ts) return ''
    const d = ts.toDate ? ts.toDate() : new Date(ts)
    if (isNaN(d)) return ''
    return d.toISOString().split('T')[0]
  }

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <select style={{ ...inputStyle, width: 'auto', minWidth: '160px' }} value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
          <option value="all">All Categories</option>
          {CATEGORY_KEYS.map(k => <option key={k} value={k}>{COMPLIANCE_CATEGORIES[k].icon} {COMPLIANCE_CATEGORIES[k].label}</option>)}
        </select>
        <select style={{ ...inputStyle, width: 'auto', minWidth: '100px' }} value={siteFilter} onChange={e => setSiteFilter(e.target.value)}>
          <option value="all">All Sites</option>
          {siteOptions.map(site => <option key={site} value={site}>{site}</option>)}
        </select>
        <select style={{ ...inputStyle, width: 'auto', minWidth: '130px' }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All Status</option>
          <option value="overdue">Overdue</option>
          <option value="upcoming">Due in 30 days</option>
          <option value="current">Current</option>
        </select>
        <button onClick={() => setAdding(!adding)} style={btnPrimary}>+ Add Item</button>
      </div>

      {/* Add form */}
      {adding && (
        <div style={{ ...cardStyle, border: '2px solid #E53935' }}>
          <h4 style={{ margin: '0 0 12px 0', color: '#e8e8e8' }}>Add Compliance Item</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Employee *</label>
              <select style={inputStyle} value={addForm.employeeId} onChange={e => setAddForm({ ...addForm, employeeId: e.target.value })}>
                <option value="">Select...</option>
                {employees.filter(e => e.active !== false).map(e => <option key={e.id} value={e.id}>{e.name} ({e.site})</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Category *</label>
              <select style={inputStyle} value={addForm.category} onChange={e => setAddForm({ ...addForm, category: e.target.value })}>
                {CATEGORY_KEYS.map(k => <option key={k} value={k}>{COMPLIANCE_CATEGORIES[k].label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Subtype</label>
              <input style={inputStyle} value={addForm.subtype} onChange={e => setAddForm({ ...addForm, subtype: e.target.value })} placeholder="e.g., 90_day" />
            </div>
            <div>
              <label style={labelStyle}>Last Completed</label>
              <input type="date" style={inputStyle} value={addForm.lastCompleted} onChange={e => setAddForm({ ...addForm, lastCompleted: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Due Date</label>
              <input type="date" style={inputStyle} value={addForm.dueDate} onChange={e => setAddForm({ ...addForm, dueDate: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Notes</label>
              <input style={inputStyle} value={addForm.notes} onChange={e => setAddForm({ ...addForm, notes: e.target.value })} placeholder="Optional" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button onClick={handleAdd} style={btnPrimary}>Save</button>
            <button onClick={() => setAdding(false)} style={btnCancel}>Cancel</button>
          </div>
        </div>
      )}

      {/* Items list */}
      <div style={{ fontSize: '13px', color: '#8899aa', marginBottom: '8px' }}>{filtered.length} items</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {filtered.map(item => {
          const s = getStatus(item.dueDate)
          const isEditing = editingId === item.id

          if (isEditing) {
            return (
              <div key={item.id} style={{ ...cardStyle, border: '2px solid #E53935', marginBottom: '0' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                  <div>
                    <label style={labelStyle}>Last Completed</label>
                    <input type="date" style={inputStyle} value={editForm.lastCompleted || ''} onChange={e => setEditForm({ ...editForm, lastCompleted: e.target.value })} />
                  </div>
                  <div>
                    <label style={labelStyle}>Due Date</label>
                    <input type="date" style={inputStyle} value={editForm.dueDate || ''} onChange={e => setEditForm({ ...editForm, dueDate: e.target.value })} />
                  </div>
                  <div>
                    <label style={labelStyle}>Notes</label>
                    <input style={inputStyle} value={editForm.notes || ''} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <button onClick={handleSaveEdit} style={btnPrimary}>Save</button>
                  <button onClick={() => setEditingId(null)} style={btnCancel}>Cancel</button>
                </div>
              </div>
            )
          }

          return (
            <div key={item.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 16px', borderRadius: '8px',
              border: s === 'overdue' ? '2px solid #f44336' : '1px solid rgba(255,255,255,0.08)',
              backgroundColor: 'rgba(255,255,255,0.03)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 'bold', fontSize: '14px', minWidth: '140px' }}>{item.employeeName}</span>
                <span style={{ fontSize: '13px' }}>
                  {COMPLIANCE_CATEGORIES[item.category]?.icon} {COMPLIANCE_CATEGORIES[item.category]?.label || item.category}
                  {item.subtype && <span style={{ color: '#8899aa' }}> ({item.subtype})</span>}
                </span>
                {item.notes && <span style={{ fontSize: '12px', color: '#8899aa', fontStyle: 'italic' }}>{item.notes}</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                <span style={{ fontSize: '12px', color: '#8899aa' }}>Due: {formatDateShort(item.dueDate)}</span>
                {statusBadge(s)}
                <button onClick={() => {
                  setEditingId(item.id)
                  setEditForm({
                    lastCompleted: tsToInputDate(item.lastCompleted),
                    dueDate: tsToInputDate(item.dueDate),
                    notes: item.notes || ''
                  })
                }} style={btnSecondary}>Edit</button>
                <button onClick={() => handleDelete(item.id)} style={{ ...btnSecondary, backgroundColor: '#c62828', fontSize: '11px', padding: '6px 10px' }}>X</button>
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#556677' }}>No items found</div>
        )}
      </div>
    </div>
  )
}

// ─── SUB-TAB: CINTAS ───────────────────────────────────────────────────────────
function CintasTab({ cintasServices }) {
  const [editingId, setEditingId] = useState(null)
  const [editDate, setEditDate] = useState('')
  const [adding, setAdding] = useState(false)
  const [addForm, setAddForm] = useState({ siteAddress: '', serviceType: '', monthDue: '', fiveYearNote: '' })

  const grouped = useMemo(() => {
    const map = {}
    cintasServices.forEach(s => {
      const addr = s.siteAddress || 'Unknown'
      if (!map[addr]) map[addr] = []
      map[addr].push(s)
    })
    return map
  }, [cintasServices])

  const handleSaveDate = async (id) => {
    await updateDoc(doc(db, 'cintasServices', id), {
      lastCompleted: editDate ? Timestamp.fromDate(new Date(editDate)) : null,
      updatedAt: serverTimestamp()
    })
    setEditingId(null)
    notifySuccess('Service date saved')
  }

  const handleAdd = async () => {
    if (!addForm.siteAddress.trim() || !addForm.serviceType.trim()) return alert('Address and service type required')
    await addDoc(collection(db, 'cintasServices'), {
      siteAddress: addForm.siteAddress.trim(),
      serviceType: addForm.serviceType.trim(),
      monthDue: addForm.monthDue || '',
      lastCompleted: null,
      fiveYearNote: addForm.fiveYearNote || null,
      source: 'manual',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    })
    setAddForm({ siteAddress: '', serviceType: '', monthDue: '', fiveYearNote: '' })
    setAdding(false)
    notifySuccess('Cintas service added')
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this service?')) return
    await deleteDoc(doc(db, 'cintasServices', id))
    notifySuccess('Cintas service deleted')
  }

  const tsToInputDate = (ts) => {
    if (!ts) return ''
    const d = ts.toDate ? ts.toDate() : new Date(ts)
    if (isNaN(d)) return ''
    return d.toISOString().split('T')[0]
  }

  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <button onClick={() => setAdding(!adding)} style={btnPrimary}>+ Add Service</button>
      </div>

      {adding && (
        <div style={{ ...cardStyle, border: '2px solid #E53935' }}>
          <h4 style={{ margin: '0 0 12px 0', color: '#e8e8e8' }}>Add Cintas Service</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Site Address *</label>
              <input style={inputStyle} value={addForm.siteAddress} onChange={e => setAddForm({ ...addForm, siteAddress: e.target.value })} placeholder="Building address" />
            </div>
            <div>
              <label style={labelStyle}>Service Type *</label>
              <input style={inputStyle} value={addForm.serviceType} onChange={e => setAddForm({ ...addForm, serviceType: e.target.value })} placeholder="e.g., Extinguishers" />
            </div>
            <div>
              <label style={labelStyle}>Month Due</label>
              <input style={inputStyle} value={addForm.monthDue} onChange={e => setAddForm({ ...addForm, monthDue: e.target.value })} placeholder="e.g., May" />
            </div>
            <div>
              <label style={labelStyle}>5-Year Note</label>
              <input style={inputStyle} value={addForm.fiveYearNote} onChange={e => setAddForm({ ...addForm, fiveYearNote: e.target.value })} placeholder="Optional" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button onClick={handleAdd} style={btnPrimary}>Save</button>
            <button onClick={() => setAdding(false)} style={btnCancel}>Cancel</button>
          </div>
        </div>
      )}

      {Object.keys(grouped).length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px', color: '#556677' }}>No Cintas services</div>
      )}

      {Object.entries(grouped).map(([address, services]) => (
        <div key={address} style={{ ...cardStyle }}>
          <h4 style={{ margin: '0 0 12px 0', color: '#e8e8e8', fontSize: '15px' }}>{address}</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {services.map(svc => (
              <div key={svc.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 14px', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '6px',
                border: '1px solid rgba(255,255,255,0.06)'
              }}>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 'bold', fontSize: '14px' }}>{svc.serviceType}</span>
                  {svc.monthDue && <span style={{ fontSize: '12px', color: '#8899aa' }}>Due: {svc.monthDue}</span>}
                  <span style={{ fontSize: '12px', color: '#8899aa' }}>Last: {formatDateShort(svc.lastCompleted)}</span>
                  {svc.fiveYearNote && <span style={{ fontSize: '11px', color: '#FF9800' }}>{svc.fiveYearNote}</span>}
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  {editingId === svc.id ? (
                    <>
                      <input type="date" style={{ ...inputStyle, width: '150px' }} value={editDate} onChange={e => setEditDate(e.target.value)} />
                      <button onClick={() => handleSaveDate(svc.id)} style={{ ...btnPrimary, padding: '6px 12px', fontSize: '12px' }}>Save</button>
                      <button onClick={() => setEditingId(null)} style={{ ...btnCancel, padding: '6px 12px', fontSize: '12px' }}>X</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => { setEditingId(svc.id); setEditDate(tsToInputDate(svc.lastCompleted)) }} style={btnSecondary}>Edit Date</button>
                      <button onClick={() => handleDelete(svc.id)} style={{ ...btnSecondary, backgroundColor: '#c62828', fontSize: '11px', padding: '6px 10px' }}>X</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── SUB-TAB: IMPORT ───────────────────────────────────────────────────────────
function ImportTab() {
  const [compliancePreview, setCompliancePreview] = useState(null)
  const [cintasPreview, setCintasPreview] = useState(null)
  const [importing, setImporting] = useState(false)
  const [status, setStatus] = useState('')

  const parseComplianceFile = (file) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const employees = new Map() // name -> { name, site }
        const items = [] // { employeeName, category, subtype, lastCompleted, dueDate, notes }

        const parseSheet = (sheetName, category, extractor) => {
          const ws = wb.Sheets[sheetName]
          if (!ws) return
          const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
          let currentSite = 'RTC'

          for (let r = 0; r < data.length; r++) {
            const row = data[r]
            if (!row || row.length === 0) continue

            const firstCell = String(row[0] || '').trim()

            // Detect site headers
            if (/\bOTC\b/i.test(firstCell) && !/\bRTC\b/i.test(firstCell)) { currentSite = 'OTC'; continue }
            if (/\bRTC\b/i.test(firstCell) && !/\bOTC\b/i.test(firstCell)) { currentSite = 'RTC'; continue }

            // Skip header rows and empty rows
            if (!firstCell || /^(name|employee)/i.test(firstCell)) continue

            // Check if this looks like an employee name (not a number, has letters)
            if (!/[a-zA-Z]/.test(firstCell)) continue

            const name = firstCell
            if (!employees.has(name)) {
              employees.set(name, { name, site: currentSite })
            }

            const extracted = extractor(row, data[0] || [], r, data)
            if (extracted) {
              const extractedArr = Array.isArray(extracted) ? extracted : [extracted]
              extractedArr.forEach(item => {
                items.push({ employeeName: name, category, ...item })
              })
            }
          }
        }

        // FPCC
        parseSheet('FPCC', 'fpcc', (row) => {
          const results = []
          // Main FPCC item - look for expiration date (often col 1 or 2)
          if (row[1] && typeof row[1] === 'number') results.push({ subtype: null, dueDate: excelDateToJS(row[1]), lastCompleted: null, notes: '' })
          else if (row[2] && typeof row[2] === 'number') results.push({ subtype: null, dueDate: excelDateToJS(row[2]), lastCompleted: null, notes: '' })
          // Bi-annual verification
          for (let c = 2; c < row.length; c++) {
            if (row[c] && typeof row[c] === 'number' && results.length > 0 && c > (results[0].dueDate ? 2 : 1)) {
              results.push({ subtype: 'bi_annual_verification', dueDate: excelDateToJS(row[c]), lastCompleted: null, notes: '' })
              break
            }
          }
          return results.length > 0 ? results : null
        })

        // TB Test
        parseSheet('TB Test', 'tb_test', (row) => {
          let lastCompleted = null, dueDate = null, notes = ''
          for (let c = 1; c < row.length; c++) {
            if (typeof row[c] === 'number' && row[c] > 1000) {
              if (!lastCompleted) lastCompleted = excelDateToJS(row[c])
              else if (!dueDate) dueDate = excelDateToJS(row[c])
            } else if (typeof row[c] === 'string' && row[c].trim()) {
              notes = row[c].trim()
            }
          }
          return lastCompleted || dueDate ? { subtype: null, lastCompleted, dueDate, notes } : null
        })

        // CPR & First Aid
        parseSheet('CPR & First Aid', 'cpr_first_aid', (row) => {
          let lastCompleted = null, dueDate = null
          for (let c = 1; c < row.length; c++) {
            if (typeof row[c] === 'number' && row[c] > 1000) {
              if (!lastCompleted) lastCompleted = excelDateToJS(row[c])
              else if (!dueDate) dueDate = excelDateToJS(row[c])
            }
          }
          return lastCompleted || dueDate ? { subtype: null, lastCompleted, dueDate, notes: '' } : null
        })

        // Food Handlers
        parseSheet('Food Handlers', 'food_handlers', (row) => {
          let lastCompleted = null, dueDate = null
          for (let c = 1; c < row.length; c++) {
            if (typeof row[c] === 'number' && row[c] > 1000) {
              if (!lastCompleted) lastCompleted = excelDateToJS(row[c])
              else if (!dueDate) dueDate = excelDateToJS(row[c])
            }
          }
          return lastCompleted || dueDate ? { subtype: null, lastCompleted, dueDate, notes: '' } : null
        })

        // Drivers License
        parseSheet('Drivers License', 'drivers_license', (row) => {
          const results = []
          let dueDate = null, issDate = ''
          for (let c = 1; c < row.length; c++) {
            if (typeof row[c] === 'number' && row[c] > 1000) {
              if (!dueDate) dueDate = excelDateToJS(row[c])
              else if (!issDate) issDate = formatDateShort(Timestamp.fromDate(excelDateToJS(row[c])))
            } else if (typeof row[c] === 'string' && /mvd/i.test(row[c])) {
              results.push({ subtype: 'mvd_record', lastCompleted: null, dueDate: null, notes: row[c].trim() })
            } else if (typeof row[c] === 'string' && /policy/i.test(row[c])) {
              results.push({ subtype: 'policy_signed', lastCompleted: null, dueDate: null, notes: row[c].trim() })
            }
          }
          if (dueDate) results.unshift({ subtype: null, lastCompleted: null, dueDate, notes: issDate ? `Iss: ${issDate}` : '' })
          return results.length > 0 ? results : null
        })

        // Annual Orientation
        parseSheet('Annual Orientation', 'annual_orientation', (row) => {
          const results = []
          const subtypes = ['initial', '1st_annual', '2nd_annual']
          let subtypeIdx = 0
          for (let c = 1; c < row.length; c++) {
            if (typeof row[c] === 'number' && row[c] > 1000) {
              results.push({ subtype: subtypes[subtypeIdx] || `year_${subtypeIdx + 1}`, lastCompleted: excelDateToJS(row[c]), dueDate: null, notes: '' })
              subtypeIdx++
            }
          }
          return results.length > 0 ? results : null
        })

        // Performance Evaluation
        parseSheet('Performance Evaluation', 'performance_evaluation', (row) => {
          const results = []
          const subtypes = ['90_day', '1st_annual', '2nd_annual', '3rd_annual']
          let subtypeIdx = 0
          for (let c = 1; c < row.length; c++) {
            if (typeof row[c] === 'number' && row[c] > 1000) {
              results.push({ subtype: subtypes[subtypeIdx] || `eval_${subtypeIdx + 1}`, lastCompleted: excelDateToJS(row[c]), dueDate: null, notes: '' })
              subtypeIdx++
            }
          }
          return results.length > 0 ? results : null
        })

        // Misc sheet - Education & Resume
        const miscSheet = wb.Sheets['Misc'] || wb.Sheets['MISC'] || wb.Sheets['misc']
        if (miscSheet) {
          const miscData = XLSX.utils.sheet_to_json(miscSheet, { header: 1, defval: '' })
          let currentSite = 'RTC'
          for (let r = 0; r < miscData.length; r++) {
            const row = miscData[r]
            if (!row || row.length === 0) continue
            const firstCell = String(row[0] || '').trim()
            if (/\bOTC\b/i.test(firstCell)) { currentSite = 'OTC'; continue }
            if (/\bRTC\b/i.test(firstCell)) { currentSite = 'RTC'; continue }
            if (!firstCell || /^(name|employee)/i.test(firstCell) || !/[a-zA-Z]/.test(firstCell)) continue

            const name = firstCell
            if (!employees.has(name)) employees.set(name, { name, site: currentSite })

            // Try to parse education and resume columns
            const edParts = []
            const resParts = []
            for (let c = 1; c < row.length; c++) {
              const val = String(row[c] || '').trim()
              if (/degree|diploma|ged|college|university|school/i.test(val)) edParts.push(val)
              if (/resume|reference/i.test(val)) resParts.push(val)
            }
            if (edParts.length > 0) items.push({ employeeName: name, category: 'education', subtype: null, lastCompleted: null, dueDate: null, notes: edParts.join(', ') })
            if (resParts.length > 0) items.push({ employeeName: name, category: 'resume', subtype: null, lastCompleted: null, dueDate: null, notes: resParts.join(', ') })
          }
        }

        setCompliancePreview({ employees: [...employees.values()], items, sheetNames: wb.SheetNames })
      } catch (err) {
        console.error('Parse error:', err)
        alert('Error parsing file: ' + err.message)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const parseCintasFile = (file) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const services = []

        wb.SheetNames.forEach(sheetName => {
          const ws = wb.Sheets[sheetName]
          if (!ws) return
          const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
          let currentAddress = ''

          for (let r = 0; r < data.length; r++) {
            const row = data[r]
            if (!row || row.length === 0) continue
            const first = String(row[0] || '').trim()

            // Address rows typically have a street number or "address" keyword
            if (/^\d+\s/.test(first) || /address/i.test(first)) {
              if (/^\d+\s/.test(first)) currentAddress = first
              continue
            }

            // Service rows
            if (!first || /^(service|type)/i.test(first)) continue

            const serviceType = first
            let monthDue = '', lastCompleted = null, fiveYearNote = null

            for (let c = 1; c < row.length; c++) {
              const val = row[c]
              if (typeof val === 'number' && val > 1000) {
                lastCompleted = excelDateToJS(val)
              } else if (typeof val === 'string') {
                const trimmed = val.trim()
                if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(trimmed)) {
                  monthDue = trimmed
                } else if (/\d\s*yr/i.test(trimmed)) {
                  fiveYearNote = trimmed
                }
              }
            }

            if (serviceType && currentAddress) {
              services.push({ siteAddress: currentAddress, serviceType, monthDue, lastCompleted, fiveYearNote })
            }
          }
        })

        setCintasPreview({ services, sheetNames: wb.SheetNames })
      } catch (err) {
        console.error('Cintas parse error:', err)
        alert('Error parsing file: ' + err.message)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const handleComplianceFileChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setCompliancePreview(null)
    parseComplianceFile(file)
  }

  const handleCintasFileChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setCintasPreview(null)
    parseCintasFile(file)
  }

  const importCompliance = async () => {
    if (!compliancePreview) return
    setImporting(true)
    setStatus('Importing employees...')

    try {
      const batch = writeBatch(db)
      const empMap = new Map() // name -> docRef

      // Create employees
      for (const emp of compliancePreview.employees) {
        const ref = doc(collection(db, 'complianceEmployees'))
        empMap.set(emp.name, ref.id)
        batch.set(ref, {
          name: emp.name,
          site: emp.site,
          active: true,
          linkedUserId: null,
          createdAt: serverTimestamp()
        })
      }

      await batch.commit()
      setStatus(`Imported ${compliancePreview.employees.length} employees. Importing items...`)

      // Import items in batches of 400 (Firestore limit is 500 per batch)
      const allItems = compliancePreview.items
      for (let i = 0; i < allItems.length; i += 400) {
        const chunk = allItems.slice(i, i + 400)
        const itemBatch = writeBatch(db)

        for (const item of chunk) {
          const empId = empMap.get(item.employeeName) || ''
          const ref = doc(collection(db, 'complianceItems'))
          itemBatch.set(ref, {
            employeeId: empId,
            employeeName: item.employeeName,
            category: item.category,
            subtype: item.subtype || null,
            lastCompleted: toTimestamp(item.lastCompleted),
            dueDate: toTimestamp(item.dueDate),
            notes: item.notes || '',
            source: 'import',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          })
        }

        await itemBatch.commit()
        setStatus(`Imported ${Math.min(i + 400, allItems.length)} / ${allItems.length} items...`)
      }

      setStatus(`Done! ${compliancePreview.employees.length} employees, ${allItems.length} items imported.`)
      setCompliancePreview(null)
    } catch (err) {
      console.error('Import error:', err)
      setStatus('Error: ' + err.message)
    }
    setImporting(false)
  }

  const importCintas = async () => {
    if (!cintasPreview) return
    setImporting(true)
    setStatus('Importing Cintas services...')

    try {
      const allServices = cintasPreview.services
      for (let i = 0; i < allServices.length; i += 400) {
        const chunk = allServices.slice(i, i + 400)
        const batch = writeBatch(db)

        for (const svc of chunk) {
          const ref = doc(collection(db, 'cintasServices'))
          batch.set(ref, {
            siteAddress: svc.siteAddress,
            serviceType: svc.serviceType,
            monthDue: svc.monthDue || '',
            lastCompleted: toTimestamp(svc.lastCompleted),
            fiveYearNote: svc.fiveYearNote || null,
            source: 'import',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          })
        }

        await batch.commit()
        setStatus(`Imported ${Math.min(i + 400, allServices.length)} / ${allServices.length} services...`)
      }

      setStatus(`Done! ${allServices.length} Cintas services imported.`)
      setCintasPreview(null)
    } catch (err) {
      console.error('Cintas import error:', err)
      setStatus('Error: ' + err.message)
    }
    setImporting(false)
  }

  return (
    <div>
      <p style={{ color: '#8899aa', marginBottom: '20px', fontSize: '14px' }}>
        Upload Excel workbooks to import compliance data. Preview data before committing.
      </p>

      {status && (
        <div style={{
          padding: '12px 16px', borderRadius: '8px', marginBottom: '16px',
          backgroundColor: status.startsWith('Error') ? 'rgba(244,67,54,0.15)' : 'rgba(76,175,80,0.15)',
          border: `1px solid ${status.startsWith('Error') ? 'rgba(244,67,54,0.3)' : 'rgba(76,175,80,0.3)'}`,
          color: status.startsWith('Error') ? '#f44336' : '#4CAF50',
          fontSize: '14px'
        }}>
          {status}
        </div>
      )}

      {/* Employee Compliance Import */}
      <div style={cardStyle}>
        <h4 style={{ margin: '0 0 12px 0', color: '#e8e8e8' }}>Employee Compliance</h4>
        <p style={{ fontSize: '13px', color: '#8899aa', marginBottom: '12px' }}>
          Upload the employee compliance Excel file (with sheets: FPCC, TB Test, CPR & First Aid, etc.)
        </p>
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={handleComplianceFileChange}
          style={{ marginBottom: '12px', color: '#e8e8e8' }}
        />

        {compliancePreview && (
          <div style={{ marginTop: '12px' }}>
            <div style={{ fontSize: '14px', marginBottom: '8px', color: '#e8e8e8' }}>
              Sheets found: {compliancePreview.sheetNames.join(', ')}
            </div>
            <div style={{ display: 'flex', gap: '16px', marginBottom: '12px' }}>
              <div style={{ padding: '8px 16px', backgroundColor: 'rgba(76,175,80,0.15)', borderRadius: '6px' }}>
                <span style={{ fontSize: '12px', color: '#8899aa' }}>Employees: </span>
                <span style={{ fontWeight: 'bold', color: '#4CAF50' }}>{compliancePreview.employees.length}</span>
              </div>
              <div style={{ padding: '8px 16px', backgroundColor: 'rgba(76,175,80,0.15)', borderRadius: '6px' }}>
                <span style={{ fontSize: '12px', color: '#8899aa' }}>Items: </span>
                <span style={{ fontWeight: 'bold', color: '#4CAF50' }}>{compliancePreview.items.length}</span>
              </div>
            </div>

            {/* Preview table */}
            <div style={{ maxHeight: '300px', overflow: 'auto', marginBottom: '12px' }}>
              <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <th style={{ padding: '6px 8px', textAlign: 'left', color: '#8899aa' }}>Employee</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', color: '#8899aa' }}>Category</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', color: '#8899aa' }}>Subtype</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', color: '#8899aa' }}>Due Date</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', color: '#8899aa' }}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {compliancePreview.items.slice(0, 50).map((item, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '4px 8px' }}>{item.employeeName}</td>
                      <td style={{ padding: '4px 8px' }}>{COMPLIANCE_CATEGORIES[item.category]?.label || item.category}</td>
                      <td style={{ padding: '4px 8px', color: '#8899aa' }}>{item.subtype || '--'}</td>
                      <td style={{ padding: '4px 8px' }}>{item.dueDate ? item.dueDate.toLocaleDateString() : '--'}</td>
                      <td style={{ padding: '4px 8px', color: '#8899aa' }}>{item.notes || '--'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {compliancePreview.items.length > 50 && (
                <div style={{ padding: '8px', color: '#8899aa', fontSize: '12px' }}>...and {compliancePreview.items.length - 50} more items</div>
              )}
            </div>

            <button onClick={importCompliance} disabled={importing} style={{ ...btnPrimary, opacity: importing ? 0.5 : 1 }}>
              {importing ? 'Importing...' : `Import ${compliancePreview.employees.length} Employees & ${compliancePreview.items.length} Items`}
            </button>
          </div>
        )}
      </div>

      {/* Cintas Import */}
      <div style={cardStyle}>
        <h4 style={{ margin: '0 0 12px 0', color: '#e8e8e8' }}>Cintas Services</h4>
        <p style={{ fontSize: '13px', color: '#8899aa', marginBottom: '12px' }}>
          Upload the Cintas building services Excel file.
        </p>
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={handleCintasFileChange}
          style={{ marginBottom: '12px', color: '#e8e8e8' }}
        />

        {cintasPreview && (
          <div style={{ marginTop: '12px' }}>
            <div style={{ fontSize: '14px', marginBottom: '8px', color: '#e8e8e8' }}>
              Sheets found: {cintasPreview.sheetNames.join(', ')}
            </div>
            <div style={{ padding: '8px 16px', backgroundColor: 'rgba(76,175,80,0.15)', borderRadius: '6px', display: 'inline-block', marginBottom: '12px' }}>
              <span style={{ fontSize: '12px', color: '#8899aa' }}>Services: </span>
              <span style={{ fontWeight: 'bold', color: '#4CAF50' }}>{cintasPreview.services.length}</span>
            </div>

            <div style={{ maxHeight: '300px', overflow: 'auto', marginBottom: '12px' }}>
              <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <th style={{ padding: '6px 8px', textAlign: 'left', color: '#8899aa' }}>Address</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', color: '#8899aa' }}>Service</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', color: '#8899aa' }}>Month Due</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', color: '#8899aa' }}>Last Completed</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', color: '#8899aa' }}>5-Yr Note</th>
                  </tr>
                </thead>
                <tbody>
                  {cintasPreview.services.slice(0, 50).map((svc, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '4px 8px' }}>{svc.siteAddress}</td>
                      <td style={{ padding: '4px 8px' }}>{svc.serviceType}</td>
                      <td style={{ padding: '4px 8px' }}>{svc.monthDue || '--'}</td>
                      <td style={{ padding: '4px 8px' }}>{svc.lastCompleted ? svc.lastCompleted.toLocaleDateString() : '--'}</td>
                      <td style={{ padding: '4px 8px', color: '#8899aa' }}>{svc.fiveYearNote || '--'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button onClick={importCintas} disabled={importing} style={{ ...btnPrimary, opacity: importing ? 0.5 : 1 }}>
              {importing ? 'Importing...' : `Import ${cintasPreview.services.length} Services`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── MAIN COMPLIANCE PANEL ─────────────────────────────────────────────────────
function CompliancePanel({ user, scopeSites = null }) {
  const [subTab, setSubTab] = useState('employees')
  const [employees, setEmployees] = useState([])
  const [complianceItems, setComplianceItems] = useState([])
  const [cintasServices, setCintasServices] = useState([])
  const isAdmin = user?.role === 'admin'
  const normalizedScopeSites = useMemo(() => {
    if (!Array.isArray(scopeSites)) return []
    return [...new Set(scopeSites.map(s => String(s || '').trim().toUpperCase()).filter(Boolean))]
  }, [scopeSites])
  const scopeSiteSet = useMemo(() => new Set(normalizedScopeSites), [normalizedScopeSites])
  const siteOptions = normalizedScopeSites.length > 0 ? normalizedScopeSites : ['RTC', 'OTC']
  const hasComplianceScope = isAdmin || normalizedScopeSites.length > 0

  // Real-time listeners
  useEffect(() => {
    if (!hasComplianceScope) return () => {}

    const unsub1 = onSnapshot(
      query(collection(db, 'complianceEmployees'), orderBy('name', 'asc')),
      snap => {
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        setEmployees(rows.filter(e => isAdmin || scopeSiteSet.has(String(e.site || '').trim().toUpperCase())))
      }
    )
    const unsub2 = onSnapshot(
      query(collection(db, 'complianceItems'), orderBy('employeeName', 'asc')),
      snap => setComplianceItems(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    const unsub3 = isAdmin
      ? onSnapshot(
          query(collection(db, 'cintasServices'), orderBy('siteAddress', 'asc')),
          snap => setCintasServices(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        )
      : () => {}
    return () => { unsub1(); unsub2(); unsub3() }
  }, [hasComplianceScope, isAdmin, scopeSiteSet])

  const subTabs = useMemo(() => (isAdmin
    ? {
        employees: 'Employees',
        items: 'Items',
        cintas: 'Cintas',
        import: 'Import'
      }
    : {
        employees: 'Employees',
        items: 'Items'
      }
  ), [isAdmin])
  const activeSubTab = Object.prototype.hasOwnProperty.call(subTabs, subTab) ? subTab : 'employees'
  const scopedEmployees = hasComplianceScope ? employees : []
  const scopedComplianceItems = hasComplianceScope ? complianceItems : []
  const scopedCintasServices = hasComplianceScope && isAdmin ? cintasServices : []

  return (
    <div>
      {!hasComplianceScope && (
        <div style={{
          padding: '16px',
          borderRadius: '10px',
          backgroundColor: 'rgba(255,152,0,0.15)',
          border: '1px solid rgba(255,152,0,0.3)',
          color: '#FF9800',
          fontSize: '13px'
        }}>
          No compliance site scope is configured for this account.
        </div>
      )}

      {hasComplianceScope && (
        <>
      {/* Sub-tab navigation */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {Object.entries(subTabs).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSubTab(key)}
            style={{
              padding: '8px 18px',
              backgroundColor: activeSubTab === key ? '#E53935' : 'rgba(255,255,255,0.06)',
              color: activeSubTab === key ? 'white' : '#8899aa',
              border: 'none',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 'bold',
              cursor: 'pointer'
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {activeSubTab === 'employees' && <EmployeesTab employees={scopedEmployees} complianceItems={scopedComplianceItems} siteOptions={siteOptions} />}
      {activeSubTab === 'items' && <ItemsTab employees={scopedEmployees} complianceItems={scopedComplianceItems} siteOptions={siteOptions} />}
      {activeSubTab === 'cintas' && <CintasTab cintasServices={scopedCintasServices} />}
      {activeSubTab === 'import' && <ImportTab />}
        </>
      )}
    </div>
  )
}

export default CompliancePanel

