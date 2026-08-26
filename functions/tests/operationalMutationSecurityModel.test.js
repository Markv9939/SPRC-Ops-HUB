import test from 'node:test'
import assert from 'node:assert/strict'
import {
  actorCanCompleteEocTask,
  actorCanPerformIssueAction,
  assertExpectedOperationalVersion,
  cleanOperationalOperationId,
  operationalActorCanAccessLocation
} from '../src/operationalMutationSecurityModel.js'

const bht = { id: 'bht_1', role: 'bht', issueLocationIds: ['mesquite'], authorizedLocations: ['OTC'] }
const supervisor = { id: 'sup_1', role: 'supervisor', issueLocationIds: ['mesquite'], authorizedLocations: ['OTC'] }

test('EOC completion requires exact task eligibility and location scope', () => {
  assert.equal(actorCanCompleteEocTask(bht, { locationId: 'mesquite', eligibleUserIds: ['bht_1'] }), true)
  assert.equal(actorCanCompleteEocTask(bht, { locationId: 'mesquite', eligibleUserIds: ['bht_2'] }), false)
  assert.equal(actorCanCompleteEocTask(bht, { locationId: 'res', eligibleUserIds: ['bht_1'] }), false)
})

test('issue actions enforce staff ownership, supervisor scope, and admin-only unlink', () => {
  const issue = { locationId: 'mesquite', reportedByUserId: 'bht_1' }
  assert.equal(actorCanPerformIssueAction(bht, issue, 'submit_resolution'), true)
  assert.equal(actorCanPerformIssueAction({ ...bht, id: 'other' }, issue, 'submit_resolution'), false)
  assert.equal(actorCanPerformIssueAction(supervisor, issue, 'review_resolution'), true)
  assert.equal(actorCanPerformIssueAction(supervisor, issue, 'unlink_relationship'), false)
  assert.equal(actorCanPerformIssueAction({ id: 'admin', role: 'admin' }, issue, 'unlink_relationship'), true)
})

test('location aliases, operation IDs, and optimistic versions are strict', () => {
  assert.equal(operationalActorCanAccessLocation(supervisor, 'lone_mountain'), true)
  assert.equal(operationalActorCanAccessLocation(supervisor, 'res'), false)
  assert.equal(cleanOperationalOperationId('operation_security_0001'), 'operation_security_0001')
  assert.throws(() => cleanOperationalOperationId('short'))
  assert.equal(assertExpectedOperationalVersion(3, 3, 'Issue'), 4)
  assert.throws(() => assertExpectedOperationalVersion(2, 3, 'Issue'), /changed/)
})
