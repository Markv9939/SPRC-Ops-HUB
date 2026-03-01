import { normalizeMainLocation } from './orgModel'

export const DEFAULT_OIL_INTERVAL_MILES = 5000
export const DEFAULT_OIL_SOON_WINDOW_MILES = 100
export const DEFAULT_MILESTONE_SOON_WINDOW_MILES = 500
export const DEFAULT_RENEWAL_SOON_WINDOW_DAYS = 30

export const FLEET_TASK_TYPE = Object.freeze({
  OIL_CHANGE: 'oil_change',
  INSURANCE_RENEWAL: 'insurance_renewal',
  REGISTRATION_RENEWAL: 'registration_renewal',
  MAINTENANCE_MILESTONE: 'maintenance_milestone'
})

export const FLEET_TRIGGER_MODE = Object.freeze({
  MILEAGE: 'mileage',
  DATE: 'date'
})

const MILEAGE_TASK_TYPES = new Set([
  FLEET_TASK_TYPE.OIL_CHANGE,
  FLEET_TASK_TYPE.MAINTENANCE_MILESTONE
])

export function normalizeFleetTaskType(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (Object.values(FLEET_TASK_TYPE).includes(normalized)) return normalized
  return ''
}

export function isFleetAlertType(value) {
  return String(value || '').trim().toLowerCase().startsWith('fleet_')
}

export function parseMileageValue(value) {
  if (value === null || value === undefined) return null
  const normalized = String(value).replace(/,/g, '').trim()
  if (!normalized) return null
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null
  const numeric = Number(normalized)
  if (!Number.isFinite(numeric)) return null
  const rounded = Math.round(numeric)
  if (rounded < 0) return null
  return rounded
}

export function normalizeMileageWithDefault(value, fallback = 0) {
  const parsed = parseMileageValue(value)
  if (parsed === null) return Math.max(0, Number(fallback) || 0)
  return parsed
}

export function normalizeMainLocationFromVehicle(vehicle) {
  const fromMainLocation = normalizeMainLocation(vehicle?.mainLocation)
  if (fromMainLocation) return fromMainLocation
  return normalizeMainLocation(vehicle?.locationId)
}

export function toDate(value) {
  if (!value) return null
  const parsed = value?.toDate ? value.toDate() : new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

export function toIsoDate(value) {
  const date = toDate(value)
  if (!date) return ''
  return date.toISOString().split('T')[0]
}

export function getNow() {
  return new Date()
}

export function evaluateMileageStatus({
  currentMileage,
  dueMileage,
  soonWindowMiles
}) {
  const current = parseMileageValue(currentMileage)
  const due = parseMileageValue(dueMileage)
  if (current === null || due === null) {
    return {
      status: null,
      remainingMiles: null
    }
  }

  const soonWindow = normalizeMileageWithDefault(soonWindowMiles, 0)
  const remainingMiles = due - current
  if (remainingMiles <= 0) {
    return { status: 'overdue', remainingMiles }
  }
  if (remainingMiles <= soonWindow) {
    return { status: 'upcoming', remainingMiles }
  }

  return { status: null, remainingMiles }
}

export function evaluateDateStatus({
  now,
  dueDate,
  soonWindowDays
}) {
  const nowDate = toDate(now) || getNow()
  const due = toDate(dueDate)
  if (!due) {
    return {
      status: null,
      remainingDays: null
    }
  }

  const msPerDay = 24 * 60 * 60 * 1000
  const remainingDays = Math.ceil((due.getTime() - nowDate.getTime()) / msPerDay)
  if (remainingDays < 0) {
    return { status: 'overdue', remainingDays }
  }
  if (remainingDays <= Math.max(0, Number(soonWindowDays) || 0)) {
    return { status: 'upcoming', remainingDays }
  }

  return { status: null, remainingDays }
}

export function getFleetTaskTypeLabel(taskType) {
  const normalized = normalizeFleetTaskType(taskType)
  if (normalized === FLEET_TASK_TYPE.OIL_CHANGE) return 'Oil Change'
  if (normalized === FLEET_TASK_TYPE.INSURANCE_RENEWAL) return 'Insurance Renewal'
  if (normalized === FLEET_TASK_TYPE.REGISTRATION_RENEWAL) return 'Registration Renewal'
  if (normalized === FLEET_TASK_TYPE.MAINTENANCE_MILESTONE) return 'Maintenance Milestone'
  return 'Fleet Task'
}

export function getFleetTaskDefaultTitle(taskType, templateTitle = '') {
  const normalized = normalizeFleetTaskType(taskType)
  if (normalized === FLEET_TASK_TYPE.OIL_CHANGE) return 'Oil change due'
  if (normalized === FLEET_TASK_TYPE.INSURANCE_RENEWAL) return 'Insurance renewal due'
  if (normalized === FLEET_TASK_TYPE.REGISTRATION_RENEWAL) return 'Registration renewal due'
  if (normalized === FLEET_TASK_TYPE.MAINTENANCE_MILESTONE) {
    const label = String(templateTitle || '').trim()
    return label ? `${label} mileage service due` : 'Scheduled mileage service due'
  }
  return 'Fleet task due'
}

export function getFleetTaskTriggerMode(taskType) {
  const normalized = normalizeFleetTaskType(taskType)
  if (MILEAGE_TASK_TYPES.has(normalized)) return FLEET_TRIGGER_MODE.MILEAGE
  return FLEET_TRIGGER_MODE.DATE
}
