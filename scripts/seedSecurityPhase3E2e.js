/* global process */
import { createHash } from 'node:crypto'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { workflowsThroughStage } from './securityCanaryStageModel.js'

const projectId = process.env.GCLOUD_PROJECT || 'demo-sprc-security-phase3-e2e'
const app = initializeApp({ projectId }, 'phase3-security-browser-seed')
const db = getFirestore(app)
const now = Timestamp.now()
const activeGrantStartsAt = Timestamp.fromMillis(now.toMillis() - (60 * 1000))
const activeGrantExpiresAt = Timestamp.fromMillis(now.toMillis() + (7 * 24 * 60 * 60 * 1000))
function argument(name) {
  const prefix = `--${name}=`
  const value = process.argv.find(item => item.startsWith(prefix))
  return value ? value.slice(prefix.length) : ''
}

const securityStage = argument('stage') || 'identity_users'
const secureWorkflows = workflowsThroughStage(securityStage)
const enrollmentMode = argument('enrollment')
if (enrollmentMode && enrollmentMode !== 'canary') throw new Error('Use --enrollment=canary or omit it.')
const enabledProfileIds = enrollmentMode === 'canary' ? ['phase3_browser_mobile'] : []

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

function admin(name, pin, overrides = {}) {
  return {
    name,
    role: 'admin',
    active: true,
    deleted: false,
    pinHash: hashPin(pin),
    pinVersion: 'v2_sha256_6digit',
    site: 'GLOBAL',
    location: 'GLOBAL',
    house: null,
    locationId: null,
    authorizedLocations: [],
    issueLocationIds: ['mesquite', 'lone_mountain', 'test_house', 'res'],
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
    offlineReplayVersion: 5,
    offlineReplayEnabled: secureWorkflows.includes('eoc'),
    rolloutState: enrollmentMode === 'canary' ? 'production_canary' : 'emulator_only',
    ...(enabledProfileIds.length ? { enabledProfileIds } : {}),
    updatedAt: now
  }],
  ['appSettings/securityWorkflows', {
    schemaVersion: 6,
    enabled: true,
    workflows: secureWorkflows,
    rolloutState: enrollmentMode === 'canary' ? 'production_canary' : 'emulator_only',
    ...(enabledProfileIds.length ? { enabledProfileIds } : {}),
    updatedAt: now
  }],
  ['users/phase3_browser_mobile', bht('Phase 3 Mobile BHT', '111111', 'shift_1')],
  ['users/phase3_browser_tablet', bht('Phase 3 Tablet BHT', '555555', 'shift_2')],
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
  }],
  ['shiftAssignments/asg_phase3_browser_tablet', {
    bhtUserId: 'phase3_browser_tablet',
    bhtUserName: 'Phase 3 Tablet BHT',
    locationId: 'test_house',
    shiftId: 'shift_2',
    vanIds: ['van_test'],
    active: true,
    version: 1,
    createdAt: now,
    updatedAt: now
  }]
]

if (secureWorkflows.includes('templates_photos')) {
  writes.push(
    ['eocTemplateLibrary/security_stage4_shared', {
      schemaVersion: 3,
      name: 'Security Stage 4 Shared House Template',
      eocType: 'house',
      templateScope: 'otc_shared',
      status: 'active',
      ownerUserId: 'security_stage4_admin',
      ownerAuthUid: 'security_stage4_admin_uid',
      ownerName: 'Security Stage 4 Admin',
      sections: [{
        id: 'safety',
        title: 'Safety',
        questions: [{ id: 'doors', trackingId: 'doors', label: 'Doors and locks are secure', type: 'pass_issue', required: true }]
      }],
      currentVersion: 1,
      currentVersionId: 'security_stage4_shared__v1',
      version: 1,
      createdAt: now,
      updatedAt: now
    }],
    ['eocSubmissions/security_stage4_submission', {
      locationId: 'test_house',
      shiftId: 'shift_1',
      eocType: 'house',
      submittedByUserId: 'phase3_browser_mobile',
      submittedByName: 'Phase 3 Mobile BHT',
      templateScope: 'otc_shared',
      version: 1,
      createdAt: now,
      updatedAt: now
    }]
  )
}

if (secureWorkflows.includes('eoc')) {
  writes.push(['eocTasks/security_stage5_task', {
    taskType: 'house',
    eocType: 'house',
    locationId: 'test_house',
    shiftId: 'shift_1',
    templateScope: 'otc_shared',
    templateId: 'security_stage4_shared',
    templateName: 'Security Stage 4 Shared House Template',
    templateVersion: 1,
    templateVersionId: 'security_stage4_shared__v1',
    eligibleUserIds: ['phase3_browser_mobile'],
    status: 'pending',
    dueDate: '2026-08-29',
    version: 3,
    createdAt: now,
    updatedAt: now
  }])
}

