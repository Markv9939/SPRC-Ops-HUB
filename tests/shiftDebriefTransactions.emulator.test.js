import assert from 'node:assert/strict'
import test from 'node:test'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, runTransaction, setDoc } from 'firebase/firestore'
import {
  appendUniqueDebriefRecord,
  mergeDebriefConfirmation,
  removeDebriefRecordById
} from '../src/services/shiftDebriefModel.js'

const projectId = 'sprc-debrief-v2-transaction-test'
const testEnv = await initializeTestEnvironment({ projectId })

test.after(async () => {
  await testEnv.cleanup()
})

test('concurrent V2 writes preserve notes, acknowledgments, idempotent replay, and exact-item Undo', async () => {
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    const draftRef = doc(db, 'shiftDebriefDrafts/concurrent_draft')
    const submittedRef = doc(db, 'shiftDebriefs/concurrent_submitted')
    const quickOne = { id: 'quick_one', note: 'First quick note.' }
    const quickTwo = { id: 'quick_two', note: 'Second quick note.' }

    await setDoc(draftRef, { schemaVersion: 2, items: [], itemCount: 0, version: 1 })
    const appendQuick = quickItem => runTransaction(db, async transaction => {
      const snapshot = await transaction.get(draftRef)
      const current = snapshot.data()
      const items = appendUniqueDebriefRecord(current.items, quickItem)
      transaction.update(draftRef, { items, itemCount: items.length, version: current.version + 1 })
    })

    await Promise.all([appendQuick(quickOne), appendQuick(quickTwo)])
    await appendQuick(quickOne)
    let snapshot = await getDoc(draftRef)
    assert.deepEqual(snapshot.data().items.map(item => item.id).sort(), ['quick_one', 'quick_two'])

    await runTransaction(db, async transaction => {
      const currentSnapshot = await transaction.get(draftRef)
      const current = currentSnapshot.data()
      const items = removeDebriefRecordById(current.items, quickOne.id)
      transaction.update(draftRef, { items, itemCount: items.length, version: current.version + 1 })
    })
    snapshot = await getDoc(draftRef)
    assert.deepEqual(snapshot.data().items.map(item => item.id), ['quick_two'])

    await setDoc(submittedRef, {
      schemaVersion: 2,
      extraNotes: [],
      confirmation: { acknowledgments: {} },
      confirmed: false,
      version: 1
    })
    const appendExtra = extraNote => runTransaction(db, async transaction => {
      const submittedSnapshot = await transaction.get(submittedRef)
      const current = submittedSnapshot.data()
      transaction.update(submittedRef, {
        extraNotes: appendUniqueDebriefRecord(current.extraNotes, extraNote),
        version: current.version + 1
      })
    })
    await Promise.all([
      appendExtra({ id: 'extra_one', note: 'First correction.' }),
      appendExtra({ id: 'extra_two', note: 'Second correction.' })
    ])

    const completeConfirmation = initials => ({
      keysAccountedFor: true,
      sharpsRestrictedVerified: true,
      clientRoundCompleted: true,
      controlledMedicationLogReviewed: true,
      questionsClarificationsAddressed: true,
      incomingStaffInitials: initials
    })
    const saveConfirmation = (userId, initials) => runTransaction(db, async transaction => {
      const submittedSnapshot = await transaction.get(submittedRef)
      const current = submittedSnapshot.data()
      const merged = mergeDebriefConfirmation(current.confirmation, completeConfirmation(initials), {
        userId,
        userName: userId,
        receivingUserIds: ['receiver_one', 'receiver_two'],
        acknowledgedAt: new Date('2026-08-09T12:00:00.000Z')
      })
      transaction.update(submittedRef, {
        confirmation: merged.confirmation,
        confirmed: merged.confirmed,
        version: current.version + 1
      })
    })
    await Promise.all([
      saveConfirmation('receiver_one', 'R1'),
      saveConfirmation('receiver_two', 'R2')
    ])

    const submitted = (await getDoc(submittedRef)).data()
    assert.deepEqual(submitted.extraNotes.map(note => note.id).sort(), ['extra_one', 'extra_two'])
    assert.deepEqual(Object.keys(submitted.confirmation.acknowledgments).sort(), ['receiver_one', 'receiver_two'])
    assert.equal(submitted.confirmed, true)
  })
})
