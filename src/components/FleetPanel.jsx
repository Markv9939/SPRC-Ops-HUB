import { useEffect, useMemo, useState } from 'react'
import { db } from '../firebase'
import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where
} from 'firebase/firestore'
import { LOCATIONS, VANS } from '../data/eocConstants'
import { notifySuccess } from '../utils/toast'
import { getVersionNumber } from '../services/versioning'
import { logFleetServiceRecord, syncFleetTasksForUserScope, syncFleetTasksForVehicle } from '../services/fleetTaskEngine'
import {
  DEFAULT_MILESTONE_SOON_WINDOW_MILES,
  DEFAULT_OIL_INTERVAL_MILES,
  DEFAULT_OIL_SOON_WINDOW_MILES,
  FLEET_TASK_TYPE,
  getFleetTaskTypeLabel,
  parseMileageValue,
  toIsoDate
} from '../utils/fleetStatus'
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

function formatDateForUi(value) {
  if (!value) return '--'
  const date = value?.toDate ? value.toDate() : new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
}

function formatMileage(value) {
  const parsed = parseMileageValue(value)
  if (parsed === null) return '--'
  return parsed.toLocaleString('en-US')
}

function normalizeText(value) {
  return String(value || '').trim()
}

function normalizeTemplateIdList(values) {
  if (!Array.isArray(values)) return []
  return [...new Set(values.map(value => normalizeText(value)).filter(Boolean))]
}

function toDateInput(value) {
  return toIsoDate(value)
}

function buildDefaultVehicleForm(mainLocation = 'OTC') {
  return {
    name: '',
    vin: '',
    vanId: '',
    mainLocation,
    locationId: '',
    active: true,
    oilChangeIntervalMiles: String(DEFAULT_OIL_INTERVAL_MILES),
    oilSoonWindowMiles: String(DEFAULT_OIL_SOON_WINDOW_MILES),
    oilBaselineMileage: '',
    insuranceDueDate: '',
    registrationDueDate: '',
    disabledMaintenanceTemplateIds: [],
    customMaintenanceText: ''
  }
}

function buildDefaultTemplateForm(mainLocation = 'OTC') {
  return {
    mainLocation,
    title: '',
    dueMileage: '',
    soonWindowMiles: String(DEFAULT_MILESTONE_SOON_WINDOW_MILES),
    active: true
  }
}

function buildDefaultServiceForm() {
  const today = toIsoDate(new Date())
  return {
    vehicleId: '',
    serviceType: FLEET_TASK_TYPE.OIL_CHANGE,
    maintenanceTemplateId: '',
    milestoneKey: '',
    serviceDate: today,
    mileageAtService: '',
    renewalDueDate: '',
    vendorName: '',
    notes: '',
    documentUrl: ''
  }
}

function serializeCustomMilestones(items) {
  if (!Array.isArray(items) || items.length === 0) return ''
  return items
    .filter(item => item?.active !== false)
    .map((item) => {
      const title = normalizeText(item?.title) || 'Milestone'
      const dueMileage = parseMileageValue(item?.dueMileage)
      const soonWindowMiles = parseMileageValue(item?.soonWindowMiles) ?? DEFAULT_MILESTONE_SOON_WINDOW_MILES
      if (dueMileage === null) return ''
      return `${title}|${dueMileage}|${soonWindowMiles}`
    })
    .filter(Boolean)
    .join('\n')
}

