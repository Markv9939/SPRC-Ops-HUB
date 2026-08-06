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

function formatPhoenix(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Phoenix',
    weekday: 'short',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(value)
}

function pdt(year, month, day, hour, minute = 0) {
  return phoenixDateFromParts({ year, month, day, hour, minute })
}

function yesNo(value) {
  return value ? 'yes' : 'no'
}

function summarizeScenario({ name, now, assignment, submittedDebriefs }) {
  const state = evaluateDebriefTimingState({ now, assignment, submittedDebriefs })
  const incoming = state.incoming?.[0] || null
  return {
    name,
    now: formatPhoenix(now),
    assignment: `${assignment.bhtUserId} ${assignment.shiftId}`,
    outgoingDue: formatPhoenix(state.outgoingDebriefDueAt),
    outgoingSubmitted: yesNo(state.outgoingDebriefSubmitted),
    missingOutgoing: yesNo(state.missingOutgoingDebrief),
    incomingVisibleAfterSubmit: incoming ? yesNo(incoming.appAlertVisibleAfterSubmit) : 'n/a',
    nextShiftStarted: incoming ? yesNo(incoming.shiftStartGateOpen) : 'n/a',
    incomingAckLate: incoming ? yesNo(incoming.acknowledgmentLate) : 'n/a',
    acknowledged: incoming ? yesNo(incoming.acknowledged) : 'n/a'
  }
}

function printTable(rows) {
  const columns = [
    ['Scenario', 'name'],
    ['Phoenix now', 'now'],
    ['Assignment', 'assignment'],
    ['Outgoing due', 'outgoingDue'],
    ['Outgoing submitted', 'outgoingSubmitted'],
    ['Missing outgoing', 'missingOutgoing'],
    ['Incoming visible after submit', 'incomingVisibleAfterSubmit'],
    ['Next shift started', 'nextShiftStarted'],
    ['Ack late', 'incomingAckLate'],
    ['Acknowledged', 'acknowledged']
  ]
  const widths = columns.map(([label, key]) => Math.max(label.length, ...rows.map(row => String(row[key] || '').length)))
  const render = values => values.map((value, index) => String(value).padEnd(widths[index])).join(' | ')
  console.log(render(columns.map(([label]) => label)))
  console.log(render(widths.map(width => '-'.repeat(width))))
  rows.forEach(row => {
    console.log(render(columns.map(([, key]) => row[key])))
  })
}

const submittedBeforeShiftStart = makeSubmittedDebriefFixture({
  now: pdt(2026, 6, 17, 17, 30),
  outgoingAssignment: testOne,
  receivingAssignment: testTwo
})

const submittedAcknowledged = makeSubmittedDebriefFixture({
  now: pdt(2026, 6, 17, 18, 31),
  outgoingAssignment: testOne,
  receivingAssignment: testTwo,
  acknowledged: true
})

const rows = [
  summarizeScenario({
    name: 'before 1st shift start',
    now: pdt(2026, 6, 14, 8, 30),
    assignment: testOne,
    submittedDebriefs: []
  }),
  summarizeScenario({
    name: 'after outgoing deadline, no submit',
    now: pdt(2026, 6, 17, 17, 5),
    assignment: testOne,
    submittedDebriefs: []
  }),
  summarizeScenario({
    name: 'submitted before next shift start',
    now: pdt(2026, 6, 17, 17, 30),
    assignment: testTwo,
    submittedDebriefs: [submittedBeforeShiftStart]
  }),
  summarizeScenario({
    name: 'at next shift start',
    now: pdt(2026, 6, 17, 18, 0),
    assignment: testTwo,
    submittedDebriefs: [submittedBeforeShiftStart]
  }),
  summarizeScenario({
    name: 'submitted unacknowledged after grace',
    now: pdt(2026, 6, 17, 18, 31),
    assignment: testTwo,
    submittedDebriefs: [submittedBeforeShiftStart]
  }),
  summarizeScenario({
    name: 'submitted acknowledged after grace',
    now: pdt(2026, 6, 17, 18, 31),
    assignment: testTwo,
    submittedDebriefs: [submittedAcknowledged]
  }),
  summarizeScenario({
    name: 'weekend before 2nd shift deadline',
    now: pdt(2026, 6, 21, 7, 30),
    assignment: testTwo,
    submittedDebriefs: []
  }),
  summarizeScenario({
    name: 'weekend after 2nd shift deadline',
    now: pdt(2026, 6, 21, 8, 5),
    assignment: testTwo,
    submittedDebriefs: []
  })
]

console.log('Shift debrief timing simulation. No Firebase reads or writes are performed.')
console.log('Current app behavior: targeted incoming handoff alerts are visible after submit; late/missing supervisor alerts are time-gated.')
console.log('Outgoing columns apply to the listed assignment; incoming columns apply only when a submitted handoff is supplied.')
printTable(rows)
