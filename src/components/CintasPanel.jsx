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
  updateDoc
} from 'firebase/firestore'
import { notifySuccess } from '../utils/toast'
import { showConfirmDialog } from '../utils/dialogs'
import { MAIN_LOCATIONS, normalizeMainLocation } from '../utils/orgModel'
import { getStatus } from '../utils/complianceStatus'

const LOCATION_ITEM_CATEGORIES = {
  fire_safety: { label: 'Fire Safety', icon: '\u{1F9EF}' },
  cintas: { label: 'Legacy Cintas Item', icon: '\u{1F9FC}' }
}

const wrapperStyle = {
  backgroundColor: 'rgba(17,47,82,0.08)',
  borderRadius: '12px',
  padding: '16px',
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

function serviceMainLocation(svc) {
  return normalizeMainLocation(svc?.mainLocation)
    || normalizeMainLocation(svc?.locationId)
    || normalizeMainLocation(svc?.site)
    || ''
}

function locationItemMainLocation(item) {
  return normalizeMainLocation(item?.mainLocation)
    || normalizeMainLocation(item?.locationId)
    || normalizeMainLocation(item?.employeeSite)
    || normalizeMainLocation(item?.site)
    || ''
}

function isLocationComplianceItem(item) {
  const category = String(item?.category || '').trim().toLowerCase()
  const targetType = String(item?.targetType || '').trim().toLowerCase()
  if (targetType === 'location') return true
  return category === 'fire_safety' || category === 'cintas'
}

function CintasPanel({ user, scopeSites = null }) {
  const isAdmin = user?.role === 'admin'
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 900)
  const normalizedScopeSites = useMemo(() => {
    if (!Array.isArray(scopeSites)) return []
    return [...new Set(scopeSites.map(s => normalizeMainLocation(s)).filter(Boolean))]
  }, [scopeSites])
  const scopeSiteSet = useMemo(() => new Set(normalizedScopeSites), [normalizedScopeSites])
  const siteOptions = normalizedScopeSites.length > 0 ? normalizedScopeSites : MAIN_LOCATIONS
  const hasScope = isAdmin || normalizedScopeSites.length > 0

  const [services, setServices] = useState([])
  const [locationItems, setLocationItems] = useState([])
  const [siteFilter, setSiteFilter] = useState('all')

  const [addingService, setAddingService] = useState(false)
  const [serviceForm, setServiceForm] = useState({
    mainLocation: 'OTC',
    siteAddress: '',
    serviceType: '',
    monthDue: '',
    fiveYearNote: ''
  })

  const [addingLocationItem, setAddingLocationItem] = useState(false)
  const [itemForm, setItemForm] = useState({
    mainLocation: 'OTC',
    category: 'fire_safety',
    subtype: '',
    lastCompleted: '',
    dueDate: '',
    notes: ''
  })

  const [editingServiceId, setEditingServiceId] = useState(null)
  const [serviceEditDate, setServiceEditDate] = useState('')

  const [editingItemId, setEditingItemId] = useState(null)
  const [itemEditForm, setItemEditForm] = useState({ lastCompleted: '', dueDate: '', notes: '' })

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 900)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!hasScope) return () => {}

    const unsubServices = onSnapshot(
      query(collection(db, 'cintasServices'), orderBy('siteAddress', 'asc')),
      (snap) => {
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        setServices(rows)
      }
    )

    const unsubItems = onSnapshot(
      collection(db, 'complianceItems'),
      (snap) => {
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        setLocationItems(rows.filter(isLocationComplianceItem))
      }
    )

    return () => {
      unsubServices()
      unsubItems()
    }
  }, [hasScope])

  const visibleServices = useMemo(() => {
    return services.filter(row => {
      const mainLocation = serviceMainLocation(row)
      if (!isAdmin && !scopeSiteSet.has(mainLocation)) return false
      if (siteFilter !== 'all' && mainLocation !== siteFilter) return false
      return true
    })
  }, [isAdmin, scopeSiteSet, services, siteFilter])

  const visibleLocationItems = useMemo(() => {
    return locationItems.filter(row => {
      const mainLocation = locationItemMainLocation(row)
      if (!isAdmin && !scopeSiteSet.has(mainLocation)) return false
      if (siteFilter !== 'all' && mainLocation !== siteFilter) return false
      return true
    })
  }, [isAdmin, locationItems, scopeSiteSet, siteFilter])

  const legacyServices = useMemo(() => {
    if (!isAdmin) return []
    return services.filter(row => !serviceMainLocation(row))
  }, [isAdmin, services])

  const legacyLocationItems = useMemo(() => {
    if (!isAdmin) return []
    return locationItems.filter(row => !locationItemMainLocation(row))
  }, [isAdmin, locationItems])

  const groupedServices = useMemo(() => {
    const map = {}
    visibleServices.forEach(row => {
      const mainLocation = serviceMainLocation(row) || 'Unknown'
      const key = `${mainLocation}::${row.siteAddress || 'Unknown Address'}`
      if (!map[key]) {
        map[key] = {
          mainLocation,
          siteAddress: row.siteAddress || 'Unknown Address',
          rows: []
        }
      }
      map[key].rows.push(row)
    })
    return Object.values(map)
  }, [visibleServices])

  const normalizedServiceLocation = normalizeMainLocation(serviceForm.mainLocation) || siteOptions[0] || 'OTC'
  const normalizedItemLocation = normalizeMainLocation(itemForm.mainLocation) || siteOptions[0] || 'OTC'

  const handleAddService = async () => {
    const mainLocation = normalizedServiceLocation
    const siteAddress = String(serviceForm.siteAddress || '').trim()
    const serviceType = String(serviceForm.serviceType || '').trim()
    if (!siteAddress) return alert('Site address is required.')
    if (!serviceType) return alert('Service type is required.')

    await addDoc(collection(db, 'cintasServices'), {
      mainLocation,
      locationId: mainLocation,
      siteAddress,
      serviceType,
      monthDue: String(serviceForm.monthDue || '').trim(),
      fiveYearNote: String(serviceForm.fiveYearNote || '').trim() || null,
      lastCompleted: null,
      source: 'manual',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    })

    setServiceForm({ mainLocation, siteAddress: '', serviceType: '', monthDue: '', fiveYearNote: '' })
    setAddingService(false)
    notifySuccess('Cintas service added')
  }

  const handleDeleteService = async (id) => {
    const confirmed = await showConfirmDialog('Delete this Cintas service?', {
      title: 'Delete Cintas Service',
      confirmText: 'Delete',
      tone: 'danger'
    })
    if (!confirmed) return
    await deleteDoc(doc(db, 'cintasServices', id))
    notifySuccess('Cintas service deleted')
  }

  const handleSaveServiceDate = async (id) => {
    await updateDoc(doc(db, 'cintasServices', id), {
      lastCompleted: serviceEditDate ? Timestamp.fromDate(new Date(serviceEditDate)) : null,
      updatedAt: serverTimestamp()
    })
    setEditingServiceId(null)
    notifySuccess('Service date saved')
  }

  const handleAddLocationItem = async () => {
    const mainLocation = normalizedItemLocation

    await addDoc(collection(db, 'complianceItems'), {
      targetType: 'location',
      mainLocation,
      locationId: mainLocation,
      employeeSite: mainLocation,
      employeeId: null,
      employeeName: null,
      category: itemForm.category,
      subtype: String(itemForm.subtype || '').trim() || null,
      lastCompleted: itemForm.lastCompleted ? Timestamp.fromDate(new Date(itemForm.lastCompleted)) : null,
      dueDate: itemForm.dueDate ? Timestamp.fromDate(new Date(itemForm.dueDate)) : null,
      notes: String(itemForm.notes || '').trim(),
      source: 'manual',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    })

    setAddingLocationItem(false)
    setItemForm({ mainLocation, category: 'fire_safety', subtype: '', lastCompleted: '', dueDate: '', notes: '' })
    notifySuccess('Location compliance item added')
  }

  const handleDeleteLocationItem = async (id) => {
    const confirmed = await showConfirmDialog('Delete this location compliance item?', {
      title: 'Delete Item',
      confirmText: 'Delete',
      tone: 'danger'
    })
    if (!confirmed) return
    await deleteDoc(doc(db, 'complianceItems', id))
    notifySuccess('Location compliance item deleted')
  }

  const handleSaveLocationItem = async (id) => {
    await updateDoc(doc(db, 'complianceItems', id), {
      lastCompleted: itemEditForm.lastCompleted ? Timestamp.fromDate(new Date(itemEditForm.lastCompleted)) : null,
      dueDate: itemEditForm.dueDate ? Timestamp.fromDate(new Date(itemEditForm.dueDate)) : null,
      notes: String(itemEditForm.notes || '').trim(),
      updatedAt: serverTimestamp()
    })
    setEditingItemId(null)
    notifySuccess('Location compliance item updated')
  }

  const assignLegacyServiceLocation = async (id, location) => {
    const normalized = normalizeMainLocation(location)
    if (!normalized) return
    await updateDoc(doc(db, 'cintasServices', id), {
      mainLocation: normalized,
      locationId: normalized,
      updatedAt: serverTimestamp()
    })
    notifySuccess('Legacy service location assigned')
  }

  const assignLegacyLocationItem = async (id, location) => {
    const normalized = normalizeMainLocation(location)
    if (!normalized) return
    await updateDoc(doc(db, 'complianceItems', id), {
      mainLocation: normalized,
      locationId: normalized,
      employeeSite: normalized,
      targetType: 'location',
      updatedAt: serverTimestamp()
    })
    notifySuccess('Legacy location item assigned')
  }

  return (
    <div style={{ display: 'grid', gap: '12px' }}>
      {!hasScope && (
        <div style={{
          padding: '16px',
          borderRadius: '10px',
          backgroundColor: 'rgba(255,152,0,0.15)',
          border: '1px solid rgba(255,152,0,0.3)',
          color: '#B07A28',
          fontSize: '13px'
        }}>
          No Cintas location scope is configured for this account.
        </div>
      )}

      {hasScope && (
        <>
          <div style={wrapperStyle}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} style={{ ...inputStyle, width: isMobile ? '100%' : 'auto', minWidth: isMobile ? '100%' : '130px' }}>
                <option value="all">All Locations</option>
                {siteOptions.map(site => <option key={site} value={site}>{site}</option>)}
              </select>
              <button onClick={() => setAddingService(v => !v)} style={{ ...btnPrimary, minHeight: '40px', width: isMobile ? '100%' : 'auto' }}>{addingService ? 'Close Service Form' : '+ Add Cintas Service'}</button>
              <button onClick={() => setAddingLocationItem(v => !v)} style={{ ...btnSecondary, minHeight: '40px', width: isMobile ? '100%' : 'auto' }}>{addingLocationItem ? 'Close Location Item Form' : '+ Add Fire Safety Item'}</button>
            </div>
          </div>

          {addingService && (
            <div style={wrapperStyle}>
              <h3 style={{ marginTop: 0, color: '#1F2C3A' }}>Add Cintas Service</h3>
              <div style={{ display: 'grid', gap: '8px', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                <select value={normalizedServiceLocation} onChange={(e) => setServiceForm(prev => ({ ...prev, mainLocation: e.target.value }))} style={inputStyle}>
                  {siteOptions.map(site => <option key={site} value={site}>{site}</option>)}
                </select>
                <input value={serviceForm.siteAddress} onChange={(e) => setServiceForm(prev => ({ ...prev, siteAddress: e.target.value }))} style={inputStyle} placeholder="Site address" />
                <input value={serviceForm.serviceType} onChange={(e) => setServiceForm(prev => ({ ...prev, serviceType: e.target.value }))} style={inputStyle} placeholder="Service type" />
                <input value={serviceForm.monthDue} onChange={(e) => setServiceForm(prev => ({ ...prev, monthDue: e.target.value }))} style={inputStyle} placeholder="Month due" />
                <input value={serviceForm.fiveYearNote} onChange={(e) => setServiceForm(prev => ({ ...prev, fiveYearNote: e.target.value }))} style={inputStyle} placeholder="5-year note (optional)" />
              </div>
              <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button onClick={() => setAddingService(false)} style={btnSecondary}>Cancel</button>
                <button onClick={handleAddService} style={btnPrimary}>Save Service</button>
              </div>
            </div>
          )}

          {addingLocationItem && (
            <div style={wrapperStyle}>
              <h3 style={{ marginTop: 0, color: '#1F2C3A' }}>Add Location Compliance Item</h3>
              <div style={{ display: 'grid', gap: '8px', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                <select value={normalizedItemLocation} onChange={(e) => setItemForm(prev => ({ ...prev, mainLocation: e.target.value }))} style={inputStyle}>
                  {siteOptions.map(site => <option key={site} value={site}>{site}</option>)}
                </select>
                <select value={itemForm.category} onChange={(e) => setItemForm(prev => ({ ...prev, category: e.target.value }))} style={inputStyle}>
                  <option value="fire_safety">Fire Safety</option>
                  {isAdmin && <option value="cintas">Legacy Cintas Item</option>}
                </select>
                <input value={itemForm.subtype} onChange={(e) => setItemForm(prev => ({ ...prev, subtype: e.target.value }))} style={inputStyle} placeholder="Subtype (optional)" />
                <input type="date" value={itemForm.lastCompleted} onChange={(e) => setItemForm(prev => ({ ...prev, lastCompleted: e.target.value }))} style={inputStyle} />
                <input type="date" value={itemForm.dueDate} onChange={(e) => setItemForm(prev => ({ ...prev, dueDate: e.target.value }))} style={inputStyle} />
                <input value={itemForm.notes} onChange={(e) => setItemForm(prev => ({ ...prev, notes: e.target.value }))} style={inputStyle} placeholder="Notes" />
              </div>
              <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button onClick={() => setAddingLocationItem(false)} style={btnSecondary}>Cancel</button>
                <button onClick={handleAddLocationItem} style={btnPrimary}>Save Item</button>
              </div>
            </div>
          )}

          <div style={wrapperStyle}>
            <h3 style={{ margin: '0 0 10px 0', color: '#1F2C3A' }}>Cintas Services</h3>
            {groupedServices.length === 0 && <div style={{ color: '#556677' }}>No Cintas services for this scope.</div>}
            <div style={{ display: 'grid', gap: '10px' }}>
              {groupedServices.map(group => (
                <div key={`${group.mainLocation}-${group.siteAddress}`} style={{ border: '1px solid rgba(17,47,82,0.14)', borderRadius: '8px', padding: '10px', backgroundColor: 'rgba(17,47,82,0.05)' }}>
                  <div style={{ fontWeight: 700, color: '#1F2C3A' }}>{group.siteAddress} <span style={{ color: '#465367', fontWeight: 400 }}>({group.mainLocation})</span></div>
                  <div style={{ display: 'grid', gap: '8px', marginTop: '8px' }}>
                    {group.rows.map(row => (
                      <div key={row.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 700, color: '#1F2C3A' }}>{row.serviceType}</div>
                          <div style={{ fontSize: '12px', color: '#465367' }}>Month due: {row.monthDue || '--'} | Last completed: {formatDateShort(row.lastCompleted)}</div>
                          {row.fiveYearNote ? <div style={{ fontSize: '12px', color: '#B07A28' }}>{row.fiveYearNote}</div> : null}
                        </div>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                          {editingServiceId === row.id ? (
                            <>
                              <input type="date" value={serviceEditDate} onChange={(e) => setServiceEditDate(e.target.value)} style={{ ...inputStyle, width: '150px' }} />
                              <button onClick={() => handleSaveServiceDate(row.id)} style={btnPrimary}>Save</button>
                              <button onClick={() => setEditingServiceId(null)} style={btnSecondary}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => { setEditingServiceId(row.id); setServiceEditDate(tsToInputDate(row.lastCompleted)) }} style={btnSecondary}>Edit Date</button>
                              <button onClick={() => handleDeleteService(row.id)} style={btnDanger}>Delete</button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={wrapperStyle}>
            <h3 style={{ margin: '0 0 10px 0', color: '#1F2C3A' }}>Location Compliance Items</h3>
            {visibleLocationItems.length === 0 && <div style={{ color: '#556677' }}>No location compliance items for this scope.</div>}
            <div style={{ display: 'grid', gap: '8px' }}>
              {visibleLocationItems.map(item => {
                const mainLocation = locationItemMainLocation(item) || '--'
                const category = String(item.category || '').trim().toLowerCase()
                const categoryMeta = LOCATION_ITEM_CATEGORIES[category] || { label: category || 'Location item', icon: '\u{1F4CB}' }
                const status = getStatus(item.dueDate)
                return (
                  <div key={item.id} style={{ border: '1px solid rgba(17,47,82,0.14)', borderRadius: '8px', padding: '10px', backgroundColor: 'rgba(17,47,82,0.05)' }}>
                    {editingItemId === item.id ? (
                      <>
                        <div style={{ display: 'grid', gap: '8px', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                          <input type="date" value={itemEditForm.lastCompleted} onChange={(e) => setItemEditForm(prev => ({ ...prev, lastCompleted: e.target.value }))} style={inputStyle} />
                          <input type="date" value={itemEditForm.dueDate} onChange={(e) => setItemEditForm(prev => ({ ...prev, dueDate: e.target.value }))} style={inputStyle} />
                          <input value={itemEditForm.notes} onChange={(e) => setItemEditForm(prev => ({ ...prev, notes: e.target.value }))} style={inputStyle} placeholder="Notes" />
                        </div>
                        <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                          <button onClick={() => setEditingItemId(null)} style={btnSecondary}>Cancel</button>
                          <button onClick={() => handleSaveLocationItem(item.id)} style={btnPrimary}>Save</button>
                        </div>
                      </>
                    ) : (
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 700, color: '#1F2C3A' }}>{categoryMeta.icon} {categoryMeta.label}</div>
                          <div style={{ fontSize: '12px', color: '#465367' }}>Location: {mainLocation} | Due: {formatDateShort(item.dueDate)} | Last: {formatDateShort(item.lastCompleted)}</div>
                          {item.subtype ? <div style={{ fontSize: '12px', color: '#465367' }}>Subtype: {item.subtype}</div> : null}
                          {item.notes ? <div style={{ fontSize: '12px', color: '#556677' }}>Notes: {item.notes}</div> : null}
                        </div>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                          {statusBadge(status)}
                          <button
                            onClick={() => {
                              setEditingItemId(item.id)
                              setItemEditForm({
                                lastCompleted: tsToInputDate(item.lastCompleted),
                                dueDate: tsToInputDate(item.dueDate),
                                notes: item.notes || ''
                              })
                            }}
                            style={btnSecondary}
                          >
                            Edit
                          </button>
                          <button onClick={() => handleDeleteLocationItem(item.id)} style={btnDanger}>Delete</button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {isAdmin && (legacyServices.length > 0 || legacyLocationItems.length > 0) && (
            <div style={{ ...wrapperStyle, border: '1px solid rgba(255,152,0,0.45)', backgroundColor: 'rgba(255,152,0,0.10)' }}>
              <h3 style={{ margin: '0 0 10px 0', color: '#B07A28' }}>Needs Location Assignment</h3>
              {legacyServices.length > 0 && (
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontWeight: 700, color: '#1F2C3A', marginBottom: '6px' }}>Legacy Cintas services without location</div>
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {legacyServices.map(row => (
                      <div key={row.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <div>{row.siteAddress || 'Unknown address'} - {row.serviceType || 'Unknown service'}</div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          {siteOptions.map(site => (
                            <button key={site} onClick={() => assignLegacyServiceLocation(row.id, site)} style={btnSecondary}>Assign {site}</button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {legacyLocationItems.length > 0 && (
                <div>
                  <div style={{ fontWeight: 700, color: '#1F2C3A', marginBottom: '6px' }}>Legacy location compliance items without location</div>
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {legacyLocationItems.map(row => (
                      <div key={row.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <div>{LOCATION_ITEM_CATEGORIES[row.category]?.label || row.category || 'Item'} - Due {formatDateShort(row.dueDate)}</div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          {siteOptions.map(site => (
                            <button key={site} onClick={() => assignLegacyLocationItem(row.id, site)} style={btnSecondary}>Assign {site}</button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default CintasPanel
