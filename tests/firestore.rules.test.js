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
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore'

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
    items: [],
    itemCount: 0,
    extraNotes: [],
    confirmation: {
      keysAccountedFor: true,
      sharpsRestrictedVerified: true,
      clientRoundCompleted: true,
      urgentIssuesCommunicated: true
    },
    confirmed: true,
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
      confirmed: true,
      confirmedAt: new Date(),
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
    confirmed: true,
    updatedAt: new Date(),
    version: 2
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

  await assertSucceeds(updateDoc(transportRef, {
    status: 'closed',
    returnedAt: new Date(),
    closedAt: new Date(),
    dcPaperworkStatus: 'na',
    updatedAt: new Date(),
    version: 2
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