if (secureWorkflows.includes('debriefs_alerts')) {
  const incomingAcknowledgmentLateAt = Timestamp.fromMillis(now.toMillis() - (15 * 60 * 1000))
  const baseDebrief = {
    schemaVersion: 2,
    dateKey: '2026-08-29',
    locationId: 'test_house',
    locationLabel: 'Test House',
    mainLocation: 'OTC',
    shiftId: 'shift_1',
    shiftLabel: 'Shift 1',
    receivingShiftId: 'shift_2',
    receivingShiftLabel: 'Shift 2',
    receivingUserIds: ['phase3_browser_desktop'],
    receivingUserNames: { phase3_browser_desktop: 'Phase 3 Desktop BHT' },
    status: 'submitted',
    items: [{
      id: 'security_stage6_note', type: 'general', section: 'pending_task', clientName: '',
      note: 'Complete the synthetic handoff check.', source: 'editor',
      createdAtIso: '2026-08-29T12:00:00.000Z', updatedAtIso: '2026-08-29T12:00:00.000Z',
      createdByUserId: 'phase3_browser_mobile', createdByName: 'Phase 3 Mobile BHT'
    }],
    itemCount: 1,
    extraNotes: [],
    confirmation: { acknowledgments: {}, confirmedByUserId: null, confirmedByName: null },
    confirmed: false,
    draftByUserId: 'phase3_browser_mobile',
    draftByName: 'Phase 3 Mobile BHT',
    submittedByUserId: 'phase3_browser_mobile',
    submittedByName: 'Phase 3 Mobile BHT',
    submittedAt: now,
    createdAt: now,
    updatedAt: now,
    version: 1
  }
  writes.push(
    ['shiftDebriefs/security_stage6_handoff', baseDebrief],
    ['shiftDebriefs/security_stage6_reassignment', {
      ...baseDebrief,
      items: [{
        ...baseDebrief.items[0],
        id: 'security_stage6_reassignment_note',
        note: 'Reassign this synthetic handoff to the current incoming staff member.'
      }]
    }],
    ['shiftDebriefs/security_stage6_late', {
      ...baseDebrief,
      items: [{
        ...baseDebrief.items[0],
        id: 'security_stage6_late_note',
        note: 'Synthetic handoff acknowledgment is late.'
      }],
      incomingAcknowledgmentLateAt
    }],
    ['shiftDebriefs/security_stage6_offline_conflict', {
      ...baseDebrief,
      items: [{
        ...baseDebrief.items[0],
        id: 'security_stage6_offline_conflict_note',
        note: 'Synthetic handoff changed after offline review.'
      }],
      extraNotes: [{
        id: 'security_stage6_offline_server_correction',
        type: 'general',
        section: 'pending_task',
        clientName: '',
        note: 'Server-side correction added while receiving staff was offline.',
        source: 'editor',
        createdAtIso: '2026-08-29T12:20:00.000Z',
        updatedAtIso: '2026-08-29T12:20:00.000Z',
        createdByUserId: 'phase3_browser_mobile',
        createdByName: 'Phase 3 Mobile BHT'
      }],
      version: 2
    }],
    ['shiftDebriefs/security_stage6_res_hidden', {
      ...baseDebrief,
      locationId: 'res', locationLabel: 'RES', mainLocation: 'RES',
      receivingUserIds: ['phase4_out_of_scope_res_bht'],
      receivingUserNames: { phase4_out_of_scope_res_bht: 'Out of Scope RES BHT' },
      draftByUserId: 'phase4_out_of_scope_res_bht', draftByName: 'Out of Scope RES BHT',
      submittedByUserId: 'phase4_out_of_scope_res_bht', submittedByName: 'Out of Scope RES BHT'
    }],
    ['alerts/security_stage6_receiver_alert', {
      type: 'shift_debrief_submitted', debriefId: 'security_stage6_handoff',
      locationId: 'test_house', shiftId: 'shift_1', receivingShiftId: 'shift_2',
      targetUserId: 'phase3_browser_desktop', targetUserName: 'Phase 3 Desktop BHT',
      audience: 'bht', severity: 'medium', message: 'Synthetic Test House debrief submitted.',
      read: false, version: 1, createdAt: now, updatedAt: now
    }],
    ['alerts/security_stage6_reassignment_receiver_alert', {
      type: 'shift_debrief_submitted', debriefId: 'security_stage6_reassignment',
      locationId: 'test_house', shiftId: 'shift_1', receivingShiftId: 'shift_2',
      targetUserId: 'phase3_browser_desktop', targetUserName: 'Phase 3 Desktop BHT',
      audience: 'bht', severity: 'medium', message: 'Synthetic handoff awaiting reassignment.',
      read: false, version: 1, createdAt: now, updatedAt: now
    }],
    ['alerts/security_stage6_late_receiver_alert', {
      type: 'shift_debrief_incoming_ack_late', debriefId: 'security_stage6_late',
      locationId: 'test_house', shiftId: 'shift_1', receivingShiftId: 'shift_2',
      targetUserId: 'phase3_browser_desktop', targetUserName: 'Phase 3 Desktop BHT',
      audience: 'bht', severity: 'high', message: 'Synthetic Test House handoff acknowledgment is late.',
      read: false, incomingAcknowledgmentLateAt, version: 1, createdAt: now, updatedAt: now
    }],
    ['alerts/security_stage6_late_supervisor_alert', {
      type: 'shift_debrief_incoming_ack_late', debriefId: 'security_stage6_late',
      locationId: 'test_house', shiftId: 'shift_1', receivingShiftId: 'shift_2',
      audience: 'supervisor', severity: 'high', message: 'Synthetic Test House handoff acknowledgment is late.',
      read: false, incomingAcknowledgmentLateAt, version: 1, createdAt: now, updatedAt: now
    }],
    ['alerts/security_stage6_supervisor_alert', {
      type: 'shift_debrief_submitted', debriefId: 'security_stage6_handoff',
      locationId: 'test_house', shiftId: 'shift_1', audience: 'supervisor', severity: 'medium',
      message: 'Synthetic Test House debrief submitted.', read: false, version: 1,
      createdAt: now, updatedAt: now
    }],
    ['alerts/security_stage6_res_hidden_alert', {
      type: 'shift_debrief_submitted', debriefId: 'security_stage6_res_hidden',
      locationId: 'res', shiftId: 'res_shift_1_day', audience: 'supervisor', severity: 'medium',
      message: 'Synthetic RES debrief submitted.', read: false, version: 1,
      createdAt: now, updatedAt: now
    }]
  )
}

