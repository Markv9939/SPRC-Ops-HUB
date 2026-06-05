import { useEffect, useMemo, useState } from 'react'
import { db } from '../firebase'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  writeBatch
} from 'firebase/firestore'
import { notifySuccess } from '../utils/toast'
import { showConfirmDialog } from '../utils/dialogs'
import { getStatus } from '../utils/complianceStatus'
import { MAIN_LOCATIONS, normalizeMainLocation } from '../utils/orgModel'

const EMPLOYEE_COMPLIANCE_CATEGORIES = {
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

const CATEGORY_KEYS = Object.keys(EMPLOYEE_COMPLIANCE_CATEGORIES)

const panelStyle = {
  backgroundColor: 'rgba(17,47,82,0.08)',
  borderRadius: '12px',
  border: '1px solid rgba(229,57,53,0.2)',
  backdropFilter: 'blur(12px)'
}

const inputStyle = {
  width: '100%',
  padding: '9px 10px',
  border: '1px solid #C9D3DD',
  borderRadius: '8px',
  fontSize: '14px',
  boxSizing: 'border-box',
  backgroundColor: '#FFFFFF',
  color: '#1F2C3A'
}

const mobileSheetInputStyle = {
  ...inputStyle,
  minHeight: '44px',
  fontSize: '16px',
  lineHeight: 1.35,
  color: '#0F1D2A',
  WebkitTextFillColor: '#0F1D2A'
}

const mobileFieldLabelStyle = {
  fontSize: '12px',
  fontWeight: 700,
  letterSpacing: '0.02em',
  color: '#324559',
  marginBottom: '4px'
}

const btnPrimary = {
  padding: '9px 14px',
  backgroundColor: '#2F7D57',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: '8px',
  fontSize: '13px',
  fontWeight: 700,
  cursor: 'pointer'
}

const btnSecondary = {
  padding: '8px 12px',
  backgroundColor: '#F1EFEA',
  color: '#1F3A52',
  border: '1px solid #D8D1C6',
  borderRadius: '8px',
  fontSize: '12px',
  fontWeight: 700,
  cursor: 'pointer'
}

const btnDanger = {
  padding: '8px 12px',
  backgroundColor: '#CD4E42',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: '8px',
  fontSize: '12px',
  fontWeight: 700,
  cursor: 'pointer'
}

function tsToInputDate(ts) {
  if (!ts) return ''
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().split('T')[0]
}

function formatDateShort(ts) {
  if (!ts) return '--'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  if (Number.isNaN(d.getTime())) return '--'
  return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
}

function statusBadge(status) {
  const colors = { overdue: '#B75E54', upcoming: '#B07A28', current: '#2F7D57', none: '#556677' }
  const labels = { overdue: 'OVERDUE', upcoming: 'DUE SOON', current: 'CURRENT', none: 'N/A' }
  return (
    <span style={{
      padding: '2px 8px',
      borderRadius: '10px',
      fontSize: '11px',
      fontWeight: 700,
      color: '#FFFFFF',
      backgroundColor: colors[status] || colors.none
    }}>
      {labels[status] || 'N/A'}
    </span>
  )
}

function isEmployeeItem(item) {
  const category = String(item?.category || '').trim().toLowerCase()
  if (category === 'cintas' || category === 'fire_safety') return false
  const targetType = String(item?.targetType || '').trim().toLowerCase()
  if (targetType === 'location') return false
  if (item?.locationId && !item?.employeeId) return false
  return true
}

function summaryForItems(items) {
  let overdue = 0
  let upcoming = 0
  let current = 0
  items.forEach(item => {
    const status = getStatus(item.dueDate)
    if (status === 'overdue') overdue += 1
    else if (status === 'upcoming') upcoming += 1
    else if (status === 'current') current += 1
  })
  return { overdue, upcoming, current, total: items.length }
}

function AddEmployeeModal({ siteOptions, onClose, onSave }) {
  const defaultSite = siteOptions[0] || 'OTC'
  const [name, setName] = useState('')
  const [site, setSite] = useState(defaultSite)
  const [selectedCategories, setSelectedCategories] = useState([])

  const toggleCategory = (key) => {
    setSelectedCategories(prev => (
      prev.includes(key) ? prev.filter(v => v !== key) : [...prev, key]
    ))
  }

  const handleSave = async () => {
    const trimmedName = String(name || '').trim()
    const normalizedSite = normalizeMainLocation(site)
    if (!trimmedName) return alert('Employee name is required.')
    if (!normalizedSite) return alert('Valid location is required.')
    await onSave({ name: trimmedName, site: normalizedSite, selectedCategories })
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0,0,0,0.58)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 3000,
      padding: '14px'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '560px',
        backgroundColor: '#FFFFFF',
        border: '1px solid #D8D1C6',
        borderRadius: '14px',
        padding: '20px'
      }}>
        <h3 style={{ margin: '0 0 14px 0', color: '#1F2C3A' }}>Add Employee</h3>
        <div style={{ display: 'grid', gap: '10px' }}>
          <div>
            <label style={{ fontSize: '12px', color: '#465367', display: 'block', marginBottom: '4px' }}>Employee Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="Full name" />
          </div>
          <div>
            <label style={{ fontSize: '12px', color: '#465367', display: 'block', marginBottom: '4px' }}>Location</label>
            <select value={site} onChange={(e) => setSite(e.target.value)} style={inputStyle}>
              {siteOptions.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: '#465367', marginBottom: '6px' }}>Optional: create starter compliance items</div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
              <button type="button" style={btnSecondary} onClick={() => setSelectedCategories([...CATEGORY_KEYS])}>Select All</button>
              <button type="button" style={btnSecondary} onClick={() => setSelectedCategories([])}>Clear</button>
            </div>
            <div style={{ display: 'grid', gap: '8px', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              {CATEGORY_KEYS.map(key => (
                <label key={key} style={{ border: '1px solid #D8D1C6', borderRadius: '8px', padding: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="checkbox" checked={selectedCategories.includes(key)} onChange={() => toggleCategory(key)} />
                  <span style={{ fontSize: '13px', color: '#1F2C3A' }}>
                    {EMPLOYEE_COMPLIANCE_CATEGORIES[key].icon} {EMPLOYEE_COMPLIANCE_CATEGORIES[key].label}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button onClick={onClose} style={btnSecondary}>Cancel</button>
          <button onClick={handleSave} style={btnPrimary}>Save Employee</button>
        </div>
      </div>
    </div>
  )
}

function EmployeeDetail({ employee, items, siteOptions, onClose, onEmployeeUpdated, onItemAdded, onItemUpdated, onItemDeleted, isMobile = false }) {
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ category: CATEGORY_KEYS[0], subtype: '', lastCompleted: '', dueDate: '', notes: '' })
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ lastCompleted: '', dueDate: '', notes: '' })
  const [nameEdit, setNameEdit] = useState(employee?.name || '')
  const [siteEdit, setSiteEdit] = useState(employee?.site || siteOptions[0] || 'OTC')

  const [mobileAddOpen, setMobileAddOpen] = useState(false)
  const [mobileAddForm, setMobileAddForm] = useState({ category: CATEGORY_KEYS[0], subtype: '', lastCompleted: '', dueDate: '', notes: '' })
  const [mobileEditItemId, setMobileEditItemId] = useState(null)
  const [mobileEditForm, setMobileEditForm] = useState({ lastCompleted: '', dueDate: '', notes: '' })
  const [mobileEditMeta, setMobileEditMeta] = useState({ label: '', subtype: '', dueDate: null })
  const [isSavingMobile, setIsSavingMobile] = useState(false)

  const groupedItems = useMemo(() => {
    const sorted = [...items].sort((a, b) => {
      const aStatus = getStatus(a.dueDate)
      const bStatus = getStatus(b.dueDate)
      const order = { overdue: 0, upcoming: 1, current: 2, none: 3 }
      if ((order[aStatus] ?? 4) !== (order[bStatus] ?? 4)) return (order[aStatus] ?? 4) - (order[bStatus] ?? 4)
      const aDue = a?.dueDate?.toDate ? a.dueDate.toDate().getTime() : Number.POSITIVE_INFINITY
      const bDue = b?.dueDate?.toDate ? b.dueDate.toDate().getTime() : Number.POSITIVE_INFINITY
      return aDue - bDue
    })
    return sorted
  }, [items])

  const stats = useMemo(() => summaryForItems(items), [items])

  const handleAddItem = async () => {
    await onItemAdded({
      employee,
      category: addForm.category,
      subtype: String(addForm.subtype || '').trim() || null,
      lastCompleted: addForm.lastCompleted ? Timestamp.fromDate(new Date(addForm.lastCompleted)) : null,
      dueDate: addForm.dueDate ? Timestamp.fromDate(new Date(addForm.dueDate)) : null,
      notes: String(addForm.notes || '').trim()
    })
    setShowAdd(false)
    setAddForm({ category: CATEGORY_KEYS[0], subtype: '', lastCompleted: '', dueDate: '', notes: '' })
  }

  const handleSaveEdit = async (itemId) => {
    await onItemUpdated(itemId, {
      lastCompleted: editForm.lastCompleted ? Timestamp.fromDate(new Date(editForm.lastCompleted)) : null,
      dueDate: editForm.dueDate ? Timestamp.fromDate(new Date(editForm.dueDate)) : null,
      notes: String(editForm.notes || '').trim()
    })
    setEditingId(null)
  }

  const handleSaveMobileAdd = async () => {
    setIsSavingMobile(true)
    try {
      await onItemAdded({
        employee,
        category: mobileAddForm.category,
        subtype: String(mobileAddForm.subtype || '').trim() || null,
        lastCompleted: mobileAddForm.lastCompleted ? Timestamp.fromDate(new Date(mobileAddForm.lastCompleted)) : null,
        dueDate: mobileAddForm.dueDate ? Timestamp.fromDate(new Date(mobileAddForm.dueDate)) : null,
        notes: String(mobileAddForm.notes || '').trim()
      })
      setMobileAddOpen(false)
      setMobileAddForm({ category: CATEGORY_KEYS[0], subtype: '', lastCompleted: '', dueDate: '', notes: '' })
    } finally {
      setIsSavingMobile(false)
    }
  }

  const openMobileEdit = (item) => {
    setMobileEditItemId(item.id)
    setMobileEditForm({
      lastCompleted: tsToInputDate(item.lastCompleted),
      dueDate: tsToInputDate(item.dueDate),
      notes: item.notes || ''
    })
    setMobileEditMeta({
      label: EMPLOYEE_COMPLIANCE_CATEGORIES[item.category]?.label || String(item.category || 'Compliance Item'),
      subtype: item.subtype || '',
      dueDate: item.dueDate || null
    })
  }

  const handleSaveMobileEdit = async () => {
    if (!mobileEditItemId) return
    setIsSavingMobile(true)
    try {
      await onItemUpdated(mobileEditItemId, {
        lastCompleted: mobileEditForm.lastCompleted ? Timestamp.fromDate(new Date(mobileEditForm.lastCompleted)) : null,
        dueDate: mobileEditForm.dueDate ? Timestamp.fromDate(new Date(mobileEditForm.dueDate)) : null,
        notes: String(mobileEditForm.notes || '').trim()
      })
      setMobileEditItemId(null)
      setMobileEditMeta({ label: '', subtype: '', dueDate: null })
    } finally {
      setIsSavingMobile(false)
    }
  }

  const handleDeactivateToggle = async () => {
    const nextActive = employee.active === false
    const message = nextActive ? 'Reactivate this employee?' : 'Deactivate this employee?'
    const title = nextActive ? 'Reactivate Employee' : 'Deactivate Employee'
    const confirmText = nextActive ? 'Reactivate' : 'Deactivate'
    const confirmed = await showConfirmDialog(message, { title, confirmText, tone: nextActive ? 'default' : 'danger' })
    if (!confirmed) return
    await onEmployeeUpdated(employee.id, {
      active: nextActive,
      updatedAt: serverTimestamp()
    })
    notifySuccess(nextActive ? 'Employee reactivated' : 'Employee deactivated')
  }

  const handleSaveHeader = async () => {
    const trimmedName = String(nameEdit || '').trim()
    const normalizedSite = normalizeMainLocation(siteEdit)
    if (!trimmedName) return alert('Name is required.')
    if (!normalizedSite) return alert('Location is required.')
    await onEmployeeUpdated(employee.id, {
      name: trimmedName,
      site: normalizedSite,
      updatedAt: serverTimestamp()
    })
    notifySuccess('Employee updated')
  }

  return (
    <div style={{ ...panelStyle, padding: isMobile ? '12px' : '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
        <div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#1F2C3A' }}>{employee.name}</div>
          <div style={{ fontSize: '12px', color: '#465367' }}>{employee.site} {employee.active === false ? '• Inactive' : '• Active'}</div>
        </div>
        {!isMobile && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <button onClick={() => setShowAdd(prev => !prev)} style={{ ...btnPrimary, minHeight: '40px' }}>{showAdd ? 'Close Add' : '+ Add Item'}</button>
            <button onClick={handleDeactivateToggle} style={{ ...btnDanger, minHeight: '40px' }}>{employee.active === false ? 'Reactivate' : 'Deactivate'}</button>
            {onClose && <button onClick={onClose} style={{ ...btnSecondary, minHeight: '40px' }}>Back</button>}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px', marginBottom: '10px' }}>
        <div style={{ ...panelStyle, padding: '8px 10px', backgroundColor: 'rgba(183,94,84,0.12)' }}><strong>{stats.overdue}</strong> overdue</div>
        <div style={{ ...panelStyle, padding: '8px 10px', backgroundColor: 'rgba(176,122,40,0.12)' }}><strong>{stats.upcoming}</strong> due soon</div>
        <div style={{ ...panelStyle, padding: '8px 10px', backgroundColor: 'rgba(47,125,87,0.12)' }}><strong>{stats.current}</strong> current</div>
        <div style={{ ...panelStyle, padding: '8px 10px', backgroundColor: 'rgba(17,47,82,0.10)' }}><strong>{stats.total}</strong> total</div>
      </div>

      <div style={{ ...panelStyle, padding: '12px', marginBottom: '10px' }}>
        <div style={{ fontWeight: 700, color: '#1F2C3A', marginBottom: '8px', fontSize: '13px' }}>Employee Info</div>
        <div style={{ display: 'grid', gap: '8px', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr auto' }}>
          <input value={nameEdit} onChange={(e) => setNameEdit(e.target.value)} style={inputStyle} />
          <select value={siteEdit} onChange={(e) => setSiteEdit(e.target.value)} style={inputStyle}>
            {siteOptions.map(site => <option key={site} value={site}>{site}</option>)}
          </select>
          <button onClick={handleSaveHeader} style={{ ...btnSecondary, minHeight: '40px' }}>Save</button>
        </div>
      </div>

      {!isMobile && showAdd && (
        <div style={{ ...panelStyle, padding: '12px', marginBottom: '10px' }}>
          <div style={{ fontWeight: 700, color: '#1F2C3A', marginBottom: '8px', fontSize: '13px' }}>New Compliance Item</div>
          <div style={{ display: 'grid', gap: '8px', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <select value={addForm.category} onChange={(e) => setAddForm(prev => ({ ...prev, category: e.target.value }))} style={inputStyle}>
              {CATEGORY_KEYS.map(key => (
                <option key={key} value={key}>{EMPLOYEE_COMPLIANCE_CATEGORIES[key].icon} {EMPLOYEE_COMPLIANCE_CATEGORIES[key].label}</option>
              ))}
            </select>
            <input value={addForm.subtype} onChange={(e) => setAddForm(prev => ({ ...prev, subtype: e.target.value }))} style={inputStyle} placeholder="Subtype (optional)" />
            <input type="date" value={addForm.lastCompleted} onChange={(e) => setAddForm(prev => ({ ...prev, lastCompleted: e.target.value }))} style={inputStyle} />
            <input type="date" value={addForm.dueDate} onChange={(e) => setAddForm(prev => ({ ...prev, dueDate: e.target.value }))} style={inputStyle} />
            <input value={addForm.notes} onChange={(e) => setAddForm(prev => ({ ...prev, notes: e.target.value }))} style={inputStyle} placeholder="Add document/status details or follow-up needed..." />
          </div>
          <div style={{ marginTop: '8px', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
            <button onClick={() => setShowAdd(false)} style={btnSecondary}>Cancel</button>
            <button onClick={handleAddItem} style={btnPrimary}>Save Item</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingBottom: isMobile ? '96px' : '0' }}>
        {groupedItems.map(item => {
          const status = getStatus(item.dueDate)
          const isEditing = editingId === item.id
          return (
            <div key={item.id} style={{
              padding: '10px',
              borderRadius: '8px',
              border: status === 'overdue' ? '2px solid #B75E54' : '1px solid rgba(17,47,82,0.16)',
              backgroundColor: 'rgba(17,47,82,0.05)'
            }}>
              {!isMobile && isEditing ? (
                <>
                  <div style={{ display: 'grid', gap: '8px', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                    <input type="date" value={editForm.lastCompleted} onChange={(e) => setEditForm(prev => ({ ...prev, lastCompleted: e.target.value }))} style={inputStyle} />
                    <input type="date" value={editForm.dueDate} onChange={(e) => setEditForm(prev => ({ ...prev, dueDate: e.target.value }))} style={inputStyle} />
                    <input value={editForm.notes} onChange={(e) => setEditForm(prev => ({ ...prev, notes: e.target.value }))} style={inputStyle} placeholder="Add document/status details or follow-up needed..." />
                  </div>
                  <div style={{ marginTop: '8px', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                    <button onClick={() => setEditingId(null)} style={btnSecondary}>Cancel</button>
                    <button onClick={() => handleSaveEdit(item.id)} style={btnPrimary}>Save</button>
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ display: 'grid', gap: '4px' }}>
                    <div style={{ fontWeight: 700, color: '#1F2C3A' }}>
                      {EMPLOYEE_COMPLIANCE_CATEGORIES[item.category]?.icon} {EMPLOYEE_COMPLIANCE_CATEGORIES[item.category]?.label || item.category}
                      {item.subtype ? <span style={{ color: '#465367', fontWeight: 400 }}> ({item.subtype})</span> : null}
                    </div>
                    <div style={{ fontSize: '12px', color: '#324559', fontWeight: isMobile ? 600 : 400 }}>
                      Due: {formatDateShort(item.dueDate)}
                    </div>
                    {isMobile && (
                      <div style={{ fontSize: '12px', color: '#465367' }}>
                        Last: {formatDateShort(item.lastCompleted)}
                      </div>
                    )}
                    {!isMobile && (
                      <div style={{ fontSize: '12px', color: '#465367' }}>
                        Last: {formatDateShort(item.lastCompleted)}
                      </div>
                    )}
                    {item.notes ? <div style={{ fontSize: '12px', color: '#556677' }}>Notes: {item.notes}</div> : null}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    {statusBadge(status)}
                    <button
                      onClick={() => {
                        if (isMobile) {
                          openMobileEdit(item)
                          return
                        }
                        setEditingId(item.id)
                        setEditForm({
                          lastCompleted: tsToInputDate(item.lastCompleted),
                          dueDate: tsToInputDate(item.dueDate),
                          notes: item.notes || ''
                        })
                      }}
                      style={{ ...btnSecondary, minHeight: '36px' }}
                    >
                      Edit
                    </button>
                    <button onClick={() => onItemDeleted(item.id)} style={{ ...btnDanger, minHeight: '36px' }}>Delete</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {groupedItems.length === 0 && (
          <div style={{ textAlign: 'center', padding: '24px', color: '#556677' }}>No compliance items for this employee.</div>
        )}
      </div>

      {isMobile && (
        <div style={{
          position: 'sticky',
          bottom: 0,
          zIndex: 6,
          backgroundColor: '#FFFFFF',
          borderTop: '1px solid #D8D1C6',
          marginTop: '10px',
          marginLeft: '-12px',
          marginRight: '-12px',
          marginBottom: '-12px',
          padding: '8px 12px',
          paddingBottom: 'calc(8px + env(safe-area-inset-bottom))',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: '8px'
        }}>
          <button onClick={onClose} style={{ ...btnSecondary, minHeight: '42px' }}>Back</button>
          <button
            onClick={() => {
              setMobileEditItemId(null)
              setMobileAddOpen(true)
            }}
            style={{ ...btnPrimary, minHeight: '42px' }}
          >
            + Add Item
          </button>
          <button onClick={handleDeactivateToggle} style={{ ...btnDanger, minHeight: '42px' }}>
            {employee.active === false ? 'Reactivate' : 'Deactivate'}
          </button>
        </div>
      )}

      {isMobile && mobileAddOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3200, backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <div style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: '#FFFFFF',
            borderTopLeftRadius: '14px',
            borderTopRightRadius: '14px',
            borderTop: '1px solid #D8D1C6',
            maxHeight: '84vh',
            overflow: 'auto',
            padding: '14px',
            paddingBottom: 'calc(14px + env(safe-area-inset-bottom))'
          }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#1F2C3A', marginBottom: '10px' }}>Add Compliance Item</div>
            <div style={{ display: 'grid', gap: '8px' }}>
              <div>
                <div style={mobileFieldLabelStyle}>Category</div>
                <select value={mobileAddForm.category} onChange={(e) => setMobileAddForm(prev => ({ ...prev, category: e.target.value }))} style={mobileSheetInputStyle}>
                  {CATEGORY_KEYS.map(key => (
                    <option key={key} value={key}>{EMPLOYEE_COMPLIANCE_CATEGORIES[key].label}</option>
                  ))}
                </select>
              </div>
              <div>
                <div style={mobileFieldLabelStyle}>Subtype (optional)</div>
                <input value={mobileAddForm.subtype} onChange={(e) => setMobileAddForm(prev => ({ ...prev, subtype: e.target.value }))} style={mobileSheetInputStyle} placeholder="e.g. annual" />
              </div>
              <div>
                <div style={mobileFieldLabelStyle}>Last Completed</div>
                <input type="date" value={mobileAddForm.lastCompleted} onChange={(e) => setMobileAddForm(prev => ({ ...prev, lastCompleted: e.target.value }))} style={mobileSheetInputStyle} />
              </div>
              <div>
                <div style={mobileFieldLabelStyle}>Due Date</div>
                <input type="date" value={mobileAddForm.dueDate} onChange={(e) => setMobileAddForm(prev => ({ ...prev, dueDate: e.target.value }))} style={mobileSheetInputStyle} />
              </div>
              <div>
                <div style={mobileFieldLabelStyle}>Notes</div>
                <input value={mobileAddForm.notes} onChange={(e) => setMobileAddForm(prev => ({ ...prev, notes: e.target.value }))} style={mobileSheetInputStyle} placeholder="Add document/status details or follow-up needed..." />
              </div>
            </div>
            <div style={{
              position: 'sticky',
              bottom: 0,
              zIndex: 2,
              backgroundColor: '#FFFFFF',
              borderTop: '1px solid #D8D1C6',
              marginTop: '10px',
              marginLeft: '-14px',
              marginRight: '-14px',
              marginBottom: '-14px',
              padding: '10px 14px calc(10px + env(safe-area-inset-bottom))',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px'
            }}>
              <button onClick={() => setMobileAddOpen(false)} style={{ ...btnSecondary, minHeight: '42px' }}>Cancel</button>
              <button onClick={handleSaveMobileAdd} disabled={isSavingMobile} style={{ ...btnPrimary, minHeight: '42px', opacity: isSavingMobile ? 0.7 : 1 }}>
                {isSavingMobile ? 'Saving...' : 'Save Item'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isMobile && mobileEditItemId && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3200, backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <div style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: '#FFFFFF',
            borderTopLeftRadius: '14px',
            borderTopRightRadius: '14px',
            borderTop: '1px solid #D8D1C6',
            maxHeight: '84vh',
            overflow: 'auto',
            padding: '14px',
            paddingBottom: 'calc(14px + env(safe-area-inset-bottom))'
          }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#1F2C3A', marginBottom: '6px' }}>Edit Compliance Item</div>
            <div style={{
              border: '1px solid #D8D1C6',
              borderRadius: '10px',
              backgroundColor: '#F8F5F1',
              padding: '10px',
              marginBottom: '10px'
            }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#112F52' }}>
                {employee.name} - {mobileEditMeta.label || 'Selected Item'}
                {mobileEditMeta.subtype ? ` (${mobileEditMeta.subtype})` : ''}
              </div>
              <div style={{ fontSize: '12px', color: '#465367', marginTop: '3px' }}>
                Current Due: {formatDateShort(mobileEditMeta.dueDate)}
              </div>
            </div>
            <div style={{ display: 'grid', gap: '8px' }}>
              <div>
                <div style={mobileFieldLabelStyle}>Last Completed</div>
                <input type="date" value={mobileEditForm.lastCompleted} onChange={(e) => setMobileEditForm(prev => ({ ...prev, lastCompleted: e.target.value }))} style={mobileSheetInputStyle} />
              </div>
              <div>
                <div style={mobileFieldLabelStyle}>Due Date</div>
                <input type="date" value={mobileEditForm.dueDate} onChange={(e) => setMobileEditForm(prev => ({ ...prev, dueDate: e.target.value }))} style={mobileSheetInputStyle} />
              </div>
              <div>
                <div style={mobileFieldLabelStyle}>Notes</div>
                <input value={mobileEditForm.notes} onChange={(e) => setMobileEditForm(prev => ({ ...prev, notes: e.target.value }))} style={mobileSheetInputStyle} placeholder="Add document/status details or follow-up needed..." />
              </div>
            </div>
            <div style={{
              position: 'sticky',
              bottom: 0,
              zIndex: 2,
              backgroundColor: '#FFFFFF',
              borderTop: '1px solid #D8D1C6',
              marginTop: '10px',
              marginLeft: '-14px',
              marginRight: '-14px',
              marginBottom: '-14px',
              padding: '10px 14px calc(10px + env(safe-area-inset-bottom))',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px'
            }}>
              <button onClick={() => {
                setMobileEditItemId(null)
                setMobileEditMeta({ label: '', subtype: '', dueDate: null })
              }} style={{ ...btnSecondary, minHeight: '42px' }}>Cancel</button>
              <button onClick={handleSaveMobileEdit} disabled={isSavingMobile} style={{ ...btnPrimary, minHeight: '42px', opacity: isSavingMobile ? 0.7 : 1 }}>
                {isSavingMobile ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CompliancePanel({ user, scopeSites = null }) {
  const isAdmin = user?.role === 'admin'
  const [employees, setEmployees] = useState([])
  const [complianceItems, setComplianceItems] = useState([])
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null)
  const [search, setSearch] = useState('')
  const [siteFilter, setSiteFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showInactive, setShowInactive] = useState(false)
  const [showAddEmployee, setShowAddEmployee] = useState(false)
  const getMobileFlow = () => {
    const isNarrow = window.innerWidth < 1100
    const isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches
    return isNarrow || isTouch
  }
  const [isMobileDetail, setIsMobileDetail] = useState(() => getMobileFlow())

  const normalizedScopeSites = useMemo(() => {
    if (!Array.isArray(scopeSites)) return []
    return [...new Set(scopeSites.map(s => normalizeMainLocation(s)).filter(Boolean))]
  }, [scopeSites])

  const scopeSiteSet = useMemo(() => new Set(normalizedScopeSites), [normalizedScopeSites])
  const siteOptions = normalizedScopeSites.length > 0 ? normalizedScopeSites : MAIN_LOCATIONS
  const hasComplianceScope = isAdmin || normalizedScopeSites.length > 0

  useEffect(() => {
    const onResize = () => setIsMobileDetail(getMobileFlow())
    window.addEventListener('resize', onResize)
    const pointerMedia = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null
    const onPointerChange = () => setIsMobileDetail(getMobileFlow())
    if (pointerMedia && pointerMedia.addEventListener) {
      pointerMedia.addEventListener('change', onPointerChange)
    } else if (pointerMedia && pointerMedia.addListener) {
      pointerMedia.addListener(onPointerChange)
    }
    return () => {
      window.removeEventListener('resize', onResize)
      if (pointerMedia && pointerMedia.removeEventListener) {
        pointerMedia.removeEventListener('change', onPointerChange)
      } else if (pointerMedia && pointerMedia.removeListener) {
        pointerMedia.removeListener(onPointerChange)
      }
    }
  }, [])

  useEffect(() => {
    if (!hasComplianceScope) return () => {}

    const unsubEmployees = onSnapshot(
      query(collection(db, 'complianceEmployees'), orderBy('name', 'asc')),
      (snap) => {
        const rows = snap.docs.map(d => {
          const data = d.data()
          return {
            id: d.id,
            ...data,
            site: normalizeMainLocation(data.site) || String(data.site || '').trim().toUpperCase()
          }
        })
        setEmployees(rows.filter(row => isAdmin || scopeSiteSet.has(normalizeMainLocation(row.site))))
      }
    )

    const unsubItems = onSnapshot(
      query(collection(db, 'complianceItems'), orderBy('employeeName', 'asc')),
      (snap) => {
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        setComplianceItems(rows)
      }
    )

    return () => {
      unsubEmployees()
      unsubItems()
    }
  }, [hasComplianceScope, isAdmin, scopeSiteSet])

  const employeeMap = useMemo(() => {
    const map = {}
    employees.forEach(emp => {
      map[emp.id] = emp
    })
    return map
  }, [employees])

  const scopedEmployeeItems = useMemo(() => {
    return complianceItems.filter(item => {
      if (!isEmployeeItem(item)) return false
      const emp = employeeMap[item.employeeId]
      const itemSite = normalizeMainLocation(item?.employeeSite) || normalizeMainLocation(emp?.site)
      return isAdmin || scopeSiteSet.has(itemSite)
    })
  }, [complianceItems, employeeMap, isAdmin, scopeSiteSet])

  const itemsByEmployee = useMemo(() => {
    const map = {}
    scopedEmployeeItems.forEach(item => {
      if (!map[item.employeeId]) map[item.employeeId] = []
      map[item.employeeId].push(item)
    })
    return map
  }, [scopedEmployeeItems])

  const filteredEmployees = useMemo(() => {
    return employees.filter(emp => {
      const normalizedSite = normalizeMainLocation(emp.site)
      if (siteFilter !== 'all' && normalizedSite !== siteFilter) return false
      if (!showInactive && emp.active === false) return false
      if (search && !String(emp.name || '').toLowerCase().includes(search.toLowerCase())) return false
      if (statusFilter !== 'all') {
        const stats = summaryForItems(itemsByEmployee[emp.id] || [])
        if (statusFilter === 'overdue' && stats.overdue === 0) return false
        if (statusFilter === 'upcoming' && stats.upcoming === 0) return false
        if (statusFilter === 'current' && stats.current === 0) return false
      }
      return true
    })
  }, [employees, itemsByEmployee, search, showInactive, siteFilter, statusFilter])

  const selectedEmployee = selectedEmployeeId ? employeeMap[selectedEmployeeId] : null
  const selectedEmployeeItems = selectedEmployeeId ? (itemsByEmployee[selectedEmployeeId] || []) : []

  const handleAddEmployee = async ({ name, site, selectedCategories }) => {
    try {
      const batch = writeBatch(db)
      const employeeRef = doc(collection(db, 'complianceEmployees'))
      batch.set(employeeRef, {
        name,
        site,
        active: true,
        linkedUserId: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })

      selectedCategories.forEach(category => {
        const itemRef = doc(collection(db, 'complianceItems'))
        batch.set(itemRef, {
          targetType: 'employee',
          employeeId: employeeRef.id,
          employeeName: name,
          employeeSite: site,
          locationId: null,
          category,
          subtype: null,
          lastCompleted: null,
          dueDate: null,
          notes: '',
          source: 'manual',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        })
      })

      await batch.commit()
      setShowAddEmployee(false)
      setSelectedEmployeeId(employeeRef.id)
      notifySuccess(`Employee added (${selectedCategories.length} starter items)`)
    } catch (error) {
      console.error('Failed to add employee:', error)
      alert(error?.message || 'Unable to add employee.')
    }
  }

  const handleEmployeeUpdate = async (employeeId, updates) => {
    await updateDoc(doc(db, 'complianceEmployees', employeeId), updates)
  }

  const handleAddItem = async ({ employee, category, subtype, lastCompleted, dueDate, notes }) => {
    try {
      await addDoc(collection(db, 'complianceItems'), {
        targetType: 'employee',
        employeeId: employee.id,
        employeeName: employee.name || '',
        employeeSite: normalizeMainLocation(employee.site) || employee.site || null,
        locationId: null,
        category,
        subtype,
        lastCompleted,
        dueDate,
        notes,
        source: 'manual',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
      notifySuccess('Compliance item added')
    } catch (error) {
      console.error('Failed to add compliance item:', error)
      alert(error?.message || 'Unable to add compliance item.')
    }
  }

  const handleUpdateItem = async (itemId, updates) => {
    await updateDoc(doc(db, 'complianceItems', itemId), {
      ...updates,
      updatedAt: serverTimestamp()
    })
    notifySuccess('Compliance item updated')
  }

  const handleDeleteItem = async (itemId) => {
    const confirmed = await showConfirmDialog('Delete this compliance item?', {
      title: 'Delete Compliance Item',
      confirmText: 'Delete',
      tone: 'danger'
    })
    if (!confirmed) return
    await deleteDoc(doc(db, 'complianceItems', itemId))
    notifySuccess('Compliance item deleted')
  }

  return (
    <div>
      {!hasComplianceScope && (
        <div style={{
          padding: '16px',
          borderRadius: '10px',
          backgroundColor: 'rgba(255,152,0,0.15)',
          border: '1px solid rgba(255,152,0,0.3)',
          color: '#B07A28',
          fontSize: '13px'
        }}>
          No compliance location scope is configured for this account.
        </div>
      )}

      {hasComplianceScope && (
        <>
          <div style={{ ...panelStyle, padding: '14px', marginBottom: '12px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ ...inputStyle, flex: 1, minWidth: isMobileDetail ? '100%' : '220px' }}
                placeholder="Search employees..."
              />
              <select value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} style={{ ...inputStyle, width: isMobileDetail ? '100%' : 'auto', minWidth: isMobileDetail ? '100%' : '110px' }}>
                <option value="all">All Locations</option>
                {siteOptions.map(site => <option key={site} value={site}>{site}</option>)}
              </select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...inputStyle, width: isMobileDetail ? '100%' : 'auto', minWidth: isMobileDetail ? '100%' : '130px' }}>
                <option value="all">All Status</option>
                <option value="overdue">Overdue</option>
                <option value="upcoming">Due Soon</option>
                <option value="current">Current</option>
              </select>
              <button onClick={() => setShowInactive(v => !v)} style={{ ...btnSecondary, minHeight: '40px', width: isMobileDetail ? '100%' : 'auto' }}>{showInactive ? 'Hide Inactive' : 'Show Inactive'}</button>
              <button onClick={() => setShowAddEmployee(true)} style={{ ...btnPrimary, minHeight: '40px', width: isMobileDetail ? '100%' : 'auto' }}>+ Add Employee</button>
            </div>
          </div>

          <div style={{
            display: 'grid',
            gap: '12px',
            gridTemplateColumns: isMobileDetail || !selectedEmployee ? '1fr' : 'minmax(260px, 1fr) minmax(340px, 1.3fr)',
            alignItems: 'start'
          }}>
            <div style={{ ...panelStyle, padding: '10px' }}>
              <div style={{ fontSize: '13px', color: '#465367', marginBottom: '8px' }}>{filteredEmployees.length} employee(s)</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {filteredEmployees.map(emp => {
                  const stats = summaryForItems(itemsByEmployee[emp.id] || [])
                  const isSelected = selectedEmployeeId === emp.id
                  return (
                    <button
                      key={emp.id}
                      onClick={() => setSelectedEmployeeId(emp.id)}
                      style={{
                        textAlign: 'left',
                        width: '100%',
                        border: isSelected ? '2px solid #CD4E42' : '1px solid rgba(17,47,82,0.16)',
                        backgroundColor: isSelected ? 'rgba(205,78,66,0.08)' : 'rgba(17,47,82,0.04)',
                        borderRadius: '10px',
                        padding: isMobileDetail ? '12px' : '10px',
                        cursor: 'pointer'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 700, color: '#1F2C3A' }}>{emp.name}</div>
                          <div style={{ fontSize: '12px', color: '#465367' }}>{emp.site} {emp.active === false ? '• Inactive' : ''}</div>
                        </div>
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                          {stats.overdue > 0 && <span style={{ fontSize: '11px', color: '#B75E54', fontWeight: 700 }}>{stats.overdue} OVD</span>}
                          {stats.upcoming > 0 && <span style={{ fontSize: '11px', color: '#B07A28', fontWeight: 700 }}>{stats.upcoming} SOON</span>}
                          <span style={{ fontSize: '11px', color: '#2F7D57', fontWeight: 700 }}>{stats.current} CUR</span>
                        </div>
                      </div>
                    </button>
                  )
                })}
                {filteredEmployees.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '22px', color: '#556677' }}>No employees found.</div>
                )}
              </div>
            </div>

            {!isMobileDetail && selectedEmployee && (
              <EmployeeDetail
                key={selectedEmployee.id}
                employee={selectedEmployee}
                items={selectedEmployeeItems}
                siteOptions={siteOptions}
                isMobile={false}
                onEmployeeUpdated={handleEmployeeUpdate}
                onItemAdded={handleAddItem}
                onItemUpdated={handleUpdateItem}
                onItemDeleted={handleDeleteItem}
              />
            )}
          </div>

          {isMobileDetail && selectedEmployee && (
            <div style={{
              position: 'fixed',
              inset: 0,
              zIndex: 2900,
              backgroundColor: 'rgba(0,0,0,0.58)',
              padding: '0'
            }}>
              <div style={{
                maxHeight: '100%',
                height: '100%',
                overflow: 'auto',
                backgroundColor: '#F8F5F1',
                padding: '8px',
                paddingBottom: 'calc(10px + env(safe-area-inset-bottom))'
              }}>
                <EmployeeDetail
                  key={selectedEmployee.id}
                  employee={selectedEmployee}
                  items={selectedEmployeeItems}
                  siteOptions={siteOptions}
                  isMobile
                  onClose={() => setSelectedEmployeeId(null)}
                  onEmployeeUpdated={handleEmployeeUpdate}
                  onItemAdded={handleAddItem}
                  onItemUpdated={handleUpdateItem}
                  onItemDeleted={handleDeleteItem}
                />
              </div>
            </div>
          )}
        </>
      )}

      {showAddEmployee && (
        <AddEmployeeModal
          siteOptions={siteOptions}
          onClose={() => setShowAddEmployee(false)}
          onSave={handleAddEmployee}
        />
      )}
    </div>
  )
}

export default CompliancePanel
