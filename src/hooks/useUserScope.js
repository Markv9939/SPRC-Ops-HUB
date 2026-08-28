/**
 * Hook: useUserScope
 *
 * Derives all scope-related values from a session user object.
 * Replaces the duplicated scope derivation logic that lived inline
 * inside SupervisorDashboard (lines 244-310).
 *
 * Consumers get stable, memoized values for:
 *   - isAdmin / isSupervisor / isBht
 *   - normalizedScopes, primaryScopes, activeBackupGrants
 *   - managedMainLocations, defaultManagedMainLocation
 *   - allowedTransportSites, allowedComplianceSites
 *   - inTransportScope(site), inComplianceScope(site), inEocScope(locationId)
 */

import { useMemo, useCallback } from 'react'
import {
  MAIN_LOCATIONS,
  MAIN_LOCATION_OTC,
  getExactOperationalLocationIdsForUser,
  getAvailableMainLocationsForUser,
  isAdminRole,
  isBhtRole,
  isSupervisorRole,
  locationIdToMainLocation,
  normalizeMainLocation,
  normalizeScopeValues,
  normalizeTransportSite
} from '../utils/orgModel'

const TRANSPORT_SITES = new Set(MAIN_LOCATIONS)
const COMPLIANCE_SITES = new Set(MAIN_LOCATIONS)
function locationScopeAlias(locationId) {
  const normalizedMainLocation = locationIdToMainLocation(locationId)
  if (normalizedMainLocation) return normalizedMainLocation
  const normalized = String(locationId || '').trim().toUpperCase()
  return normalizeMainLocation(normalized) || normalized
}

function normalizeComplianceSite(siteId) {
  return locationScopeAlias(siteId)
}

export default function useUserScope(user) {
  const isAdmin = isAdminRole(user?.role)
  const isSupervisor = isSupervisorRole(user?.role)
  const isBht = isBhtRole(user?.role)

  // Memoized to prevent new array references on every render, which would
  // cascade into inTransportScope / inComplianceScope changing every render
  // and cause all dependent Firestore listeners to re-subscribe continuously.
  const normalizedScopes = useMemo(
    () => normalizeScopeValues([
      ...(user?.site ? [user.site] : []),
      ...(Array.isArray(user?.authorizedLocations) ? user.authorizedLocations : [])
    ]),
    [user]
  )

  const primaryScopes = useMemo(
    () => normalizeScopeValues([
      ...(Array.isArray(user?.primaryScopes) ? user.primaryScopes : []),
      ...(user?.site ? [user.site] : [])
    ]),
    [user]
  )

  const activeBackupGrants = Array.isArray(user?.activeBackupGrants)
    ? user.activeBackupGrants.filter(grant => grant?.state === 'active')
    : []

  const exactIssueLocationIds = useMemo(
    () => getExactOperationalLocationIdsForUser(user),
    [user]
  )

  const managedMainLocations = useMemo(() => {
    const scopedLocations = getAvailableMainLocationsForUser(user)
    if (isAdmin) return [...MAIN_LOCATIONS]
    return scopedLocations.length > 0 ? scopedLocations : [MAIN_LOCATION_OTC]
  }, [isAdmin, user])

  const defaultManagedMainLocation = managedMainLocations[0] || MAIN_LOCATION_OTC

  const allowedTransportSites = useMemo(
    () => (isAdmin ? [] : normalizedScopes.filter(v => TRANSPORT_SITES.has(v))),
    [isAdmin, normalizedScopes]
  )

  const allowedComplianceSites = useMemo(
    () => (isAdmin
      ? []
      : [...new Set(
          normalizedScopes
            .map(scope => normalizeComplianceSite(scope))
            .filter(scope => COMPLIANCE_SITES.has(scope))
        )]),
    [isAdmin, normalizedScopes]
  )

  const inTransportScope = useCallback(
    (site) => isAdmin || allowedTransportSites.includes(normalizeTransportSite(site)),
    [allowedTransportSites, isAdmin]
  )

  const inComplianceScope = useCallback(
    (site) => isAdmin || allowedComplianceSites.includes(normalizeComplianceSite(site)),
    [allowedComplianceSites, isAdmin]
  )

  const inEocScope = useCallback(
    (locationId) => {
      if (isAdmin) return true
      const normalizedLocation = String(locationId || '').trim().toUpperCase()
      if (!normalizedLocation) return false
      const aliasedLocation = locationScopeAlias(normalizedLocation)
      return normalizedScopes.includes(normalizedLocation) || normalizedScopes.includes(aliasedLocation)
    },
    [isAdmin, normalizedScopes]
  )

  const inIssueScope = useCallback(
    (locationId) => isAdmin || exactIssueLocationIds.includes(String(locationId || '').trim().toLowerCase()),
    [exactIssueLocationIds, isAdmin]
  )

  return {
    isAdmin,
    isSupervisor,
    isBht,
    normalizedScopes,
    primaryScopes,
    activeBackupGrants,
    managedMainLocations,
    defaultManagedMainLocation,
    allowedTransportSites,
    allowedComplianceSites,
    exactIssueLocationIds,
    inTransportScope,
    inComplianceScope,
    inEocScope,
    inIssueScope
  }
}