if (secureWorkflows.includes('issues_feedback_audit')) {
  const pendingIssue = {
    schemaVersion: 3,
    source: 'bht_home',
    issueType: 'house_property',
    issueTypeLabel: 'House/property',
    eocType: 'house',
    locationId: 'test_house',
    shiftId: 'shift_1',
    label: 'Synthetic Stage 7 issue',
    description: 'Synthetic issue waiting for supervisor resolution review.',
    status: 'pending_supervisor_review',
    reportedByUserId: 'phase3_browser_mobile',
    reportedByName: 'Phase 3 Mobile BHT',
    resolutionSubmittedNotes: 'Synthetic repair is complete.',
    resolutionSubmittedByUserId: 'phase3_browser_mobile',
    resolutionSubmittedByName: 'Phase 3 Mobile BHT',
    latestActivity: {
      id: 'v2_resolution_submitted', eventType: 'resolution_submitted',
      actorUserId: 'phase3_browser_mobile', actorName: 'Phase 3 Mobile BHT'
    },
    createdAt: now,
    updatedAt: now,
    version: 2
  }
  writes.push(
    ['users/phase7_admin', admin('Phase 7 Admin', '737373')],
    ['eocIssues/security_stage7_pending_review', pendingIssue],
    ['eocIssues/security_stage7_res_out_of_scope', {
      ...pendingIssue,
      locationId: 'res', shiftId: 'res_shift_1_day',
      label: 'Synthetic RES issue', description: 'Out-of-scope synthetic RES issue.',
      reportedByUserId: 'phase4_out_of_scope_res_bht', reportedByName: 'Out of Scope RES BHT',
      resolutionSubmittedByUserId: 'phase4_out_of_scope_res_bht',
      resolutionSubmittedByName: 'Out of Scope RES BHT'
    }],
    ['appFeedback/security_stage7_res_feedback', {
      schemaVersion: 1, feedbackType: 'app_feedback',
      originalText: 'Synthetic RES feedback must not appear in a BHT personal list.',
      submittedByUserId: 'phase4_out_of_scope_res_bht', submittedByName: 'Out of Scope RES BHT',
      submittedByRole: 'bht', locationId: 'res', shiftId: 'res_shift_1_day',
      route: '/home', appVersion: 'security-stage7', userAgent: 'synthetic',
      localFeedbackId: 'security_stage7_res_feedback', status: 'new', adminNote: '',
      version: 1, createdAt: now, updatedAt: now
    }]
  )
}

