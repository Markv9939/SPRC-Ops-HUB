import { useState, useEffect, useMemo } from 'react'
import { db } from '../firebase'
import {
  collection, query, orderBy, onSnapshot,
  doc, addDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp
} from 'firebase/firestore'
import { notifySuccess } from '../utils/toast'
import { showConfirmDialog } from '../utils/dialogs'
import { getStatus } from '../utils/complianceStatus'
import { MAIN_LOCATIONS, normalizeMainLocation } from '../utils/orgModel'

const COMPLIANCE_CATEGORIES = {
  fpcc: { label: 'FPCC', icon: '\u{1FAAA}' },
  tb_test: { label: 'TB Test', icon: '\u{1FA7A}' },
  cpr_first_aid: { label: 'CPR & First Aid', icon: '\u2764\uFE0F' },
  food_handlers: { label: 'Food Handlers', icon: '\u{1F37D}\uFE0F' },
  drivers_license: { label: "Driver's License", icon: '\u{1F697}' },
  annual_orientation: { label: 'Annual Orientation', icon: '\u{1F4C5}' },
  performance_evaluation: { label: 'Performance Evaluation', icon: '\u{1F4DD}' },
  education: { label: 'Education Verification', icon: '\u{1F393}' },
  resume: { label: 'Resume', icon: '\u{1F4C4}' },
  cintas: { label: 'Cintas', icon: '\u{1F9FC}' },
  fire_safety: { label: 'Fire Safety', icon: '\u{1F9EF}' }
}

const CATEGORY_KEYS = Object.keys(COMPLIANCE_CATEGORIES)
const LOCATION_ONLY_CATEGORIES = ['cintas', 'fire_safety']

function isLocationCategory(category) {
  return LOCATION_ONLY_CATEGORIES.includes(String(category || '').trim())
}

