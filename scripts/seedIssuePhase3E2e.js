/* global process */
import { createHash } from 'node:crypto'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { getShiftById } from '../src/data/eocConstants.js'
import { getCurrentCycleDueDate } from '../src/utils/eocSchedule.js'

const PROJECT_ID = 'sprc-ops-hub-phase3-e2e'
const PIN_HASH_PEPPER = 'sprc-pin-v2-6digit'

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'

initializeApp({ projectId: PROJECT_ID })
const db = getFirestore()
const securityFoundationEnabled = process.env.SPRC_E2E_SECURITY_MODE !== 'legacy'

function hashPin(pin) {
  return createHash('sha256').update(`${PIN_HASH_PEPPER}:${pin}`).digest('hex')
}

const now = Timestamp.now()
const dueDate = getCurrentCycleDueDate(getShiftById('shift_1'))
const dueDateShift2 = getCurrentCycleDueDate(getShiftById('shift_2'))
const writes = [
  ['appSettings/authPolicy', { authScopeEnforced: false, version: 1, updatedAt: now }],
  ['appSettings/securityFoundation', {
    schemaVersion: 2,
    serverPinLoginEnabled: securityFoundationEnabled,
    clientBootstrapVersion: 3,
    clientBootstrapEnabled: securityFoundationEnabled,
    protectedAccountActionsVersion: 4,
    protectedAccountActionsEnabled: securityFoundationEnabled,
    offlineReplayVersion: 5,
    offlineReplayEnabled: securityFoundationEnabled,
    rolloutState: securityFoundationEnabled ? 'emulator_only' : 'disabled',
    updatedAt: now
  }],
  ['appSettings/securityWorkflows', {
    schemaVersion: 6,
    enabled: securityFoundationEnabled,
    workflows: securityFoundationEnabled ? ['eoc', 'issues_feedback_audit'] : [],
    updatedAt: now
  }],
  ['appSettings/eocIssueFeatures', {
    flags: { recurrence: true, photos: true, offlinePhotos: true, supervisorTools: true, issueWorkflowV2: true, retention: true, strictAuthentication: false },
    enabledLocationIds: ['test_house'],
    canaryLabel: 'Synthetic Test House',
    version: 1,
    updatedAt: now
  }],
  ['appMetrics/photoRetention', { dueIssues: 1, deleted: 2, failed: 0, version: 1, updatedAt: now }],
  ['users/phase3_bht', {
    name: 'Phase 3 Test BHT',
    role: 'bht',
    active: true,
    deleted: false,
    pinHash: hashPin('111111'),
    pinVersion: 'v2_sha256_6digit',
    site: 'OTC',
    location: 'OTC',
    house: 'TEST_HOUSE',
    authorizedLocations: ['OTC', 'TEST_HOUSE'],
    issueLocationIds: ['test_house'],
    locationId: 'test_house',
    shiftId: 'shift_1',
    vanId: 'van_test',
    vanIds: ['van_test'],
    version: 1,
    createdAt: now,
    updatedAt: now
  }],
  ['users/phase3_supervisor', {
    name: 'Phase 3 Test Supervisor',
    role: 'supervisor',
    active: true,
    deleted: false,
    pinHash: hashPin('222222'),
    pinVersion: 'v2_sha256_6digit',
    site: 'OTC',
    location: 'OTC',
    authorizedLocations: ['OTC', 'TEST_HOUSE'],
    issueLocationIds: ['test_house'],
    version: 1,
    createdAt: now,
    updatedAt: now
  }],
  ['users/phase3_same_house_bht', {
    name: 'Same House Test BHT',
    role: 'bht',
    active: true,
    deleted: false,
    pinHash: hashPin('444444'),
    pinVersion: 'v2_sha256_6digit',
    site: 'OTC',
    location: 'OTC',
    house: 'TEST_HOUSE',
    authorizedLocations: ['OTC', 'TEST_HOUSE'],
    issueLocationIds: ['test_house'],
    locationId: 'test_house',
    shiftId: 'shift_2',
    vanId: 'van_test',
    vanIds: ['van_test'],
    version: 1,
    createdAt: now,
    updatedAt: now
  }],
  ['users/phase3_tablet_bht', {
    name: 'Phase 3 Tablet BHT',
    role: 'bht',
    active: true,
    deleted: false,
    pinHash: hashPin('555555'),
    pinVersion: 'v2_sha256_6digit',
    site: 'OTC',
    location: 'OTC',
    house: 'TEST_HOUSE',
    authorizedLocations: ['OTC', 'TEST_HOUSE'],
    issueLocationIds: ['test_house'],
    locationId: 'test_house',
    shiftId: 'shift_1',
    vanId: 'van_test',
    vanIds: ['van_test'],
    version: 1,
    createdAt: now,
    updatedAt: now
  }],
  ['users/phase3_admin', {
    name: 'Phase 3 Test Admin',
    role: 'admin',
    active: true,
    deleted: false,
    pinHash: hashPin('333333'),
    pinVersion: 'v2_sha256_6digit',
    site: 'ALL',
    location: 'ALL',
    authorizedLocations: ['ALL', 'OTC', 'RES', 'TEST_HOUSE'],
    issueLocationIds: ['test_house', 'mesquite', 'lone_mountain', 'res'],
    version: 1,
    createdAt: now,
    updatedAt: now
  }],
  ['users/phase3_other_house_bht', {
    name: 'Other House Test BHT',
    role: 'bht',
    active: true,
    deleted: false,
    site: 'OTC',
    location: 'OTC',
    house: 'MESQUITE',
    authorizedLocations: ['OTC', 'MESQUITE'],
    issueLocationIds: ['mesquite'],
    locationId: 'mesquite',
    shiftId: 'shift_1',
    vanId: 'van_1',
    vanIds: ['van_1'],
    version: 1,
    createdAt: now,
    updatedAt: now
  }],
  ['shiftAssignments/asg_phase3_bht', {
    bhtUserId: 'phase3_bht',
    bhtUserName: 'Phase 3 Test BHT',
    locationId: 'test_house',
    shiftId: 'shift_1',
    vanId: 'van_test',
    vanIds: ['van_test'],
    active: true,
    source: 'e2e_test',
    version: 1,
    createdAt: now,
    updatedAt: now
  }],
  ['shiftAssignments/asg_phase3_same_house_bht', {
    bhtUserId: 'phase3_same_house_bht',
    bhtUserName: 'Same House Test BHT',
    locationId: 'test_house',
    shiftId: 'shift_2',
    vanId: 'van_test',
    vanIds: ['van_test'],
    active: true,
    source: 'e2e_test',
    version: 1,
    createdAt: now,
    updatedAt: now
  }],
  ['shiftAssignments/asg_phase3_tablet_bht', {
    bhtUserId: 'phase3_tablet_bht',
    bhtUserName: 'Phase 3 Tablet BHT',
    locationId: 'test_house',
    shiftId: 'shift_1',
    vanId: 'van_test',
    vanIds: ['van_test'],
    active: true,
    source: 'e2e_test',
    version: 1,
    createdAt: now,
    updatedAt: now
  }],
  ['shiftAssignments/asg_phase3_other_house_bht', {
    bhtUserId: 'phase3_other_house_bht',
    bhtUserName: 'Other House Test BHT',
    locationId: 'mesquite',
    shiftId: 'shift_1',
    vanId: 'van_1',
    vanIds: ['van_1'],
    active: true,
    source: 'e2e_test',
    version: 1,
    createdAt: now,
    updatedAt: now
  }],
  ['eocTemplateLibrary/phase3_house_template', {
    name: 'Phase 3 Test House EOC',
    eocType: 'house',
    status: 'active',
    items: [
      { id: 'phase3_smoke_detectors', trackingId: 'phase3_smoke_detectors', category: 'Safety', label: 'Are the smoke detectors secure and undamaged?', helpText: '', requiresPhotoOnIssue: false, order: 1, active: true },
      { id: 'phase3_kitchen_sink', trackingId: 'phase3_kitchen_sink', category: 'Kitchen', label: 'Is the kitchen sink working without leaks?', helpText: 'Check under the sink for moisture.', requiresPhotoOnIssue: true, order: 2, active: true }
    ],
    itemSchemaVersion: 2,
    publishedVersion: 1,
    publishedVersionId: 'phase3_house_template__v1',
    version: 1,
    createdAt: now,
    updatedAt: now
  }],
  ['eocTemplateVersions/phase3_house_template__v1', {
    templateId: 'phase3_house_template',
    templateName: 'Phase 3 Test House EOC',
    eocType: 'house',
    status: 'active',
    items: [
      { id: 'phase3_smoke_detectors', trackingId: 'phase3_smoke_detectors', category: 'Safety', label: 'Are the smoke detectors secure and undamaged?', helpText: '', requiresPhotoOnIssue: false, order: 1, active: true },
      { id: 'phase3_kitchen_sink', trackingId: 'phase3_kitchen_sink', category: 'Kitchen', label: 'Is the kitchen sink working without leaks?', helpText: 'Check under the sink for moisture.', requiresPhotoOnIssue: true, order: 2, active: true }
    ],
    itemSchemaVersion: 2,
    versionNumber: 1,
    version: 1,
    publishedAt: now,
    createdAt: now
  }],
  ['eocTemplateLibrary/phase3_van_template', {
    name: 'Phase 3 Test Van EOC',
    eocType: 'van',
    status: 'active',
    items: [
      { id: 'phase3_van_tires', trackingId: 'phase3_van_tires', category: 'Engine Off Criteria', label: 'Are the tires visibly safe and properly inflated?', helpText: '', requiresPhotoOnIssue: false, order: 1, active: true },
      { id: 'phase3_van_lights', trackingId: 'phase3_van_lights', category: 'Engine On Criteria', label: 'Are the headlights and turn signals working?', helpText: '', requiresPhotoOnIssue: false, order: 2, active: true }
    ],
    itemSchemaVersion: 2,
    publishedVersion: 1,
    publishedVersionId: 'phase3_van_template__v1',
    version: 1,
    createdAt: now,
    updatedAt: now
  }],
  ['eocTemplateVersions/phase3_van_template__v1', {
    templateId: 'phase3_van_template',
    templateName: 'Phase 3 Test Van EOC',
    eocType: 'van',
    status: 'active',
    items: [
      { id: 'phase3_van_tires', trackingId: 'phase3_van_tires', category: 'Engine Off Criteria', label: 'Are the tires visibly safe and properly inflated?', helpText: '', requiresPhotoOnIssue: false, order: 1, active: true },
      { id: 'phase3_van_lights', trackingId: 'phase3_van_lights', category: 'Engine On Criteria', label: 'Are the headlights and turn signals working?', helpText: '', requiresPhotoOnIssue: false, order: 2, active: true }
    ],
    itemSchemaVersion: 2,
    versionNumber: 1,
    version: 1,
    publishedAt: now,
    createdAt: now
  }],
  ['eocVehicles/phase3_van_test_vehicle', {
    vanId: 'van_test',
    name: 'Phase 3 Test Van',
    vin: 'TESTVIN0000000001',
    active: true,
    version: 1,
    createdAt: now,
    updatedAt: now
  }],
  ['eocTemplateAssignments/asg_test_house_shift_1_house', {
    locationId: 'test_house',
    shiftId: 'shift_1',
    eocType: 'house',
    defaultTemplateId: 'phase3_house_template',
    defaultTemplateName: 'Phase 3 Test House EOC',
    defaultTemplateVersion: 1,
    defaultTemplateVersionId: 'phase3_house_template__v1',
    version: 1,
    createdAt: now,
    updatedAt: now
  }],
  ['eocTemplateAssignments/asg_test_house_shift_2_house', {
    locationId: 'test_house',
    shiftId: 'shift_2',
    eocType: 'house',
    defaultTemplateId: 'phase3_house_template',
    defaultTemplateName: 'Phase 3 Test House EOC',
    defaultTemplateVersion: 1,
    defaultTemplateVersionId: 'phase3_house_template__v1',
    version: 1,
    createdAt: now,
    updatedAt: now
  }],
  [`eocTasks/task_test_house_shift_1_house_${dueDate}`, {
    taskType: 'house',
    eocType: 'house',
    locationId: 'test_house',
    shiftId: 'shift_1',
    dueDate,
    cycleKey: `phase3_house_${dueDate}`,
    status: 'pending',
    eligibleUserIds: ['phase3_bht'],
    assigneeUserId: 'phase3_bht',
    templateScope: 'otc_shared',
    templateId: 'phase3_house_template',
    templateName: 'Phase 3 Test House EOC',
    templateVersion: 1,
    templateVersionId: 'phase3_house_template__v1',
    version: 1,
    dueAt: now,
    createdAt: now,
    updatedAt: now
  }],
  [`eocTasks/task_test_house_shift_2_house_${dueDateShift2}`, {
    taskType: 'house',
    eocType: 'house',
    locationId: 'test_house',
    shiftId: 'shift_2',
    dueDate: dueDateShift2,
    cycleKey: `phase3_house_shift2_${dueDateShift2}`,
    status: 'pending',
    eligibleUserIds: ['phase3_same_house_bht'],
    assigneeUserId: 'phase3_same_house_bht',
    templateScope: 'otc_shared',
    templateId: 'phase3_house_template',
    templateName: 'Phase 3 Test House EOC',
    templateVersion: 1,
    templateVersionId: 'phase3_house_template__v1',
    version: 1,
    dueAt: now,
    createdAt: now,
    updatedAt: now
  }],
  ['eocTemplateAssignments/asg_test_house_shift_1_van', {
    locationId: 'test_house',
    shiftId: 'shift_1',
    eocType: 'van',
    defaultTemplateId: 'phase3_van_template',
    defaultTemplateName: 'Phase 3 Test Van EOC',
    defaultTemplateVersion: 1,
    defaultTemplateVersionId: 'phase3_van_template__v1',
    version: 1,
    createdAt: now,
    updatedAt: now
  }],
  ['eocTemplateAssignments/asg_test_house_shift_2_van', {
    locationId: 'test_house',
    shiftId: 'shift_2',
    eocType: 'van',
    defaultTemplateId: 'phase3_van_template',
    defaultTemplateName: 'Phase 3 Test Van EOC',
    defaultTemplateVersion: 1,
    defaultTemplateVersionId: 'phase3_van_template__v1',
    version: 1,
    createdAt: now,
    updatedAt: now
  }],
  ['eocTasks/phase3_house_task_tablet', {
    taskType: 'house',
    eocType: 'house',
    locationId: 'test_house',
    shiftId: 'shift_1',
    dueDate,
    cycleKey: `phase3_house_tablet_${dueDate}`,
    status: 'pending',
    eligibleUserIds: ['phase3_tablet_bht'],
    assigneeUserId: 'phase3_tablet_bht',
    templateScope: 'otc_shared',
    templateId: 'phase3_house_template',
    templateName: 'Phase 3 Test House EOC',
    templateVersion: 1,
    templateVersionId: 'phase3_house_template__v1',
    version: 1,
    dueAt: now,
    createdAt: now,
    updatedAt: now
  }],
  [`eocTasks/task_test_house_shift_1_van_van_test_${dueDate}`, {
    taskType: 'van',
    eocType: 'van',
    locationId: 'test_house',
    shiftId: 'shift_1',
    vanId: 'van_test',
    vehicleId: 'phase3_van_test_vehicle',
    dueDate,
    cycleKey: `phase3_van_${dueDate}`,
    status: 'pending',
    eligibleUserIds: ['phase3_bht'],
    assigneeUserId: 'phase3_bht',
    templateScope: 'otc_shared',
    templateId: 'phase3_van_template',
    templateName: 'Phase 3 Test Van EOC',
    templateVersion: 1,
    templateVersionId: 'phase3_van_template__v1',
    version: 1,
    dueAt: now,
    createdAt: now,
    updatedAt: now
  }],
  [`eocTasks/task_test_house_shift_2_van_van_test_${dueDateShift2}`, {
    taskType: 'van',
    eocType: 'van',
    locationId: 'test_house',
    shiftId: 'shift_2',
    vanId: 'van_test',
    vehicleId: 'phase3_van_test_vehicle',
    dueDate: dueDateShift2,
    cycleKey: `phase3_van_shift2_${dueDateShift2}`,
    status: 'pending',
    eligibleUserIds: ['phase3_same_house_bht'],
    assigneeUserId: 'phase3_same_house_bht',
    templateScope: 'otc_shared',
    templateId: 'phase3_van_template',
    templateName: 'Phase 3 Test Van EOC',
    templateVersion: 1,
    templateVersionId: 'phase3_van_template__v1',
    version: 1,
    dueAt: now,
    createdAt: now,
    updatedAt: now
  }],
  ['eocTasks/phase3_van_task_tablet', {
    taskType: 'van',
    eocType: 'van',
    locationId: 'test_house',
    shiftId: 'shift_1',
    vanId: 'van_test',
    vehicleId: 'phase3_van_test_vehicle',
    dueDate,
    cycleKey: `phase3_van_tablet_${dueDate}`,
    status: 'pending',
    eligibleUserIds: ['phase3_tablet_bht'],
    assigneeUserId: 'phase3_tablet_bht',
    templateScope: 'otc_shared',
    templateId: 'phase3_van_template',
    templateName: 'Phase 3 Test Van EOC',
    templateVersion: 1,
    templateVersionId: 'phase3_van_template__v1',
    version: 1,
    dueAt: now,
    createdAt: now,
    updatedAt: now
  }],
  ['eocIssues/phase3_active_issue', {
    schemaVersion: 2,
    source: 'quick_report',
    issueType: 'house_property',
    issueTypeLabel: 'House/property',
    eocType: 'house',
    locationId: 'test_house',
    shiftId: 'shift_2',
    label: 'Laundry room dryer',
    category: 'Staff report',
    description: 'Dryer is running but not producing heat.',
    status: 'open',
    reportedByUserId: 'phase3_same_house_bht',
    reportedByName: 'Same House Test BHT',
    version: 1,
    latestActivity: { id: 'v1_reported', eventType: 'reported', label: 'Reported', note: 'Dryer is running but not producing heat.', actorUserId: 'phase3_same_house_bht', actorName: 'Same House Test BHT', createdAt: now },
    createdAt: now,
    updatedAt: now
  }],
  ['eocIssues/phase3_active_issue/activity/v1_reported', {
    issueId: 'phase3_active_issue', eventType: 'reported', label: 'Reported', status: 'open', note: 'Dryer is running but not producing heat.', actorUserId: 'phase3_same_house_bht', actorName: 'Same House Test BHT', locationId: 'test_house', issueVersion: 1, version: 1, immutable: true, createdAt: now
  }],
  ['eocIssues/phase3_resolution_mobile', {
    schemaVersion: 3, source: 'quick_report', issueType: 'house_property', issueTypeLabel: 'House/property', eocType: 'house', locationId: 'test_house', shiftId: 'shift_1', label: 'Mobile resolution review', category: 'Staff report', description: 'Mobile bathroom needs cleaning.', status: 'open', reportedByUserId: 'phase3_bht', reportedByName: 'Phase 3 Test BHT', version: 1, latestActivity: { id: 'v1_reported', eventType: 'reported', label: 'Reported', note: 'Mobile bathroom needs cleaning.', actorUserId: 'phase3_bht', actorName: 'Phase 3 Test BHT', createdAt: now }, createdAt: now, updatedAt: now
  }],
  ['eocIssues/phase3_resolution_desktop', {
    schemaVersion: 3, source: 'quick_report', issueType: 'house_property', issueTypeLabel: 'House/property', eocType: 'house', locationId: 'test_house', shiftId: 'shift_2', label: 'Desktop resolution review', category: 'Staff report', description: 'Desktop bathroom needs cleaning.', status: 'open', reportedByUserId: 'phase3_same_house_bht', reportedByName: 'Same House Test BHT', version: 1, latestActivity: { id: 'v1_reported', eventType: 'reported', label: 'Reported', note: 'Desktop bathroom needs cleaning.', actorUserId: 'phase3_same_house_bht', actorName: 'Same House Test BHT', createdAt: now }, createdAt: now, updatedAt: now
  }],
  ['eocIssues/phase3_resolved_issue', {
    schemaVersion: 2,
    source: 'eoc_checklist',
    issueType: 'house_property',
    issueTypeLabel: 'House/property',
    eocType: 'house',
    locationId: 'test_house',
    shiftId: 'shift_1',
    taskId: 'older_test_task',
    submissionId: 'older_test_submission',
    itemId: 'back_door_latch',
    trackingId: 'back_door_latch',
    label: 'Back door latch',
    category: 'Safety',
    description: 'Latch was difficult to close.',
    status: 'resolved',
    reportedByUserId: 'phase3_bht',
    reportedByName: 'Phase 3 Test BHT',
    resolvedNotes: 'Latch aligned, lubricated, and tested.',
    resolvedByUserId: 'phase3_supervisor',
    resolvedByName: 'Phase 3 Test Supervisor',
    resolvedAt: now,
    closedAt: now,
    version: 2,
    latestActivity: { id: 'v2_resolved', eventType: 'resolved', label: 'Resolved', note: 'Latch aligned, lubricated, and tested.', actorUserId: 'phase3_supervisor', actorName: 'Phase 3 Test Supervisor', createdAt: now },
    createdAt: now,
    updatedAt: now
  }],
  ['eocIssues/phase3_resolved_issue/activity/v1_reported', {
    issueId: 'phase3_resolved_issue', eventType: 'reported', label: 'Reported', status: 'open', note: 'Latch was difficult to close.', actorUserId: 'phase3_bht', actorName: 'Phase 3 Test BHT', locationId: 'test_house', issueVersion: 1, version: 1, immutable: true, createdAt: Timestamp.fromMillis(now.toMillis() - 3600000)
  }],
  ['eocIssues/phase3_resolved_issue/activity/v2_resolved', {
    issueId: 'phase3_resolved_issue', eventType: 'resolved', label: 'Resolved', status: 'resolved', note: 'Latch aligned, lubricated, and tested.', actorUserId: 'phase3_supervisor', actorName: 'Phase 3 Test Supervisor', locationId: 'test_house', issueVersion: 2, version: 1, immutable: true, createdAt: now
  }]
]

const batch = db.batch()
writes.forEach(([path, data]) => batch.set(db.doc(path), data))
await batch.commit()

console.log(JSON.stringify({ projectId: PROJECT_ID, dueDate, dueDateShift2, seededDocuments: writes.length }))
