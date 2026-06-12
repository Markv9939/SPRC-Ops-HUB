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
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc
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
