/* global process */
import { createHash } from 'node:crypto'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

const projectId = process.env.GCLOUD_PROJECT || 'demo-sprc-security-phase3-e2e'
const app = initializeApp({ projectId }, 'phase3-security-browser-seed')
const db = getFirestore(app)
const now = Timestamp.now()
const activeGrantStartsAt = Timestamp.fromMillis(now.toMillis() - (60 * 1000))
const activeGrantExpiresAt = Timestamp.fromMillis(now.toMillis() + (7 * 24 * 60 * 60 * 1000))

function hashPin(pin) {
  return createHash('sha256').update(`sprc-pin-v2-6digit:${pin}`).digest('hex')
}

function bht(name, pin, shiftId, overrides = {}) {
  return {
    name,
    role: 'bht',
    active: true,
    deleted: false,
    pinHash: hashPin(pin),
    pinVersion: 'v2_sha256_6digit',
    site: 'OTC',
    location: 'OTC',
    house: 'TEST_HOUSE',
    authorizedLocations: ['OTC', 'TEST_HOUSE'],
    issueLocationIds: ['test_house'],
    locationId: 'test_house',
    shiftId,
    vanId: 'van_test',
    vanIds: ['van_test'],
    securityVersion: 1,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

function supervisor(name, pin, overrides = {}) {
  return {
    name,
    role: 'supervisor',
    active: true,
    deleted: false,
    pinHash: hashPin(pin),
    pinVersion: 'v2_sha256_6digit',
    site: 'OTC',
    location: 'OTC',
    house: null,
    locationId: null,
    authorizedLocations: ['OTC'],
    issueLocationIds: ['mesquite', 'lone_mountain', 'test_house'],
    securityVersion: 1,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

const writes = [
  ['appSettings/authPolicy', { authScopeEnforced: false, version: 1, updatedAt: now }],
  ['appSettings/securityFoundation', {
    schemaVersion: 2,
    serverPinLoginEnabled: true,
    clientBootstrapVersion: 3,
    clientBootstrapEnabled: true,
    protectedAccountActionsVersion: 4,
    protectedAccountActionsEnabled: true,
    rolloutState: 'emulator_only',
    updatedAt: now
  }],
  ['appSettings/securityWorkflows', {
    schemaVersion: 6,
    enabled: true,
    workflows: ['identity_users'],
    updatedAt: now
  }],
  ['users/phase3_browser_mobile', bht('Phase 3 Mobile BHT', '111111', 'shift_1')],
  ['users/phase3_browser_tablet', bht('Phase 3 Tablet BHT', '555555', 'shift_1')],
  ['users/phase3_browser_desktop', bht('Phase 3 Desktop BHT', '444444', 'shift_2')],
  ['users/phase4_self_bht', bht('Phase 4 Self BHT', '284619', 'shift_1', { house: 'MESQUITE', locationId: 'mesquite', authorizedLocations: ['OTC'], issueLocationIds: ['mesquite'], vanId: 'van_1', vanIds: ['van_1'] })],
  ['users/phase4_supervisor', supervisor('Phase 4 Supervisor', '395172')],
  ['users/phase4_target_bht', bht('Phase 4 Target BHT', '619274', 'shift_1', { house: 'MESQUITE', locationId: 'mesquite', authorizedLocations: ['OTC'], issueLocationIds: ['mesquite'], vanId: 'van_1', vanIds: ['van_1'] })],
  ['users/phase4_end_sessions_bht', bht('Phase 4 End Sessions BHT', '472619', 'shift_2', { house: 'LONE_MOUNTAIN', locationId: 'lone_mountain', authorizedLocations: ['OTC'], issueLocationIds: ['lone_mountain'], vanId: 'van_2', vanIds: ['van_2'] })],
  ['users/phase4_out_of_scope_res_bht', bht('Out of Scope RES BHT', '851472', 'res_shift_1_day', { site: 'RES', location: 'RES', house: null, locationId: 'res', authorizedLocations: ['RES'], issueLocationIds: ['res'], vanId: 'van_3', vanIds: ['van_3'] })],
  ['accessGrants/phase3_mobile_active_scope', {
    userId: 'phase3_browser_mobile', userName: 'Phase 3 Mobile BHT', locationId: 'RES',
    startsAt: activeGrantStartsAt, expiresAt: activeGrantExpiresAt,
    reason: 'Synthetic strict-scope browser test', revoked: false, revokedAt: null,
    version: 1, createdByUserId: 'synthetic_admin', createdByName: 'Synthetic Admin', createdAt: now, updatedAt: now
  }],
  ['issueAccess/phase3_browser_mobile', {
    userId: 'phase3_browser_mobile', locationIds: ['test_house', 'res'], active: true,
    version: 1, createdAt: now, updatedAt: now
  }]
]

for (const [path, data] of writes) await db.doc(path).set(data)

console.log(`Seeded ${writes.length} synthetic Phase 3 browser records in ${projectId}.`)
