export const COLLABORATION_CONFLICT_CODE = 'collaboration-conflict'

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeComparable(value) {
  if (value && typeof value.toDate === 'function') {
    return normalizeComparable(value.toDate())
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (Array.isArray(value)) {
    return value.map(normalizeComparable)
  }
  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = normalizeComparable(value[key])
        return acc
      }, {})
  }
  return value
}

export function valuesEqual(a, b) {
  return JSON.stringify(normalizeComparable(a)) === JSON.stringify(normalizeComparable(b))
}

export function cloneRecord(value) {
  return normalizeComparable(value)
}

export function makeConflictError(conflicts, message = 'This record changed in another session. Review the latest version before saving.') {
  const error = new Error(message)
  error.code = COLLABORATION_CONFLICT_CODE
  error.conflicts = Array.isArray(conflicts) ? conflicts : []
  return error
}

export function isCollaborationConflict(error) {
  return error?.code === COLLABORATION_CONFLICT_CODE
}

export function formatConflictFields(conflicts) {
  const fields = (Array.isArray(conflicts) ? conflicts : [])
    .map(conflict => conflict.label || conflict.field)
    .filter(Boolean)
  return fields.length > 0 ? fields.join(', ') : 'record fields'
}

export function mergeByIdList(originalList, localList, remoteList, options = {}) {
  const idField = options.idField || 'id'
  const label = options.label || 'Item'
  const originalById = new Map((Array.isArray(originalList) ? originalList : []).filter(item => item?.[idField]).map(item => [item[idField], item]))
  const localById = new Map((Array.isArray(localList) ? localList : []).filter(item => item?.[idField]).map(item => [item[idField], item]))
  const remoteById = new Map((Array.isArray(remoteList) ? remoteList : []).filter(item => item?.[idField]).map(item => [item[idField], item]))
  const ids = [...new Set([...originalById.keys(), ...remoteById.keys(), ...localById.keys()])]
  const merged = []
  const conflicts = []
  const autoMerged = []

  ids.forEach(id => {
    const original = originalById.get(id)
    const local = localById.get(id)
    const remote = remoteById.get(id)
    const localChanged = !valuesEqual(original, local)
    const remoteChanged = !valuesEqual(original, remote)

    if (!local && !remote) return
    if (!original) {
      if (local && remote && !valuesEqual(local, remote)) {
        conflicts.push({ field: id, label, localValue: local, remoteValue: remote })
        merged.push(local)
        return
      }
      merged.push(local || remote)
      if (local && remote) autoMerged.push(id)
      return
    }
    if (!local) {
      if (remoteChanged) merged.push(remote)
      return
    }
    if (!remote) {
      if (localChanged) {
        conflicts.push({ field: id, label, localValue: local, remoteValue: null })
        merged.push(local)
      }
      return
    }
    if (!localChanged && remoteChanged) {
      merged.push(remote)
      autoMerged.push(id)
      return
    }
    if (localChanged && !remoteChanged) {
      merged.push(local)
      return
    }
    if (!localChanged && !remoteChanged) {
      merged.push(local)
      return
    }
    if (valuesEqual(local, remote)) {
      merged.push(local)
      return
    }
    conflicts.push({ field: id, label, localValue: local, remoteValue: remote })
    merged.push(local)
  })

  return { merged, conflicts, autoMerged }
}

export function mergeRecordFields(originalRecord, localRecord, remoteRecord, fieldConfigs) {
  const original = originalRecord || {}
  const local = localRecord || {}
  const remote = remoteRecord || {}
  const merged = { ...local }
  const conflicts = []
  const autoMerged = []

  fieldConfigs.forEach(config => {
    const field = typeof config === 'string' ? config : config.field
    const label = typeof config === 'string' ? config : (config.label || config.field)
    if (!field) return

    if (config?.type === 'listById') {
      const result = mergeByIdList(original[field], local[field], remote[field], {
        idField: config.idField || 'id',
        label
      })
      merged[field] = result.merged
      conflicts.push(...result.conflicts.map(conflict => ({ ...conflict, field })))
      if (result.autoMerged.length > 0) autoMerged.push(field)
      return
    }

    const localChanged = !valuesEqual(original[field], local[field])
    const remoteChanged = !valuesEqual(original[field], remote[field])

    if (!localChanged && remoteChanged) {
      merged[field] = remote[field]
      autoMerged.push(field)
      return
    }
    if (localChanged && remoteChanged && !valuesEqual(local[field], remote[field])) {
      conflicts.push({
        field,
        label,
        localValue: local[field],
        remoteValue: remote[field]
      })
    }
  })

  return { merged, conflicts, autoMerged }
}
