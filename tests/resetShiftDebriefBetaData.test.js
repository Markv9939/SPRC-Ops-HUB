import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CONFIRM_PHRASE,
  NO_BACKUP_PHRASE,
  PROJECT_ID,
  assertResetApproved,
  parseArguments
} from '../scripts/resetShiftDebriefBetaData.js'

const inventory = {
  counts: { drafts: 2, debriefs: 3, alerts: 4, homeStates: 1 }
}

const approvedArgs = {
  project: PROJECT_ID,
  confirm: CONFIRM_PHRASE,
  backup: true,
  noBackup: '',
  expectedDrafts: '2',
  expectedDebriefs: '3',
  expectedAlerts: '4',
  expectedHomeStates: '1'
}

test('reset arguments are parsed without enabling destructive mode by default', () => {
  const args = parseArguments(['node', 'script.js'])
  assert.equal(args.confirm, '')
  assert.equal(args.backup, false)
})

test('approved reset requires all exact safeguards', () => {
  assert.doesNotThrow(() => assertResetApproved({ args: approvedArgs, inventory, backupVerified: true }))
  assert.doesNotThrow(() => assertResetApproved({
    args: { ...approvedArgs, backup: false, noBackup: NO_BACKUP_PHRASE },
    inventory,
    backupVerified: false
  }))
})

test('wrong project, phrase, missing backup, or changed counts block the reset', () => {
  const attempts = [
    { args: { ...approvedArgs, project: 'wrong-project' }, backupVerified: true },
    { args: { ...approvedArgs, confirm: 'close-enough' }, backupVerified: true },
    { args: { ...approvedArgs, backup: false, noBackup: 'not-an-explicit-waiver' }, backupVerified: false },
    { args: { ...approvedArgs, expectedDebriefs: '2' }, backupVerified: true }
  ]

  attempts.forEach(attempt => {
    assert.throws(() => assertResetApproved({ ...attempt, inventory }), /Refusing reset/)
  })
})
