export const ROLE_ADMIN = 'admin'
export const ROLE_SUPERVISOR = 'supervisor'
export const ROLE_BHT = 'bht'
export const LEGACY_ROLE_TECH = 'tech'

export const MAIN_LOCATION_OTC = 'OTC'
export const MAIN_LOCATION_RES = 'RES'
export const GLOBAL_SCOPE = 'GLOBAL'

export const HOUSE_MESQUITE = 'MESQUITE'
export const HOUSE_LONE_MOUNTAIN = 'LONE_MOUNTAIN'

export const MAIN_LOCATIONS = [MAIN_LOCATION_OTC, MAIN_LOCATION_RES]

export const HOUSE_OPTIONS = [
  { id: HOUSE_MESQUITE, label: 'Mesquite House', locationId: 'mesquite' },
  { id: HOUSE_LONE_MOUNTAIN, label: 'Lone Mountain', locationId: 'lone_mountain' }
]

export const VAN_IDS_BY_MAIN_LOCATION = Object.freeze({
  [MAIN_LOCATION_OTC]: ['van_1', 'van_2', 'van_4'],
  [MAIN_LOCATION_RES]: ['van_3']
})

const MAIN_LOCATION_ALIASES = Object.freeze({
  PHP: MAIN_LOCATION_OTC,
  RTC: MAIN_LOCATION_OTC,
  MESQUITE: MAIN_LOCATION_OTC,
  LONE_MOUNTAIN: MAIN_LOCATION_OTC,
  RES: MAIN_LOCATION_RES,
  OTC: MAIN_LOCATION_OTC
})

function normalizeToken(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '_')
}

export function normalizeRole(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === LEGACY_ROLE_TECH) return ROLE_BHT
  return normalized
}

export function isAdminRole(value) {
  return normalizeRole(value) === ROLE_ADMIN
}

export function isSupervisorRole(value) {
  return normalizeRole(value) === ROLE_SUPERVISOR
}

export function isBhtRole(value) {
  return normalizeRole(value) === ROLE_BHT
}

export function formatRoleLabel(value) {
  const normalized = normalizeRole(value)
  if (normalized === ROLE_ADMIN) return 'Admin'
  if (normalized === ROLE_SUPERVISOR) return 'Supervisor'
  if (normalized === ROLE_BHT) return 'BHT'
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : 'Unknown'
}

export function normalizeMainLocation(value) {
  const normalized = normalizeToken(value)
  return MAIN_LOCATION_ALIASES[normalized] || ''
}

export function normalizeTransportSite(value) {
  return normalizeMainLocation(value)
}

export function normalizeHouseId(value) {
  const normalized = normalizeToken(value)
  if (!normalized) return ''
  if (normalized.includes('MESQUITE')) return HOUSE_MESQUITE
  if (normalized === 'LONEMOUNTAIN' || normalized.includes('LONE_MOUNTAIN')) return HOUSE_LONE_MOUNTAIN
  return ''
}

export function houseIdToLocationId(houseId) {
  const normalized = normalizeHouseId(houseId)
  if (normalized === HOUSE_MESQUITE) return 'mesquite'
  if (normalized === HOUSE_LONE_MOUNTAIN) return 'lone_mountain'
  return ''
}

export function locationIdToHouseId(locationId) {
  const normalized = normalizeToken(locationId)
  if (normalized === 'MESQUITE') return HOUSE_MESQUITE
  if (normalized === 'LONE_MOUNTAIN') return HOUSE_LONE_MOUNTAIN
  return ''
}

export function locationIdToMainLocation(locationId) {
  const normalized = normalizeToken(locationId)
  if (normalized === 'RES') return MAIN_LOCATION_RES
  if (normalized === 'MESQUITE' || normalized === 'LONE_MOUNTAIN') return MAIN_LOCATION_OTC
  return normalizeMainLocation(normalized)
}

export function requiresHouseSelection(mainLocation) {
  return normalizeMainLocation(mainLocation) === MAIN_LOCATION_OTC
}