function parseCustomMilestones(text) {
  const lines = String(text || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  return lines.map((line, idx) => {
    const [titlePart, duePart, soonPart] = line.split('|').map(part => normalizeText(part))
    const title = titlePart || `Milestone ${idx + 1}`
    const dueMileage = parseMileageValue(duePart)
    if (dueMileage === null) {
      throw new Error(`Custom milestone line ${idx + 1} has invalid due mileage.`)
    }
    const soonWindowMiles = parseMileageValue(soonPart) ?? DEFAULT_MILESTONE_SOON_WINDOW_MILES
    return {
      id: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${dueMileage}`,
      title,
      dueMileage,
      soonWindowMiles,
      active: true
    }
  })
}

function FleetPanel({ user, scopeSites = null }) {
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

  const [subTab, setSubTab] = useState('vehicles')
  const [vehicles, setVehicles] = useState([])
  const [runtimeMap, setRuntimeMap] = useState({})
  const [templates, setTemplates] = useState([])
  const [openFleetTasks, setOpenFleetTasks] = useState([])
  const [serviceRecords, setServiceRecords] = useState([])

  const [editingVehicleId, setEditingVehicleId] = useState('')
  const [vehicleForm, setVehicleForm] = useState(() => buildDefaultVehicleForm(defaultMainLocation))

  const [editingTemplateId, setEditingTemplateId] = useState('')
  const [templateForm, setTemplateForm] = useState(() => buildDefaultTemplateForm(defaultMainLocation))

  const [serviceForm, setServiceForm] = useState(buildDefaultServiceForm)
  const [savingService, setSavingService] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)

  useEffect(() => {
    setVehicleForm(prev => ({ ...buildDefaultVehicleForm(defaultMainLocation), ...prev, mainLocation: prev.mainLocation || defaultMainLocation }))
    setTemplateForm(prev => ({ ...buildDefaultTemplateForm(defaultMainLocation), ...prev, mainLocation: prev.mainLocation || defaultMainLocation }))
  }, [defaultMainLocation])

  useEffect(() => {
    if (allowedMainLocations.length === 0) return () => {}

    const unsubVehicles = onSnapshot(
      query(collection(db, 'eocVehicles'), orderBy('name', 'asc')),
      (snap) => {
        const rows = snap.docs
          .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
          .filter((row) => {
            const mainLocation = normalizeMainLocation(row.mainLocation) || locationIdToMainLocation(row.locationId)
            return mainLocation && allowedMainLocationSet.has(mainLocation)
          })
        setVehicles(rows)
      }
    )

    const unsubTemplates = onSnapshot(
      query(collection(db, 'fleetMaintenanceTemplates'), orderBy('dueMileage', 'asc')),
      (snap) => {
        const rows = snap.docs
          .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
          .filter(row => allowedMainLocationSet.has(normalizeMainLocation(row.mainLocation)))
        setTemplates(rows)
      }
    )

    const unsubRuntime = onSnapshot(
      collection(db, 'fleetVehicleRuntime'),
      (snap) => {
        const map = {}
        snap.docs.forEach((docSnap) => {
          map[docSnap.id] = { id: docSnap.id, ...docSnap.data() }
        })
        setRuntimeMap(map)
      }
    )

    const unsubOverdueTasks = onSnapshot(
      query(collection(db, 'fleetTasks'), where('status', '==', 'overdue')),
      (snap) => {
        const rows = snap.docs
          .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
          .filter(row => allowedMainLocationSet.has(normalizeMainLocation(row.mainLocation)))
        setOpenFleetTasks(prev => {
          const upcoming = prev.filter(item => item.status === 'upcoming')
          return [...upcoming, ...rows]
        })
      }
    )

    const unsubUpcomingTasks = onSnapshot(
      query(collection(db, 'fleetTasks'), where('status', '==', 'upcoming')),
      (snap) => {
        const rows = snap.docs
          .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
          .filter(row => allowedMainLocationSet.has(normalizeMainLocation(row.mainLocation)))
        setOpenFleetTasks(prev => {
          const overdue = prev.filter(item => item.status === 'overdue')
          return [...overdue, ...rows]
        })
      }
    )

    const unsubServiceRecords = onSnapshot(
      query(collection(db, 'vehicleServiceRecords'), orderBy('serviceDate', 'desc')),
      (snap) => {
        const rows = snap.docs
          .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
          .filter(row => allowedMainLocationSet.has(normalizeMainLocation(row.mainLocation)))
        setServiceRecords(rows)
      }
    )

    return () => {
      unsubVehicles()
      unsubTemplates()
      unsubRuntime()
      unsubOverdueTasks()
      unsubUpcomingTasks()
      unsubServiceRecords()
    }
  }, [allowedMainLocationSet, allowedMainLocations.length])

  const templatesByMainLocation = useMemo(() => {
    const map = {}
    templates.forEach((template) => {
      const mainLocation = normalizeMainLocation(template.mainLocation)
      if (!mainLocation) return
      if (!map[mainLocation]) map[mainLocation] = []
      map[mainLocation].push(template)
    })
    return map
  }, [templates])

  const vehicleMap = useMemo(() => {
    const map = {}
    vehicles.forEach((vehicle) => {
      map[vehicle.id] = vehicle
    })
    return map
  }, [vehicles])

  const filteredServiceRecords = useMemo(() => {
    return serviceRecords.slice(0, 40)
  }, [serviceRecords])

  const taskSummary = useMemo(() => {
    return openFleetTasks.reduce((acc, task) => {
      if (task.status === 'overdue') acc.overdue += 1
      else if (task.status === 'upcoming') acc.upcoming += 1
      return acc
    }, { overdue: 0, upcoming: 0 })
  }, [openFleetTasks])

  const locationOptionsForMain = useMemo(() => {
    return LOCATIONS.filter(location => locationIdToMainLocation(location.id) === normalizeMainLocation(vehicleForm.mainLocation))
  }, [vehicleForm.mainLocation])

  const selectedServiceVehicle = vehicleMap[serviceForm.vehicleId] || null
  const selectedServiceVehicleRuntime = selectedServiceVehicle ? runtimeMap[selectedServiceVehicle.id] : null
  const selectedVehicleOpenMilestones = useMemo(() => {
    if (!serviceForm.vehicleId) return []
    return openFleetTasks
      .filter(task => task.vehicleId === serviceForm.vehicleId)
      .filter(task => task.taskType === FLEET_TASK_TYPE.MAINTENANCE_MILESTONE)
      .sort((a, b) => (a.dueMileage || 0) - (b.dueMileage || 0))
  }, [openFleetTasks, serviceForm.vehicleId])

  const handleForceSync = async () => {
    setIsSyncing(true)
    try {
      const result = await syncFleetTasksForUserScope(user)
      notifySuccess(`Fleet sync complete (${result.created} created, ${result.updated} updated)`)
    } catch (error) {
      console.error('Fleet sync failed:', error)
      alert(error?.message || 'Fleet sync failed.')
    } finally {
      setIsSyncing(false)
    }
  }

  const handleSaveVehicle = async () => {
    try {
      const name = normalizeText(vehicleForm.name)
      const vin = normalizeText(vehicleForm.vin)
      const mainLocation = normalizeMainLocation(vehicleForm.mainLocation)
      if (!name || !vin) {
        alert('Vehicle name and VIN are required.')
        return
      }
      if (!mainLocation || !allowedMainLocationSet.has(mainLocation)) {
        alert('Valid main location is required.')
        return
      }

      const intervalMiles = parseMileageValue(vehicleForm.oilChangeIntervalMiles)
      const soonWindowMiles = parseMileageValue(vehicleForm.oilSoonWindowMiles)
      if (intervalMiles === null || intervalMiles <= 0) {
        alert('Oil interval must be a positive mileage value.')
        return
      }
      if (soonWindowMiles === null) {
        alert('Oil soon window must be a valid mileage value.')
        return
      }

      const baselineMileage = parseMileageValue(vehicleForm.oilBaselineMileage)
      const customMilestones = parseCustomMilestones(vehicleForm.customMaintenanceText)
      const insuranceDueDate = normalizeText(vehicleForm.insuranceDueDate)
      const registrationDueDate = normalizeText(vehicleForm.registrationDueDate)

      const payload = {
        name,
        vin,
        vanId: normalizeText(vehicleForm.vanId) || null,
        mainLocation,
        locationId: normalizeText(vehicleForm.locationId) || null,
        active: vehicleForm.active !== false,
        oilChangeIntervalMiles: intervalMiles,
        oilSoonWindowMiles: soonWindowMiles,
        oilBaselineMileage: baselineMileage ?? 0,
        insuranceDueDate: insuranceDueDate ? Timestamp.fromDate(new Date(insuranceDueDate)) : null,
        registrationDueDate: registrationDueDate ? Timestamp.fromDate(new Date(registrationDueDate)) : null,
        disabledMaintenanceTemplateIds: normalizeTemplateIdList(vehicleForm.disabledMaintenanceTemplateIds),
        customMaintenanceMilestones: customMilestones,
        updatedAt: serverTimestamp()
      }

      if (editingVehicleId) {
        const existing = await getDoc(doc(db, 'eocVehicles', editingVehicleId))
        const version = existing.exists() ? getVersionNumber(existing.data()) + 1 : 1
        await updateDoc(doc(db, 'eocVehicles', editingVehicleId), {
          ...payload,
          version
        })
        await syncFleetTasksForVehicle({ vehicleId: editingVehicleId })
        notifySuccess('Vehicle profile updated')
      } else {
        const ref = await addDoc(collection(db, 'eocVehicles'), {
          ...payload,
          version: 1,
          createdAt: serverTimestamp()
        })
        await syncFleetTasksForVehicle({ vehicleId: ref.id })
        notifySuccess('Vehicle profile created')
      }

      setEditingVehicleId('')
      setVehicleForm(buildDefaultVehicleForm(defaultMainLocation))
    } catch (error) {
      console.error('Failed to save vehicle profile:', error)
      alert(error?.message || 'Failed to save vehicle profile.')
    }
  }

  const startEditVehicle = (vehicle) => {
    setEditingVehicleId(vehicle.id)
    setSubTab('vehicles')
    setVehicleForm({
      name: vehicle.name || '',
      vin: vehicle.vin || '',
      vanId: vehicle.vanId || '',
      mainLocation: normalizeMainLocation(vehicle.mainLocation) || locationIdToMainLocation(vehicle.locationId) || defaultMainLocation,
      locationId: vehicle.locationId || '',
      active: vehicle.active !== false,
      oilChangeIntervalMiles: String(parseMileageValue(vehicle.oilChangeIntervalMiles) ?? DEFAULT_OIL_INTERVAL_MILES),
      oilSoonWindowMiles: String(parseMileageValue(vehicle.oilSoonWindowMiles) ?? DEFAULT_OIL_SOON_WINDOW_MILES),
      oilBaselineMileage: String(parseMileageValue(vehicle.oilBaselineMileage) ?? ''),
      insuranceDueDate: toDateInput(vehicle.insuranceDueDate),
      registrationDueDate: toDateInput(vehicle.registrationDueDate),
      disabledMaintenanceTemplateIds: normalizeTemplateIdList(vehicle.disabledMaintenanceTemplateIds),
      customMaintenanceText: serializeCustomMilestones(vehicle.customMaintenanceMilestones)
    })
  }

  const handleSaveTemplate = async () => {
    try {
      const mainLocation = normalizeMainLocation(templateForm.mainLocation)
      const title = normalizeText(templateForm.title)
      const dueMileage = parseMileageValue(templateForm.dueMileage)
      const soonWindowMiles = parseMileageValue(templateForm.soonWindowMiles) ?? DEFAULT_MILESTONE_SOON_WINDOW_MILES
      if (!mainLocation || !allowedMainLocationSet.has(mainLocation)) {
        alert('Valid template main location is required.')
        return
      }
      if (!title) {
        alert('Template title is required.')
        return
      }
      if (dueMileage === null) {
        alert('Template due mileage is required.')
        return
      }

      const payload = {
        mainLocation,
        title,
        dueMileage,
        soonWindowMiles,
        active: templateForm.active !== false,
        updatedAt: serverTimestamp(),
        updatedByUserId: user?.id || null,
        updatedByName: user?.name || null
      }

      if (editingTemplateId) {
        const existing = await getDoc(doc(db, 'fleetMaintenanceTemplates', editingTemplateId))
        const version = existing.exists() ? getVersionNumber(existing.data()) + 1 : 1
        await updateDoc(doc(db, 'fleetMaintenanceTemplates', editingTemplateId), {
          ...payload,
          version
        })
        notifySuccess('Mileage template updated')
      } else {
        await addDoc(collection(db, 'fleetMaintenanceTemplates'), {
          ...payload,
          version: 1,
          createdAt: serverTimestamp(),
          createdByUserId: user?.id || null,
          createdByName: user?.name || null
        })
        notifySuccess('Mileage template created')
      }

      await syncFleetTasksForUserScope(user)
      setEditingTemplateId('')
      setTemplateForm(buildDefaultTemplateForm(defaultMainLocation))
    } catch (error) {
      console.error('Failed to save mileage template:', error)
      alert(error?.message || 'Failed to save mileage template.')
    }
  }

  const startEditTemplate = (template) => {
    setEditingTemplateId(template.id)
    setSubTab('templates')
    setTemplateForm({
      mainLocation: normalizeMainLocation(template.mainLocation) || defaultMainLocation,
      title: template.title || '',
      dueMileage: String(parseMileageValue(template.dueMileage) ?? ''),
      soonWindowMiles: String(parseMileageValue(template.soonWindowMiles) ?? DEFAULT_MILESTONE_SOON_WINDOW_MILES),
      active: template.active !== false
    })
  }

  const handleLogService = async () => {
    if (!serviceForm.vehicleId) {
      alert('Select a vehicle first.')
      return
    }
    setSavingService(true)
    try {
      const serviceType = serviceForm.serviceType
      const payload = {
        actor: user,
        vehicleId: serviceForm.vehicleId,
        serviceType,
        maintenanceTemplateId: normalizeText(serviceForm.maintenanceTemplateId) || null,
        milestoneKey: normalizeText(serviceForm.milestoneKey) || null,
        serviceDate: serviceForm.serviceDate ? new Date(serviceForm.serviceDate) : null,
        mileageAtService: normalizeText(serviceForm.mileageAtService) || null,
        renewalDueDate: serviceForm.renewalDueDate ? new Date(serviceForm.renewalDueDate) : null,
        vendorName: serviceForm.vendorName,
        notes: serviceForm.notes,
        documentUrl: serviceForm.documentUrl
      }
      await logFleetServiceRecord(payload)
      notifySuccess('Service record logged')
      setServiceForm({
        ...buildDefaultServiceForm(),
        vehicleId: serviceForm.vehicleId
      })
    } catch (error) {
      console.error('Failed to log service record:', error)
      alert(error?.message || 'Failed to log service record.')
    } finally {
      setSavingService(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: '12px' }}>
      {allowedMainLocations.length === 0 && (
        <div style={{
          padding: '14px',
          borderRadius: '10px',
          backgroundColor: 'rgba(255,152,0,0.15)',
          border: '1px solid rgba(255,152,0,0.3)',
          color: '#B07A28',
          fontSize: '13px'
        }}>
          No Fleet location scope is configured for this account.
        </div>
      )}

      {allowedMainLocations.length > 0 && (
        <>
          <div style={{ ...panelCardStyle, display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#1F2C3A' }}>Fleet Maintenance</div>
              <div style={{ fontSize: '12px', color: '#465367', marginTop: '2px' }}>
                Overdue tasks stay visible until service/renewal records resolve them.
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <div style={{ ...panelCardStyle, backgroundColor: 'rgba(183,94,84,0.12)', padding: '8px 10px' }}>
                <strong>{taskSummary.overdue}</strong> overdue
              </div>
              <div style={{ ...panelCardStyle, backgroundColor: 'rgba(176,122,40,0.12)', padding: '8px 10px' }}>
                <strong>{taskSummary.upcoming}</strong> upcoming
              </div>
              <button onClick={handleForceSync} disabled={isSyncing} style={{ ...buttonSecondaryStyle, minHeight: '38px' }}>
                {isSyncing ? 'Syncing...' : 'Run Fleet Sync'}
              </button>
            </div>
          </div>

          <div style={{ ...panelCardStyle, display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button onClick={() => setSubTab('vehicles')} style={{ ...buttonSecondaryStyle, backgroundColor: subTab === 'vehicles' ? '#CD4E42' : buttonSecondaryStyle.backgroundColor, color: subTab === 'vehicles' ? '#fff' : buttonSecondaryStyle.color }}>
              Vehicles
            </button>
            <button onClick={() => setSubTab('templates')} style={{ ...buttonSecondaryStyle, backgroundColor: subTab === 'templates' ? '#CD4E42' : buttonSecondaryStyle.backgroundColor, color: subTab === 'templates' ? '#fff' : buttonSecondaryStyle.color }}>
              Mileage Templates
            </button>
            <button onClick={() => setSubTab('service')} style={{ ...buttonSecondaryStyle, backgroundColor: subTab === 'service' ? '#CD4E42' : buttonSecondaryStyle.backgroundColor, color: subTab === 'service' ? '#fff' : buttonSecondaryStyle.color }}>
              Service Records
            </button>
          </div>

          {subTab === 'vehicles' && (
            <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'minmax(280px, 1fr) minmax(300px, 1.2fr)' }}>
              <div style={panelCardStyle}>
                <h4 style={{ margin: '0 0 10px 0', color: '#1F2C3A' }}>{editingVehicleId ? 'Edit Vehicle Profile' : 'New Vehicle Profile'}</h4>
                <div style={{ display: 'grid', gap: '8px' }}>
                  <input value={vehicleForm.name} onChange={e => setVehicleForm(prev => ({ ...prev, name: e.target.value }))} style={inputStyle} placeholder="Vehicle name" />
                  <input value={vehicleForm.vin} onChange={e => setVehicleForm(prev => ({ ...prev, vin: e.target.value }))} style={inputStyle} placeholder="VIN" />
                  <div style={{ display: 'grid', gap: '8px', gridTemplateColumns: '1fr 1fr' }}>
                    <select value={vehicleForm.mainLocation} onChange={e => setVehicleForm(prev => ({ ...prev, mainLocation: e.target.value }))} style={inputStyle}>
                      {allowedMainLocations.map(location => <option key={location} value={location}>{location}</option>)}
                    </select>
                    <select value={vehicleForm.locationId} onChange={e => setVehicleForm(prev => ({ ...prev, locationId: e.target.value }))} style={inputStyle}>
                      <option value="">House / location (optional)</option>
                      {locationOptionsForMain.map(location => <option key={location.id} value={location.id}>{location.label}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'grid', gap: '8px', gridTemplateColumns: '1fr 1fr' }}>
                    <select value={vehicleForm.vanId} onChange={e => setVehicleForm(prev => ({ ...prev, vanId: e.target.value }))} style={inputStyle}>
                      <option value="">Van (optional)</option>
                      {VANS.map(van => <option key={van.id} value={van.id}>{van.label}</option>)}
                    </select>
                    <select value={vehicleForm.active ? 'true' : 'false'} onChange={e => setVehicleForm(prev => ({ ...prev, active: e.target.value === 'true' }))} style={inputStyle}>
                      <option value="true">Active</option>
                      <option value="false">Inactive</option>
                    </select>
                  </div>
                  <div style={{ display: 'grid', gap: '8px', gridTemplateColumns: '1fr 1fr 1fr' }}>
                    <input value={vehicleForm.oilChangeIntervalMiles} onChange={e => setVehicleForm(prev => ({ ...prev, oilChangeIntervalMiles: e.target.value }))} style={inputStyle} placeholder="Oil interval" />
                    <input value={vehicleForm.oilSoonWindowMiles} onChange={e => setVehicleForm(prev => ({ ...prev, oilSoonWindowMiles: e.target.value }))} style={inputStyle} placeholder="Oil soon window" />
                    <input value={vehicleForm.oilBaselineMileage} onChange={e => setVehicleForm(prev => ({ ...prev, oilBaselineMileage: e.target.value }))} style={inputStyle} placeholder="Oil baseline" />
                  </div>
                  <div style={{ display: 'grid', gap: '8px', gridTemplateColumns: '1fr 1fr' }}>
                    <input type="date" value={vehicleForm.insuranceDueDate} onChange={e => setVehicleForm(prev => ({ ...prev, insuranceDueDate: e.target.value }))} style={inputStyle} />
                    <input type="date" value={vehicleForm.registrationDueDate} onChange={e => setVehicleForm(prev => ({ ...prev, registrationDueDate: e.target.value }))} style={inputStyle} />
                  </div>

                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#465367', marginBottom: '4px' }}>Disable mileage templates for this vehicle</div>
                    <div style={{ display: 'grid', gap: '4px' }}>
                      {(templatesByMainLocation[normalizeMainLocation(vehicleForm.mainLocation)] || []).map((template) => {
                        const checked = vehicleForm.disabledMaintenanceTemplateIds.includes(template.id)
                        return (
                          <label key={template.id} style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12px', color: '#465367' }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => {
                                const isChecked = event.target.checked
                                setVehicleForm((prev) => {
                                  const current = normalizeTemplateIdList(prev.disabledMaintenanceTemplateIds)
                                  if (isChecked) {
                                    return { ...prev, disabledMaintenanceTemplateIds: [...current, template.id] }
                                  }
                                  return { ...prev, disabledMaintenanceTemplateIds: current.filter(id => id !== template.id) }
                                })
                              }}
                            />
                            {template.title} ({formatMileage(template.dueMileage)} mi)
                          </label>
                        )
                      })}
                      {(templatesByMainLocation[normalizeMainLocation(vehicleForm.mainLocation)] || []).length === 0 && (
                        <div style={{ fontSize: '12px', color: '#556677' }}>No templates for this main location yet.</div>
                      )}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#465367', marginBottom: '4px' }}>
                      Custom milestones (`Title|DueMileage|SoonWindow`)
                    </div>
                    <textarea
                      value={vehicleForm.customMaintenanceText}
                      onChange={e => setVehicleForm(prev => ({ ...prev, customMaintenanceText: e.target.value }))}
                      rows={4}
                      style={{ ...inputStyle, resize: 'vertical' }}
                      placeholder="Transmission service|60000|500"
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button onClick={handleSaveVehicle} style={buttonPrimaryStyle}>
                      {editingVehicleId ? 'Save Vehicle' : 'Create Vehicle'}
                    </button>
                    {editingVehicleId && (
                      <button onClick={() => {
                        setEditingVehicleId('')
                        setVehicleForm(buildDefaultVehicleForm(defaultMainLocation))
                      }} style={buttonSecondaryStyle}>
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div style={panelCardStyle}>
                <h4 style={{ margin: '0 0 10px 0', color: '#1F2C3A' }}>Vehicle Profiles ({vehicles.length})</h4>
                <div style={{ display: 'grid', gap: '8px' }}>
                  {vehicles.map((vehicle) => {
                    const runtime = runtimeMap[vehicle.id]
                    return (
                      <div key={vehicle.id} style={{ border: '1px solid rgba(17,47,82,0.14)', borderRadius: '8px', backgroundColor: 'rgba(17,47,82,0.05)', padding: '10px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                          <div>
                            <div style={{ fontWeight: 700, color: '#1F2C3A' }}>{vehicle.name || vehicle.vanId || vehicle.id}</div>
                            <div style={{ fontSize: '12px', color: '#556677' }}>
                              {normalizeMainLocation(vehicle.mainLocation) || locationIdToMainLocation(vehicle.locationId) || '--'}
                              {' '}| {vehicle.vanId || '--'}
                              {' '}| VIN {vehicle.vin || '--'}
                            </div>
                          </div>
                          <button onClick={() => startEditVehicle(vehicle)} style={buttonSecondaryStyle}>Edit</button>
                        </div>
                        <div style={{ marginTop: '8px', fontSize: '12px', color: '#465367' }}>
                          Runtime: {formatMileage(runtime?.lastKnownMileage)} mi
                          {' '}| Last update {formatDateForUi(runtime?.lastKnownMileageAt)}
                          {' '}| Oil baseline {formatMileage(vehicle.oilBaselineMileage)}
                        </div>
                        <div style={{ marginTop: '4px', fontSize: '12px', color: '#465367' }}>
                          Insurance due {formatDateForUi(vehicle.insuranceDueDate)}
                          {' '}| Registration due {formatDateForUi(vehicle.registrationDueDate)}
                        </div>
                      </div>
                    )
                  })}
                  {vehicles.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '18px', color: '#556677' }}>No vehicles in this scope.</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {subTab === 'templates' && (
            <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'minmax(280px, 1fr) minmax(300px, 1.2fr)' }}>
              <div style={panelCardStyle}>
                <h4 style={{ margin: '0 0 10px 0', color: '#1F2C3A' }}>{editingTemplateId ? 'Edit Mileage Template' : 'New Mileage Template'}</h4>
                <div style={{ display: 'grid', gap: '8px' }}>
                  <select value={templateForm.mainLocation} onChange={e => setTemplateForm(prev => ({ ...prev, mainLocation: e.target.value }))} style={inputStyle}>
                    {allowedMainLocations.map(location => <option key={location} value={location}>{location}</option>)}
                  </select>
                  <input value={templateForm.title} onChange={e => setTemplateForm(prev => ({ ...prev, title: e.target.value }))} style={inputStyle} placeholder="Template title" />
                  <div style={{ display: 'grid', gap: '8px', gridTemplateColumns: '1fr 1fr' }}>
                    <input value={templateForm.dueMileage} onChange={e => setTemplateForm(prev => ({ ...prev, dueMileage: e.target.value }))} style={inputStyle} placeholder="Due mileage" />
                    <input value={templateForm.soonWindowMiles} onChange={e => setTemplateForm(prev => ({ ...prev, soonWindowMiles: e.target.value }))} style={inputStyle} placeholder="Soon window miles" />
                  </div>
                  <select value={templateForm.active ? 'true' : 'false'} onChange={e => setTemplateForm(prev => ({ ...prev, active: e.target.value === 'true' }))} style={inputStyle}>
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={handleSaveTemplate} style={buttonPrimaryStyle}>
                      {editingTemplateId ? 'Save Template' : 'Create Template'}
                    </button>
                    {editingTemplateId && (
                      <button onClick={() => {
                        setEditingTemplateId('')
                        setTemplateForm(buildDefaultTemplateForm(defaultMainLocation))
                      }} style={buttonSecondaryStyle}>
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div style={panelCardStyle}>
                <h4 style={{ margin: '0 0 10px 0', color: '#1F2C3A' }}>Templates ({templates.length})</h4>
                <div style={{ display: 'grid', gap: '8px' }}>
                  {templates.map((template) => (
                    <div key={template.id} style={{ border: '1px solid rgba(17,47,82,0.14)', borderRadius: '8px', backgroundColor: 'rgba(17,47,82,0.05)', padding: '10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                        <div>
                          <div style={{ fontWeight: 700, color: '#1F2C3A' }}>{template.title}</div>
                          <div style={{ fontSize: '12px', color: '#556677' }}>
                            {template.mainLocation} | Due {formatMileage(template.dueMileage)} mi | Soon {formatMileage(template.soonWindowMiles)} mi
                          </div>
                        </div>
                        <button onClick={() => startEditTemplate(template)} style={buttonSecondaryStyle}>Edit</button>
                      </div>
                    </div>
                  ))}
                  {templates.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '18px', color: '#556677' }}>No templates in scope.</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {subTab === 'service' && (
            <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'minmax(280px, 1fr) minmax(300px, 1.2fr)' }}>
              <div style={panelCardStyle}>
                <h4 style={{ margin: '0 0 10px 0', color: '#1F2C3A' }}>Log Service Record</h4>
                <div style={{ display: 'grid', gap: '8px' }}>
                  <select value={serviceForm.vehicleId} onChange={e => setServiceForm(prev => ({ ...prev, vehicleId: e.target.value }))} style={inputStyle}>
                    <option value="">Select vehicle</option>
                    {vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.name || vehicle.vanId || vehicle.id}</option>)}
                  </select>
                  <select value={serviceForm.serviceType} onChange={e => setServiceForm(prev => ({ ...prev, serviceType: e.target.value, maintenanceTemplateId: '', milestoneKey: '' }))} style={inputStyle}>
                    <option value={FLEET_TASK_TYPE.OIL_CHANGE}>Oil change</option>
                    <option value={FLEET_TASK_TYPE.INSURANCE_RENEWAL}>Insurance renewal</option>
                    <option value={FLEET_TASK_TYPE.REGISTRATION_RENEWAL}>Registration renewal</option>
                    <option value={FLEET_TASK_TYPE.MAINTENANCE_MILESTONE}>Maintenance milestone</option>
                  </select>
                  <input type="date" value={serviceForm.serviceDate} onChange={e => setServiceForm(prev => ({ ...prev, serviceDate: e.target.value }))} style={inputStyle} />

                  {(serviceForm.serviceType === FLEET_TASK_TYPE.OIL_CHANGE || serviceForm.serviceType === FLEET_TASK_TYPE.MAINTENANCE_MILESTONE) && (
                    <input value={serviceForm.mileageAtService} onChange={e => setServiceForm(prev => ({ ...prev, mileageAtService: e.target.value }))} style={inputStyle} placeholder="Mileage at service" />
                  )}

                  {(serviceForm.serviceType === FLEET_TASK_TYPE.INSURANCE_RENEWAL || serviceForm.serviceType === FLEET_TASK_TYPE.REGISTRATION_RENEWAL) && (
                    <input type="date" value={serviceForm.renewalDueDate} onChange={e => setServiceForm(prev => ({ ...prev, renewalDueDate: e.target.value }))} style={inputStyle} />
                  )}

                  {serviceForm.serviceType === FLEET_TASK_TYPE.MAINTENANCE_MILESTONE && (
                    <select
                      value={serviceForm.maintenanceTemplateId || serviceForm.milestoneKey || ''}
                      onChange={(e) => {
                        const selectedValue = e.target.value
                        const matchedTask = selectedVehicleOpenMilestones.find(task => (task.templateId || task.milestoneKey || '') === selectedValue)
                        setServiceForm(prev => ({
                          ...prev,
                          maintenanceTemplateId: matchedTask?.templateId || '',
                          milestoneKey: matchedTask?.milestoneKey || ''
                        }))
                      }}
                      style={inputStyle}
                    >
                      <option value="">Match open milestone (optional)</option>
                      {selectedVehicleOpenMilestones.map(task => {
                        const key = task.templateId || task.milestoneKey || task.id
                        return (
                          <option key={task.id} value={key}>
                            {task.title} ({formatMileage(task.dueMileage)} mi)
                          </option>
                        )
                      })}
                    </select>
                  )}

                  <input value={serviceForm.vendorName} onChange={e => setServiceForm(prev => ({ ...prev, vendorName: e.target.value }))} style={inputStyle} placeholder="Vendor name (optional)" />
                  <input value={serviceForm.documentUrl} onChange={e => setServiceForm(prev => ({ ...prev, documentUrl: e.target.value }))} style={inputStyle} placeholder="External document URL (optional)" />
                  <textarea value={serviceForm.notes} onChange={e => setServiceForm(prev => ({ ...prev, notes: e.target.value }))} style={{ ...inputStyle, resize: 'vertical' }} rows={3} placeholder="Notes (optional)" />

                  <button onClick={handleLogService} disabled={savingService} style={{ ...buttonPrimaryStyle, opacity: savingService ? 0.75 : 1 }}>
                    {savingService ? 'Saving...' : 'Log Service Record'}
                  </button>
                </div>

                {selectedServiceVehicle && (
                  <div style={{ marginTop: '10px', fontSize: '12px', color: '#465367' }}>
                    Selected vehicle runtime: {formatMileage(selectedServiceVehicleRuntime?.lastKnownMileage)} mi
                  </div>
                )}
              </div>

              <div style={panelCardStyle}>
                <h4 style={{ margin: '0 0 10px 0', color: '#1F2C3A' }}>Recent Service Records ({filteredServiceRecords.length})</h4>
                <div style={{ display: 'grid', gap: '8px' }}>
                  {filteredServiceRecords.map((record) => {
                    const vehicle = vehicleMap[record.vehicleId]
                    return (
                      <div key={record.id} style={{ border: '1px solid rgba(17,47,82,0.14)', borderRadius: '8px', backgroundColor: 'rgba(17,47,82,0.05)', padding: '10px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                          <div style={{ fontWeight: 700, color: '#1F2C3A' }}>
                            {vehicle?.name || record.vanId || record.vehicleId}
                          </div>
                          <div style={{ fontSize: '11px', color: '#465367' }}>
                            {getFleetTaskTypeLabel(record.serviceType)}
                          </div>
                        </div>
                        <div style={{ marginTop: '4px', fontSize: '12px', color: '#556677' }}>
                          Service date {formatDateForUi(record.serviceDate)}
                          {' '}| Mileage {formatMileage(record.mileageAtService)}
                          {' '}| Vendor {record.vendorName || '--'}
                        </div>
                        {record.notes && (
                          <div style={{ marginTop: '4px', fontSize: '12px', color: '#465367' }}>
                            Notes: {record.notes}
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {filteredServiceRecords.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '18px', color: '#556677' }}>No service records yet.</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default FleetPanel
