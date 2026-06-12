import { db } from '../firebase'
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  Timestamp,
  increment
} from 'firebase/firestore'
import {
  GLOBAL_SCOPE,
  isAdminRole,
  normalizeMainLocation,
  normalizeRole,
  normalizeScopeValue,
  normalizeScopeValues
} from '../utils/orgModel'

export const ACCESS_GRANT_STATES = Object.freeze({
  ACTIVE: 'active',
  UPCOMING: 'upcoming',
  EXPIRED: 'expired',
  REVOKED: 'revoked'
})

function normalizeLocationId(value) {
  const normalized = normalizeScopeValue(value)
  return normalized || String(value || '').trim().toUpperCase()
}

function toDate(value) {
  if (!value) return null
  if (typeof value.toDate === 'function') return value.toDate()
  if (value instanceof Date) return value
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function startOfDay(dateStr) {
  return new Date(`${String(dateStr)}T00:00:00.000`)
}

function endOfDay(dateStr) {
  return new Date(`${String(dateStr)}T23:59:59.999`)
}

function toIso(value) {
  const date = toDate(value)
  return date ? date.toISOString() : null
}

function normalizeBaseScopes(userData) {
  const raw = []
  if (userData?.site) raw.push(userData.site)
  if (Array.isArray(userData?.authorizedLocations)) raw.push(...userData.authorizedLocations)
  return normalizeScopeValues(raw)
}

function normalizeExactIssueLocation(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'lone_mountain') return 'lone_mountain'
  if (normalized === 'mesquite') return 'mesquite'
  if (normalized === 'res') return 'res'
  return ''
}

function normalizeIssueLocations(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(normalizeExactIssueLocation)
    .filter(Boolean))]
}

async function loadEffectiveIssueAccess(userId) {
  if (!userId) return []
  try {
    const snap = await getDoc(doc(db, 'issueAccess', userId))
    if (!snap.exists()) return []
    const data = snap.data()
    if (data.active === false) return []
    return normalizeIssueLocations(data.locationIds)
  } catch (error) {
    console.warn('Issue access lookup failed:', error)
    return []
  }
}

export function deriveAccessGrantState(grant, now = new Date()) {
  if (!grant) return ACCESS_GRANT_STATES.EXPIRED

  const revokedAt = toDate(grant.revokedAt)
  const isRevoked = grant.revoked === true || !!revokedAt
  if (isRevoked) return ACCESS_GRANT_STATES.REVOKED

  const startsAt = toDate(grant.startsAt)
  const expiresAt = toDate(grant.expiresAt)
  if (!startsAt || !expiresAt) return ACCESS_GRANT_STATES.EXPIRED

  if (now < startsAt) return ACCESS_GRANT_STATES.UPCOMING
  if (now > expiresAt) return ACCESS_GRANT_STATES.EXPIRED
  return ACCESS_GRANT_STATES.ACTIVE
}

function mapGrantDoc(docSnap) {
  const data = docSnap.data()
  return {
    id: docSnap.id,
    userId: data.userId || '',
    userName: data.userName || '',
    locationId: normalizeLocationId(data.locationId),
    startsAtIso: toIso(data.startsAt),
    expiresAtIso: toIso(data.expiresAt),
    revokedAtIso: toIso(data.revokedAt),
    revoked: data.revoked === true,
    reason: data.reason || '',
    revokedReason: data.revokedReason || '',
    createdAtIso: toIso(data.createdAt),
    updatedAtIso: toIso(data.updatedAt),
    state: deriveAccessGrantState(data)
  }
}

function sortGrantsForDisplay(grants) {
  return [...grants].sort((a, b) => {
    const aDate = Date.parse(a.createdAtIso || a.startsAtIso || '') || 0
    const bDate = Date.parse(b.createdAtIso || b.startsAtIso || '') || 0
    return bDate - aDate
  })
}

export async function loadAccessGrantsForUser(userId) {
  if (!userId) return []
  const snap = await getDocs(
    query(collection(db, 'accessGrants'), where('userId', '==', userId))
  )
  return sortGrantsForDisplay(snap.docs.map(mapGrantDoc))
}

