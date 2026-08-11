import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getEocCycleScopeKey,
  shouldMarkEocTaskMissed
} from '../src/utils/eocTaskLifecycle.js'

const oldTask = {
  taskType: 'house',
  locationId: 'mesquite',
  shiftId: 'shift_1',
  dueDate: '2026-08-10',
  status: 'overdue'
}

test('a newer matching EOC cycle marks an overdue task missed', () => {
  const desired = [{ ...oldTask, dueDate: '2026-08-11', status: 'pending' }]
  assert.equal(shouldMarkEocTaskMissed(oldTask, desired), true)
})

test('assignment or task-type changes do not create a false missed record', () => {
  const desired = [{ ...oldTask, taskType: 'van', vanId: 'van_1', dueDate: '2026-08-11' }]
  assert.equal(shouldMarkEocTaskMissed(oldTask, desired), false)
})

test('pending tasks can become missed but completed tasks cannot', () => {
  const desired = [{ ...oldTask, dueDate: '2026-08-11' }]
  assert.equal(shouldMarkEocTaskMissed({ ...oldTask, status: 'pending' }, desired), true)
  assert.equal(shouldMarkEocTaskMissed({ ...oldTask, status: 'completed' }, desired), false)
})

test('van cycle identity includes vehicle', () => {
  const first = getEocCycleScopeKey({ ...oldTask, taskType: 'van', vanId: 'van_1' })
  const second = getEocCycleScopeKey({ ...oldTask, taskType: 'van', vanId: 'van_2' })
  assert.notEqual(first, second)
})

