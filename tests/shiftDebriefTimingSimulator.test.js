import assert from 'node:assert/strict'
import test from 'node:test'
import {
  evaluateDebriefTimingState,
  makeSubmittedDebriefFixture
} from '../src/services/shiftDebriefTimingSimulator.js'
import { phoenixDateFromParts } from '../src/services/shiftTimingCore.js'

const testOne = {
  bhtUserId: 'test_1',
  bhtUserName: 'Test One',
  locationId: 'test_house',
  shiftId: 'shift_1'
}

const testTwo = {
  bhtUserId: 'test_2',
  bhtUserName: 'Test Two',
  locationId: 'test_house',
  shiftId: 'shift_2'
}

function pdt(year, month, day, hour, minute = 0) {
  return phoenixDateFromParts({ year, month, day, hour, minute })
}

test('missing outgoing debrief starts after outgoing deadline', () => {
  const beforeDeadline = evaluateDebriefTimingState({
    now: pdt(2026, 6, 17, 16, 59),
    assignment: testOne,
    submittedDebriefs: []
  })
  const afterDeadline = evaluateDebriefTimingState({
    now: pdt(2026, 6, 17, 17, 1),
    assignment: testOne,
    submittedDebriefs: []
  })

  assert.equal(beforeDeadline.missingOutgoingDebrief, false)
  assert.equal(afterDeadline.missingOutgoingDebrief, true)
})

test('incoming handoff visibility and late acknowledgment are separate timing concerns', () => {
  const submitted = makeSubmittedDebriefFixture({
    now: pdt(2026, 6, 17, 17, 30),
    outgoingAssignment: testOne,
    receivingAssignment: testTwo
  })

  const beforeShiftStart = evaluateDebriefTimingState({
    now: pdt(2026, 6, 17, 17, 30),
    assignment: testTwo,
    submittedDebriefs: [submitted]
  })
  const atShiftStart = evaluateDebriefTimingState({
    now: pdt(2026, 6, 17, 18, 0),
    assignment: testTwo,
    submittedDebriefs: [submitted]
  })
  const afterGrace = evaluateDebriefTimingState({
    now: pdt(2026, 6, 17, 18, 31),
    assignment: testTwo,
    submittedDebriefs: [submitted]
  })

  assert.equal(beforeShiftStart.incoming[0].appAlertVisibleAfterSubmit, true)
  assert.equal(beforeShiftStart.incoming[0].shiftStartGateOpen, false)
  assert.equal(atShiftStart.incoming[0].shiftStartGateOpen, true)
  assert.equal(afterGrace.incoming[0].acknowledgmentLate, true)
})

test('acknowledged incoming debrief does not become late after grace', () => {
  const submitted = makeSubmittedDebriefFixture({
    now: pdt(2026, 6, 17, 18, 31),
    outgoingAssignment: testOne,
    receivingAssignment: testTwo,
    acknowledged: true
  })
  const state = evaluateDebriefTimingState({
    now: pdt(2026, 6, 17, 18, 31),
    assignment: testTwo,
    submittedDebriefs: [submitted]
  })

  assert.equal(state.incoming[0].acknowledged, true)
  assert.equal(state.incoming[0].acknowledgmentLate, false)
})

test('weekend 2nd shift outgoing deadline is Sunday morning', () => {
  const beforeDeadline = evaluateDebriefTimingState({
    now: pdt(2026, 6, 21, 7, 30),
    assignment: testTwo,
    submittedDebriefs: []
  })
  const afterDeadline = evaluateDebriefTimingState({
    now: pdt(2026, 6, 21, 8, 5),
    assignment: testTwo,
    submittedDebriefs: []
  })

  assert.equal(beforeDeadline.missingOutgoingDebrief, false)
  assert.equal(afterDeadline.missingOutgoingDebrief, true)
})