export function getHouseOptionsForMainLocation(mainLocation) {
  return requiresHouseSelection(mainLocation) ? HOUSE_OPTIONS : []
}

export function getAllowedVanIdsForMainLocation(mainLocation) {
  const normalized = normalizeMainLocation(mainLocation)
  return VAN_IDS_BY_MAIN_LOCATION[normalized] || []
}

export function getAllowedVanIdsForLocationId(locationId) {
  return getAllowedVanIdsForMainLocation(locationIdToMainLocation(locationId))
}

export function isVanAllowedForMainLocation(mainLocation, vanId) {
  return getAllowedVanIdsForMainLocation(mainLocation).includes(String(vanId || '').trim().toLowerCase())
}

export function isVanAllowedForLocationId(locationId, vanId) {
  return getAllowedVanIdsForLocationId(locationId).includes(String(vanId || '').trim().toLowerCase())
}

export function normalizeScopeValue(value) {
  const normalized = normalizeToken(value)
  if (!normalized) return ''
  if (normalized === GLOBAL_SCOPE) return GLOBAL_SCOPE
  if (normalized === HOUSE_MESQUITE || normalized === HOUSE_LONE_MOUNTAIN) return normalized
  return normalizeMainLocation(normalized)
}

function expandScopeValue(value) {
  const normalized = normalizeScopeValue(value)
  if (!normalized) return []
  if (normalized === GLOBAL_SCOPE) return [GLOBAL_SCOPE, MAIN_LOCATION_OTC, MAIN_LOCATION_RES]
  if (normalized === HOUSE_MESQUITE || normalized === HOUSE_LONE_MOUNTAIN) {
    return [normalized, MAIN_LOCATION_OTC]
  }
  return [normalized]
}

export function normalizeScopeValues(values) {
  if (!Array.isArray(values)) return []
  const expanded = values.flatMap(expandScopeValue)
  return [...new Set(expanded.filter(Boolean))]
}

export function getMainLocationsFromScopes(values) {
  const normalizedScopes = normalizeScopeValues(values)
  if (normalizedScopes.includes(GLOBAL_SCOPE)) return [...MAIN_LOCATIONS]
  return MAIN_LOCATIONS.filter(locationId => normalizedScopes.includes(locationId))
}

export function getAvailableMainLocationsForUser(user) {
  if (isAdminRole(user?.role)) return [...MAIN_LOCATIONS]
  return getMainLocationsFromScopes([
    ...(user?.site ? [user.site] : []),
    ...(Array.isArray(user?.authorizedLocations) ? user.authorizedLocations : []),
    ...(Array.isArray(user?.primaryScopes) ? user.primaryScopes : [])
  ])
}

export function canActorManageRole(actorRole, targetRole) {
  const actor = normalizeRole(actorRole)
  const target = normalizeRole(targetRole)
  if (actor === ROLE_ADMIN) return true
  if (actor === ROLE_SUPERVISOR) return target === ROLE_BHT
  return false
}

export function roleOptionsForActor(actorRole) {
  if (isAdminRole(actorRole)) {
    return [ROLE_BHT, ROLE_SUPERVISOR, ROLE_ADMIN]
  }
  if (isSupervisorRole(actorRole)) {
    return [ROLE_BHT]
  }
  return []
}

export function buildBhtLocationId(mainLocation, houseId) {
  const normalizedMain = normalizeMainLocation(mainLocation)
  if (normalizedMain === MAIN_LOCATION_RES) return 'res'
  if (normalizedMain !== MAIN_LOCATION_OTC) return ''
  return houseIdToLocationId(houseId)
}

export function buildAuthorizedLocations({ role, mainLocation, houseId }) {
  const normalizedRole = normalizeRole(role)
  if (normalizedRole === ROLE_ADMIN) return []

  const normalizedMain = normalizeMainLocation(mainLocation)
  const scopes = []
  if (normalizedMain) scopes.push(normalizedMain)

  if (normalizedRole === ROLE_BHT) {
    const normalizedHouse = normalizeHouseId(houseId)
    if (normalizedHouse) scopes.push(normalizedHouse)
  }

  return [...new Set(scopes)]
}
