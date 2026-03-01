import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch
} from 'firebase/firestore'
import { db } from '../firebase'
import { getVersionNumber } from './versioning'
import {
  DEFAULT_MILESTONE_SOON_WINDOW_MILES,
  DEFAULT_OIL_INTERVAL_MILES,
  DEFAULT_OIL_SOON_WINDOW_MILES,
  DEFAULT_RENEWAL_SOON_WINDOW_DAYS,
  FLEET_TASK_TYPE,
  evaluateDateStatus,
  evaluateMileageStatus,
  getFleetTaskDefaultTitle,
  getFleetTaskTriggerMode,
  normalizeFleetTaskType,
  normalizeMainLocationFromVehicle,
  normalizeMileageWithDefault,
  parseMileageValue,
  toDate,
  toIsoDate
} from '../utils/fleetStatus'
import { getAvailableMainLocationsForUser, isAdminRole, isSupervisorRole } from '../utils/orgModel'

const OPEN_STATUSES = ['upcoming', 'overdue']
const BATCH_LIMIT = 350

function normalizeTemplateIdList(values) {
  if (!Array.isArray(values)) return []
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))]
}

function sanitizeMilestoneKey(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return ''
  return normalized.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function normalizeString(value) {
  return String(value || '').trim()
}

function normalizeOptionalUrl(value) {
  const normalized = normalizeString(value)
  if (!normalized) return null
  try {
    const parsed = new URL(normalized)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.toString()
  } catch {
    return null
  }
}

function buildTaskDocId({
  vehicleId,
  taskType,
  templateId,
  milestoneKey,
  dueMileage,
  dueDate
}) {
  const normalizedVehicleId = sanitizeMilestoneKey(vehicleId)
  const normalizedType = sanitizeMilestoneKey(taskType)
  const suffix = (() => {
    if (dueMileage !== null && dueMileage !== undefined) return `m_${dueMileage}`
    if (dueDate) return `d_${sanitizeMilestoneKey(dueDate)}`
    return 'open'
  })()

  if (normalizeString(templateId)) {
    return `fleet_${normalizedVehicleId}_${normalizedType}_${sanitizeMilestoneKey(templateId)}_${suffix}`
  }
  if (normalizeString(milestoneKey)) {
    return `fleet_${normalizedVehicleId}_${normalizedType}_${sanitizeMilestoneKey(milestoneKey)}_${suffix}`
  }
  return `fleet_${normalizedVehicleId}_${normalizedType}_${suffix}`
}

function buildDescriptorBase(vehicle, runtime, now) {
  const mainLocation = normalizeMainLocationFromVehicle(vehicle)
  const currentMileage = parseMileageValue(runtime?.lastKnownMileage)
  return {
    vehicleId: vehicle.id,
    mainLocation,
    locationId: normalizeString(vehicle.locationId) || null,
    vanId: normalizeString(vehicle.vanId) || null,
    currentMileageSnapshot: currentMileage,
    currentDateSnapshot: toIsoDate(now),
    now
  }
}

function buildOilDescriptor(base, vehicle) {
  const intervalMiles = normalizeMileageWithDefault(vehicle?.oilChangeIntervalMiles, DEFAULT_OIL_INTERVAL_MILES)
  const soonWindowMiles = normalizeMileageWithDefault(vehicle?.oilSoonWindowMiles, DEFAULT_OIL_SOON_WINDOW_MILES)
  const fallbackBaseline = base.currentMileageSnapshot !== null ? base.currentMileageSnapshot : 0
  const baselineMileage = normalizeMileageWithDefault(vehicle?.oilBaselineMileage, fallbackBaseline)
  const dueMileage = baselineMileage + intervalMiles

  const evaluation = evaluateMileageStatus({
    currentMileage: base.currentMileageSnapshot,
    dueMileage,
    soonWindowMiles
  })
  if (!evaluation.status) return null

  const taskType = FLEET_TASK_TYPE.OIL_CHANGE
  const taskId = buildTaskDocId({
    vehicleId: base.vehicleId,
    taskType,
    dueMileage
  })

  return {
    taskId,
    taskType,
    triggerMode: getFleetTaskTriggerMode(taskType),
    templateId: null,
    milestoneKey: null,
    title: getFleetTaskDefaultTitle(taskType),
    dueMileage,
    dueDate: null,
    status: evaluation.status,
    currentMileageSnapshot: base.currentMileageSnapshot,
    currentDateSnapshot: base.currentDateSnapshot
  }
}

function buildDateDescriptor(base, vehicle, taskType, dueDateValue) {
  const dueDate = toDate(dueDateValue)
  if (!dueDate) return null

  const evaluation = evaluateDateStatus({
    now: base.now,
    dueDate,
    soonWindowDays: DEFAULT_RENEWAL_SOON_WINDOW_DAYS
  })
  if (!evaluation.status) return null

  const dueDateKey = toIsoDate(dueDate)
  const taskId = buildTaskDocId({
    vehicleId: base.vehicleId,
    taskType,
    dueDate: dueDateKey
  })

  return {
    taskId,
    taskType,
    triggerMode: getFleetTaskTriggerMode(taskType),
    templateId: null,
    milestoneKey: null,
    title: getFleetTaskDefaultTitle(taskType),
    dueMileage: null,
    dueDate: dueDateKey,
    status: evaluation.status,
    currentMileageSnapshot: base.currentMileageSnapshot,
    currentDateSnapshot: base.currentDateSnapshot
  }
}

function buildTemplateMilestoneDescriptor(base, template) {
  const dueMileage = parseMileageValue(template?.dueMileage)
  if (dueMileage === null) return null

  const soonWindowMiles = normalizeMileageWithDefault(template?.soonWindowMiles, DEFAULT_MILESTONE_SOON_WINDOW_MILES)
  const evaluation = evaluateMileageStatus({
    currentMileage: base.currentMileageSnapshot,
    dueMileage,
    soonWindowMiles
  })
  if (!evaluation.status) return null

  const templateId = normalizeString(template?.id)
  const title = normalizeString(template?.title) || 'Mileage service'
  const taskType = FLEET_TASK_TYPE.MAINTENANCE_MILESTONE
  const taskId = buildTaskDocId({
    vehicleId: base.vehicleId,
    taskType,
    templateId,
    dueMileage
  })

  return {
    taskId,
    taskType,
    triggerMode: getFleetTaskTriggerMode(taskType),
    templateId,
    milestoneKey: null,
    title: getFleetTaskDefaultTitle(taskType, title),
    dueMileage,
    dueDate: null,
    status: evaluation.status,
    currentMileageSnapshot: base.currentMileageSnapshot,
    currentDateSnapshot: base.currentDateSnapshot
  }
}

function buildCustomMilestoneDescriptor(base, customMilestone) {
  const dueMileage = parseMileageValue(customMilestone?.dueMileage)
  if (dueMileage === null) return null

  const soonWindowMiles = normalizeMileageWithDefault(
    customMilestone?.soonWindowMiles,
    DEFAULT_MILESTONE_SOON_WINDOW_MILES
  )
  const evaluation = evaluateMileageStatus({
    currentMileage: base.currentMileageSnapshot,
    dueMileage,
    soonWindowMiles
  })
  if (!evaluation.status) return null

  const rawKey = normalizeString(customMilestone?.id) || normalizeString(customMilestone?.title) || `m${dueMileage}`
  const milestoneKey = sanitizeMilestoneKey(rawKey)
  const taskType = FLEET_TASK_TYPE.MAINTENANCE_MILESTONE
  const taskId = buildTaskDocId({
    vehicleId: base.vehicleId,
    taskType,
    milestoneKey,
    dueMileage
  })

  return {
    taskId,
    taskType,
    triggerMode: getFleetTaskTriggerMode(taskType),
    templateId: null,
    milestoneKey,
    title: getFleetTaskDefaultTitle(taskType, normalizeString(customMilestone?.title)),
    dueMileage,
    dueDate: null,
    status: evaluation.status,
    currentMileageSnapshot: base.currentMileageSnapshot,
    currentDateSnapshot: base.currentDateSnapshot
  }
}

function buildDescriptorsForVehicle({
  vehicle,
  runtime,
  templates,
  now
}) {
  const base = buildDescriptorBase(vehicle, runtime, now)
  if (!base.mainLocation) return []
  const descriptors = []

  const oilDescriptor = buildOilDescriptor(base, vehicle)
  if (oilDescriptor) descriptors.push(oilDescriptor)

  const insuranceDescriptor = buildDateDescriptor(base, vehicle, FLEET_TASK_TYPE.INSURANCE_RENEWAL, vehicle.insuranceDueDate)
  if (insuranceDescriptor) descriptors.push(insuranceDescriptor)

  const registrationDescriptor = buildDateDescriptor(base, vehicle, FLEET_TASK_TYPE.REGISTRATION_RENEWAL, vehicle.registrationDueDate)
  if (registrationDescriptor) descriptors.push(registrationDescriptor)

  const disabledTemplateIds = new Set(normalizeTemplateIdList(vehicle.disabledMaintenanceTemplateIds))
  const eligibleTemplates = (Array.isArray(templates) ? templates : [])
    .filter(template => template?.active !== false)
    .filter(template => {
      const templateId = normalizeString(template?.id)
      if (!templateId) return false
      return !disabledTemplateIds.has(templateId)
    })

  eligibleTemplates.forEach((template) => {
    const descriptor = buildTemplateMilestoneDescriptor(base, template)
    if (descriptor) descriptors.push(descriptor)
  })

  const customMilestones = Array.isArray(vehicle.customMaintenanceMilestones)
    ? vehicle.customMaintenanceMilestones.filter(item => item?.active !== false)
    : []
  customMilestones.forEach((milestone) => {
    const descriptor = buildCustomMilestoneDescriptor(base, milestone)
    if (descriptor) descriptors.push(descriptor)
  })

  return descriptors.map(descriptor => ({
    ...descriptor,
    vehicleId: base.vehicleId,
    mainLocation: base.mainLocation,
    locationId: base.locationId,
    vanId: base.vanId
  }))
}

function needsTaskUpdate(existing, descriptor) {
  return (
    normalizeFleetTaskType(existing.taskType) !== normalizeFleetTaskType(descriptor.taskType)
    || normalizeString(existing.mainLocation) !== normalizeString(descriptor.mainLocation)
    || normalizeString(existing.locationId) !== normalizeString(descriptor.locationId)
    || normalizeString(existing.vanId) !== normalizeString(descriptor.vanId)
    || normalizeString(existing.triggerMode) !== normalizeString(descriptor.triggerMode)
    || normalizeString(existing.templateId) !== normalizeString(descriptor.templateId)
    || normalizeString(existing.milestoneKey) !== normalizeString(descriptor.milestoneKey)
    || normalizeString(existing.title) !== normalizeString(descriptor.title)
    || normalizeString(existing.dueDate) !== normalizeString(descriptor.dueDate)
    || parseMileageValue(existing.dueMileage) !== parseMileageValue(descriptor.dueMileage)
    || parseMileageValue(existing.currentMileageSnapshot) !== parseMileageValue(descriptor.currentMileageSnapshot)
    || normalizeString(existing.currentDateSnapshot) !== normalizeString(descriptor.currentDateSnapshot)
    || normalizeString(existing.status) !== normalizeString(descriptor.status)
    || existing.resolvedAt
    || normalizeString(existing.resolvedByServiceRecordId)
  )
}

function buildAlertPayload(taskDocId, descriptor, status) {
  const isOverdue = status === 'overdue'
  const typeSuffix = isOverdue ? 'overdue' : 'upcoming'
  const statusLabel = isOverdue ? 'overdue' : 'upcoming'
  const dueLabel = descriptor.triggerMode === 'mileage'
    ? `due at ${descriptor.dueMileage} mi`
    : `due on ${descriptor.dueDate}`
  const currentLabel = descriptor.triggerMode === 'mileage'
    ? `current mileage ${descriptor.currentMileageSnapshot ?? '--'}`
    : `current date ${descriptor.currentDateSnapshot || '--'}`
  const vanLabel = normalizeString(descriptor.vanId) ? ` (${descriptor.vanId})` : ''

  return {
    type: `fleet_${typeSuffix}`,
    taskId: taskDocId,
    taskType: descriptor.taskType,
    vehicleId: descriptor.vehicleId,
    mainLocation: descriptor.mainLocation || null,
    locationId: descriptor.locationId || descriptor.mainLocation || null,
    vanId: descriptor.vanId || null,
    severity: isOverdue ? 'high' : 'medium',
    message: `Fleet ${statusLabel}: ${descriptor.title}${vanLabel}, ${dueLabel}, ${currentLabel}.`,
    read: false,
    version: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }
}

async function commitOperationsInChunks(operations) {
  if (!Array.isArray(operations) || operations.length === 0) return
  for (let i = 0; i < operations.length; i += BATCH_LIMIT) {
    const chunk = operations.slice(i, i + BATCH_LIMIT)
    const batch = writeBatch(db)
    chunk.forEach((operation) => {
      if (operation.type === 'set') {
        batch.set(operation.ref, operation.data, operation.options || {})
        return
      }
      batch.update(operation.ref, operation.data)
    })
    await batch.commit()
  }
}

async function loadActiveVehiclesForMainLocations(allowedMainLocations) {
  const snap = await getDocs(collection(db, 'eocVehicles'))
  const allowed = new Set(Array.isArray(allowedMainLocations) ? allowedMainLocations : [])
  return snap.docs
    .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
    .filter(vehicle => vehicle?.active !== false)
    .filter((vehicle) => {
      if (allowed.size === 0) return false
      const mainLocation = normalizeMainLocationFromVehicle(vehicle)
      return Boolean(mainLocation) && allowed.has(mainLocation)
    })
}

async function loadRuntimeMap() {
  const snap = await getDocs(collection(db, 'fleetVehicleRuntime'))
  const map = new Map()
  snap.docs.forEach((docSnap) => {
    map.set(docSnap.id, { id: docSnap.id, ...docSnap.data() })
  })
  return map
}

async function loadTemplateMapByMainLocation() {
  const snap = await getDocs(collection(db, 'fleetMaintenanceTemplates'))
  const map = new Map()
  snap.docs.forEach((docSnap) => {
    const data = docSnap.data() || {}
    const mainLocation = normalizeString(data.mainLocation).toUpperCase()
    if (!mainLocation || data.active === false) return
    const rows = map.get(mainLocation) || []
    rows.push({ id: docSnap.id, ...data })
    map.set(mainLocation, rows)
  })
  return map
}

async function loadOpenTaskMap() {
  const [upcomingSnap, overdueSnap] = await Promise.all([
    getDocs(query(collection(db, 'fleetTasks'), where('status', '==', 'upcoming'))),
    getDocs(query(collection(db, 'fleetTasks'), where('status', '==', 'overdue')))
  ])
  const map = new Map()
  ;[...upcomingSnap.docs, ...overdueSnap.docs].forEach((docSnap) => {
    map.set(docSnap.id, { id: docSnap.id, ...docSnap.data() })
  })
  return map
}

function upsertFleetTasks({
  descriptors,
  existingOpenTaskMap
}) {
  const operations = []
  const stats = {
    created: 0,
    updated: 0,
    alerts: 0,
    evaluated: descriptors.length
  }

  descriptors.forEach((descriptor) => {
    const taskRef = doc(db, 'fleetTasks', descriptor.taskId)
    const existing = existingOpenTaskMap.get(descriptor.taskId)

    if (!existing) {
      operations.push({
        type: 'set',
        ref: taskRef,
        data: {
          vehicleId: descriptor.vehicleId,
          mainLocation: descriptor.mainLocation || null,
          locationId: descriptor.locationId || null,
          vanId: descriptor.vanId || null,
          taskType: descriptor.taskType,
          triggerMode: descriptor.triggerMode,
          templateId: descriptor.templateId || null,
          milestoneKey: descriptor.milestoneKey || null,
          title: descriptor.title,
          dueMileage: descriptor.dueMileage ?? null,
          dueDate: descriptor.dueDate || null,
          currentMileageSnapshot: descriptor.currentMileageSnapshot ?? null,
          currentDateSnapshot: descriptor.currentDateSnapshot || null,
          status: descriptor.status,
          openedAt: serverTimestamp(),
          lastEvaluatedAt: serverTimestamp(),
          resolvedAt: null,
          resolvedByServiceRecordId: null,
          version: 1,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }
      })
      stats.created += 1

      if (descriptor.status === 'upcoming' || descriptor.status === 'overdue') {
        const alertRef = doc(collection(db, 'alerts'))
        operations.push({
          type: 'set',
          ref: alertRef,
          data: buildAlertPayload(taskRef.id, descriptor, descriptor.status)
        })
        stats.alerts += 1
      }
      return
    }

    if (!needsTaskUpdate(existing, descriptor)) {
      return
    }

    const previousStatus = normalizeString(existing.status)
    const nextStatus = normalizeString(descriptor.status)
    operations.push({
      type: 'update',
      ref: taskRef,
      data: {
        mainLocation: descriptor.mainLocation || null,
        locationId: descriptor.locationId || null,
        vanId: descriptor.vanId || null,
        taskType: descriptor.taskType,
        triggerMode: descriptor.triggerMode,
        templateId: descriptor.templateId || null,
        milestoneKey: descriptor.milestoneKey || null,
        title: descriptor.title,
        dueMileage: descriptor.dueMileage ?? null,
        dueDate: descriptor.dueDate || null,
        currentMileageSnapshot: descriptor.currentMileageSnapshot ?? null,
        currentDateSnapshot: descriptor.currentDateSnapshot || null,
        status: descriptor.status,
        lastEvaluatedAt: serverTimestamp(),
        resolvedAt: null,
        resolvedByServiceRecordId: null,
        version: getVersionNumber(existing) + 1,
        updatedAt: serverTimestamp()
      }
    })
    stats.updated += 1

    if (previousStatus !== nextStatus && (nextStatus === 'upcoming' || nextStatus === 'overdue')) {
      const alertRef = doc(collection(db, 'alerts'))
      operations.push({
        type: 'set',
        ref: alertRef,
        data: buildAlertPayload(taskRef.id, descriptor, nextStatus)
      })
      stats.alerts += 1
    }
  })

  return { operations, stats }
}

function getAllowedMainLocations(user) {
  if (!user) return []
  if (!(isAdminRole(user.role) || isSupervisorRole(user.role))) return []
  if (isAdminRole(user.role)) return ['OTC', 'RES']
  return getAvailableMainLocationsForUser(user)
}

async function loadOpenTasksForVehicle(vehicleId) {
  const [upcomingSnap, overdueSnap] = await Promise.all([
    getDocs(query(collection(db, 'fleetTasks'), where('vehicleId', '==', vehicleId), where('status', '==', 'upcoming'))),
    getDocs(query(collection(db, 'fleetTasks'), where('vehicleId', '==', vehicleId), where('status', '==', 'overdue')))
  ])
  const map = new Map()
  ;[...upcomingSnap.docs, ...overdueSnap.docs].forEach((docSnap) => {
    map.set(docSnap.id, { id: docSnap.id, ...docSnap.data() })
  })
  return map
}

export async function syncFleetTasksForVehicle({ vehicleId }) {
  const normalizedVehicleId = normalizeString(vehicleId)
  if (!normalizedVehicleId) {
    return { created: 0, updated: 0, alerts: 0, evaluated: 0 }
  }

  const vehicleSnap = await getDoc(doc(db, 'eocVehicles', normalizedVehicleId))
  if (!vehicleSnap.exists()) {
    return { created: 0, updated: 0, alerts: 0, evaluated: 0 }
  }

  const vehicle = { id: vehicleSnap.id, ...vehicleSnap.data() }
  if (vehicle.active === false) {
    return { created: 0, updated: 0, alerts: 0, evaluated: 0 }
  }

  const runtimeSnap = await getDoc(doc(db, 'fleetVehicleRuntime', normalizedVehicleId))
  const runtime = runtimeSnap.exists() ? runtimeSnap.data() : null
  const mainLocation = normalizeMainLocationFromVehicle(vehicle)
  const templateSnap = await getDocs(collection(db, 'fleetMaintenanceTemplates'))
  const templates = templateSnap.docs
    .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
    .filter(template => template.active !== false)
    .filter(template => normalizeString(template.mainLocation).toUpperCase() === mainLocation)
  const descriptors = buildDescriptorsForVehicle({
    vehicle,
    runtime,
    templates,
    now: new Date()
  })
  const existingOpenTaskMap = await loadOpenTasksForVehicle(vehicle.id)

  const { operations, stats } = upsertFleetTasks({
    descriptors,
    existingOpenTaskMap
  })

  await commitOperationsInChunks(operations)
  return stats
}

export async function syncFleetTasksForUserScope(user) {
  const allowedMainLocations = getAllowedMainLocations(user)
  if (allowedMainLocations.length === 0) {
    return { created: 0, updated: 0, alerts: 0, evaluated: 0, vehicles: 0 }
  }

  const [vehicles, runtimeMap, templateMapByMainLocation, openTaskMap] = await Promise.all([
    loadActiveVehiclesForMainLocations(allowedMainLocations),
    loadRuntimeMap(),
    loadTemplateMapByMainLocation(),
    loadOpenTaskMap()
  ])

  const now = new Date()
  const descriptors = vehicles.flatMap((vehicle) => {
    const mainLocation = normalizeMainLocationFromVehicle(vehicle)
    const templates = templateMapByMainLocation.get(mainLocation) || []
    const runtime = runtimeMap.get(vehicle.id) || null
    return buildDescriptorsForVehicle({
      vehicle,
      runtime,
      templates,
      now
    })
  })

  const { operations, stats } = upsertFleetTasks({
    descriptors,
    existingOpenTaskMap: openTaskMap
  })

  await commitOperationsInChunks(operations)
  return {
    ...stats,
    vehicles: vehicles.length
  }
}

export async function resolveFleetTasksForServiceRecord({
  vehicleId,
  serviceType,
  maintenanceTemplateId,
  milestoneKey,
  serviceRecordId
}) {
  const normalizedVehicleId = normalizeString(vehicleId)
  const normalizedServiceType = normalizeFleetTaskType(serviceType)
  if (!normalizedVehicleId || !normalizedServiceType) return 0

  const [upcomingSnap, overdueSnap] = await Promise.all([
    getDocs(query(collection(db, 'fleetTasks'), where('vehicleId', '==', normalizedVehicleId), where('status', '==', 'upcoming'))),
    getDocs(query(collection(db, 'fleetTasks'), where('vehicleId', '==', normalizedVehicleId), where('status', '==', 'overdue')))
  ])
  const rows = [...upcomingSnap.docs, ...overdueSnap.docs]
  if (rows.length === 0) return 0

  const normalizedTemplateId = normalizeString(maintenanceTemplateId)
  const normalizedMilestoneKey = sanitizeMilestoneKey(milestoneKey)
  const targets = rows.filter((docSnap) => {
    const data = docSnap.data() || {}
    const taskType = normalizeFleetTaskType(data.taskType)
    if (taskType !== normalizedServiceType) return false
    if (taskType !== FLEET_TASK_TYPE.MAINTENANCE_MILESTONE) return true

    if (normalizedTemplateId) {
      return normalizeString(data.templateId) === normalizedTemplateId
    }
    if (normalizedMilestoneKey) {
      return sanitizeMilestoneKey(data.milestoneKey) === normalizedMilestoneKey
    }
    return true
  })
  if (targets.length === 0) return 0

  const operations = targets.map((docSnap) => {
    const data = docSnap.data() || {}
    return {
      type: 'update',
      ref: docSnap.ref,
      data: {
        status: 'resolved',
        resolvedAt: serverTimestamp(),
        resolvedByServiceRecordId: normalizeString(serviceRecordId) || null,
        lastEvaluatedAt: serverTimestamp(),
        version: getVersionNumber(data) + 1,
        updatedAt: serverTimestamp()
      }
    }
  })

  await commitOperationsInChunks(operations)
  return targets.length
}

function normalizeServiceDate(value) {
  const date = toDate(value)
  if (!date) return null
  return date
}

export async function logFleetServiceRecord({
  actor,
  vehicleId,
  serviceType,
  maintenanceTemplateId = null,
  milestoneKey = null,
  serviceDate,
  mileageAtService = null,
  vendorName = '',
  notes = '',
  documentUrl = '',
  renewalDueDate = null
}) {
  const normalizedVehicleId = normalizeString(vehicleId)
  const normalizedServiceType = normalizeFleetTaskType(serviceType)
  const normalizedServiceDate = normalizeServiceDate(serviceDate)
  const normalizedMileage = parseMileageValue(mileageAtService)
  const normalizedRenewalDueDate = normalizeServiceDate(renewalDueDate)

  if (!normalizedVehicleId) throw new Error('Vehicle is required.')
  if (!normalizedServiceType) throw new Error('Valid service type is required.')
  if (!normalizedServiceDate) throw new Error('Service date is required.')
  if (normalizedServiceType === FLEET_TASK_TYPE.OIL_CHANGE && normalizedMileage === null) {
    throw new Error('Mileage at service is required for oil changes.')
  }
  if (
    (normalizedServiceType === FLEET_TASK_TYPE.INSURANCE_RENEWAL
      || normalizedServiceType === FLEET_TASK_TYPE.REGISTRATION_RENEWAL)
    && !normalizedRenewalDueDate
  ) {
    throw new Error('Next due date is required for renewals.')
  }

  const safeUrl = normalizeOptionalUrl(documentUrl)
  if (normalizeString(documentUrl) && !safeUrl) {
    throw new Error('Document URL must be a valid http(s) URL.')
  }

  let createdServiceRecordId = ''
  await runTransaction(db, async (transaction) => {
    const vehicleRef = doc(db, 'eocVehicles', normalizedVehicleId)
    const vehicleSnap = await transaction.get(vehicleRef)
    if (!vehicleSnap.exists()) {
      throw new Error('Vehicle not found.')
    }

    const vehicle = vehicleSnap.data() || {}
    const serviceRef = doc(collection(db, 'vehicleServiceRecords'))
    createdServiceRecordId = serviceRef.id

    const mainLocation = normalizeMainLocationFromVehicle(vehicle)
    transaction.set(serviceRef, {
      vehicleId: normalizedVehicleId,
      mainLocation: mainLocation || null,
      locationId: normalizeString(vehicle.locationId) || null,
      vanId: normalizeString(vehicle.vanId) || null,
      serviceType: normalizedServiceType,
      maintenanceTemplateId: normalizeString(maintenanceTemplateId) || null,
      milestoneKey: sanitizeMilestoneKey(milestoneKey) || null,
      serviceDate: Timestamp.fromDate(normalizedServiceDate),
      mileageAtService: normalizedMileage,
      vendorName: normalizeString(vendorName),
      notes: normalizeString(notes),
      documentUrl: safeUrl || null,
      recordedByUserId: actor?.id || null,
      recordedByName: actor?.name || null,
      version: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    })

    const vehiclePatch = {}
    if (normalizedServiceType === FLEET_TASK_TYPE.OIL_CHANGE) {
      vehiclePatch.oilBaselineMileage = normalizedMileage
    }
    if (normalizedServiceType === FLEET_TASK_TYPE.INSURANCE_RENEWAL) {
      vehiclePatch.insuranceDueDate = Timestamp.fromDate(normalizedRenewalDueDate)
    }
    if (normalizedServiceType === FLEET_TASK_TYPE.REGISTRATION_RENEWAL) {
      vehiclePatch.registrationDueDate = Timestamp.fromDate(normalizedRenewalDueDate)
    }

    if (Object.keys(vehiclePatch).length > 0) {
      transaction.update(vehicleRef, {
        ...vehiclePatch,
        version: getVersionNumber(vehicle) + 1,
        updatedAt: serverTimestamp()
      })
    }
  })

  await resolveFleetTasksForServiceRecord({
    vehicleId: normalizedVehicleId,
    serviceType: normalizedServiceType,
    maintenanceTemplateId,
    milestoneKey,
    serviceRecordId: createdServiceRecordId
  })

  await syncFleetTasksForVehicle({ vehicleId: normalizedVehicleId })
  return { serviceRecordId: createdServiceRecordId }
}
