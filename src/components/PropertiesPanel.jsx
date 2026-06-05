import { useEffect, useMemo, useState } from 'react'
import { db } from '../firebase'
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc
} from 'firebase/firestore'
import { LOCATIONS, getShiftLabel } from '../data/eocConstants'
import { notifySuccess } from '../utils/toast'
import { getVersionNumber } from '../services/versioning'
import {
  getAvailableMainLocationsForUser,
  isAdminRole,
  locationIdToMainLocation,
  normalizeMainLocation
} from '../utils/orgModel'

const panelCardStyle = {
  backgroundColor: 'rgba(17,47,82,0.08)',
  borderRadius: '12px',
  border: '1px solid rgba(229,57,53,0.2)',
  backdropFilter: 'blur(12px)',
  padding: '14px'
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

const buttonPrimaryStyle = {
  padding: '9px 14px',
  backgroundColor: '#2F7D57',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: '8px',
  fontSize: '13px',
  fontWeight: 700,
  cursor: 'pointer'
}

const buttonSecondaryStyle = {
  padding: '8px 12px',
  backgroundColor: '#F1EFEA',
  color: '#1F3A52',
  border: '1px solid #D8D1C6',
  borderRadius: '8px',
  fontSize: '12px',
  fontWeight: 700,
  cursor: 'pointer'
}

function normalizeText(value) {
  return String(value || '').trim()
}

function formatDate(value) {
  if (!value) return '--'
  const date = value?.toDate ? value.toDate() : new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
}

function locationLabel(locationId) {
  return LOCATIONS.find(location => location.id === locationId)?.label || locationId || 'Unknown location'
}

function buildDefaultPropertyForm(mainLocation = 'OTC') {
  const normalizedMainLocation = normalizeMainLocation(mainLocation) || 'OTC'
  const defaultLocationId = normalizedMainLocation === 'RES' ? 'res' : 'mesquite'
  return {
    name: '',
    mainLocation: normalizedMainLocation,
    locationId: defaultLocationId,
    active: true,
    notes: ''
  }
}

function PropertiesPanel({ user, scopeSites = null, onOpenTab = null }) {
  const isAdmin = isAdminRole(user?.role)
  const allowedMainLocations = useMemo(() => {
    if (isAdmin) return ['OTC', 'RES']
    if (Array.isArray(scopeSites) && scopeSites.length > 0) {
      return [...new Set(scopeSites.map(site => normalizeMainLocation(site)).filter(Boolean))]
    }
    return getAvailableMainLocationsForUser(user)
  }, [isAdmin, scopeSites, user])
  const allowedMainLocationSet = useMemo(() => new Set(allowedMainLocations), [allowedMainLocations])
  const defaultMainLocation = allowedMainLocations[0] || 'OTC'

  const [subTab, setSubTab] = useState('profiles')
  const [properties, setProperties] = useState([])
  const [houseTasks, setHouseTasks] = useState([])
  const [editingPropertyId, setEditingPropertyId] = useState('')
  const [propertyForm, setPropertyForm] = useState(() => buildDefaultPropertyForm(defaultMainLocation))

  useEffect(() => {
    if (allowedMainLocations.length === 0) return () => {}

    const unsubProperties = onSnapshot(
      query(collection(db, 'eocProperties'), orderBy('name', 'asc')),
      (snap) => {
        const rows = snap.docs
          .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
          .filter((row) => {
            const mainLocation = normalizeMainLocation(row.mainLocation) || locationIdToMainLocation(row.locationId)
            return Boolean(mainLocation) && allowedMainLocationSet.has(mainLocation)
          })
        setProperties(rows)
      }
    )

    const unsubHouseTasks = onSnapshot(
      collection(db, 'eocTasks'),
      (snap) => {
        const rows = snap.docs
          .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
          .filter(task => task.taskType === 'house')
          .filter(task => allowedMainLocationSet.has(locationIdToMainLocation(task.locationId)))
          .sort((a, b) => {
            const aDue = String(a.dueDate || '')
            const bDue = String(b.dueDate || '')
            return aDue.localeCompare(bDue)
          })
        setHouseTasks(rows)
      }
    )

    return () => {
      unsubProperties()
      unsubHouseTasks()
    }
  }, [allowedMainLocationSet, allowedMainLocations.length])

  const allowedLocationOptions = useMemo(() => {
    return LOCATIONS.filter(location => allowedMainLocationSet.has(locationIdToMainLocation(location.id)))
  }, [allowedMainLocationSet])

  const profileStats = useMemo(() => {
    return properties.reduce((acc, property) => {
      if (property.active === false) acc.inactive += 1
      else acc.active += 1
      return acc
    }, { active: 0, inactive: 0 })
  }, [properties])

  const openHouseTasks = useMemo(
    () => houseTasks.filter(task => task.status === 'pending' || task.status === 'overdue'),
    [houseTasks]
  )

  const houseTaskSummary = useMemo(() => {
    return openHouseTasks.reduce((acc, task) => {
      if (task.status === 'overdue') acc.overdue += 1
      else acc.pending += 1
      return acc
    }, { overdue: 0, pending: 0 })
  }, [openHouseTasks])

  const handleSaveProperty = async () => {
    try {
      const name = normalizeText(propertyForm.name)
      const mainLocation = normalizeMainLocation(propertyForm.mainLocation)
      const locationId = normalizeText(propertyForm.locationId).toLowerCase()

      if (!name) {
        alert('Property name is required.')
        return
      }
      if (!mainLocation || !allowedMainLocationSet.has(mainLocation)) {
        alert('Valid property main location is required.')
        return
      }
      if (!locationId || !allowedLocationOptions.some(option => option.id === locationId)) {
        alert('Valid property location is required.')
        return
      }

      const payload = {
        name,
        mainLocation,
        locationId,
        active: propertyForm.active !== false,
        notes: normalizeText(propertyForm.notes),
        updatedAt: serverTimestamp()
      }

      if (editingPropertyId) {
        const existing = await getDoc(doc(db, 'eocProperties', editingPropertyId))
        const version = existing.exists() ? getVersionNumber(existing.data()) + 1 : 1
        await updateDoc(doc(db, 'eocProperties', editingPropertyId), {
          ...payload,
          version
        })
        notifySuccess('Property profile updated')
      } else {
        await addDoc(collection(db, 'eocProperties'), {
          ...payload,
          version: 1,
          createdAt: serverTimestamp()
        })
        notifySuccess('Property profile added')
      }

      setEditingPropertyId('')
      setPropertyForm(buildDefaultPropertyForm(defaultMainLocation))
    } catch (error) {
      console.error('Failed to save property profile:', error)
      alert(error?.message || 'Failed to save property profile.')
    }
  }

  const handleEditProperty = (property) => {
    setEditingPropertyId(property.id)
    setPropertyForm({
      name: normalizeText(property.name),
      mainLocation: normalizeMainLocation(property.mainLocation) || locationIdToMainLocation(property.locationId) || defaultMainLocation,
      locationId: normalizeText(property.locationId).toLowerCase(),
      active: property.active !== false,
      notes: normalizeText(property.notes)
    })
  }

  const resetPropertyEditor = () => {
    setEditingPropertyId('')
    setPropertyForm(buildDefaultPropertyForm(defaultMainLocation))
  }

  const canNavigateTabs = typeof onOpenTab === 'function'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ ...panelCardStyle, display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '13px', lineHeight: 1, color: '#4A6072', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Properties</div>
          <h3 style={{ margin: '4px 0 6px 0', fontSize: '22px', color: '#1F2C3A' }}>Properties</h3>
          <div style={{ fontSize: '13px', color: '#4A6072' }}>
            House profiles and House EOC status in one workspace.
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{
            fontSize: '14px',
            fontWeight: 700,
            color: '#1F2C3A',
            backgroundColor: '#F1EFEA',
            border: '1px solid #D8D1C6',
            borderRadius: '999px',
            padding: '8px 12px'
          }}>
            {profileStats.active} active
          </span>
          <span style={{
            fontSize: '14px',
            fontWeight: 700,
            color: '#B75E54',
            backgroundColor: 'rgba(183,94,84,0.12)',
            border: '1px solid rgba(183,94,84,0.35)',
            borderRadius: '999px',
            padding: '8px 12px'
          }}>
            {houseTaskSummary.overdue} overdue
          </span>
          {canNavigateTabs && (
            <>
              <button type="button" style={buttonSecondaryStyle} onClick={() => onOpenTab('eoc')}>
                Open EOC Templates
              </button>
              <button type="button" style={buttonSecondaryStyle} onClick={() => onOpenTab('users')}>
                Open Users
              </button>
            </>
          )}
        </div>
      </div>

      <div style={{ ...panelCardStyle, display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setSubTab('profiles')}
          style={{
            ...buttonSecondaryStyle,
            backgroundColor: subTab === 'profiles' ? '#CD4E42' : buttonSecondaryStyle.backgroundColor,
            color: subTab === 'profiles' ? '#FFFFFF' : buttonSecondaryStyle.color,
            border: subTab === 'profiles' ? '1px solid #CD4E42' : buttonSecondaryStyle.border
          }}
        >
          Property Profiles
        </button>
        <button
          type="button"
          onClick={() => setSubTab('house_status')}
          style={{
            ...buttonSecondaryStyle,
            backgroundColor: subTab === 'house_status' ? '#CD4E42' : buttonSecondaryStyle.backgroundColor,
            color: subTab === 'house_status' ? '#FFFFFF' : buttonSecondaryStyle.color,
            border: subTab === 'house_status' ? '1px solid #CD4E42' : buttonSecondaryStyle.border
          }}
        >
          House EOC Status
        </button>
      </div>

      {subTab === 'profiles' && (
        <div style={{ display: 'grid', gap: '14px', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          <div style={panelCardStyle}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '16px', color: '#1F2C3A' }}>
              {editingPropertyId ? 'Edit Property Profile' : 'New Property Profile'}
            </h4>
            <div style={{ display: 'grid', gap: '10px' }}>
              <input
                style={inputStyle}
                placeholder="Property name"
                value={propertyForm.name}
                onChange={event => setPropertyForm(prev => ({ ...prev, name: event.target.value }))}
              />
              <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                <select
                  style={inputStyle}
                  value={propertyForm.mainLocation}
                  onChange={(event) => {
                    const nextMainLocation = normalizeMainLocation(event.target.value)
                    const locationFallback = nextMainLocation === 'RES' ? 'res' : 'mesquite'
                    setPropertyForm(prev => ({
                      ...prev,
                      mainLocation: nextMainLocation,
                      locationId: locationFallback
                    }))
                  }}
                >
                  {allowedMainLocations.map(mainLocation => (
                    <option key={mainLocation} value={mainLocation}>{mainLocation}</option>
                  ))}
                </select>
                <select
                  style={inputStyle}
                  value={propertyForm.locationId}
                  onChange={event => setPropertyForm(prev => ({ ...prev, locationId: event.target.value }))}
                >
                  {allowedLocationOptions
                    .filter(option => locationIdToMainLocation(option.id) === normalizeMainLocation(propertyForm.mainLocation))
                    .map(option => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                </select>
              </div>
              <select
                style={inputStyle}
                value={propertyForm.active ? 'true' : 'false'}
                onChange={event => setPropertyForm(prev => ({ ...prev, active: event.target.value === 'true' }))}
              >
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
              <textarea
                style={{ ...inputStyle, minHeight: '88px', resize: 'vertical' }}
                placeholder="Add access, maintenance, or operational details..."
                value={propertyForm.notes}
                onChange={event => setPropertyForm(prev => ({ ...prev, notes: event.target.value }))}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
              <button type="button" style={buttonPrimaryStyle} onClick={handleSaveProperty}>
                {editingPropertyId ? 'Save Property' : 'Add Property'}
              </button>
              {editingPropertyId && (
                <button type="button" style={buttonSecondaryStyle} onClick={resetPropertyEditor}>
                  Cancel
                </button>
              )}
            </div>
          </div>

          <div style={panelCardStyle}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '16px', color: '#1F2C3A' }}>
              Property Profiles ({properties.length})
            </h4>
            {properties.length === 0 ? (
              <div style={{ fontSize: '13px', color: '#556677' }}>
                No property profiles yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {properties.map(property => (
                  <div key={property.id} style={{
                    border: '1px solid #D8D1C6',
                    borderRadius: '10px',
                    backgroundColor: 'rgba(255,255,255,0.7)',
                    padding: '10px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                      <div style={{ fontSize: '18px', fontWeight: 700, color: '#1F2C3A' }}>
                        {property.name || 'Unnamed property'}
                      </div>
                      <span style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        color: property.active === false ? '#6B7280' : '#2F7D57',
                        backgroundColor: property.active === false ? '#ECEFF1' : 'rgba(47,125,87,0.13)',
                        border: '1px solid rgba(47,125,87,0.25)',
                        borderRadius: '999px',
                        padding: '4px 8px',
                        textTransform: 'uppercase'
                      }}>
                        {property.active === false ? 'Inactive' : 'Active'}
                      </span>
                    </div>
                    <div style={{ fontSize: '13px', color: '#4A6072', marginTop: '4px' }}>
                      {locationLabel(property.locationId)} | {normalizeMainLocation(property.mainLocation) || '--'}
                    </div>
                    <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '4px' }}>
                      Updated {formatDate(property.updatedAt)} | Created {formatDate(property.createdAt)}
                    </div>
                    {property.notes ? (
                      <div style={{ fontSize: '13px', color: '#1F2C3A', marginTop: '6px' }}>
                        {property.notes}
                      </div>
                    ) : null}
                    <div style={{ marginTop: '8px' }}>
                      <button type="button" style={buttonSecondaryStyle} onClick={() => handleEditProperty(property)}>
                        Edit
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {subTab === 'house_status' && (
        <div style={panelCardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
            <h4 style={{ margin: 0, fontSize: '16px', color: '#1F2C3A' }}>Open House EOC Tasks</h4>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{
                fontSize: '12px',
                fontWeight: 700,
                color: '#B75E54',
                backgroundColor: 'rgba(183,94,84,0.12)',
                border: '1px solid rgba(183,94,84,0.35)',
                borderRadius: '999px',
                padding: '4px 9px'
              }}>
                {houseTaskSummary.overdue} overdue
              </span>
              <span style={{
                fontSize: '12px',
                fontWeight: 700,
                color: '#2F7D57',
                backgroundColor: 'rgba(47,125,87,0.12)',
                border: '1px solid rgba(47,125,87,0.25)',
                borderRadius: '999px',
                padding: '4px 9px'
              }}>
                {houseTaskSummary.pending} pending
              </span>
            </div>
          </div>

          {openHouseTasks.length === 0 ? (
            <div style={{ fontSize: '13px', color: '#556677' }}>
              No open house EOC tasks for your scope.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {openHouseTasks.map(task => (
                <div
                  key={task.id}
                  style={{
                    border: task.status === 'overdue' ? '1px solid rgba(183,94,84,0.35)' : '1px solid #D8D1C6',
                    borderRadius: '10px',
                    backgroundColor: task.status === 'overdue' ? 'rgba(183,94,84,0.08)' : 'rgba(255,255,255,0.75)',
                    padding: '10px'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: '#1F2C3A' }}>
                      {locationLabel(task.locationId)} | {getShiftLabel(task.shiftId)}
                    </div>
                    <span style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      color: task.status === 'overdue' ? '#B75E54' : '#2F7D57',
                      backgroundColor: task.status === 'overdue' ? 'rgba(183,94,84,0.14)' : 'rgba(47,125,87,0.13)',
                      border: task.status === 'overdue' ? '1px solid rgba(183,94,84,0.35)' : '1px solid rgba(47,125,87,0.25)',
                      borderRadius: '999px',
                      padding: '3px 8px'
                    }}>
                      {task.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#4A6072', marginTop: '4px' }}>
                    Due {task.dueDate || '--'} | Assigned {task.assigneeUserName || 'Unassigned'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '4px' }}>
                    Eligible users: {Array.isArray(task.eligibleUserNames) ? task.eligibleUserNames.length : 0}
                  </div>
                  {canNavigateTabs ? (
                    <div style={{ marginTop: '8px' }}>
                      <button type="button" style={buttonSecondaryStyle} onClick={() => onOpenTab('eoc')}>
                        Open EOC Tab
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default PropertiesPanel
