import crypto from 'node:crypto'
import { Buffer } from 'node:buffer'
import { promisify } from 'node:util'

const scryptAsync = promisify(crypto.scrypt)

export const STAFF_PIN_CREDENTIAL_SCHEMA_VERSION = 2
export const STAFF_PIN_LOGIN_CONFIG_VERSION = 2
export const STAFF_PIN_SCRYPT_COST = 16384
export const STAFF_PIN_SCRYPT_BLOCK_SIZE = 8
export const STAFF_PIN_SCRYPT_PARALLELIZATION = 1
export const STAFF_PIN_SCRYPT_KEY_LENGTH = 32
const LEGACY_PIN_PEPPER = 'sprc-pin-v2-6digit'

function requireSecret(secret) {
  const value = String(secret || '')
  if (value.length < 32) throw new Error('The server PIN secret must contain at least 32 characters.')
  return value
}

export function normalizeStaffPin(pin) {
  const normalized = String(pin || '').trim()
  if (!/^\d{6}$/.test(normalized)) throw new Error('A six-digit PIN is required.')
  return normalized
}

function hmacHex(secret, purpose, value) {
  return crypto.createHmac('sha256', requireSecret(secret)).update(`${purpose}:${value}`).digest('hex')
}

export function derivePinLookupKey(pin, secret) {
  return hmacHex(secret, 'staff-pin-lookup-v2', normalizeStaffPin(pin))
}

export function deriveStableStaffAuthUid(profileId, secret) {
  const cleanProfileId = String(profileId || '').trim()
  if (!cleanProfileId) throw new Error('A profile ID is required.')
  return `staff_${hmacHex(secret, 'staff-auth-uid-v2', cleanProfileId).slice(0, 48)}`
}

export function derivePrivateIdentifier(value, purpose, secret, length = 48) {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error(`${purpose} is required.`)
  return hmacHex(secret, purpose, normalized).slice(0, length)
}

export function deriveLegacyPinHash(pin) {
  return crypto.createHash('sha256').update(`${LEGACY_PIN_PEPPER}:${normalizeStaffPin(pin)}`).digest('hex')
}

function pinKeyMaterial(pin, secret) {
  return `${normalizeStaffPin(pin)}:${requireSecret(secret)}`
}

export async function createServerPinCredential(pin, secret, { salt = crypto.randomBytes(16).toString('base64url') } = {}) {
  const normalizedSalt = String(salt || '').trim()
  if (!normalizedSalt) throw new Error('A credential salt is required.')
  const derived = await scryptAsync(pinKeyMaterial(pin, secret), normalizedSalt, STAFF_PIN_SCRYPT_KEY_LENGTH, {
    N: STAFF_PIN_SCRYPT_COST,
    r: STAFF_PIN_SCRYPT_BLOCK_SIZE,
    p: STAFF_PIN_SCRYPT_PARALLELIZATION,
    maxmem: 64 * 1024 * 1024
  })
  return {
    schemaVersion: STAFF_PIN_CREDENTIAL_SCHEMA_VERSION,
    algorithm: 'scrypt-v1',
    lookupKey: derivePinLookupKey(pin, secret),
    salt: normalizedSalt,
    hash: Buffer.from(derived).toString('base64url'),
    cost: STAFF_PIN_SCRYPT_COST,
    blockSize: STAFF_PIN_SCRYPT_BLOCK_SIZE,
    parallelization: STAFF_PIN_SCRYPT_PARALLELIZATION,
    keyLength: STAFF_PIN_SCRYPT_KEY_LENGTH
  }
}

export async function verifyServerPinCredential(pin, secret, credential = {}) {
  if (
    credential.schemaVersion !== STAFF_PIN_CREDENTIAL_SCHEMA_VERSION
    || credential.algorithm !== 'scrypt-v1'
    || typeof credential.salt !== 'string'
    || typeof credential.hash !== 'string'
  ) return false

  const expected = await createServerPinCredential(pin, secret, { salt: credential.salt })
  const expectedBytes = Buffer.from(expected.hash, 'base64url')
  const actualBytes = Buffer.from(credential.hash, 'base64url')
  return expectedBytes.length === actualBytes.length && crypto.timingSafeEqual(expectedBytes, actualBytes)
}

export function sanitizeStaffProfile(profileId, profile = {}) {
  const stringArray = value => Array.isArray(value) ? value.filter(item => typeof item === 'string') : []
  return {
    id: String(profileId || ''),
    name: String(profile.name || ''),
    role: String(profile.role || ''),
    site: String(profile.site || ''),
    location: String(profile.location || ''),
    house: profile.house == null ? null : String(profile.house),
    locationId: profile.locationId == null ? null : String(profile.locationId),
    shiftId: profile.shiftId == null ? null : String(profile.shiftId),
    vanId: profile.vanId == null ? null : String(profile.vanId),
    vanIds: stringArray(profile.vanIds),
    authorizedLocations: stringArray(profile.authorizedLocations),
    issueLocationIds: stringArray(profile.issueLocationIds),
    securityVersion: Number(profile.securityVersion || 1)
  }
}

export function containsCredentialMaterial(value) {
  const forbidden = /(pin|hash|salt|lookupkey|secret|pepper)/i
  const visit = item => {
    if (Array.isArray(item)) return item.some(visit)
    if (!item || typeof item !== 'object') return false
    return Object.entries(item).some(([key, child]) => forbidden.test(key) || visit(child))
  }
  return visit(value)
}
