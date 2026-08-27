import { normalizeSecurityRole, validateBhtHomeLocation } from './securityFoundationModel.js'

export function normalizeTransportSite(value) {
  const site = String(value || '').trim().toUpperCase()
  return site === 'OTC' || site === 'RES' ? site : ''
}

export function actorCanCreateTransport(actor = {}, requestedSite) {
  const site = normalizeTransportSite(requestedSite)
  const role = normalizeSecurityRole(actor.role)
  if (!site || !['bht', 'supervisor', 'admin'].includes(role)) return false
  if (role === 'admin') return true
  if (role === 'bht') {
    const home = validateBhtHomeLocation(actor)
    return home.valid && home.mainLocation === site
  }
  const scopes = new Set((Array.isArray(actor.authorizedLocations) ? actor.authorizedLocations : [])
    .map(value => String(value || '').trim().toUpperCase()))
  return scopes.has(site)
    || (site === 'OTC' && (scopes.has('PHP') || scopes.has('RTC')))
    || (site === 'RES' && scopes.has('PHP'))
}

export function newProtectedTransport({ actor, site, now }) {
  if (!actorCanCreateTransport(actor, site)) throw new Error('Actor cannot create a transport at that site.')
  return {
    site: normalizeTransportSite(site),
    locationId: String(actor.locationId || '').trim(),
    createdByUserId: actor.id,
    createdByName: String(actor.name || '').trim() || 'Staff user',
    status: 'open',
    version: 1,
    departedAt: now,
    clients: [],
    reasons: [],
    stops: [],
    destinations: [],
    notes: '',
    createdAt: now,
    updatedAt: now,
    securityMutationVersion: 6
  }
}