if (secureWorkflows.includes('transports')) {
  const closedTransport = {
    locationId: 'test_house',
    createdByUserId: 'phase3_browser_mobile',
    createdByName: 'Phase 3 Mobile BHT',
    status: 'closed',
    version: 3,
    departedAt: now,
    returnedAt: now,
    clients: ['Stage 8 OTC Client'],
    reasons: ['Synthetic security test'],
    stops: [],
    destinations: [],
    notes: 'Synthetic closed transport for scoped read proof.',
    dcPaperworkStatus: 'na',
    createdAt: now,
    updatedAt: now,
    securityMutationVersion: 6
  }
  writes.push(
    ['transports/security_stage8_otc_closed', { ...closedTransport, site: 'OTC' }],
    ['transports/security_stage8_res_hidden', {
      ...closedTransport,
      site: 'RES', locationId: 'res',
      createdByUserId: 'phase4_out_of_scope_res_bht', createdByName: 'Out of Scope RES BHT',
      clients: ['Stage 8 RES Client']
    }]
  )
}

if (secureWorkflows.includes('operations_admin')) {
  for (const [suffix, mainLocation, locationId] of [
    ['otc', 'OTC', 'test_house'],
    ['res', 'RES', 'res']
  ]) {
    writes.push(
      [`eocProperties/security_stage9_${suffix}_property`, {
        name: `Stage 9 ${mainLocation} Property`, mainLocation, locationId,
        active: true, notes: 'Synthetic scoped property.', version: 1,
        createdAt: now, updatedAt: now
      }],
      [`eocVehicles/security_stage9_${suffix}_vehicle`, {
        name: `Stage 9 ${mainLocation} Vehicle`, mainLocation, locationId,
        vanId: suffix === 'otc' ? 'test_van' : 'res_van_1', active: true,
        currentMileage: 12000, version: 1, createdAt: now, updatedAt: now
      }],
      [`fleetMaintenanceTemplates/security_stage9_${suffix}_template`, {
        name: `Stage 9 ${mainLocation} Fleet Template`, mainLocation,
        dueMileage: 15000, active: true, version: 1, createdAt: now, updatedAt: now
      }],
      [`fleetVehicleRuntime/security_stage9_${suffix}_vehicle`, {
        vehicleId: `security_stage9_${suffix}_vehicle`, mainLocation,
        lastKnownMileage: 12000, version: 1, createdAt: now, updatedAt: now
      }],
      [`fleetTasks/security_stage9_${suffix}_task`, {
        vehicleId: `security_stage9_${suffix}_vehicle`, vehicleName: `Stage 9 ${mainLocation} Vehicle`,
        mainLocation, status: 'overdue', taskType: 'oil_change', triggerMode: 'mileage',
        dueMileage: 11000, currentMileageSnapshot: 12000, version: 1,
        createdAt: now, updatedAt: now
      }],
      [`vehicleServiceRecords/security_stage9_${suffix}_service`, {
        vehicleId: `security_stage9_${suffix}_vehicle`, vehicleName: `Stage 9 ${mainLocation} Vehicle`,
        mainLocation, serviceType: 'oil_change', serviceDate: '2026-08-29', mileage: 11500,
        notes: `Stage 9 ${mainLocation} service record`, version: 1, createdAt: now, updatedAt: now
      }],
      [`complianceEmployees/security_stage9_${suffix}_employee`, {
        name: `Stage 9 ${mainLocation} Employee`, site: mainLocation, active: true,
        version: 1, createdAt: now, updatedAt: now
      }],
      [`complianceItems/security_stage9_${suffix}_employee_item`, {
        targetType: 'employee', employeeId: `security_stage9_${suffix}_employee`,
        employeeName: `Stage 9 ${mainLocation} Employee`, employeeSite: mainLocation,
        category: 'cpr_first_aid', dueDate: now, version: 1, createdAt: now, updatedAt: now
      }],
      [`complianceItems/security_stage9_${suffix}_location_item`, {
        targetType: 'location', mainLocation, locationId: mainLocation,
        category: 'fire_safety', subtype: `Stage 9 ${mainLocation} Fire Safety`,
        dueDate: now, version: 1, createdAt: now, updatedAt: now
      }],
      [`cintasServices/security_stage9_${suffix}_service`, {
        mainLocation, locationId: mainLocation, siteAddress: `Stage 9 ${mainLocation} Address`,
        serviceType: 'Synthetic service', monthDue: 'August', fiveYearNote: '',
        version: 1, createdAt: now, updatedAt: now
      }]
    )
  }
}

if (secureWorkflows.includes('settings')) {
  writes.push(['appSettings/security_stage10_operational', {
    label: 'Stage 10 Operational Setting', enabled: true,
    version: 1, createdAt: now, updatedAt: now
  }])
}

for (const [path, data] of writes) await db.doc(path).set(data)

console.log(`Seeded ${writes.length} synthetic security browser records through ${securityStage} in ${projectId}.`)
