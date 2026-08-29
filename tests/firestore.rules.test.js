import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore'
import { commitFirestoreWritesInChunks } from '../src/utils/firestoreBatching.js'

const projectId = 'sprc-ops-hub-rules-test'

const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: {
    rules: readFileSync('firestore.rules', 'utf8')
  }
})

test.after(async () => {
  await testEnv.cleanup()
})

async function seed(path, data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path), data)
  })
}

test.before(async () => {
  await testEnv.clearFirestore()
  await seed('appSettings/authPolicy', {
    authScopeEnforced: true
  })
})

function authed(uid, email) {
  return testEnv.authenticatedContext(uid, {
    email,
    email_verified: true
  }).firestore()
}

function secureAuthed(uid, profileId, sessionId, securityVersion, role, secureWorkflows, scope = {}) {
  return testEnv.authenticatedContext(uid, {
    profileId,
    sessionId,
    sessionVersion: 2,
    securityVersion,
    role,
    authorizedLocations: scope.authorizedLocations || [],
    issueLocationIds: scope.issueLocationIds || [],
    locationId: scope.locationId || '',
    workflowSecurityVersion: 6,
    secureWorkflows
  }).firestore()
}

test('approved admin mapping can read own profile', async () => {
  await seed('users/admin_owner', {
    name: 'Admin Owner',
    role: 'admin',
    active: true,
    email: 'mark@scottsdaleprovidence.com',
    authorizedLocations: [],
    issueLocationIds: ['lone_mountain', 'mesquite', 'res'],
    version: 1
  })
  await seed('usersByAuthUid/admin_uid', {
    userId: 'admin_owner',
    email: 'mark@scottsdaleprovidence.com',
    emailDomain: 'scottsdaleprovidence.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })

  const snap = await assertSucceeds(getDoc(doc(authed('admin_uid', 'mark@scottsdaleprovidence.com'), 'users/admin_owner')))
  assert.equal(snap.exists(), true)
})

test('Phase 2 credentials, identities, sessions, rate limits, audits, and activation boundary are server-only', async () => {
  await seed('users/admin_owner', {
    name: 'Admin Owner',
    role: 'admin',
    active: true,
    site: 'GLOBAL',
    authorizedLocations: [],
    issueLocationIds: ['lone_mountain', 'mesquite', 'test_house', 'res'],
    version: 1
  })
  await seed('usersByAuthUid/admin_uid', {
    userId: 'admin_owner',
    linkedBy: 'test',
    version: 1
  })
  await seed('staffPinCredentials/security_bht', { algorithm: 'scrypt-v1', hash: 'server-only', salt: 'server-only', lookupKey: 'server-only' })
  await seed('staffAuthIdentities/security_bht', { profileId: 'security_bht', authUid: 'staff_uid' })
  await seed('staffSessions/security_session', { profileId: 'security_bht', authUid: 'staff_uid' })
  await seed('securityRateLimits/security_rate', { attemptCount: 1 })
  await seed('securityLoginAudit/security_audit', { action: 'staff_pin_login_failed' })
  await seed('staffPinLookup/security_lookup', { profileId: 'security_bht' })
  await seed('securityAccountAudit/security_account_audit', { action: 'reset_pin' })
  await seed('securityCleanupJobs/security_cleanup', { status: 'pending' })
  await seed('securityOfflineReplayAudit/security_replay', { action: 'offline_replay_authorized' })
  await seed('securityWorkflowLocks/security_lock', { active: true })
  await seed('securityWorkflowAudit/security_workflow_audit', { action: 'protected_transport_created' })

  const adminDb = authed('admin_uid', 'mark@scottsdaleprovidence.com')
  const anonymousDb = testEnv.unauthenticatedContext().firestore()
  for (const path of [
    'staffPinCredentials/security_bht',
    'staffAuthIdentities/security_bht',
    'staffSessions/security_session',
    'securityRateLimits/security_rate',
    'securityLoginAudit/security_audit',
    'staffPinLookup/security_lookup',
    'securityAccountAudit/security_account_audit',
    'securityCleanupJobs/security_cleanup',
    'securityOfflineReplayAudit/security_replay',
    'securityWorkflowLocks/security_lock',
    'securityWorkflowAudit/security_workflow_audit'
  ]) {
    await assertFails(getDoc(doc(adminDb, path)))
    await assertFails(getDoc(doc(anonymousDb, path)))
    await assertFails(setDoc(doc(adminDb, path), { browserWrite: true }))
  }
  await assertFails(setDoc(doc(adminDb, 'appSettings/securityFoundation'), {
    schemaVersion: 2,
    serverPinLoginEnabled: true
  }))
})

test('approved admin can list users and save admin owner email link', async () => {
  await seed('users/admin_owner', {
    name: 'Admin Owner',
    role: 'admin',
    site: 'GLOBAL',
    location: 'GLOBAL',
    active: true,
    authorizedLocations: ['OTC', 'RES'],
    issueLocationIds: ['lone_mountain', 'mesquite', 'res'],
    version: 1,
    createdAt: new Date()
  })
  await seed('users/bht_one', {
    name: 'BHT One',
    role: 'bht',
    site: 'OTC',
    location: 'OTC',
    house: 'MESQUITE',
    locationId: 'mesquite',
    shiftId: 'first',
    vanId: 'van_1',
    vanIds: ['van_1'],
    active: true,
    authorizedLocations: ['OTC', 'MESQUITE'],
    issueLocationIds: ['mesquite'],
    version: 1,
    createdAt: new Date()
  })
  await seed('usersByAuthUid/admin_uid', {
    userId: 'admin_owner',
    email: 'mark@scottsdaleprovidence.com',
    emailDomain: 'scottsdaleprovidence.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })

  const adminDb = authed('admin_uid', 'mark@scottsdaleprovidence.com')
  const usersSnap = await assertSucceeds(getDocs(collection(adminDb, 'users')))
  assert.equal(usersSnap.size, 2)

  await assertSucceeds(runTransaction(adminDb, async (transaction) => {
    const userRef = doc(adminDb, 'users/admin_owner')
    const emailLinkRef = doc(adminDb, 'userEmailLinks/mark@scottsdaleprovidence.com')
    const userSnap = await transaction.get(userRef)
    const emailLinkSnap = await transaction.get(emailLinkRef)

    assert.equal(userSnap.exists(), true)
    assert.equal(emailLinkSnap.exists(), false)

    transaction.update(userRef, {
      name: 'Mark Voglio',
      email: 'mark@scottsdaleprovidence.com',
      emailDomain: 'scottsdaleprovidence.com',
      emailType: 'company',
      externalGoogleAllowed: false,
      externalReason: null,
      externalApprovedByUserId: null,
      externalApprovedByName: null,
      externalApprovedAt: null,
      role: 'admin',
      site: 'GLOBAL',
      location: 'GLOBAL',
      house: null,
      locationId: null,
      shiftId: null,
      vanId: null,
      vanIds: [],
      active: true,
      authorizedLocations: [],
      issueLocationIds: ['lone_mountain', 'mesquite', 'res'],
      updatedAt: serverTimestamp(),
      version: 2
    })

    transaction.set(emailLinkRef, {
      userId: 'admin_owner',
      email: 'mark@scottsdaleprovidence.com',
      emailDomain: 'scottsdaleprovidence.com',
      emailType: 'company',
      externalGoogleAllowed: false,
      externalReason: null,
      externalApprovedByUserId: null,
      externalApprovedByName: null,
      externalApprovedAt: null,
      active: true,
      linkedAuthUid: null,
      linkedAt: null,
      version: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true })
  }))
})

test('approved admin can edit a BHT and create the derived assignment', async () => {
  await seed('users/admin_owner', {
    name: 'Admin Owner',
    role: 'admin',
    site: 'GLOBAL',
    location: 'GLOBAL',
    active: true,
    authorizedLocations: ['OTC', 'RES'],
    issueLocationIds: ['lone_mountain', 'mesquite', 'res'],
    version: 1,
    createdAt: new Date()
  })
  await seed('users/bht_lm', {
    name: 'BHT LM',
    email: 'bhtlm@scottsdaleprovidence.com',
    emailDomain: 'scottsdaleprovidence.com',
    emailType: 'company',
    externalGoogleAllowed: false,
    role: 'bht',
    site: 'OTC',
    location: 'OTC',
    house: 'LONE_MOUNTAIN',
    locationId: 'lone_mountain',
    shiftId: 'shift_2',
    vanId: 'van_2',
    vanIds: ['van_2'],
    active: true,
    authorizedLocations: ['OTC', 'LONE_MOUNTAIN'],
    issueLocationIds: ['lone_mountain'],
    version: 1,
    createdAt: new Date()
  })
  await seed('usersByAuthUid/admin_uid', {
    userId: 'admin_owner',
    email: 'mark@scottsdaleprovidence.com',
    emailDomain: 'scottsdaleprovidence.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })

  const adminDb = authed('admin_uid', 'mark@scottsdaleprovidence.com')

  await assertSucceeds(runTransaction(adminDb, async (transaction) => {
    const userRef = doc(adminDb, 'users/bht_lm')
    const emailLinkRef = doc(adminDb, 'userEmailLinks/bhtlm@scottsdaleprovidence.com')
    await transaction.get(userRef)
    await transaction.get(emailLinkRef)

    transaction.update(userRef, {
      name: 'BHT LM Updated',
      email: 'bhtlm@scottsdaleprovidence.com',
      emailDomain: 'scottsdaleprovidence.com',
      emailType: 'company',
      externalGoogleAllowed: false,
      externalReason: null,
      externalApprovedByUserId: null,
      externalApprovedByName: null,
      externalApprovedAt: null,
      role: 'bht',
      site: 'OTC',
      location: 'OTC',
      house: 'LONE_MOUNTAIN',
      locationId: 'lone_mountain',
      shiftId: 'shift_2',
      vanId: 'van_2',
      vanIds: ['van_2'],
      active: true,
      authorizedLocations: ['OTC', 'LONE_MOUNTAIN'],
      issueLocationIds: ['lone_mountain'],
      updatedAt: serverTimestamp(),
      version: 2
    })

    transaction.set(emailLinkRef, {
      userId: 'bht_lm',
      email: 'bhtlm@scottsdaleprovidence.com',
      emailDomain: 'scottsdaleprovidence.com',
      emailType: 'company',
      externalGoogleAllowed: false,
      externalReason: null,
      externalApprovedByUserId: null,
      externalApprovedByName: null,
      externalApprovedAt: null,
      active: true,
      linkedAuthUid: null,
      linkedAt: null,
      version: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true })
  }))

  await assertSucceeds(runTransaction(adminDb, async (transaction) => {
    const assignmentRef = doc(adminDb, 'shiftAssignments/asg_bht_lm')
    const assignmentSnap = await transaction.get(assignmentRef)
    assert.equal(assignmentSnap.exists(), false)

    transaction.set(assignmentRef, {
      bhtUserId: 'bht_lm',
      bhtUserName: 'BHT LM Updated',
      locationId: 'lone_mountain',
      shiftId: 'shift_2',
      vanIds: ['van_2'],
      active: true,
      source: 'user_profile',
      deleted: false,
      deletedAt: null,
      deleteReason: null,
      version: 1,
      effectiveFrom: serverTimestamp(),
      effectiveTo: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    })
  }))
})

test('BHT can read own missing canonical assignment doc', async () => {
  await seed('users/bht_missing', {
    name: 'BHT Missing',
    role: 'bht',
    active: true,
    email: 'bhtmissing@scottsdaleprovidence.com',
    authorizedLocations: ['OTC', 'LONE_MOUNTAIN'],
    issueLocationIds: ['lone_mountain'],
    locationId: 'lone_mountain',
    shiftId: 'shift_1',
    vanId: 'van_2',
    vanIds: ['van_2'],
    version: 1
  })
  await seed('usersByAuthUid/bht_missing_uid', {
    userId: 'bht_missing',
    email: 'bhtmissing@scottsdaleprovidence.com',
    emailDomain: 'scottsdaleprovidence.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })

  const snap = await assertSucceeds(getDoc(doc(authed('bht_missing_uid', 'bhtmissing@scottsdaleprovidence.com'), 'shiftAssignments/asg_bht_missing')))
  assert.equal(snap.exists(), false)
})

test('broad OTC scope does not grant Mesquite issue access without exact issue location', async () => {
  await seed('users/bht_lm', {
    name: 'LM BHT',
    role: 'bht',
    active: true,
    email: 'lm@scottsdaleprovidence.com',
    authorizedLocations: ['OTC'],
    issueLocationIds: ['lone_mountain'],
    locationId: 'lone_mountain',
    version: 1
  })
  await seed('usersByAuthUid/lm_uid', {
    userId: 'bht_lm',
    email: 'lm@scottsdaleprovidence.com',
    emailDomain: 'scottsdaleprovidence.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })
  await seed('eocIssues/mesquite_issue', {
    locationId: 'mesquite',
    status: 'open',
    eocType: 'house',
    label: 'Dryer',
    reportedByUserId: 'other',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  })

  await assertFails(getDoc(doc(authed('lm_uid', 'lm@scottsdaleprovidence.com'), 'eocIssues/mesquite_issue')))
})

test('admin can create Test House BHT profile and derived assignment', async () => {
  await seed('users/admin_test_house', {
    name: 'Admin Test House',
    role: 'admin',
    site: 'GLOBAL',
    location: 'GLOBAL',
    active: true,
    authorizedLocations: ['OTC', 'RES'],
    issueLocationIds: ['lone_mountain', 'mesquite', 'test_house', 'res'],
    version: 1,
    createdAt: new Date()
  })
  await seed('usersByAuthUid/admin_test_house_uid', {
    userId: 'admin_test_house',
    email: 'admintesthouse@scottsdaleprovidence.com',
    emailDomain: 'scottsdaleprovidence.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })

  const adminDb = authed('admin_test_house_uid', 'admintesthouse@scottsdaleprovidence.com')
  await assertSucceeds(setDoc(doc(adminDb, 'users/bht_test_house_rules'), {
    name: 'BHT Test House Rules',
    email: 'bhttesthouse@example.com',
    emailDomain: 'example.com',
    emailType: 'external',
    externalGoogleAllowed: true,
    role: 'bht',
    site: 'OTC',
    location: 'OTC',
    house: 'TEST_HOUSE',
    locationId: 'test_house',
    shiftId: 'shift_1',
    vanId: 'van_test',
    vanIds: ['van_test'],
    active: true,
    authorizedLocations: ['OTC', 'TEST_HOUSE'],
    issueLocationIds: ['test_house'],
    version: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }))

  await assertSucceeds(setDoc(doc(adminDb, 'shiftAssignments/asg_bht_test_house_rules'), {
    bhtUserId: 'bht_test_house_rules',
    bhtUserName: 'BHT Test House Rules',
    locationId: 'test_house',
    shiftId: 'shift_1',
    vanIds: ['van_test'],
    active: true,
    source: 'user_profile',
    version: 1,
    effectiveFrom: serverTimestamp(),
    effectiveTo: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }))
})

test('invalid Test House typo and Test Van on RES are rejected', async () => {
  await seed('users/admin_reject_test_house', {
    name: 'Admin Reject Test House',
    role: 'admin',
    site: 'GLOBAL',
    location: 'GLOBAL',
    active: true,
    authorizedLocations: ['OTC', 'RES'],
    issueLocationIds: ['lone_mountain', 'mesquite', 'test_house', 'res'],
    version: 1,
    createdAt: new Date()
  })
  await seed('usersByAuthUid/admin_reject_test_house_uid', {
    userId: 'admin_reject_test_house',
    email: 'adminrejecttesthouse@scottsdaleprovidence.com',
    emailDomain: 'scottsdaleprovidence.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })

  const adminDb = authed('admin_reject_test_house_uid', 'adminrejecttesthouse@scottsdaleprovidence.com')
  await assertFails(setDoc(doc(adminDb, 'users/bht_bad_test_house'), {
    name: 'BHT Bad Test House',
    role: 'bht',
    site: 'OTC',
    location: 'OTC',
    house: 'TEST_HOUS',
    locationId: 'test_house',
    shiftId: 'shift_1',
    vanId: 'van_test',
    vanIds: ['van_test'],
    active: true,
    authorizedLocations: ['OTC', 'TEST_HOUS'],
    issueLocationIds: ['test_house'],
    version: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }))

  await assertFails(setDoc(doc(adminDb, 'users/bht_res_test_van'), {
    name: 'BHT RES Test Van',
    role: 'bht',
    site: 'RES',
    location: 'RES',
    house: null,
    locationId: 'res',
    shiftId: 'res_shift_1_day',
    vanId: 'van_test',
    vanIds: ['van_test'],
    active: true,
    authorizedLocations: ['RES'],
    issueLocationIds: ['res'],
    version: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }))
})

test('Test House BHT issue scope is isolated from Mesquite and Lone Mountain', async () => {
  await seed('users/bht_test_house_scope', {
    name: 'Test House Scope BHT',
    role: 'bht',
    active: true,
    email: 'testhouse.scope@example.com',
    site: 'OTC',
    location: 'OTC',
    house: 'TEST_HOUSE',
    authorizedLocations: ['OTC', 'TEST_HOUSE'],
    issueLocationIds: ['test_house'],
    locationId: 'test_house',
    shiftId: 'shift_1',
    vanId: 'van_test',
    vanIds: ['van_test'],
    version: 1
  })
  await seed('usersByAuthUid/test_house_scope_uid', {
    userId: 'bht_test_house_scope',
    email: 'testhouse.scope@example.com',
    emailDomain: 'example.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })
  await seed('eocIssues/test_house_issue', {
    locationId: 'test_house',
    status: 'open',
    eocType: 'house',
    label: 'Test House seeded issue',
    reportedByUserId: 'bht_test_house_scope',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  })
  await seed('eocIssues/test_house_mesquite_issue', {
    locationId: 'mesquite',
    status: 'open',
    eocType: 'house',
    label: 'Mesquite seeded issue',
    reportedByUserId: 'other',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  })
  await seed('eocIssues/test_house_lm_issue', {
    locationId: 'lone_mountain',
    status: 'open',
    eocType: 'house',
    label: 'Lone Mountain seeded issue',
    reportedByUserId: 'other',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  })

  const bhtDb = authed('test_house_scope_uid', 'testhouse.scope@example.com')
  await assertSucceeds(getDoc(doc(bhtDb, 'eocIssues/test_house_issue')))
  await assertSucceeds(addDoc(collection(bhtDb, 'eocIssues'), {
    locationId: 'test_house',
    status: 'open',
    eocType: 'house',
    label: 'Created by Test House BHT',
    reportedByUserId: 'bht_test_house_scope',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  }))
  await assertFails(getDoc(doc(bhtDb, 'eocIssues/test_house_mesquite_issue')))
  await assertFails(getDoc(doc(bhtDb, 'eocIssues/test_house_lm_issue')))
})

test('Mesquite BHT cannot read Test House issue', async () => {
  await seed('users/bht_mesquite_no_test_house', {
    name: 'Mesquite No Test House BHT',
    role: 'bht',
    active: true,
    email: 'mesquite.no.test@example.com',
    site: 'OTC',
    location: 'OTC',
    house: 'MESQUITE',
    authorizedLocations: ['OTC', 'MESQUITE'],
    issueLocationIds: ['mesquite'],
    locationId: 'mesquite',
    shiftId: 'shift_1',
    vanId: 'van_1',
    vanIds: ['van_1'],
    version: 1
  })
  await seed('usersByAuthUid/mesquite_no_test_uid', {
    userId: 'bht_mesquite_no_test_house',
    email: 'mesquite.no.test@example.com',
    emailDomain: 'example.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })
  await seed('eocIssues/mesquite_no_test_house_issue', {
    locationId: 'test_house',
    status: 'open',
    eocType: 'house',
    label: 'Test House issue',
    reportedByUserId: 'other',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  })

  await assertFails(getDoc(doc(authed('mesquite_no_test_uid', 'mesquite.no.test@example.com'), 'eocIssues/mesquite_no_test_house_issue')))
})

test('Test House BHT can read own assignment and create EOC and debrief records', async () => {
  await seed('users/bht_test_house_workflows', {
    name: 'Test House Workflow BHT',
    role: 'bht',
    active: true,
    email: 'testhouse.workflows@example.com',
    site: 'OTC',
    location: 'OTC',
    house: 'TEST_HOUSE',
    authorizedLocations: ['OTC', 'TEST_HOUSE'],
    issueLocationIds: ['test_house'],
    locationId: 'test_house',
    shiftId: 'shift_1',
    vanId: 'van_test',
    vanIds: ['van_test'],
    version: 1
  })
  await seed('usersByAuthUid/test_house_workflows_uid', {
    userId: 'bht_test_house_workflows',
    email: 'testhouse.workflows@example.com',
    emailDomain: 'example.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })
  await seed('shiftAssignments/asg_bht_test_house_workflows', {
    bhtUserId: 'bht_test_house_workflows',
    bhtUserName: 'Test House Workflow BHT',
    locationId: 'test_house',
    shiftId: 'shift_1',
    vanIds: ['van_test'],
    active: true,
    source: 'user_profile',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  })

  const bhtDb = authed('test_house_workflows_uid', 'testhouse.workflows@example.com')
  const assignmentSnap = await assertSucceeds(getDoc(doc(bhtDb, 'shiftAssignments/asg_bht_test_house_workflows')))
  assert.equal(assignmentSnap.exists(), true)

  await assertSucceeds(addDoc(collection(bhtDb, 'eocSubmissions'), {
    locationId: 'test_house',
    shiftId: 'shift_1',
    eocType: 'house',
    submittedByUserId: 'bht_test_house_workflows',
    submittedByName: 'Test House Workflow BHT',
    templateScope: 'otc_shared',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  }))

  await assertSucceeds(setDoc(doc(bhtDb, 'shiftDebriefs/test_house_debrief_rules'), {
    locationId: 'test_house',
    locationLabel: 'Test House',
    mainLocation: 'OTC',
    shiftId: 'shift_1',
    shiftLabel: '1st Shift',
    dateKey: '2026-06-12',
    status: 'submitted',
    draftByUserId: 'bht_test_house_workflows',
    draftByName: 'Test House Workflow BHT',
    submittedByUserId: 'bht_test_house_workflows',
    submittedByName: 'Test House Workflow BHT',
    receivingUserIds: [],
    receivingUserNames: {},
    items: [],
    itemCount: 0,
    extraNotes: [],
    confirmation: {
      keysAccountedFor: false,
      sharpsRestrictedVerified: false,
      clientRoundCompleted: false,
      controlledMedicationLogReviewed: false,
      questionsClarificationsAddressed: false,
      incomingStaffInitials: '',
      confirmed: false,
      confirmedAt: null,
      confirmedByUserId: null,
      confirmedByName: null,
      acknowledgments: {}
    },
    confirmed: false,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  }))
})

test('BHT with exact issue location scope can complete EOC task transaction', async () => {
  await seed('users/bht_eoc_issue_scope_only', {
    name: 'EOC Issue Scope BHT',
    role: 'bht',
    active: true,
    email: 'eoc.issue.scope@example.com',
    site: 'OTC',
    location: 'OTC',
    house: 'TEST_HOUSE',
    authorizedLocations: [],
    issueLocationIds: ['test_house'],
    locationId: 'test_house',
    shiftId: 'shift_1',
    vanId: 'van_test',
    vanIds: ['van_test'],
    version: 1
  })
  await seed('usersByAuthUid/eoc_issue_scope_uid', {
    userId: 'bht_eoc_issue_scope_only',
    email: 'eoc.issue.scope@example.com',
    emailDomain: 'example.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })
  await seed('eocTasks/eoc_issue_scope_task', {
    taskType: 'house',
    locationId: 'test_house',
    shiftId: 'shift_1',
    dueDate: new Date(),
    status: 'pending',
    cycleKey: 'eoc_issue_scope_task',
    eligibleUserIds: ['bht_eoc_issue_scope_only'],
    templateScope: 'otc_shared',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  })
  await seed('eocSubmissionDrafts/eoc_issue_scope_task_bht_eoc_issue_scope_only', {
    taskId: 'eoc_issue_scope_task',
    locationId: 'test_house',
    shiftId: 'shift_1',
    eocType: 'house',
    draftByUserId: 'bht_eoc_issue_scope_only',
    templateScope: 'otc_shared',
    answers: {},
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  })

  const bhtDb = authed('eoc_issue_scope_uid', 'eoc.issue.scope@example.com')
  const taskRef = doc(bhtDb, 'eocTasks/eoc_issue_scope_task')
  const draftRef = doc(bhtDb, 'eocSubmissionDrafts/eoc_issue_scope_task_bht_eoc_issue_scope_only')

  await assertSucceeds(runTransaction(bhtDb, async (transaction) => {
    const taskSnap = await transaction.get(taskRef)
    const draftSnap = await transaction.get(draftRef)
    assert.equal(taskSnap.exists(), true)
    assert.equal(draftSnap.exists(), true)

    const submissionRef = doc(collection(bhtDb, 'eocSubmissions'))
    transaction.set(submissionRef, {
      taskId: 'eoc_issue_scope_task',
      locationId: 'test_house',
      shiftId: 'shift_1',
      eocType: 'house',
      submittedByUserId: 'bht_eoc_issue_scope_only',
      submittedByName: 'EOC Issue Scope BHT',
      templateScope: 'otc_shared',
      answers: [],
      issueCount: 0,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    })
    transaction.update(taskRef, {
      status: 'completed',
      submissionId: submissionRef.id,
      completedAt: new Date(),
      completedByUserId: 'bht_eoc_issue_scope_only',
      completedByName: 'EOC Issue Scope BHT',
      version: 2,
      updatedAt: new Date()
    })
    transaction.delete(draftRef)
  }))
})

test('BHT can complete EOC task transaction when no autosave draft exists', async () => {
  await seed('users/bht_eoc_no_draft', {
    name: 'EOC No Draft BHT',
    role: 'bht',
    active: true,
    email: 'eoc.no.draft@example.com',
    site: 'OTC',
    location: 'OTC',
    house: 'TEST_HOUSE',
    authorizedLocations: [],
    issueLocationIds: ['test_house'],
    locationId: 'test_house',
    shiftId: 'shift_1',
    vanId: 'van_test',
    vanIds: ['van_test'],
    version: 1
  })
  await seed('usersByAuthUid/eoc_no_draft_uid', {
    userId: 'bht_eoc_no_draft',
    email: 'eoc.no.draft@example.com',
    emailDomain: 'example.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })
  await seed('eocTasks/eoc_no_draft_task', {
    taskType: 'house',
    locationId: 'test_house',
    shiftId: 'shift_1',
    dueDate: new Date(),
    status: 'pending',
    cycleKey: 'eoc_no_draft_task',
    eligibleUserIds: ['bht_eoc_no_draft'],
    templateScope: 'otc_shared',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  })

  const bhtDb = authed('eoc_no_draft_uid', 'eoc.no.draft@example.com')
  const taskRef = doc(bhtDb, 'eocTasks/eoc_no_draft_task')
  const missingDraftRef = doc(bhtDb, 'eocSubmissionDrafts/eoc_no_draft_task_bht_eoc_no_draft')

  await assertSucceeds(runTransaction(bhtDb, async (transaction) => {
    const taskSnap = await transaction.get(taskRef)
    const draftSnap = await transaction.get(missingDraftRef)
    assert.equal(taskSnap.exists(), true)
    assert.equal(draftSnap.exists(), false)

    const submissionRef = doc(collection(bhtDb, 'eocSubmissions'))
    transaction.set(submissionRef, {
      taskId: 'eoc_no_draft_task',
      locationId: 'test_house',
      shiftId: 'shift_1',
      eocType: 'house',
      submittedByUserId: 'bht_eoc_no_draft',
      submittedByName: 'EOC No Draft BHT',
      templateScope: 'otc_shared',
      answers: [],
      issueCount: 0,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    })
    transaction.update(taskRef, {
      status: 'completed',
      submissionId: submissionRef.id,
      completedAt: new Date(),
      completedByUserId: 'bht_eoc_no_draft',
      completedByName: 'EOC No Draft BHT',
      version: 2,
      updatedAt: new Date()
    })
  }))
})

test('Test House BHT can submit debrief batch and cannot rewrite derived assignment', async () => {
  await seed('users/test_1_rules', {
    name: 'Test One',
    role: 'bht',
    active: true,
    email: 'test1.rules@example.com',
    site: 'OTC',
    location: 'OTC',
    house: 'TEST_HOUSE',
    authorizedLocations: ['OTC', 'TEST_HOUSE'],
    issueLocationIds: ['test_house'],
    locationId: 'test_house',
    shiftId: 'shift_1',
    vanId: 'van_test',
    vanIds: ['van_test'],
    version: 1
  })
  await seed('usersByAuthUid/test_1_rules_uid', {
    userId: 'test_1_rules',
    email: 'test1.rules@example.com',
    emailDomain: 'example.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })
  await seed('users/test_2_rules', {
    name: 'Test Two',
    role: 'bht',
    active: true,
    email: 'test2.rules@example.com',
    site: 'OTC',
    location: 'OTC',
    house: 'TEST_HOUSE',
    authorizedLocations: ['OTC', 'TEST_HOUSE'],
    issueLocationIds: ['test_house'],
    locationId: 'test_house',
    shiftId: 'shift_2',
    vanId: 'van_test',
    vanIds: ['van_test'],
    version: 1
  })
  await seed('usersByAuthUid/test_2_rules_uid', {
    userId: 'test_2_rules',
    email: 'test2.rules@example.com',
    emailDomain: 'example.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })
  await seed('users/test_debrief_supervisor', {
    name: 'Debrief Supervisor',
    role: 'supervisor',
    active: true,
    email: 'debrief.supervisor@example.com',
    site: 'OTC',
    location: 'OTC',
    authorizedLocations: ['OTC', 'TEST_HOUSE'],
    issueLocationIds: ['test_house'],
    version: 1
  })
  await seed('usersByAuthUid/test_debrief_supervisor_uid', {
    userId: 'test_debrief_supervisor',
    email: 'debrief.supervisor@example.com',
    emailDomain: 'example.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })
  await seed('shiftAssignments/asg_test_1_rules', {
    bhtUserId: 'test_1_rules',
    bhtUserName: 'Test One',
    locationId: 'test_house',
    shiftId: 'shift_1',
    vanIds: ['van_test'],
    active: true,
    source: 'user_profile',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  })
  await seed('shiftAssignments/asg_test_2_rules', {
    bhtUserId: 'test_2_rules',
    bhtUserName: 'Test Two',
    locationId: 'test_house',
    shiftId: 'shift_2',
    vanIds: ['van_test'],
    active: true,
    source: 'user_profile',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  })

  const bhtDb = authed('test_1_rules_uid', 'test1.rules@example.com')
  await assertSucceeds(getDoc(doc(bhtDb, 'shiftAssignments/asg_test_1_rules')))
  await assertSucceeds(getDoc(doc(bhtDb, 'shiftDebriefs/test_1_rules_2026-06-16_test_house_shift_1')))
  await assertSucceeds(getDocs(query(
    collection(bhtDb, 'shiftAssignments'),
    where('locationId', '==', 'test_house'),
    where('shiftId', '==', 'shift_2'),
    where('active', '==', true)
  )))
  await assertFails(updateDoc(doc(bhtDb, 'shiftAssignments/asg_test_1_rules'), {
    updatedAt: new Date(),
    version: 2
  }))

  const batch = writeBatch(bhtDb)
  batch.set(doc(bhtDb, 'shiftDebriefs/test_1_rules_2026-06-16_test_house_shift_1'), {
    schemaVersion: 2,
    locationId: 'test_house',
    locationLabel: 'Test House',
    mainLocation: 'OTC',
    shiftId: 'shift_1',
    shiftLabel: '1st Shift',
    dateKey: '2026-06-16',
    shiftStartAt: new Date('2026-06-14T16:00:00.000Z'),
    shiftEndAt: new Date('2026-06-17T01:00:00.000Z'),
    outgoingDebriefDueAt: new Date('2026-06-17T00:00:00.000Z'),
    incomingAcknowledgmentLateAt: new Date('2026-06-17T01:30:00.000Z'),
    status: 'submitted',
    draftByUserId: 'test_1_rules',
    draftByName: 'Test One',
    submittedByUserId: 'test_1_rules',
    submittedByName: 'Test One',
    receivingShiftId: 'shift_2',
    receivingShiftLabel: '2nd Shift',
    receivingUserIds: ['test_2_rules'],
    receivingUserNames: { test_2_rules: 'Test Two' },
    items: [{
      id: 'note_1',
      type: 'general',
      section: 'pending_task',
      note: 'TEST-20260616A handoff note',
      createdByUserId: 'test_1_rules',
      createdByName: 'Test One',
      createdAtIso: '2026-06-16T12:00:00.000Z',
      updatedAtIso: '2026-06-16T12:00:00.000Z'
    }],
    itemCount: 1,
    extraNotes: [],
    confirmation: {
      keysAccountedFor: false,
      sharpsRestrictedVerified: false,
      clientRoundCompleted: false,
      controlledMedicationLogReviewed: false,
      questionsClarificationsAddressed: false,
      incomingStaffInitials: '',
      confirmed: false,
      confirmedAt: null,
      confirmedByUserId: null,
      confirmedByName: null,
      acknowledgments: {}
    },
    confirmed: false,
    submittedAt: new Date(),
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  })
  batch.set(doc(bhtDb, 'shiftDebriefDrafts/test_1_rules_2026-06-16_test_house_shift_1'), {
    schemaVersion: 2,
    locationId: 'test_house',
    locationLabel: 'Test House',
    mainLocation: 'OTC',
    shiftId: 'shift_1',
    shiftLabel: '1st Shift',
    dateKey: '2026-06-16',
    draftByUserId: 'test_1_rules',
    draftByName: 'Test One',
    status: 'submitted',
    submittedDebriefId: 'test_1_rules_2026-06-16_test_house_shift_1',
    submittedAt: new Date(),
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  })
  batch.set(doc(bhtDb, 'alerts/test_debrief_bht_alert'), {
    audience: 'bht',
    type: 'shift_debrief_submitted',
    debriefId: 'test_1_rules_2026-06-16_test_house_shift_1',
    locationId: 'test_house',
    shiftId: 'shift_1',
    receivingShiftId: 'shift_2',
    targetUserId: 'test_2_rules',
    targetUserName: 'Test Two',
    incomingAcknowledgmentLateAt: new Date('2026-06-17T01:30:00.000Z'),
    severity: 'medium',
    message: 'Test One submitted Test House shift debrief.',
    bhtName: 'Test One',
    read: false,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  })
  batch.set(doc(bhtDb, 'alerts/test_debrief_supervisor_alert'), {
    audience: 'supervisor',
    type: 'shift_debrief_submitted',
    debriefId: 'test_1_rules_2026-06-16_test_house_shift_1',
    locationId: 'test_house',
    shiftId: 'shift_1',
    severity: 'medium',
    message: 'Test One submitted Test House shift debrief.',
    bhtName: 'Test One',
    read: false,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  })
  await assertSucceeds(batch.commit())
  await assertFails(updateDoc(doc(bhtDb, 'shiftDebriefs/test_1_rules_2026-06-16_test_house_shift_1'), {
    items: [{ id: 'replacement', type: 'general', section: 'pending_task', note: 'Rewritten after submit.' }],
    itemCount: 1,
    updatedAt: new Date(),
    version: 2
  }))
  await assertSucceeds(updateDoc(doc(bhtDb, 'shiftDebriefs/test_1_rules_2026-06-16_test_house_shift_1'), {
    extraNotes: [{
      id: 'correction_before_signoff',
      note: 'Correction added before incoming signoff.',
      createdByUserId: 'test_1_rules',
      createdByName: 'Test One',
      createdAtIso: '2026-06-16T12:30:00.000Z'
    }],
    updatedAt: new Date(),
    version: 2
  }))
  await assertFails(updateDoc(doc(bhtDb, 'shiftDebriefs/test_1_rules_2026-06-16_test_house_shift_1'), {
    confirmation: {
      confirmed: true,
      confirmedAt: new Date(),
      confirmedByUserId: 'test_1_rules',
      confirmedByName: 'Test One',
      acknowledgments: {
        test_1_rules: {
          confirmed: true,
          confirmedByUserId: 'test_1_rules'
        }
      }
    },
    confirmed: true,
    updatedAt: new Date(),
    version: 3
  }))

  await assertFails(updateDoc(doc(bhtDb, 'shiftDebriefs/test_1_rules_2026-06-16_test_house_shift_1'), {
    reassignedAt: new Date(),
    reassignedByUserId: 'test_1_rules',
    reassignedByName: 'Test One',
    reassignmentReason: 'Outgoing staff cannot reassign the handoff.',
    updatedAt: new Date(),
    version: 3
  }))

  const supervisorDb = authed('test_debrief_supervisor_uid', 'debrief.supervisor@example.com')
  await assertSucceeds(updateDoc(doc(supervisorDb, 'shiftDebriefs/test_1_rules_2026-06-16_test_house_shift_1'), {
    receivingUserIds: ['test_2_rules', 'test_3_rules'],
    receivingUserNames: { test_2_rules: 'Test Two', test_3_rules: 'Test Three' },
    confirmation: {
      keysAccountedFor: false,
      sharpsRestrictedVerified: false,
      clientRoundCompleted: false,
      controlledMedicationLogReviewed: false,
      questionsClarificationsAddressed: false,
      incomingStaffInitials: '',
      confirmed: false,
      confirmedAt: null,
      confirmedByUserId: null,
      confirmedByName: null,
      acknowledgments: {}
    },
    confirmed: false,
    reassignedAt: new Date(),
    reassignedByUserId: 'test_debrief_supervisor',
    reassignedByName: 'Debrief Supervisor',
    reassignmentReason: 'Confirmed the correct incoming assignment.',
    updatedAt: new Date(),
    version: 3
  }))

  const receivingBhtDb = authed('test_2_rules_uid', 'test2.rules@example.com')
  const submittedSnap = await assertSucceeds(getDoc(doc(receivingBhtDb, 'shiftDebriefs/test_1_rules_2026-06-16_test_house_shift_1')))
  assert.equal(submittedSnap.exists(), true)

  await assertSucceeds(updateDoc(doc(receivingBhtDb, 'shiftDebriefs/test_1_rules_2026-06-16_test_house_shift_1'), {
    confirmation: {
      keysAccountedFor: true,
      sharpsRestrictedVerified: true,
      clientRoundCompleted: true,
      controlledMedicationLogReviewed: true,
      questionsClarificationsAddressed: true,
      incomingStaffInitials: 'T2',
      confirmed: false,
      confirmedAt: null,
      confirmedByUserId: 'test_2_rules',
      confirmedByName: 'Test Two',
      acknowledgments: {
        test_2_rules: {
          keysAccountedFor: true,
          sharpsRestrictedVerified: true,
          clientRoundCompleted: true,
          controlledMedicationLogReviewed: true,
          questionsClarificationsAddressed: true,
          incomingStaffInitials: 'T2',
          confirmed: true,
          confirmedAt: new Date(),
          confirmedByUserId: 'test_2_rules',
          confirmedByName: 'Test Two'
        }
      }
    },
    confirmed: false,
    updatedAt: new Date(),
    version: 4
  }))

  await assertFails(updateDoc(doc(bhtDb, 'shiftDebriefs/test_1_rules_2026-06-16_test_house_shift_1'), {
    extraNotes: [
      {
        id: 'correction_before_signoff',
        note: 'Correction added before incoming signoff.',
        createdByUserId: 'test_1_rules',
        createdByName: 'Test One',
        createdAtIso: '2026-06-16T12:30:00.000Z'
      },
      {
        id: 'correction_after_signoff',
        note: 'This correction must be rejected.',
        createdByUserId: 'test_1_rules',
        createdByName: 'Test One',
        createdAtIso: '2026-06-16T13:00:00.000Z'
      }
    ],
    updatedAt: new Date(),
    version: 5
  }))

  await assertSucceeds(updateDoc(doc(receivingBhtDb, 'alerts/test_debrief_bht_alert'), {
    read: true,
    readAt: new Date(),
    readByUserId: 'test_2_rules',
    version: 2,
    updatedAt: new Date()
  }))

  await assertSucceeds(setDoc(doc(receivingBhtDb, 'userHomeState/test_2_rules'), {
    reviewedDebriefIds: ['test_1_rules_2026-06-16_test_house_shift_1'],
    lastReviewedDebriefId: 'test_1_rules_2026-06-16_test_house_shift_1',
    lastReviewedAt: new Date(),
    updatedAt: new Date(),
    version: 1
  }))
})

test('house-scoped BHT can create transport completed alert for exact house location', async () => {
  await seed('users/test_transport_alert_bht', {
    name: 'Transport Alert BHT',
    role: 'bht',
    active: true,
    email: 'transport.alert@example.com',
    site: 'OTC',
    location: 'OTC',
    house: 'TEST_HOUSE',
    authorizedLocations: ['TEST_HOUSE'],
    issueLocationIds: ['test_house'],
    locationId: 'test_house',
    shiftId: 'shift_1',
    vanId: 'van_test',
    vanIds: ['van_test'],
    version: 1
  })
  await seed('usersByAuthUid/test_transport_alert_uid', {
    userId: 'test_transport_alert_bht',
    email: 'transport.alert@example.com',
    emailDomain: 'example.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })

  const bhtDb = authed('test_transport_alert_uid', 'transport.alert@example.com')
  await assertSucceeds(addDoc(collection(bhtDb, 'alerts'), {
    audience: 'supervisor',
    type: 'transport_completed',
    transportId: 'transport_test_alert',
    site: 'OTC',
    locationId: 'test_house',
    severity: 'low',
    message: 'Transport Alert BHT completed transport - 1 client, OTC.',
    bhtName: 'Transport Alert BHT',
    read: false,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  }))
})

test('house-scoped BHT can create and close an OTC transport', async () => {
  await seed('users/bht_house_transport', {
    name: 'House Transport BHT',
    role: 'bht',
    active: true,
    email: 'housetransport@scottsdaleprovidence.com',
    site: 'OTC',
    location: 'OTC',
    house: 'LONE_MOUNTAIN',
    authorizedLocations: ['LONE_MOUNTAIN'],
    issueLocationIds: ['lone_mountain'],
    locationId: 'lone_mountain',
    shiftId: 'shift_1',
    vanId: 'van_2',
    vanIds: ['van_2'],
    version: 1
  })
  await seed('usersByAuthUid/house_transport_uid', {
    userId: 'bht_house_transport',
    email: 'housetransport@scottsdaleprovidence.com',
    emailDomain: 'scottsdaleprovidence.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })

  const bhtDb = authed('house_transport_uid', 'housetransport@scottsdaleprovidence.com')
  const transportRef = await assertSucceeds(addDoc(collection(bhtDb, 'transports'), {
    site: 'OTC',
    createdByUserId: 'bht_house_transport',
    createdByName: 'House Transport BHT',
    status: 'open',
    version: 1,
    departedAt: new Date(),
    clients: [],
    reasons: [],
    stops: [],
    destinations: [],
    notes: '',
    createdAt: new Date(),
    updatedAt: new Date()
  }))

  const correctedDepartedAt = new Date(Date.now() - 10 * 60 * 1000)
  await assertSucceeds(updateDoc(transportRef, {
    departedAt: correctedDepartedAt,
    timeCorrections: {
      departedAt: {
        originalValue: new Date().toISOString(),
        correctedValue: correctedDepartedAt.toISOString(),
        correctedAt: new Date().toISOString(),
        correctedByUserId: 'bht_house_transport',
        correctedByName: 'House Transport BHT'
      }
    },
    updatedAt: new Date(),
    version: 2
  }))

  const returnedAt = new Date(Date.now() - 2 * 60 * 1000)
  await assertSucceeds(updateDoc(transportRef, {
    status: 'closed',
    returnedAt,
    closedAt: new Date(),
    dcPaperworkStatus: 'na',
    timeCorrections: {
      departedAt: {
        originalValue: new Date().toISOString(),
        correctedValue: correctedDepartedAt.toISOString(),
        correctedAt: new Date().toISOString(),
        correctedByUserId: 'bht_house_transport',
        correctedByName: 'House Transport BHT'
      },
      returnedAt: {
        originalValue: new Date().toISOString(),
        correctedValue: returnedAt.toISOString(),
        correctedAt: new Date().toISOString(),
        correctedByUserId: 'bht_house_transport',
        correctedByName: 'House Transport BHT'
      }
    },
    updatedAt: new Date(),
    version: 3
  }))
})

test('BHT cannot create a transport for another user', async () => {
  await seed('users/bht_transport_owner', {
    name: 'Transport Owner',
    role: 'bht',
    active: true,
    email: 'transportowner@scottsdaleprovidence.com',
    site: 'OTC',
    location: 'OTC',
    house: 'LONE_MOUNTAIN',
    authorizedLocations: ['LONE_MOUNTAIN'],
    issueLocationIds: ['lone_mountain'],
    locationId: 'lone_mountain',
    shiftId: 'shift_1',
    vanId: 'van_2',
    vanIds: ['van_2'],
    version: 1
  })
  await seed('usersByAuthUid/transport_owner_uid', {
    userId: 'bht_transport_owner',
    email: 'transportowner@scottsdaleprovidence.com',
    emailDomain: 'scottsdaleprovidence.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })

  const bhtDb = authed('transport_owner_uid', 'transportowner@scottsdaleprovidence.com')
  await assertFails(addDoc(collection(bhtDb, 'transports'), {
    site: 'OTC',
    createdByUserId: 'different_bht_user',
    createdByName: 'Different BHT',
    status: 'open',
    version: 1,
    departedAt: new Date(),
    clients: [],
    reasons: [],
    stops: [],
    destinations: [],
    notes: '',
    createdAt: new Date(),
    updatedAt: new Date()
  }))
})

test('BHT cannot update another user transport', async () => {
  await seed('users/bht_transport_editor', {
    name: 'Transport Editor',
    role: 'bht',
    active: true,
    email: 'transporteditor@scottsdaleprovidence.com',
    site: 'OTC',
    location: 'OTC',
    house: 'LONE_MOUNTAIN',
    authorizedLocations: ['LONE_MOUNTAIN'],
    issueLocationIds: ['lone_mountain'],
    locationId: 'lone_mountain',
    shiftId: 'shift_1',
    vanId: 'van_2',
    vanIds: ['van_2'],
    version: 1
  })
  await seed('usersByAuthUid/transport_editor_uid', {
    userId: 'bht_transport_editor',
    email: 'transporteditor@scottsdaleprovidence.com',
    emailDomain: 'scottsdaleprovidence.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })
  await seed('transports/other_user_transport', {
    site: 'OTC',
    createdByUserId: 'different_bht_user',
    createdByName: 'Different BHT',
    status: 'open',
    version: 1,
    departedAt: new Date(),
    clients: [],
    reasons: [],
    stops: [],
    destinations: [],
    notes: '',
    createdAt: new Date(),
    updatedAt: new Date()
  })

  const bhtDb = authed('transport_editor_uid', 'transporteditor@scottsdaleprovidence.com')
  await assertFails(updateDoc(doc(bhtDb, 'transports/other_user_transport'), {
    notes: 'Edited by wrong BHT',
    updatedAt: new Date(),
    version: 2
  }))
})

test('BHT can delete their own active transport', async () => {
  await seed('users/bht_transport_cancel', {
    name: 'Transport Cancel BHT',
    role: 'bht',
    active: true,
    email: 'transportcancel@scottsdaleprovidence.com',
    site: 'OTC',
    location: 'OTC',
    house: 'LONE_MOUNTAIN',
    authorizedLocations: ['LONE_MOUNTAIN'],
    issueLocationIds: ['lone_mountain'],
    locationId: 'lone_mountain',
    shiftId: 'shift_1',
    vanId: 'van_2',
    vanIds: ['van_2'],
    version: 1
  })
  await seed('usersByAuthUid/transport_cancel_uid', {
    userId: 'bht_transport_cancel',
    email: 'transportcancel@scottsdaleprovidence.com',
    emailDomain: 'scottsdaleprovidence.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })
  await seed('transports/own_active_transport', {
    site: 'OTC',
    createdByUserId: 'bht_transport_cancel',
    createdByName: 'Transport Cancel BHT',
    status: 'open',
    version: 1,
    departedAt: new Date(),
    clients: [],
    reasons: [],
    stops: [],
    destinations: [],
    notes: '',
    createdAt: new Date(),
    updatedAt: new Date()
  })

  const bhtDb = authed('transport_cancel_uid', 'transportcancel@scottsdaleprovidence.com')
  await assertSucceeds(deleteDoc(doc(bhtDb, 'transports/own_active_transport')))
})

test('BHT cannot delete another user active transport', async () => {
  await seed('users/bht_transport_cancel_other', {
    name: 'Transport Cancel Other BHT',
    role: 'bht',
    active: true,
    email: 'transportcancelother@scottsdaleprovidence.com',
    site: 'OTC',
    location: 'OTC',
    house: 'LONE_MOUNTAIN',
    authorizedLocations: ['LONE_MOUNTAIN'],
    issueLocationIds: ['lone_mountain'],
    locationId: 'lone_mountain',
    shiftId: 'shift_1',
    vanId: 'van_2',
    vanIds: ['van_2'],
    version: 1
  })
  await seed('usersByAuthUid/transport_cancel_other_uid', {
    userId: 'bht_transport_cancel_other',
    email: 'transportcancelother@scottsdaleprovidence.com',
    emailDomain: 'scottsdaleprovidence.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })
  await seed('transports/other_active_transport', {
    site: 'OTC',
    createdByUserId: 'different_bht_user',
    createdByName: 'Different BHT',
    status: 'open',
    version: 1,
    departedAt: new Date(),
    clients: [],
    reasons: [],
    stops: [],
    destinations: [],
    notes: '',
    createdAt: new Date(),
    updatedAt: new Date()
  })

  const bhtDb = authed('transport_cancel_other_uid', 'transportcancelother@scottsdaleprovidence.com')
  await assertFails(deleteDoc(doc(bhtDb, 'transports/other_active_transport')))
})

test('BHT cannot delete their own finished transport', async () => {
  await seed('users/bht_transport_cancel_finished', {
    name: 'Transport Cancel Finished BHT',
    role: 'bht',
    active: true,
    email: 'transportcancelfinished@scottsdaleprovidence.com',
    site: 'OTC',
    location: 'OTC',
    house: 'LONE_MOUNTAIN',
    authorizedLocations: ['LONE_MOUNTAIN'],
    issueLocationIds: ['lone_mountain'],
    locationId: 'lone_mountain',
    shiftId: 'shift_1',
    vanId: 'van_2',
    vanIds: ['van_2'],
    version: 1
  })
  await seed('usersByAuthUid/transport_cancel_finished_uid', {
    userId: 'bht_transport_cancel_finished',
    email: 'transportcancelfinished@scottsdaleprovidence.com',
    emailDomain: 'scottsdaleprovidence.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })
  await seed('transports/own_finished_transport', {
    site: 'OTC',
    createdByUserId: 'bht_transport_cancel_finished',
    createdByName: 'Transport Cancel Finished BHT',
    status: 'closed',
    version: 1,
    departedAt: new Date(),
    returnedAt: new Date(),
    closedAt: new Date(),
    clients: ['Client A'],
    reasons: ['Medical'],
    stops: [],
    destinations: [{ address: '123 Main St' }],
    dcPaperworkStatus: 'na',
    notes: '',
    createdAt: new Date(),
    updatedAt: new Date()
  })

  const bhtDb = authed('transport_cancel_finished_uid', 'transportcancelfinished@scottsdaleprovidence.com')
  await assertFails(deleteDoc(doc(bhtDb, 'transports/own_finished_transport')))
})

test('targeted BHT alert is readable only by the target user', async () => {
  await seed('users/bht_target', {
    name: 'Target BHT',
    role: 'bht',
    active: true,
    email: 'target@scottsdaleprovidence.com',
    authorizedLocations: ['OTC'],
    issueLocationIds: ['lone_mountain'],
    locationId: 'lone_mountain',
    version: 1
  })
  await seed('usersByAuthUid/target_uid', {
    userId: 'bht_target',
    email: 'target@scottsdaleprovidence.com',
    emailDomain: 'scottsdaleprovidence.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })
  await seed('users/bht_other', {
    name: 'Other BHT',
    role: 'bht',
    active: true,
    email: 'other@scottsdaleprovidence.com',
    authorizedLocations: ['OTC'],
    issueLocationIds: ['lone_mountain'],
    locationId: 'lone_mountain',
    version: 1
  })
  await seed('usersByAuthUid/other_uid', {
    userId: 'bht_other',
    email: 'other@scottsdaleprovidence.com',
    emailDomain: 'scottsdaleprovidence.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })
  await seed('alerts/target_alert', {
    audience: 'bht',
    targetUserId: 'bht_target',
    type: 'eoc_issue_update',
    issueId: 'issue_1',
    locationId: 'lone_mountain',
    message: 'Updated',
    read: false,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  })

  await assertSucceeds(getDoc(doc(authed('target_uid', 'target@scottsdaleprovidence.com'), 'alerts/target_alert')))
  await assertFails(getDoc(doc(authed('other_uid', 'other@scottsdaleprovidence.com'), 'alerts/target_alert')))
})

test('PIN compatibility mode works after Firebase UID changes without orphaning drafts', async () => {
  await seed('appSettings/authPolicy', {
    authScopeEnforced: false
  })
  await seed('users/pin_test_bht', {
    name: 'PIN Test BHT',
    role: 'bht',
    active: true,
    pinHash: 'a'.repeat(64),
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
    version: 1
  })

  const firstBrowserDb = testEnv.unauthenticatedContext().firestore()
  const replacementBrowserDb = authed('pin_browser_uid_2', 'replacement-browser@example.com')

  const loginMatches = await assertSucceeds(getDocs(query(
    collection(firstBrowserDb, 'users'),
    where('pinHash', '==', 'a'.repeat(64)),
    where('active', '==', true)
  )))
  assert.equal(loginMatches.size, 1)

  const eocDraftPath = 'eocSubmissionDrafts/pin_task_pin_test_bht'
  await assertSucceeds(setDoc(doc(firstBrowserDb, eocDraftPath), {
    taskId: 'pin_task',
    locationId: 'test_house',
    shiftId: 'shift_1',
    eocType: 'house',
    draftByUserId: 'pin_test_bht',
    draftByName: 'PIN Test BHT',
    templateScope: 'otc_shared',
    answers: {},
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  }))
  await assertSucceeds(getDoc(doc(replacementBrowserDb, eocDraftPath)))
  await assertSucceeds(updateDoc(doc(replacementBrowserDb, eocDraftPath), {
    answers: { check_1: 'pass' },
    updatedAt: new Date(),
    version: 2
  }))
  await assertSucceeds(deleteDoc(doc(replacementBrowserDb, eocDraftPath)))

  const debriefId = 'pin_test_bht_2026-08-06_test_house_shift_1'
  await assertSucceeds(setDoc(doc(firstBrowserDb, `shiftDebriefDrafts/${debriefId}`), {
    locationId: 'test_house',
    locationLabel: 'Test House',
    mainLocation: 'OTC',
    shiftId: 'shift_1',
    shiftLabel: '1st Shift',
    dateKey: '2026-08-06',
    draftByUserId: 'pin_test_bht',
    draftByName: 'PIN Test BHT',
    status: 'draft',
    items: [],
    itemCount: 0,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  }))
  await assertSucceeds(updateDoc(doc(replacementBrowserDb, `shiftDebriefDrafts/${debriefId}`), {
    items: [{ id: 'note_1', type: 'general', note: 'UID-independent draft' }],
    itemCount: 1,
    updatedAt: new Date(),
    version: 2
  }))
  const submissionBatch = writeBatch(replacementBrowserDb)
  submissionBatch.set(doc(replacementBrowserDb, `shiftDebriefs/${debriefId}`), {
    locationId: 'test_house',
    locationLabel: 'Test House',
    mainLocation: 'OTC',
    shiftId: 'shift_1',
    shiftLabel: '1st Shift',
    dateKey: '2026-08-06',
    status: 'submitted',
    draftByUserId: 'pin_test_bht',
    draftByName: 'PIN Test BHT',
    submittedByUserId: 'pin_test_bht',
    submittedByName: 'PIN Test BHT',
    receivingUserIds: ['pin_receiving_bht'],
    items: [],
    itemCount: 0,
    extraNotes: [],
    confirmation: { acknowledgments: {} },
    confirmed: false,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  })
  submissionBatch.set(doc(replacementBrowserDb, 'alerts/pin_mode_bht_alert'), {
    audience: 'bht',
    type: 'shift_debrief_submitted',
    debriefId,
    locationId: 'test_house',
    shiftId: 'shift_1',
    targetUserId: 'pin_receiving_bht',
    message: 'PIN Test BHT submitted a Test House debrief.',
    read: false,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  })
  submissionBatch.set(doc(replacementBrowserDb, 'alerts/pin_mode_supervisor_alert'), {
    audience: 'supervisor',
    type: 'shift_debrief_submitted',
    debriefId,
    locationId: 'test_house',
    shiftId: 'shift_1',
    message: 'PIN Test BHT submitted a Test House debrief.',
    read: false,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  })
  await assertSucceeds(submissionBatch.commit())

  const receivingBrowserDb = authed('pin_receiving_browser_uid', 'receiver@example.com')
  await assertSucceeds(getDoc(doc(receivingBrowserDb, `shiftDebriefs/${debriefId}`)))
  await assertSucceeds(updateDoc(doc(receivingBrowserDb, `shiftDebriefs/${debriefId}`), {
    confirmation: {
      confirmed: true,
      confirmedByUserId: 'pin_receiving_bht',
      confirmedByName: 'PIN Receiving BHT',
      confirmedAt: new Date(),
      acknowledgments: {
        pin_receiving_bht: {
          confirmed: true,
          confirmedByUserId: 'pin_receiving_bht'
        }
      }
    },
    confirmed: true,
    updatedAt: new Date(),
    version: 2
  }))
  await assertSucceeds(updateDoc(doc(receivingBrowserDb, 'alerts/pin_mode_bht_alert'), {
    read: true,
    readAt: new Date(),
    readByUserId: 'pin_receiving_bht',
    updatedAt: new Date(),
    version: 2
  }))
})

test('BHT can save photo-question metadata only for an authorized EOC submission location', async () => {
  await seed('users/photo_response_bht', {
    name: 'Photo Response BHT',
    role: 'bht',
    active: true,
    email: 'photo.response@example.com',
    authorizedLocations: [],
    issueLocationIds: ['test_house'],
    version: 1
  })
  await seed('usersByAuthUid/photo_response_bht_uid', {
    userId: 'photo_response_bht',
    email: 'photo.response@example.com',
    version: 1
  })
  await seed('eocSubmissions/photo_response_submission', {
    locationId: 'test_house',
    shiftId: 'shift_1',
    eocType: 'house',
    submittedByUserId: 'photo_response_bht',
    submittedByName: 'Photo Response BHT',
    templateScope: 'otc_shared',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  })

  const bhtDb = authed('photo_response_bht_uid', 'photo.response@example.com')
  const attachmentRef = doc(bhtDb, 'eocSubmissions/photo_response_submission/attachments/photo_1')
  await assertSucceeds(setDoc(attachmentRef, {
    schemaVersion: 1,
    attachmentId: 'photo_1',
    submissionId: 'photo_response_submission',
    locationId: 'test_house',
    itemId: 'question_photo',
    kind: 'response',
    state: 'uploading',
    width: 800,
    height: 600,
    sizeBytes: 1200,
    mimeType: 'image/jpeg',
    uploaderProfileId: 'photo_response_bht',
    uploaderName: 'Photo Response BHT',
    storagePath: 'eocSubmissionAttachments/test_house/photo_response_submission/photo_1.jpg',
    visibility: 'location',
    retentionDays: 90,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  }))
  await assertSucceeds(updateDoc(attachmentRef, {
    state: 'uploaded',
    uploadedAt: new Date(),
    version: 2,
    updatedAt: new Date()
  }))
  await assertFails(setDoc(doc(bhtDb, 'eocSubmissions/photo_response_submission/attachments/photo_wrong'), {
    attachmentId: 'photo_wrong',
    submissionId: 'photo_response_submission',
    locationId: 'mesquite',
    itemId: 'question_photo',
    kind: 'response',
    state: 'uploading',
    sizeBytes: 1200,
    mimeType: 'image/jpeg',
    version: 1
  }))
})

test('published EOC templates can be read but browser writes are blocked', async () => {
  await seed('users/template_version_supervisor', {
    name: 'Template Version Supervisor',
    role: 'supervisor',
    active: true,
    email: 'template.version.supervisor@example.com',
    authorizedLocations: ['OTC'],
    issueLocationIds: ['test_house'],
    version: 1
  })
  await seed('usersByAuthUid/template_version_supervisor_uid', {
    userId: 'template_version_supervisor',
    email: 'template.version.supervisor@example.com',
    emailDomain: 'example.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })
  await seed('eocTemplateLibrary/template_rules', {
    name: 'Rules Test House EOC',
    eocType: 'house',
    status: 'active',
    items: [],
    ownerUserId: 'template_version_supervisor',
    ownerName: 'Template Version Supervisor',
    ownerAuthUid: 'template_version_supervisor_uid',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  })

  const supervisorDb = authed('template_version_supervisor_uid', 'template.version.supervisor@example.com')
  const versionRef = doc(supervisorDb, 'eocTemplateVersions/template_rules__v2')
  const publishBatch = writeBatch(supervisorDb)
  publishBatch.update(doc(supervisorDb, 'eocTemplateLibrary/template_rules'), {
    items: [{
      id: 'front_lock',
      trackingId: 'front_lock',
      category: 'Safety',
      label: 'Does the front lock work?',
      helpText: '',
      requiresPhotoOnIssue: false,
      order: 1,
      active: true
    }],
    itemSchemaVersion: 2,
    publishedVersion: 2,
    publishedVersionId: 'template_rules__v2',
    version: 2,
    updatedAt: serverTimestamp()
  })
  publishBatch.set(versionRef, {
    templateId: 'template_rules',
    templateName: 'Rules Test House EOC',
    eocType: 'house',
    status: 'active',
    items: [{
      id: 'front_lock',
      trackingId: 'front_lock',
      category: 'Safety',
      label: 'Does the front lock work?',
      helpText: '',
      requiresPhotoOnIssue: false,
      order: 1,
      active: true
    }],
    itemSchemaVersion: 2,
    versionNumber: 2,
    ownerUserId: 'template_version_supervisor',
    ownerName: 'Template Version Supervisor',
    ownerAuthUid: 'template_version_supervisor_uid',
    publishedByUserId: 'template_version_supervisor',
    publishedByName: 'Template Version Supervisor',
    publishedByAuthUid: 'template_version_supervisor_uid',
    publishedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    version: 1
  })
  await assertFails(publishBatch.commit())

  await assertFails(updateDoc(versionRef, {
    templateName: 'Silently changed version'
  }))
  await assertFails(deleteDoc(versionRef))
})

test('EOC template drafts are private to their supervisor owner', async () => {
  await seed('appSettings/authPolicy', { authScopeEnforced: true })
  await seed('users/draft_supervisor', {
    name: 'Draft Supervisor', role: 'supervisor', active: true,
    email: 'draft.supervisor@example.com', authorizedLocations: ['OTC'], version: 1
  })
  await seed('usersByAuthUid/draft_supervisor_uid', {
    userId: 'draft_supervisor', email: 'draft.supervisor@example.com', version: 1
  })
  await seed('users/other_draft_supervisor', {
    name: 'Other Draft Supervisor', role: 'supervisor', active: true,
    email: 'other.draft.supervisor@example.com', authorizedLocations: ['OTC'], version: 1
  })
  await seed('usersByAuthUid/other_draft_supervisor_uid', {
    userId: 'other_draft_supervisor', email: 'other.draft.supervisor@example.com', version: 1
  })
  const ownerDb = authed('draft_supervisor_uid', 'draft.supervisor@example.com')
  const otherDb = authed('other_draft_supervisor_uid', 'other.draft.supervisor@example.com')
  const draftRef = doc(ownerDb, 'eocTemplateDrafts/draft_private')
  await assertSucceeds(setDoc(draftRef, {
    ownerAuthUid: 'draft_supervisor_uid', ownerUserId: 'draft_supervisor',
    templateName: 'Private Draft', eocType: 'house', template: { name: 'Private Draft', sections: [] },
    version: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }))
  await assertSucceeds(getDoc(draftRef))
  await assertFails(getDoc(doc(otherDb, 'eocTemplateDrafts/draft_private')))
  await assertSucceeds(updateDoc(draftRef, { templateName: 'Updated Draft', version: 2, updatedAt: serverTimestamp() }))
  await assertFails(updateDoc(doc(otherDb, 'eocTemplateDrafts/draft_private'), { templateName: 'Stolen Draft', version: 3 }))
})

test('authorized staff can save the automatic missed EOC lifecycle fields', async () => {
  await seed('users/missed_eoc_admin', {
    name: 'Missed EOC Admin',
    role: 'admin',
    active: true,
    email: 'missed.eoc.admin@example.com',
    authorizedLocations: ['OTC'],
    issueLocationIds: ['test_house'],
    version: 1
  })
  await seed('usersByAuthUid/missed_eoc_admin_uid', {
    userId: 'missed_eoc_admin',
    email: 'missed.eoc.admin@example.com',
    emailDomain: 'example.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })

  const adminDb = authed('missed_eoc_admin_uid', 'missed.eoc.admin@example.com')
  const baseTask = {
    taskType: 'house',
    locationId: 'test_house',
    shiftId: 'shift_1',
    dueDate: '2026-08-10',
    cycleKey: 'missed_eoc_rules',
    eligibleUserIds: [],
    templateScope: 'otc_shared',
    version: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }

  await assertSucceeds(setDoc(doc(adminDb, 'eocTasks/missed_eoc_rules_valid'), {
    ...baseTask,
    cycleKey: 'missed_eoc_rules_valid',
    status: 'missed',
    missedAt: serverTimestamp(),
    missedReason: 'The next scheduled EOC cycle began without a completed submission.'
  }))
})

test('rule-safe batches allow a large authorized EOC task and alert sync', async () => {
  await seed('users/eoc_sync_batch_admin', {
    name: 'EOC Sync Batch Admin',
    role: 'admin',
    active: true,
    email: 'eoc.sync.batch@example.com',
    authorizedLocations: ['OTC'],
    issueLocationIds: ['test_house'],
    version: 1
  })
  await seed('usersByAuthUid/eoc_sync_batch_admin_uid', {
    userId: 'eoc_sync_batch_admin',
    email: 'eoc.sync.batch@example.com',
    emailDomain: 'example.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })

  const adminDb = authed('eoc_sync_batch_admin_uid', 'eoc.sync.batch@example.com')
  const runId = `eoc_sync_batch_${Date.now().toString(36)}`
  const taskIds = []
  const alertIds = []
  const operations = []
  for (let index = 0; index < 8; index += 1) {
    const suffix = String(index + 1).padStart(2, '0')
    const taskId = `${runId}_task_${suffix}`
    const alertId = `${runId}_alert_${suffix}`
    taskIds.push(taskId)
    alertIds.push(alertId)
    operations.push(batch => batch.set(doc(adminDb, 'eocTasks', taskId), {
      taskType: 'house',
      locationId: 'test_house',
      shiftId: 'shift_1',
      dueDate: '2026-08-17',
      status: 'pending',
      cycleKey: taskId,
      eligibleUserIds: [],
      templateScope: 'otc_shared',
      version: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }))
    operations.push(batch => batch.set(doc(adminDb, 'alerts', alertId), {
      type: 'shift_debrief_missing',
      message: `Synthetic EOC sync alert ${suffix}`,
      read: false,
      audience: 'supervisor',
      locationId: 'test_house',
      version: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }))
  }

  const commitCount = await commitFirestoreWritesInChunks(operations, () => writeBatch(adminDb))

  assert.equal(commitCount, 16)
  await assertSucceeds(getDoc(doc(adminDb, 'eocTasks', taskIds.at(-1))))
  await assertSucceeds(getDoc(doc(adminDb, 'alerts', alertIds.at(-1))))
})

test('BHT can report a returned problem but only a supervisor can reopen the issue', async () => {
  await seed('appSettings/authPolicy', {
    authScopeEnforced: true
  })
  await seed('users/returned_problem_bht', {
    name: 'Returned Problem BHT',
    role: 'bht',
    active: true,
    email: 'returned.problem.bht@example.com',
    authorizedLocations: ['OTC', 'TEST_HOUSE'],
    issueLocationIds: ['test_house'],
    locationId: 'test_house',
    version: 1
  })
  await seed('usersByAuthUid/returned_problem_bht_uid', {
    userId: 'returned_problem_bht',
    email: 'returned.problem.bht@example.com',
    emailDomain: 'example.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })
  await seed('users/returned_problem_supervisor', {
    name: 'Returned Problem Supervisor',
    role: 'supervisor',
    active: true,
    email: 'returned.problem.supervisor@example.com',
    authorizedLocations: ['OTC', 'TEST_HOUSE'],
    issueLocationIds: ['test_house'],
    version: 1
  })
  await seed('usersByAuthUid/returned_problem_supervisor_uid', {
    userId: 'returned_problem_supervisor',
    email: 'returned.problem.supervisor@example.com',
    emailDomain: 'example.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })
  await seed('eocIssues/returned_problem_issue', {
    locationId: 'test_house',
    status: 'resolved',
    eocType: 'house',
    label: 'Front door lock',
    description: 'Lock was sticking.',
    reportedByUserId: 'returned_problem_bht',
    resolvedNotes: 'Lock adjusted and tested.',
    closedAt: new Date(),
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  })

  const bhtDb = authed('returned_problem_bht_uid', 'returned.problem.bht@example.com')
  await assertSucceeds(setDoc(doc(bhtDb, 'eocIssues/returned_problem_issue/activity/problem_returned_1'), {
    issueId: 'returned_problem_issue',
    eventType: 'problem_returned',
    label: 'Problem returned',
    status: 'resolved',
    note: 'The lock is sticking again.',
    actorUserId: 'returned_problem_bht',
    actorName: 'Returned Problem BHT',
    locationId: 'test_house',
    issueVersion: 1,
    immutable: true,
    version: 1,
    createdAt: serverTimestamp()
  }))
  await assertFails(setDoc(doc(bhtDb, 'eocIssues/returned_problem_issue/activity/problem_returned_impersonated'), {
    issueId: 'returned_problem_issue',
    eventType: 'problem_returned',
    label: 'Problem returned',
    status: 'resolved',
    note: 'Impersonated request.',
    actorUserId: 'someone_else',
    actorName: 'Someone Else',
    locationId: 'test_house',
    issueVersion: 1,
    immutable: true,
    version: 1,
    createdAt: serverTimestamp()
  }))
  await assertFails(updateDoc(doc(bhtDb, 'eocIssues/returned_problem_issue'), {
    status: 'open',
    closedAt: null,
    version: 2,
    updatedAt: serverTimestamp()
  }))

  const supervisorDb = authed('returned_problem_supervisor_uid', 'returned.problem.supervisor@example.com')
  await assertSucceeds(updateDoc(doc(supervisorDb, 'eocIssues/returned_problem_issue'), {
    status: 'open',
    closedAt: null,
    reopenNotes: 'Confirmed the lock is sticking again.',
    version: 2,
    updatedAt: serverTimestamp()
  }))
})

test('BHT follow-ups preserve status and cannot impersonate another profile', async () => {
  await seed('appSettings/authPolicy', { authScopeEnforced: true })
  await seed('users/follow_up_bht', {
    name: 'Follow Up BHT',
    role: 'bht',
    active: true,
    email: 'follow.up.bht@example.com',
    authorizedLocations: ['OTC', 'TEST_HOUSE'],
    issueLocationIds: ['test_house'],
    locationId: 'test_house',
    version: 1
  })
  await seed('usersByAuthUid/follow_up_bht_uid', {
    userId: 'follow_up_bht',
    email: 'follow.up.bht@example.com',
    emailDomain: 'example.com',
    linkedAt: new Date(),
    linkedBy: 'self_first_login',
    version: 1
  })
  await seed('eocIssues/follow_up_issue', {
    locationId: 'test_house',
    status: 'open',
    eocType: 'house',
    label: 'Kitchen sink',
    description: 'The faucet is leaking.',
    reportedByUserId: 'follow_up_bht',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  })

  const bhtDb = authed('follow_up_bht_uid', 'follow.up.bht@example.com')
  const issueRef = doc(bhtDb, 'eocIssues/follow_up_issue')
  const activityRef = doc(bhtDb, 'eocIssues/follow_up_issue/activity/follow_up_1')
  await assertSucceeds(setDoc(activityRef, {
    issueId: 'follow_up_issue',
    eventType: 'bht_follow_up',
    label: 'Staff follow-up',
    status: 'open',
    note: 'The leak is now reaching the cabinet base.',
    actorUserId: 'follow_up_bht',
    actorName: 'Follow Up BHT',
    locationId: 'test_house',
    issueVersion: 1,
    immutable: true,
    version: 1,
    createdAt: serverTimestamp()
  }))

  await assertFails(updateDoc(issueRef, {
    status: 'resolved',
    resolvedNotes: 'BHT attempted to close it.',
    closedAt: serverTimestamp(),
    version: 2,
    updatedAt: serverTimestamp()
  }))
  await assertFails(setDoc(doc(bhtDb, 'eocIssues/follow_up_issue/activity/impersonated_follow_up'), {
    issueId: 'follow_up_issue',
    eventType: 'bht_follow_up',
    label: 'Staff follow-up',
    status: 'open',
    note: 'Impersonated follow-up.',
    actorUserId: 'someone_else',
    actorName: 'Someone Else',
    locationId: 'test_house',
    issueVersion: 2,
    immutable: true,
    version: 1,
    createdAt: serverTimestamp()
  }))
})

test('Phase 4-8 metadata rules protect tracking, attachments, patterns, and missed notes', async () => {
  await seed('appSettings/authPolicy', { authScopeEnforced: true })
  await seed('users/upgrade_bht', { name: 'Upgrade BHT', role: 'bht', active: true, issueLocationIds: ['test_house'], authorizedLocations: ['TEST_HOUSE'], version: 1 })
  await seed('usersByAuthUid/upgrade_bht_uid', { userId: 'upgrade_bht', version: 1 })
  await seed('users/upgrade_supervisor', { name: 'Upgrade Supervisor', role: 'supervisor', active: true, issueLocationIds: ['test_house'], authorizedLocations: ['OTC', 'TEST_HOUSE'], version: 1 })
  await seed('usersByAuthUid/upgrade_supervisor_uid', { userId: 'upgrade_supervisor', version: 1 })
  await seed('eocIssues/upgrade_issue', { source: 'eoc_checklist', sourceTrackingId: 'sink', trackingId: 'sink', recurrenceEligible: true, locationId: 'test_house', status: 'open', eocType: 'house', label: 'Sink', reportedByUserId: 'upgrade_bht', version: 1, createdAt: new Date(), updatedAt: new Date() })
  await seed('eocTasks/upgrade_missed_task', { locationId: 'test_house', shiftId: 'shift_1', taskType: 'house', status: 'missed', version: 1 })

  const bhtDb = authed('upgrade_bht_uid', 'upgrade.bht@example.com')
  await assertSucceeds(setDoc(doc(bhtDb, 'eocIssuePatterns/test_house__sink__test'), {
    schemaVersion: 1,
    patternId: 'test_house__sink__test',
    locationId: 'test_house',
    trackingId: 'sink',
    observations: [{ issueId: 'upgrade_issue', observedAtMs: Date.now() }],
    recentCount: 1,
    lifetimeCount: 1,
    reportedBefore: false,
    recurringIssue: false,
    version: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }))
  await assertFails(setDoc(doc(bhtDb, 'eocIssuePatterns/mesquite__sink__test'), {
    schemaVersion: 1,
    patternId: 'mesquite__sink__test',
    locationId: 'mesquite',
    trackingId: 'sink',
    observations: [],
    recentCount: 0,
    lifetimeCount: 0,
    reportedBefore: false,
    recurringIssue: false,
    version: 1
  }))
  const attachment = {
    schemaVersion: 1,
    attachmentId: 'photo_1',
    issueId: 'upgrade_issue',
    locationId: 'test_house',
    kind: 'report',
    state: 'uploading',
    width: 100,
    height: 100,
    sizeBytes: 100,
    mimeType: 'image/jpeg',
    uploaderProfileId: 'upgrade_bht',
    storagePath: 'issueAttachments/test_house/upgrade_issue/photo_1.jpg',
    visibility: 'location',
    hiddenFromBht: false,
    retentionDays: 90,
    version: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }
  await assertSucceeds(setDoc(doc(bhtDb, 'eocIssues/upgrade_issue/attachments/photo_1'), attachment))
  await assertFails(updateDoc(doc(bhtDb, 'eocIssues/upgrade_issue/attachments/photo_1'), { storagePath: 'issueAttachments/mesquite/stolen.jpg', version: 2 }))
  await assertFails(setDoc(doc(bhtDb, 'eocTasks/upgrade_missed_task/missedNotes/bht_note'), { taskId: 'upgrade_missed_task', locationId: 'test_house', text: 'BHT cannot add this note.', authorUserId: 'upgrade_bht', immutable: true, version: 1 }))

  const supervisorDb = authed('upgrade_supervisor_uid', 'upgrade.supervisor@example.com')
  await assertSucceeds(setDoc(doc(supervisorDb, 'eocTasks/upgrade_missed_task/missedNotes/supervisor_note'), { taskId: 'upgrade_missed_task', locationId: 'test_house', text: 'Supervisor reviewed the missed checklist.', authorUserId: 'upgrade_supervisor', authorName: 'Upgrade Supervisor', immutable: true, version: 1, createdAt: serverTimestamp() }))
  await assertFails(updateDoc(doc(supervisorDb, 'eocIssues/upgrade_issue'), { sourceTrackingId: 'changed', trackingId: 'changed', version: 2, updatedAt: serverTimestamp() }))
})

test('BHT can submit an active issue for supervisor review but cannot fully resolve it', async () => {
  await seed('appSettings/authPolicy', { authScopeEnforced: true })
  await seed('users/resolution_bht', { name: 'Resolution BHT', role: 'bht', active: true, issueLocationIds: ['test_house'], authorizedLocations: ['TEST_HOUSE'], locationId: 'test_house', version: 1 })
  await seed('usersByAuthUid/resolution_bht_uid', { userId: 'resolution_bht', version: 1 })
  await seed('users/resolution_supervisor', { name: 'Resolution Supervisor', role: 'supervisor', active: true, issueLocationIds: ['test_house'], authorizedLocations: ['OTC', 'TEST_HOUSE'], version: 1 })
  await seed('usersByAuthUid/resolution_supervisor_uid', { userId: 'resolution_supervisor', version: 1 })
  await seed('eocIssues/resolution_review_issue', {
    locationId: 'test_house', status: 'open', eocType: 'house', label: 'Bathroom', description: 'Bathroom is dirty.', reportedByUserId: 'resolution_bht', version: 1, createdAt: new Date(), updatedAt: new Date()
  })

  const bhtDb = authed('resolution_bht_uid', 'resolution.bht@example.com')
  const issueRef = doc(bhtDb, 'eocIssues/resolution_review_issue')
  await assertFails(updateDoc(issueRef, {
    status: 'resolved', resolvedNotes: 'Cleaned.', closedAt: serverTimestamp(), version: 2, updatedAt: serverTimestamp()
  }))

  const submitBatch = writeBatch(bhtDb)
  submitBatch.update(issueRef, {
    status: 'pending_supervisor_review',
    version: 2,
    latestActivity: { id: 'v2_resolution_submitted', eventType: 'resolution_submitted', label: 'Submitted for supervisor review', note: 'Bathroom cleaned and checked.', actorUserId: 'resolution_bht', actorName: 'Resolution BHT', createdAt: serverTimestamp() },
    resolutionSubmittedNotes: 'Bathroom cleaned and checked.',
    resolutionSubmittedAt: serverTimestamp(),
    resolutionSubmittedByUserId: 'resolution_bht',
    resolutionSubmittedByName: 'Resolution BHT',
    updatedAt: serverTimestamp()
  })
  submitBatch.set(doc(bhtDb, 'eocIssues/resolution_review_issue/activity/v2_resolution_submitted'), {
    issueId: 'resolution_review_issue', eventType: 'resolution_submitted', label: 'Submitted for supervisor review', status: 'pending_supervisor_review', note: 'Bathroom cleaned and checked.', actorUserId: 'resolution_bht', actorName: 'Resolution BHT', locationId: 'test_house', issueVersion: 2, immutable: true, version: 1, createdAt: serverTimestamp()
  })
  await assertSucceeds(submitBatch.commit())

  const supervisorDb = authed('resolution_supervisor_uid', 'resolution.supervisor@example.com')
  await assertSucceeds(updateDoc(doc(supervisorDb, 'eocIssues/resolution_review_issue'), {
    status: 'resolved',
    version: 3,
    latestActivity: { id: 'v3_resolution_approved', eventType: 'resolution_approved', actorUserId: 'resolution_supervisor' },
    resolutionReviewedAt: serverTimestamp(), resolutionReviewedByUserId: 'resolution_supervisor', resolutionReviewedByName: 'Resolution Supervisor', resolutionReviewDecision: 'approve', resolutionReviewNotes: '',
    resolvedNotes: 'Bathroom cleaned and checked.', resolvedAt: serverTimestamp(), closedAt: serverTimestamp(), resolvedByUserId: 'resolution_supervisor', resolvedByName: 'Resolution Supervisor', photoDeletionDueAt: new Date(Date.now() + 86400000), updatedAt: serverTimestamp()
  }))
})

test('app feedback is owned by the BHT and reviewable only by an admin', async () => {
  await seed('appSettings/authPolicy', { authScopeEnforced: true })
  await seed('users/feedback_bht', { name: 'Feedback BHT', role: 'bht', active: true, issueLocationIds: ['test_house'], authorizedLocations: ['TEST_HOUSE'], locationId: 'test_house', version: 1 })
  await seed('usersByAuthUid/feedback_bht_uid', { userId: 'feedback_bht', version: 1 })
  await seed('users/feedback_supervisor', { name: 'Feedback Supervisor', role: 'supervisor', active: true, issueLocationIds: ['test_house'], authorizedLocations: ['OTC'], version: 1 })
  await seed('usersByAuthUid/feedback_supervisor_uid', { userId: 'feedback_supervisor', version: 1 })
  await seed('users/feedback_admin', { name: 'Feedback Admin', role: 'admin', active: true, authorizedLocations: ['GLOBAL'], version: 1 })
  await seed('usersByAuthUid/feedback_admin_uid', { userId: 'feedback_admin', version: 1 })

  const bhtDb = authed('feedback_bht_uid', 'feedback.bht@example.com')
  const feedbackRef = doc(bhtDb, 'appFeedback/feedback_test')
  await assertSucceeds(setDoc(feedbackRef, {
    schemaVersion: 1, feedbackType: 'app_feedback', originalText: 'The report button did not open.', submittedByUserId: 'feedback_bht', submittedByName: 'Feedback BHT', submittedByRole: 'bht', locationId: 'test_house', shiftId: 'shift_1', route: '/issues', appVersion: 'test', userAgent: 'rules test', localFeedbackId: null, status: 'new', adminNote: '', version: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }))
  await assertSucceeds(getDoc(feedbackRef))
  await assertSucceeds(setDoc(feedbackRef, {
    schemaVersion: 1, feedbackType: 'app_feedback', originalText: 'The report button did not open.', submittedByUserId: 'feedback_bht', submittedByName: 'Feedback BHT', submittedByRole: 'bht', locationId: 'test_house', shiftId: 'shift_1', route: '/issues', appVersion: 'test', userAgent: 'rules test', localFeedbackId: null, status: 'new', adminNote: '', version: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }))
  await assertFails(updateDoc(feedbackRef, { originalText: 'Changed employee text', version: 2, updatedAt: serverTimestamp() }))

  const supervisorDb = authed('feedback_supervisor_uid', 'feedback.supervisor@example.com')
  await assertFails(getDoc(doc(supervisorDb, 'appFeedback/feedback_test')))
  await assertFails(getDocs(collection(supervisorDb, 'appFeedback')))

  const adminDb = authed('feedback_admin_uid', 'feedback.admin@example.com')
  await assertSucceeds(getDoc(doc(adminDb, 'appFeedback/feedback_test')))
  await assertSucceeds(updateDoc(doc(adminDb, 'appFeedback/feedback_test'), {
    status: 'reviewing', adminNote: 'Reviewing this report.', reviewedByUserId: 'feedback_admin', reviewedByName: 'Feedback Admin', reviewedAt: serverTimestamp(), updatedAt: serverTimestamp(), version: 2
  }))
})

test('workflow claims enforce current device sessions, roles, ownership, and location scope', async () => {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
  await seed('users/workflow_bht', {
    name: 'Workflow BHT', role: 'bht', active: true, deleted: false,
    securityVersion: 8, location: 'OTC', locationId: 'test_house', house: 'test_house',
    authorizedLocations: ['test_house'], issueLocationIds: ['test_house'], version: 1
  })
  await seed('usersByAuthUid/workflow_bht_uid', { userId: 'workflow_bht', version: 2 })
  await seed('staffSessions/workflow_bht_session', {
    profileId: 'workflow_bht', authUid: 'workflow_bht_uid', securityVersion: 8,
    active: true, revokedAt: null, expiresAt
  })
  await seed('transports/workflow_transport', {
    site: 'OTC', createdByUserId: 'workflow_bht', createdByName: 'Workflow BHT',
    status: 'open', departedAt: new Date(), createdAt: new Date(), updatedAt: new Date(), version: 1
  })
  await seed('eocIssues/workflow_issue', { locationId: 'test_house', status: 'open', version: 1 })
  await seed('eocIssuePatterns/workflow_pattern', {
    patternId: 'workflow_pattern', locationId: 'test_house', trackingId: 'workflow_tracking',
    observations: [], recentCount: 0, lifetimeCount: 0, reportedBefore: false,
    recurringIssue: false, version: 1
  })
  await seed('eocTemplateLibrary/workflow_template', {
    name: 'Workflow Template', eocType: 'house', items: [], status: 'published', version: 1
  })
  await seed('shiftDebriefs/workflow_debrief', {
    locationId: 'test_house', draftByUserId: 'workflow_bht', submittedByUserId: 'workflow_bht',
    submittedByName: 'Workflow BHT', receivingUserIds: ['workflow_receiver'],
    receivingUserNames: { workflow_receiver: 'Workflow Receiver' },
    shiftId: 'shift_1', dateKey: '2026-08-26', mainLocation: 'OTC',
    status: 'submitted', items: [], extraNotes: [],
    confirmation: { acknowledgments: {}, confirmedByUserId: null },
    confirmed: false, createdAt: new Date(), updatedAt: new Date(), version: 1
  })
  await seed('alerts/workflow_alert', {
    audience: 'bht', targetUserId: 'workflow_bht', locationId: 'test_house',
    type: 'transport_completed', read: false, version: 1
  })
  await seed('eocProperties/workflow_property', { mainLocation: 'OTC', locationId: 'test_house', version: 1 })
  await seed('appSettings/workflowSetting', { enabled: false, version: 1 })

  const workflows = ['identity_users', 'templates_photos', 'eoc', 'debriefs_alerts', 'issues_feedback_audit', 'transports', 'operations_admin', 'settings']
  const bhtDb = secureAuthed('workflow_bht_uid', 'workflow_bht', 'workflow_bht_session', 8, 'bht', workflows, {
    authorizedLocations: ['OTC', 'test_house'],
    issueLocationIds: ['test_house'],
    locationId: 'test_house'
  })
  await assertSucceeds(getDoc(doc(bhtDb, 'users/workflow_bht')))
  await assertSucceeds(getDoc(doc(bhtDb, 'eocTemplateLibrary/workflow_template')))
  await assertSucceeds(getDoc(doc(bhtDb, 'eocIssuePatterns/workflow_pattern')))
  await assertSucceeds(getDoc(doc(bhtDb, 'shiftDebriefs/workflow_debrief')))
  await assertSucceeds(updateDoc(doc(bhtDb, 'shiftDebriefs/workflow_debrief'), {
    extraNotes: [{
      id: 'workflow_correction', note: 'Corrected before incoming signoff.',
      createdByUserId: 'workflow_bht', createdByName: 'Workflow BHT',
      createdAtIso: '2026-08-26T08:00:00.000Z'
    }],
    updatedAt: new Date(),
    version: 2
  }))
  await assertSucceeds(getDoc(doc(bhtDb, 'alerts/workflow_alert')))
  await assertSucceeds(getDoc(doc(bhtDb, 'transports/workflow_transport')))
  await assertSucceeds(getDoc(doc(bhtDb, 'eocIssues/workflow_issue')))
  await assertSucceeds(getDoc(doc(bhtDb, 'appSettings/workflowSetting')))
  await assertFails(getDoc(doc(bhtDb, 'eocProperties/workflow_property')))
  await assertFails(updateDoc(doc(bhtDb, 'appSettings/workflowSetting'), { enabled: true, version: 2 }))
  await assertFails(setDoc(doc(bhtDb, 'transports/workflow_impersonated'), {
    site: 'OTC', createdByUserId: 'someone_else', createdByName: 'Someone Else',
    status: 'open', departedAt: new Date(), createdAt: new Date(), version: 1
  }))

  await seed('users/workflow_admin', {
    name: 'Workflow Admin', role: 'admin', active: true, deleted: false,
    securityVersion: 3, location: 'GLOBAL', authorizedLocations: [], issueLocationIds: [], version: 1
  })
  await seed('staffSessions/workflow_admin_session', {
    profileId: 'workflow_admin', authUid: 'workflow_admin_uid', securityVersion: 3,
    active: true, revokedAt: null, expiresAt
  })
  const secureAdminDb = secureAuthed('workflow_admin_uid', 'workflow_admin', 'workflow_admin_session', 3, 'admin', workflows)
  await assertFails(setDoc(doc(secureAdminDb, 'accessGrants/direct_strict_grant'), {
    userId: 'workflow_bht', userName: 'Workflow BHT', locationId: 'RES',
    startsAt: new Date(), expiresAt, reason: 'Direct strict write must be denied.',
    revoked: false, revokedAt: null, version: 1, createdAt: new Date(), updatedAt: new Date()
  }))
  await assertFails(setDoc(doc(secureAdminDb, 'issueAccess/workflow_bht'), {
    userId: 'workflow_bht', locationIds: ['res'], active: true, version: 1
  }))

  await seed('staffSessions/workflow_scope_expired_session', {
    profileId: 'workflow_bht', authUid: 'workflow_bht_uid', securityVersion: 8,
    active: true, revokedAt: null, expiresAt, scopeExpiresAt: new Date(Date.now() - 1000)
  })
  const expiredScopeDb = secureAuthed('workflow_bht_uid', 'workflow_bht', 'workflow_scope_expired_session', 8, 'bht', workflows, {
    authorizedLocations: ['OTC', 'test_house'], issueLocationIds: ['test_house'], locationId: 'test_house'
  })
  await assertFails(getDoc(doc(expiredScopeDb, 'transports/workflow_transport')))

  await seed('staffSessions/workflow_bht_session', {
    profileId: 'workflow_bht', authUid: 'workflow_bht_uid', securityVersion: 8,
    active: false, revokedAt: new Date(), expiresAt
  })
  await assertFails(getDoc(doc(bhtDb, 'transports/workflow_transport')))
  await assertFails(getDoc(doc(bhtDb, 'eocIssues/workflow_issue')))
  await assertFails(getDoc(doc(bhtDb, 'eocTemplateLibrary/workflow_template')))
  await assertFails(getDoc(doc(bhtDb, 'eocIssuePatterns/workflow_pattern')))
  await assertFails(getDoc(doc(bhtDb, 'shiftDebriefs/workflow_debrief')))
  await assertFails(getDoc(doc(bhtDb, 'alerts/workflow_alert')))
  await assertFails(getDoc(doc(bhtDb, 'appSettings/workflowSetting')))
})

test('strict identity Users queries are backend-scoped for supervisors while admins retain global access', async () => {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
  await seed('appSettings/securityWorkflows', {
    schemaVersion: 6,
    enabled: true,
    workflows: ['identity_users']
  })
  await seed('users/identity_scope_supervisor', {
    name: 'Identity Scope Supervisor', role: 'supervisor', active: true, deleted: false,
    securityVersion: 4, location: 'OTC', authorizedLocations: ['OTC'], issueLocationIds: [], version: 1
  })
  await seed('usersByAuthUid/identity_scope_supervisor_uid', { userId: 'identity_scope_supervisor', version: 1 })
  await seed('staffSessions/identity_scope_supervisor_session', {
    profileId: 'identity_scope_supervisor', authUid: 'identity_scope_supervisor_uid', securityVersion: 4,
    active: true, revokedAt: null, expiresAt
  })
  await seed('users/identity_scope_otc_bht', {
    name: 'OTC BHT', role: 'bht', active: true, deleted: false,
    securityVersion: 1, location: 'OTC', site: 'OTC', house: 'TEST_HOUSE', locationId: 'test_house',
    authorizedLocations: ['OTC'], issueLocationIds: ['test_house'], version: 1
  })
  await seed('users/identity_scope_res_bht', {
    name: 'RES BHT', role: 'bht', active: true, deleted: false,
    securityVersion: 1, location: 'RES', site: 'RES', locationId: 'res',
    authorizedLocations: ['RES'], issueLocationIds: ['res'], version: 1
  })
  await seed('users/identity_scope_other_supervisor', {
    name: 'Other Supervisor', role: 'supervisor', active: true, deleted: false,
    securityVersion: 1, location: 'OTC', authorizedLocations: ['OTC'], issueLocationIds: [], version: 1
  })

  const supervisorDb = secureAuthed(
    'identity_scope_supervisor_uid', 'identity_scope_supervisor', 'identity_scope_supervisor_session', 4,
    'supervisor', ['identity_users'], { authorizedLocations: ['OTC'] }
  )
  const scopedSnapshot = await assertSucceeds(getDocs(query(
    collection(supervisorDb, 'users'),
    where('role', '==', 'bht'),
    where('location', '==', 'OTC')
  )))
  const scopedIds = scopedSnapshot.docs.map(snapshot => snapshot.id)
  assert.equal(scopedIds.includes('identity_scope_otc_bht'), true)
  assert.equal(scopedIds.includes('identity_scope_res_bht'), false)
  assert.equal(scopedIds.includes('identity_scope_other_supervisor'), false)
  await assertFails(getDocs(collection(supervisorDb, 'users')))
  await assertFails(getDocs(query(
    collection(supervisorDb, 'users'),
    where('role', '==', 'bht'),
    where('location', '==', 'RES')
  )))
  await assertFails(getDocs(query(
    collection(supervisorDb, 'users'),
    where('role', '==', 'supervisor'),
    where('location', '==', 'OTC')
  )))

  await seed('users/identity_scope_admin', {
    name: 'Identity Scope Admin', role: 'admin', active: true, deleted: false,
    securityVersion: 2, location: 'GLOBAL', authorizedLocations: [], issueLocationIds: [], version: 1
  })
  await seed('usersByAuthUid/identity_scope_admin_uid', { userId: 'identity_scope_admin', version: 1 })
  await seed('staffSessions/identity_scope_admin_session', {
    profileId: 'identity_scope_admin', authUid: 'identity_scope_admin_uid', securityVersion: 2,
    active: true, revokedAt: null, expiresAt
  })
  const adminDb = secureAuthed(
    'identity_scope_admin_uid', 'identity_scope_admin', 'identity_scope_admin_session', 2,
    'admin', ['identity_users']
  )
  await assertSucceeds(getDocs(collection(adminDb, 'users')))
})

test('strict EOC and issue workflows require protected server mutations while drafts and reads remain usable', async () => {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
  await seed('appSettings/securityWorkflows', {
    schemaVersion: 6,
    enabled: true,
    workflows: ['eoc', 'issues_feedback_audit']
  })
  await seed('users/server_mutation_bht', {
    name: 'Server Mutation BHT', role: 'bht', active: true, deleted: false,
    securityVersion: 2, location: 'OTC', locationId: 'test_house', house: 'test_house',
    authorizedLocations: ['OTC', 'test_house'], issueLocationIds: ['test_house'], version: 1
  })
  await seed('usersByAuthUid/server_mutation_uid', { userId: 'server_mutation_bht', version: 2 })
  await seed('staffSessions/server_mutation_session', {
    profileId: 'server_mutation_bht', authUid: 'server_mutation_uid', securityVersion: 2,
    active: true, revokedAt: null, expiresAt
  })
  await seed('eocTasks/server_mutation_task', {
    taskType: 'house', locationId: 'test_house', shiftId: 'shift_1', dueDate: '2026-08-26',
    status: 'pending', cycleKey: 'server_mutation_task', eligibleUserIds: ['server_mutation_bht'],
    templateScope: 'otc_shared', version: 1, createdAt: new Date(), updatedAt: new Date()
  })
  await seed('eocIssues/server_mutation_issue', {
    locationId: 'test_house', eocType: 'house', label: 'Door', status: 'open',
    reportedByUserId: 'server_mutation_bht', version: 1, createdAt: new Date(), updatedAt: new Date()
  })
  await seed('eocIssues/server_mutation_legacy_missing_location', {
    eocType: 'house', label: 'Malformed legacy issue', status: 'open',
    reportedByUserId: 'server_mutation_bht', version: 1, createdAt: new Date(), updatedAt: new Date()
  })
  const bhtDb = secureAuthed(
    'server_mutation_uid', 'server_mutation_bht', 'server_mutation_session', 2, 'bht',
    ['eoc', 'issues_feedback_audit'],
    { authorizedLocations: ['OTC', 'test_house'], issueLocationIds: ['test_house'], locationId: 'test_house' }
  )
  await assertSucceeds(getDoc(doc(bhtDb, 'eocTasks/server_mutation_task')))
  await assertSucceeds(getDoc(doc(bhtDb, 'eocIssues/server_mutation_issue')))
  await assertSucceeds(getDocs(query(
    collection(bhtDb, 'eocIssues'),
    where('locationId', '==', 'test_house')
  )))
  await assertSucceeds(getDocs(query(
    collection(bhtDb, 'eocIssues'),
    where('locationId', '==', 'test_house'),
    where('status', 'in', ['open', 'in_progress', 'pending_supervisor_review']),
    orderBy('createdAt', 'desc')
  )))
  await assertSucceeds(getDocs(query(
    collection(bhtDb, 'eocIssues'),
    where('locationId', '==', 'test_house'),
    where('status', 'in', ['resolved', 'voided']),
    orderBy('closedAt', 'desc')
  )))
  await assertFails(getDoc(doc(bhtDb, 'eocIssues/server_mutation_legacy_missing_location')))
  await seed('users/server_mutation_admin', {
    name: 'Server Mutation Admin', role: 'admin', active: true, deleted: false,
    securityVersion: 1, authorizedLocations: [], issueLocationIds: [], version: 1
  })
  await seed('usersByAuthUid/server_mutation_admin_uid', { userId: 'server_mutation_admin', version: 1 })
  await seed('staffSessions/server_mutation_admin_session', {
    profileId: 'server_mutation_admin', authUid: 'server_mutation_admin_uid', securityVersion: 1,
    active: true, revokedAt: null, expiresAt
  })
  const adminDb = secureAuthed(
    'server_mutation_admin_uid', 'server_mutation_admin', 'server_mutation_admin_session', 1, 'admin',
    ['eoc', 'issues_feedback_audit'],
    { authorizedLocations: [], issueLocationIds: [] }
  )
  await assertSucceeds(getDocs(query(
    collection(adminDb, 'eocIssues'),
    orderBy('createdAt', 'desc')
  )))
  await assertSucceeds(getDoc(doc(adminDb, 'eocIssues/server_mutation_legacy_missing_location')))
  await assertSucceeds(setDoc(doc(bhtDb, 'eocSubmissionDrafts/server_mutation_task__server_mutation_bht'), {
    taskId: 'server_mutation_task', locationId: 'test_house', shiftId: 'shift_1', eocType: 'house',
    draftByUserId: 'server_mutation_bht', templateScope: 'otc_shared', version: 1,
    createdAt: new Date(), updatedAt: new Date()
  }))
  await assertFails(setDoc(doc(bhtDb, 'eocSubmissions/direct_strict_submission'), {
    locationId: 'test_house', shiftId: 'shift_1', eocType: 'house', templateScope: 'otc_shared',
    submittedByUserId: 'server_mutation_bht', submittedByName: 'Server Mutation BHT', version: 1,
    createdAt: new Date(), updatedAt: new Date()
  }))
  await assertFails(updateDoc(doc(bhtDb, 'eocTasks/server_mutation_task'), {
    status: 'completed', submissionId: 'direct_strict_submission', version: 2, updatedAt: new Date()
  }))
  await assertFails(setDoc(doc(bhtDb, 'eocIssues/direct_strict_issue'), {
    locationId: 'test_house', eocType: 'house', label: 'Direct issue', status: 'open',
    reportedByUserId: 'server_mutation_bht', version: 1, createdAt: new Date(), updatedAt: new Date()
  }))
  await assertFails(updateDoc(doc(bhtDb, 'eocIssues/server_mutation_issue'), {
    status: 'pending_supervisor_review', version: 2, updatedAt: new Date()
  }))
  await assertFails(setDoc(doc(bhtDb, 'eocIssues/server_mutation_issue/activity/direct_strict_activity'), {
    issueId: 'server_mutation_issue', locationId: 'test_house', eventType: 'bht_follow_up',
    actorUserId: 'server_mutation_bht', immutable: true, version: 1, createdAt: new Date()
  }))
})