export async function getScopedSessionUser(userId, userData) {
  const normalizedRole = normalizeRole(userData?.role)
  const baseScopes = normalizeBaseScopes(userData)
  const issueAccessLocations = await loadEffectiveIssueAccess(userId)
  const baseIssueLocations = normalizeIssueLocations(userData?.issueLocationIds)
  const profileLocation = normalizeExactIssueLocation(userData?.locationId)
  const issueLocationIds = [...new Set([
    ...baseIssueLocations,
    ...(profileLocation ? [profileLocation] : []),
    ...issueAccessLocations
  ])]
  const grants = await loadAccessGrantsForUser(userId)
  const activeGrantLocations = grants
    .filter(grant => grant.state === ACCESS_GRANT_STATES.ACTIVE)
    .map(grant => grant.locationId)
  const mergedScopes = [...new Set([...baseScopes, ...activeGrantLocations])]
  const activeBackupGrants = grants.filter(grant => grant.state === ACCESS_GRANT_STATES.ACTIVE)
  const normalizedSite = isAdminRole(normalizedRole)
    ? GLOBAL_SCOPE
    : (normalizeMainLocation(userData?.site) || normalizeMainLocation(baseScopes[0]) || '')

  return {
    id: userId,
    name: userData.name,
    role: normalizedRole,
    active: userData.active !== false,
    email: userData.email || null,
    emailDomain: userData.emailDomain || null,
    emailType: userData.emailType || null,
    site: normalizedSite,
    locationId: userData.locationId || null,
    shiftId: userData.shiftId || null,
    vanId: userData.vanId || null,
    vanIds: Array.isArray(userData.vanIds)
      ? userData.vanIds.map(v => String(v || '').trim().toLowerCase()).filter(Boolean)
      : (userData.vanId ? [String(userData.vanId).trim().toLowerCase()] : []),
    authorizedLocations: mergedScopes,
    issueLocationIds,
    primaryScopes: baseScopes,
    activeBackupGrants,
    scopeRefreshedAt: new Date().toISOString()
  }
}

export async function refreshScopedSessionUser(userId) {
  if (!userId) return null
  const userRef = doc(db, 'users', userId)
  const userSnap = await getDoc(userRef)
  if (!userSnap.exists()) return null

  const userData = userSnap.data()
  if (userData.active === false) return null
  return getScopedSessionUser(userId, userData)
}

export async function grantBackupAccess({
  userId,
  userName,
  locationId,
  startsOn,
  expiresOn,
  reason,
  grantedByUserId,
  grantedByName
}) {
  const normalizedLocation = normalizeLocationId(locationId)
  const startDate = startOfDay(startsOn)
  const expiryDate = endOfDay(expiresOn)

  if (!userId || !userName) throw new Error('User is required.')
  if (!normalizedLocation) throw new Error('Location is required.')
  if (!startsOn || Number.isNaN(startDate.getTime())) throw new Error('Valid start date is required.')
  if (!expiresOn || Number.isNaN(expiryDate.getTime())) throw new Error('Valid expiry date is required.')
  if (startDate > expiryDate) throw new Error('Expiry must be on or after start date.')
  if (!String(reason || '').trim()) throw new Error('Reason is required.')
  if (!grantedByUserId || !grantedByName) throw new Error('Grant actor is required.')

  const createdRef = await addDoc(collection(db, 'accessGrants'), {
    userId,
    userName,
    locationId: normalizedLocation,
    startsAt: Timestamp.fromDate(startDate),
    expiresAt: Timestamp.fromDate(expiryDate),
    reason: String(reason).trim(),
    revoked: false,
    revokedAt: null,
    revokedReason: null,
    version: 1,
    createdByUserId: grantedByUserId,
    createdByName: grantedByName,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  })

  return createdRef.id
}

export async function revokeBackupAccess({
  grantId,
  reason,
  revokedByUserId,
  revokedByName
}) {
  if (!grantId) throw new Error('Grant id is required.')
  if (!String(reason || '').trim()) throw new Error('Revocation reason is required.')
  if (!revokedByUserId || !revokedByName) throw new Error('Revocation actor is required.')

  await updateDoc(doc(db, 'accessGrants', grantId), {
    revoked: true,
    revokedAt: serverTimestamp(),
    revokedReason: String(reason).trim(),
    revokedByUserId,
    revokedByName,
    version: increment(1),
    updatedAt: serverTimestamp()
  })
}
