export const EOC_TEMPLATE_ITEM_SCHEMA_VERSION = 2

function cleanText(value) {
  return String(value || '').trim()
}

function slug(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 54)
}

function randomSuffix() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function createEocTrackingId(prefix = 'item') {
  return `${slug(prefix) || 'item'}_${randomSuffix()}`
}

export function getEocItemTrackingId(item, index = 0) {
  const explicitId = cleanText(item?.trackingId || item?.id)
  if (explicitId) return explicitId

  const categoryPart = slug(item?.category) || 'category'
  const labelPart = slug(item?.label) || 'item'
  return `legacy_${categoryPart}_${labelPart}_${index + 1}`.slice(0, 120)
}

export function createEmptyEocTemplateItem(order = 1) {
  const trackingId = createEocTrackingId('item')
  return {
    id: trackingId,
    trackingId,
    category: '',
    label: '',
    helpText: '',
    requiresPhotoOnIssue: false,
    order,
    active: true
  }
}

export function normalizeEocTemplateItems(items, { includeIncomplete = false } = {}) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => {
      const trackingId = getEocItemTrackingId(item, index)
      return {
        id: trackingId,
        trackingId,
        category: cleanText(item?.category),
        label: cleanText(item?.label),
        helpText: cleanText(item?.helpText),
        requiresPhotoOnIssue: item?.requiresPhotoOnIssue === true,
        order: Number(item?.order) || (index + 1),
        active: item?.active !== false
      }
    })
    .filter(item => includeIncomplete || (item.category && item.label))
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
}

export function findDuplicateEocTrackingIds(items) {
  const seen = new Set()
  const duplicates = new Set()

  normalizeEocTemplateItems(items, { includeIncomplete: true }).forEach((item) => {
    if (seen.has(item.trackingId)) duplicates.add(item.trackingId)
    seen.add(item.trackingId)
  })

  return [...duplicates]
}
