import { requiredPhotoSatisfied } from './photoModel.js'

export function isEocIssueDetailMissing(itemOrId, answers, issueDetails) {
  const itemId = typeof itemOrId === 'object' ? itemOrId?.id : itemOrId
  if (answers?.[itemId] !== 'repair') return false
  const details = issueDetails?.[itemId] || {}
  if (!String(details.description || '').trim()) return true
  if (typeof itemOrId === 'object' && itemOrId?.requiresPhotoOnIssue === true) {
    return !requiredPhotoSatisfied({
      photos: details.photos,
      unableToTakePhoto: details.unableToTakePhoto,
      unableReason: details.unableReason
    })
  }
  return false
}

export function getEocChecklistProgress(items, answers, issueDetails) {
  const normalizedItems = Array.isArray(items) ? items : []
  let answeredCount = 0
  let completeCount = 0
  let attentionCount = 0

  normalizedItems.forEach((item) => {
    const answer = answers?.[item.id]
    if (answer) answeredCount += 1
    if (answer === 'ok') completeCount += 1
    if (answer === 'repair') attentionCount += 1
  })

  const readyCount = normalizedItems.filter(item => (
    Boolean(answers?.[item.id])
    && !isEocIssueDetailMissing(item, answers, issueDetails)
  )).length

  return {
    totalCount: normalizedItems.length,
    answeredCount,
    readyCount,
    completeCount,
    attentionCount,
    remainingCount: normalizedItems.length - readyCount,
    percent: normalizedItems.length > 0
      ? Math.round((readyCount / normalizedItems.length) * 100)
      : 0
  }
}

export function findFirstIncompleteEocItemIndex(items, answers, issueDetails) {
  const normalizedItems = Array.isArray(items) ? items : []
  return normalizedItems.findIndex(item => (
    !answers?.[item.id]
    || isEocIssueDetailMissing(item, answers, issueDetails)
  ))
}

export function getEocCategoryProgress(items, answers, issueDetails) {
  const groups = new Map()

  ;(Array.isArray(items) ? items : []).forEach((item, index) => {
    const category = String(item?.category || '').trim() || 'Checklist'
    const existing = groups.get(category) || {
      category,
      firstItemIndex: index,
      totalCount: 0,
      readyCount: 0,
      attentionCount: 0
    }
    existing.totalCount += 1
    if (answers?.[item.id] === 'repair') existing.attentionCount += 1
    if (answers?.[item.id] && !isEocIssueDetailMissing(item, answers, issueDetails)) {
      existing.readyCount += 1
    }
    groups.set(category, existing)
  })

  return [...groups.values()]
}

function shortenAreaPart(value) {
  return String(value || '')
    .trim()
    .replace(/\bof (the )?(house|home)\b/gi, '')
    .replace(/\b(areas?|rooms?)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function getEocAreaShortLabel(category, maxLength = 14) {
  const source = String(category || '').trim() || 'Checklist'
  const commaSegment = source.split(',')[0].trim()
  const parts = commaSegment
    .split('/')
    .map(shortenAreaPart)
    .filter(Boolean)

  const firstPart = parts[0] || source
  const combined = parts.length > 1 ? `${firstPart}/${parts[1]}` : firstPart
  const candidate = combined.length <= maxLength ? combined : firstPart

  if (candidate.length <= maxLength) return candidate
  return candidate.slice(0, maxLength).trim()
}

export function isEocAreaComplete(area) {
  return Number(area?.totalCount || 0) > 0
    && Number(area?.readyCount || 0) === Number(area?.totalCount || 0)
}

export function getEocAreaProgress(items, answers, issueDetails) {
  const groups = new Map()

  ;(Array.isArray(items) ? items : []).forEach((item, index) => {
    const category = String(item?.category || '').trim() || 'Checklist'
    const existing = groups.get(category) || {
      category,
      shortLabel: getEocAreaShortLabel(category),
      firstItemIndex: index,
      lastItemIndex: index,
      itemIds: [],
      totalCount: 0,
      readyCount: 0,
      attentionCount: 0
    }

    existing.lastItemIndex = index
    existing.itemIds.push(item.id)
    existing.totalCount += 1
    if (answers?.[item.id] === 'repair') existing.attentionCount += 1
    if (answers?.[item.id] && !isEocIssueDetailMissing(item, answers, issueDetails)) {
      existing.readyCount += 1
    }
    groups.set(category, existing)
  })

  return [...groups.values()].map(area => ({
    ...area,
    percent: area.totalCount > 0 ? Math.round((area.readyCount / area.totalCount) * 100) : 0,
    isComplete: isEocAreaComplete(area)
  }))
}

export function findFirstIncompleteEocAreaIndex(items, answers, issueDetails) {
  return getEocAreaProgress(items, answers, issueDetails)
    .findIndex(area => !isEocAreaComplete(area))
}

export function findNextIncompleteEocAreaIndex(areas, currentAreaIndex = 0) {
  const normalizedAreas = Array.isArray(areas) ? areas : []
  if (normalizedAreas.length === 0) return -1

  for (let offset = 1; offset <= normalizedAreas.length; offset += 1) {
    const index = (currentAreaIndex + offset + normalizedAreas.length) % normalizedAreas.length
    if (!isEocAreaComplete(normalizedAreas[index])) return index
  }

  return -1
}