function requiresEmployee(category) {
  return !isLocationCategory(category)
}

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
  const defaultSite = siteOptions[0] || 'OTC'
  const [search, setSearch] = useState('')
  const [siteFilter, setSiteFilter] = useState('All')
  const [expandedId, setExpandedId] = useState(null)
  const [isAddWizardOpen, setIsAddWizardOpen] = useState(false)
  const [addWizardStep, setAddWizardStep] = useState(1)
  const [addDraft, setAddDraft] = useState({ name: '', site: defaultSite })
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', site: defaultSite, active: true })

  useEffect(() => {
    if (!siteOptions.includes(addDraft.site)) {
      setAddDraft(prev => ({ ...prev, site: defaultSite }))
    }
    if (!siteOptions.includes(editForm.site)) {
      setEditForm(prev => ({ ...prev, site: defaultSite }))
    }
  }, [addDraft.site, defaultSite, editForm.site, siteOptions])

  const maxAddWizardStep = 3

  const resetAddWizard = () => {
    setAddWizardStep(1)
    setAddDraft({ name: '', site: defaultSite })
  }

  const openAddWizard = () => {
    resetAddWizard()
    setIsAddWizardOpen(true)
  }

  const closeAddWizard = () => {
    setIsAddWizardOpen(false)
    resetAddWizard()
  }

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
    const trimmedName = String(addDraft.name || '').trim()
    if (!trimmedName) return alert('Name is required')
    if (!addDraft.site || !siteOptions.includes(addDraft.site)) return alert('Select a valid location')

    try {
      await addDoc(collection(db, 'complianceEmployees'), {
        name: trimmedName,
        site: addDraft.site,
        active: true,
        linkedUserId: null,
        createdAt: serverTimestamp()
      })
      closeAddWizard()
      notifySuccess('Employee added')
    } catch (err) {
      console.error('Failed to add compliance employee', err)
      alert(`Unable to save employee: ${err?.message || 'Unknown error'}`)
    }
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
          <option value="All">All Locations</option>
          {siteOptions.map(site => <option key={site} value={site}>{site}</option>)}
        </select>
        <button onClick={openAddWizard} style={btnPrimary}>+ Add Employee</button>
      </div>

      {/* Add employee wizard */}
      {isAddWizardOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.6)',
          zIndex: 3000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px'
        }}>
          <div style={{
            width: '100%',
            maxWidth: '540px',
            borderRadius: '12px',
            border: '2px solid rgba(229,57,53,0.6)',
            backgroundColor: 'rgba(12,22,35,0.95)',
            boxShadow: '0 20px 40px rgba(0,0,0,0.45)',
            padding: '20px'
          }}>
            <h4 style={{ margin: '0 0 6px 0', color: '#e8e8e8' }}>Add Employee</h4>
            <div style={{ fontSize: '12px', color: '#8899aa', marginBottom: '14px' }}>
              Step {addWizardStep} of {maxAddWizardStep}
            </div>

            {addWizardStep === 1 && (
              <div>
                <label style={labelStyle}>Employee name *</label>
                <input
                  style={inputStyle}
                  value={addDraft.name}
                  onChange={e => setAddDraft(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Full Name"
                />
              </div>
            )}

            {addWizardStep === 2 && (
              <div>
                <label style={labelStyle}>Location *</label>
                <select
                  style={inputStyle}
                  value={addDraft.site}
                  onChange={e => setAddDraft(prev => ({ ...prev, site: e.target.value }))}
                >
                  {siteOptions.map(site => <option key={site} value={site}>{site}</option>)}
                </select>
              </div>
            )}

            {addWizardStep === 3 && (
              <div style={{ display: 'grid', gap: '8px', color: '#d6dbe1', fontSize: '13px' }}>
                <div><strong>Name:</strong> {addDraft.name.trim() || '--'}</div>
                <div><strong>Location:</strong> {addDraft.site || '--'}</div>
                <div><strong>Status:</strong> Active</div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: '18px' }}>
              <button onClick={closeAddWizard} style={btnCancel}>Cancel</button>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setAddWizardStep(prev => Math.max(1, prev - 1))}
                  style={btnCancel}
                  disabled={addWizardStep === 1}
                >
                  Back
                </button>
                {addWizardStep < maxAddWizardStep && (
                  <button
                    onClick={() => setAddWizardStep(prev => Math.min(maxAddWizardStep, prev + 1))}
                    style={btnPrimary}
                    disabled={addWizardStep === 1 && !addDraft.name.trim()}
                  >
                    Next
                  </button>
                )}
                {addWizardStep === maxAddWizardStep && (
                  <button onClick={handleAdd} style={btnPrimary}>Save</button>
                )}
              </div>
            </div>
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
                      <label style={labelStyle}>Location</label>
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
  const [isAddWizardOpen, setIsAddWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState(1)
  const [addDraft, setAddDraft] = useState({
    category: 'fpcc',
    employeeId: '',
    locationId: '',
    subtype: '',
    lastCompleted: '',
    dueDate: '',
    notes: ''
  })

  const employeeMap = useMemo(() => {
    const m = {}
    employees.forEach(e => { m[e.id] = e })
    return m
  }, [employees])
  const activeEmployees = useMemo(() => (
    employees.filter(e => e.active !== false)
  ), [employees])

  const maxWizardStep = 7

  const resetAddWizard = () => {
    setWizardStep(1)
    setAddDraft({
      category: 'fpcc',
      employeeId: '',
      locationId: '',
      subtype: '',
      lastCompleted: '',
      dueDate: '',
      notes: ''
    })
  }

  const openAddWizard = () => {
    resetAddWizard()
    setIsAddWizardOpen(true)
  }

  const closeAddWizard = () => {
    setIsAddWizardOpen(false)
    resetAddWizard()
  }

  const getItemTargetType = (item) => {
    const explicitTargetType = String(item?.targetType || '').trim().toLowerCase()
    if (explicitTargetType === 'location') return 'location'
    if (explicitTargetType === 'employee') return 'employee'
    if (isLocationCategory(item?.category)) return 'location'
    if (item?.locationId && !item?.employeeId) return 'location'
    return 'employee'
  }

  const getItemSite = (item) => {
    const targetType = getItemTargetType(item)
    if (targetType === 'location') {
      return normalizeMainLocation(item?.locationId) || normalizeMainLocation(item?.employeeSite) || ''
    }
    const mappedEmployee = employeeMap[item?.employeeId]
    return normalizeMainLocation(mappedEmployee?.site) || normalizeMainLocation(item?.employeeSite) || normalizeMainLocation(item?.locationId) || ''
  }

  const filtered = complianceItems.filter(item => {
    if (categoryFilter !== 'all' && item.category !== categoryFilter) return false
    const itemSite = getItemSite(item)
    if (siteFilter !== 'all') {
      if (itemSite !== siteFilter) return false
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
    const employeeCategory = requiresEmployee(addDraft.category)
    const normalizedLocation = normalizeMainLocation(addDraft.locationId) || String(addDraft.locationId || '').trim().toUpperCase() || null
    const selectedEmployee = employeeCategory ? employeeMap[addDraft.employeeId] : null
    if (employeeCategory && !addDraft.employeeId) return alert('Select an employee')
    if (employeeCategory && !selectedEmployee) return alert('Select a valid employee')
    if (!employeeCategory && !normalizedLocation) return alert('Select a location')

    try {
      await addDoc(collection(db, 'complianceItems'), {
        targetType: employeeCategory ? 'employee' : 'location',
        locationId: employeeCategory ? null : normalizedLocation,
        employeeId: employeeCategory ? addDraft.employeeId : null,
        employeeName: employeeCategory ? (selectedEmployee?.name || '') : null,
        employeeSite: employeeCategory
          ? (normalizeMainLocation(selectedEmployee?.site) || selectedEmployee?.site || null)
          : normalizedLocation,
        category: addDraft.category,
        subtype: addDraft.subtype || null,
        lastCompleted: addDraft.lastCompleted ? Timestamp.fromDate(new Date(addDraft.lastCompleted)) : null,
        dueDate: addDraft.dueDate ? Timestamp.fromDate(new Date(addDraft.dueDate)) : null,
        notes: addDraft.notes || '',
        source: 'manual',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
      closeAddWizard()
      notifySuccess('Compliance item added')
    } catch (err) {
      console.error('Failed to add compliance item', err)
      alert(`Unable to save compliance item: ${err?.message || 'Unknown error'}`)
    }
  }

  const handleDelete = async (itemId) => {
    if (!(await showConfirmDialog('Delete this compliance item?', {
      title: 'Delete Compliance Item',
      tone: 'danger',
      confirmText: 'Delete'
    }))) return
    await deleteDoc(doc(db, 'complianceItems', itemId))
    notifySuccess('Compliance item deleted')
  }

  const tsToInputDate = (ts) => {
    if (!ts) return ''
    const d = ts.toDate ? ts.toDate() : new Date(ts)
    if (isNaN(d)) return ''
    return d.toISOString().split('T')[0]
  }

  const categoryNeedsEmployee = requiresEmployee(addDraft.category)
  const canAdvanceWizard = (() => {
    if (wizardStep === 1) return Boolean(addDraft.category)
    if (wizardStep === 2) {
      return categoryNeedsEmployee ? Boolean(addDraft.employeeId) : Boolean(addDraft.locationId)
    }
    return true
  })()

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <select style={{ ...inputStyle, width: 'auto', minWidth: '160px' }} value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
          <option value="all">All Categories</option>
          {CATEGORY_KEYS.map(k => <option key={k} value={k}>{COMPLIANCE_CATEGORIES[k].icon} {COMPLIANCE_CATEGORIES[k].label}</option>)}
        </select>
        <select style={{ ...inputStyle, width: 'auto', minWidth: '100px' }} value={siteFilter} onChange={e => setSiteFilter(e.target.value)}>
          <option value="all">All Locations</option>
          {siteOptions.map(site => <option key={site} value={site}>{site}</option>)}
        </select>
        <select style={{ ...inputStyle, width: 'auto', minWidth: '130px' }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All Status</option>
          <option value="overdue">Overdue</option>
          <option value="upcoming">Due in 30 days</option>
          <option value="current">Current</option>
        </select>
        <button onClick={openAddWizard} style={btnPrimary}>+ Add Item</button>
      </div>

      {/* Add wizard */}
      {isAddWizardOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.6)',
          zIndex: 3000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px'
        }}>
          <div style={{
            width: '100%',
            maxWidth: '620px',
            borderRadius: '12px',
            border: '2px solid rgba(229,57,53,0.6)',
            backgroundColor: 'rgba(12,22,35,0.95)',
            boxShadow: '0 20px 40px rgba(0,0,0,0.45)',
            padding: '20px'
          }}>
            <h4 style={{ margin: '0 0 6px 0', color: '#e8e8e8' }}>Add Compliance Item</h4>
            <div style={{ fontSize: '12px', color: '#8899aa', marginBottom: '14px' }}>
              Step {wizardStep} of {maxWizardStep}
            </div>

            {wizardStep === 1 && (
              <div>
                <label style={labelStyle}>Which item are you adding?</label>
                <select
                  style={inputStyle}
                  value={addDraft.category}
                  onChange={e => setAddDraft(prev => ({
                    ...prev,
                    category: e.target.value,
                    employeeId: '',
                    locationId: ''
                  }))}
                >
                  {CATEGORY_KEYS.map(k => (
                    <option key={k} value={k}>
                      {COMPLIANCE_CATEGORIES[k].icon} {COMPLIANCE_CATEGORIES[k].label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {wizardStep === 2 && categoryNeedsEmployee && (
              <div>
                <label style={labelStyle}>Select employee *</label>
                <select
                  style={inputStyle}
                  value={addDraft.employeeId}
                  onChange={e => setAddDraft(prev => ({ ...prev, employeeId: e.target.value }))}
                >
                  <option value="">Select...</option>
                  {activeEmployees.map(e => (
                    <option key={e.id} value={e.id}>
                      {e.name} ({e.site})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {wizardStep === 2 && !categoryNeedsEmployee && (
              <div>
                <label style={labelStyle}>Select location *</label>
                <select
                  style={inputStyle}
                  value={addDraft.locationId}
                  onChange={e => setAddDraft(prev => ({ ...prev, locationId: e.target.value }))}
                >
                  <option value="">Select...</option>
                  {siteOptions.map(site => <option key={site} value={site}>{site}</option>)}
                </select>
              </div>
            )}

            {wizardStep === 3 && (
              <div>
                <label style={labelStyle}>Subtype (optional)</label>
                <input
                  style={inputStyle}
                  value={addDraft.subtype}
                  onChange={e => setAddDraft(prev => ({ ...prev, subtype: e.target.value }))}
                  placeholder="e.g., 90_day"
                />
              </div>
            )}

            {wizardStep === 4 && (
              <div>
                <label style={labelStyle}>Last Completed (optional)</label>
                <input
                  type="date"
                  style={inputStyle}
                  value={addDraft.lastCompleted}
                  onChange={e => setAddDraft(prev => ({ ...prev, lastCompleted: e.target.value }))}
                />
              </div>
            )}

            {wizardStep === 5 && (
              <div>
                <label style={labelStyle}>Due Date (optional)</label>
                <input
                  type="date"
                  style={inputStyle}
                  value={addDraft.dueDate}
                  onChange={e => setAddDraft(prev => ({ ...prev, dueDate: e.target.value }))}
                />
              </div>
            )}

            {wizardStep === 6 && (
              <div>
                <label style={labelStyle}>Notes (optional)</label>
                <input
                  style={inputStyle}
                  value={addDraft.notes}
                  onChange={e => setAddDraft(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
            )}

            {wizardStep === 7 && (
              <div style={{ display: 'grid', gap: '8px', color: '#d6dbe1', fontSize: '13px' }}>
                <div><strong>Category:</strong> {COMPLIANCE_CATEGORIES[addDraft.category]?.label || addDraft.category}</div>
                <div>
                  <strong>Target:</strong>{' '}
                  {categoryNeedsEmployee
                    ? (employeeMap[addDraft.employeeId]?.name || 'Not selected')
                    : (addDraft.locationId || 'Not selected')}
                </div>
                <div><strong>Subtype:</strong> {addDraft.subtype || '--'}</div>
                <div><strong>Last Completed:</strong> {addDraft.lastCompleted || '--'}</div>
                <div><strong>Due Date:</strong> {addDraft.dueDate || '--'}</div>
                <div><strong>Notes:</strong> {addDraft.notes || '--'}</div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: '18px' }}>
              <button onClick={closeAddWizard} style={btnCancel}>Cancel</button>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setWizardStep(prev => Math.max(1, prev - 1))}
                  style={btnCancel}
                  disabled={wizardStep === 1}
                >
                  Back
                </button>
                {wizardStep < maxWizardStep && (
                  <button
                    onClick={() => setWizardStep(prev => Math.min(maxWizardStep, prev + 1))}
                    style={btnPrimary}
                    disabled={!canAdvanceWizard}
                  >
                    Next
                  </button>
                )}
                {wizardStep === maxWizardStep && (
                  <button onClick={handleAdd} style={btnPrimary}>Save</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Items list */}
      <div style={{ fontSize: '13px', color: '#8899aa', marginBottom: '8px' }}>{filtered.length} items</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {filtered.map(item => {
          const s = getStatus(item.dueDate)
          const isEditing = editingId === item.id
          const itemTargetType = getItemTargetType(item)
          const itemSite = getItemSite(item)
          const itemDisplayLabel = itemTargetType === 'location'
            ? `Location: ${itemSite || '--'}`
            : (item.employeeName || employeeMap[item.employeeId]?.name || 'Unknown employee')

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
                <span style={{ fontWeight: 'bold', fontSize: '14px', minWidth: '140px' }}>{itemDisplayLabel}</span>
                {itemTargetType === 'employee' && itemSite && (
                  <span style={{
                    fontSize: '12px',
                    color: '#8899aa',
                    backgroundColor: 'rgba(255,255,255,0.06)',
                    padding: '2px 8px',
                    borderRadius: '4px'
                  }}>
                    {itemSite}
                  </span>
                )}
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
    if (!(await showConfirmDialog('Delete this service?', {
      title: 'Delete Cintas Service',
      tone: 'danger',
      confirmText: 'Delete'
    }))) return
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


// ─── MAIN COMPLIANCE PANEL ─────────────────────────────────────────────────────
function CompliancePanel({ user, scopeSites = null }) {
  const [subTab, setSubTab] = useState('employees')
  const [employees, setEmployees] = useState([])
  const [complianceItems, setComplianceItems] = useState([])
  const [cintasServices, setCintasServices] = useState([])
  const isAdmin = user?.role === 'admin'
  const normalizedScopeSites = useMemo(() => {
    if (!Array.isArray(scopeSites)) return []
    return [...new Set(scopeSites.map(s => normalizeMainLocation(s)).filter(Boolean))]
  }, [scopeSites])
  const scopeSiteSet = useMemo(() => new Set(normalizedScopeSites), [normalizedScopeSites])
  const siteOptions = normalizedScopeSites.length > 0 ? normalizedScopeSites : MAIN_LOCATIONS
  const hasComplianceScope = isAdmin || normalizedScopeSites.length > 0

  // Real-time listeners
  useEffect(() => {
    if (!hasComplianceScope) return () => {}

    const unsub1 = onSnapshot(
      query(collection(db, 'complianceEmployees'), orderBy('name', 'asc')),
      snap => {
        const rows = snap.docs.map(d => {
          const data = d.data()
          return {
            id: d.id,
            ...data,
            site: normalizeMainLocation(data.site) || String(data.site || '').trim().toUpperCase()
          }
        })
        setEmployees(rows.filter(e => isAdmin || scopeSiteSet.has(normalizeMainLocation(e.site))))
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
        cintas: 'Cintas'
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
          No compliance location scope is configured for this account.
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
        </>
      )}
    </div>
  )
}

export default CompliancePanel

