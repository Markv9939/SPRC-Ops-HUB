/* global process */
import assert from 'node:assert/strict'
import test from 'node:test'
import admin from 'firebase-admin'
import {
  buildInventory,
  captureAuthUsers,
  captureFirestore,
  executeReset
} from '../scripts/resetProductionCore.js'

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('This destructive reset test must run only against the Firebase emulators.')
}

if (!admin.apps.length) admin.initializeApp({ projectId: 'sprc-tx-l' })

const db = admin.firestore()
const auth = admin.auth()

test('core reset preserves catalogs, deletes nested activity, clears Auth, and reseeds four users', async () => {
  await Promise.all([
    db.doc('appSettings/authPolicy').set({ authScopeEnforced: false }),
    db.doc('eocProperties/test_house').set({ name: 'Test House', createdByUserId: 'old_admin' }),
    db.doc('eocChecklistTemplate/check_1').set({ label: 'Check doors', active: true }),
    db.doc('users/old_user').set({ name: 'Old User', active: true }),
    db.doc('clients/client_1').set({ name: 'Old Client' }),
    db.doc('destinations/destination_1').set({ name: 'Old Destination' }),
    db.doc('eocIssues/issue_1').set({ title: 'Old issue' }),
    db.doc('eocIssues/issue_1/activity/event_1').set({ note: 'Old activity' }),
    auth.createUser({ uid: 'old_auth_user', email: 'old@example.com' })
  ])

  const [collections, authUsers] = await Promise.all([
    captureFirestore(db),
    captureAuthUsers(auth)
  ])
  const inventory = buildInventory(collections, authUsers)

  process.argv.push(
    '--backup',
    '--project=sprc-tx-l',
    '--confirm=RESET_SPRC_CORE_PRODUCTION',
    `--expected-auth-users=${inventory.authUserCount}`,
    `--expected-delete-docs=${inventory.deleteDocumentCount}`
  )

  const result = await executeReset({ db, auth, inventory })

  assert.equal(result.deletedAuthUsers, 1)
  assert.equal(result.testUsers.length, 4)
  assert.equal((await auth.listUsers()).users.length, 0)
  assert.equal((await db.doc('users/old_user').get()).exists, false)
  assert.equal((await db.doc('clients/client_1').get()).exists, false)
  assert.equal((await db.doc('destinations/destination_1').get()).exists, false)
  assert.equal((await db.doc('eocIssues/issue_1/activity/event_1').get()).exists, false)
  assert.equal((await db.doc('eocChecklistTemplate/check_1').get()).exists, true)

  const property = await db.doc('eocProperties/test_house').get()
  assert.equal(property.exists, true)
  assert.equal('createdByUserId' in property.data(), false)

  const users = await db.collection('users').get()
  const assignments = await db.collection('shiftAssignments').get()
  assert.deepEqual(users.docs.map(document => document.id).sort(), [
    'test_admin',
    'test_bht_shift_1',
    'test_bht_shift_2',
    'test_supervisor'
  ])
  assert.equal(assignments.size, 2)
})
