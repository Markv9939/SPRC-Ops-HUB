const MANAGED_BHT_ROLES = Object.freeze(['bht', 'tech'])

function cleanMainLocation(value) {
  const normalized = String(value || '').trim().toUpperCase()
  return ['OTC', 'RES'].includes(normalized) ? normalized : ''
}

export function buildManagedUserQueryPlan({ isAdmin = false, managedMainLocations = [] } = {}) {
  if (isAdmin) return [{ key: 'all-users', kind: 'all' }]

  const locations = [...new Set(
    (Array.isArray(managedMainLocations) ? managedMainLocations : [])
      .map(cleanMainLocation)
      .filter(Boolean)
  )]

  return locations.flatMap(location => MANAGED_BHT_ROLES.map(role => ({
    key: `${location.toLowerCase()}-${role}`,
    kind: 'scoped-bht',
    location,
    role
  })))
}

export function mergeManagedUserDocumentGroups(groups = []) {
  const byId = new Map()
  for (const group of groups) {
    for (const documentSnapshot of group || []) {
      if (documentSnapshot?.id) byId.set(documentSnapshot.id, documentSnapshot)
    }
  }
  return [...byId.values()]
}
