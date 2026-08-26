import { isShiftAllowedForMainLocation } from '../data/eocConstants.js'
import { locationIdToMainLocation } from './orgModel.js'

export const MISSED_EOC_REASON = 'The next scheduled EOC cycle began without a completed submission.'

function clean(value) {
  return String(value || '').trim().toLowerCase()
}

function toMillis(value) {
  if (!value) return 0
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

export function getEocCycleScopeKey(task) {
  return [
    clean(task?.locationId),
    clean(task?.shiftId),
    clean(task?.taskType || task?.eocType),
    clean(task?.vanId)
  ].join('::')
}

export function isSupportedEocAssignment(assignment) {
  const mainLocation = locationIdToMainLocation(assignment?.locationId)
  return Boolean(mainLocation && isShiftAllowedForMainLocation(mainLocation, assignment?.shiftId))
}

export function shouldMarkEocTaskMissed(task, desiredTasks) {
  if (!['pending', 'overdue'].includes(clean(task?.status))) return false

  const matchingNextTask = (Array.isArray(desiredTasks) ? desiredTasks : [])
    .filter(candidate => getEocCycleScopeKey(candidate) === getEocCycleScopeKey(task))
    .find((candidate) => {
      const currentDueAt = toMillis(task?.dueAt)
      const nextDueAt = toMillis(candidate?.dueAt)
      if (currentDueAt && nextDueAt) return nextDueAt > currentDueAt

      const currentDueDate = clean(task?.dueDate)
      const nextDueDate = clean(candidate?.dueDate)
      return Boolean(currentDueDate && nextDueDate && nextDueDate > currentDueDate)
    })

  return Boolean(matchingNextTask)
}

