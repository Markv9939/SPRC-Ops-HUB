/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from 'react'
import { getShiftLabel } from '../data/eocConstants'

function formatDateTime(value) {
  if (!value) return '--'
  const dateValue = value?.toDate ? value.toDate() : new Date(value)
  if (Number.isNaN(dateValue.getTime())) return '--'
  return dateValue.toLocaleString()
}

function EocTemplateScopeCard({
  location,
  shift,
  houseDefault,
  vanDefault,
  templatesByType,
  preferredTemplateIds,
  canManageTemplates = false,
  isOffline = false,
  onApply
}) {
  const activeHouseTemplates = useMemo(
    () => (Array.isArray(templatesByType?.house) ? templatesByType.house : []),
    [templatesByType]
  )
  const activeVanTemplates = useMemo(
    () => (Array.isArray(templatesByType?.van) ? templatesByType.van : []),
    [templatesByType]
  )

  const [houseTemplateId, setHouseTemplateId] = useState(String(houseDefault?.defaultTemplateId || '').trim())
  const [vanTemplateId, setVanTemplateId] = useState(String(vanDefault?.defaultTemplateId || '').trim())

  useEffect(() => {
    const preferredHouse = String(preferredTemplateIds?.house || '').trim()
    if (preferredHouse && activeHouseTemplates.some(template => template.id === preferredHouse)) {
      setHouseTemplateId(preferredHouse)
      return
    }
    setHouseTemplateId(String(houseDefault?.defaultTemplateId || '').trim())
  }, [activeHouseTemplates, houseDefault?.defaultTemplateId, preferredTemplateIds?.house])

  useEffect(() => {
    const preferredVan = String(preferredTemplateIds?.van || '').trim()
    if (preferredVan && activeVanTemplates.some(template => template.id === preferredVan)) {
      setVanTemplateId(preferredVan)
      return
    }
    setVanTemplateId(String(vanDefault?.defaultTemplateId || '').trim())
  }, [activeVanTemplates, preferredTemplateIds?.van, vanDefault?.defaultTemplateId])

  const selectStyle = {
    width: '100%',
    padding: '7px 10px',
    border: '2px solid rgba(17,47,82,0.18)',
    borderRadius: '7px',
    fontSize: '13px',
    background: '#FFFFFF',
    color: '#1A3553',
    boxSizing: 'border-box'
  }

  const actionButton = {
    padding: '7px 10px',
    border: 'none',
    borderRadius: '7px',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
    backgroundColor: '#CD4E42',
    color: '#FFFFFF'
  }

  return (
    <div
      style={{
        border: '1px solid rgba(17,47,82,0.14)',
        borderRadius: '10px',
        backgroundColor: '#F9FCFF',
        padding: '12px'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#1A3553' }}>
          {location.label} - {getShiftLabel(shift.id)}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '10px' }}>
        <div style={{ border: '1px solid rgba(17,47,82,0.10)', borderRadius: '8px', padding: '10px', backgroundColor: '#FFFFFF' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#1A3553', marginBottom: '6px' }}>House Default</div>
          <select
            value={houseTemplateId}
            onChange={event => setHouseTemplateId(event.target.value)}
            style={selectStyle}
            disabled={!canManageTemplates || isOffline}
          >
            <option value="">Select template</option>
            {activeHouseTemplates.map(template => (
              <option key={template.id} value={template.id}>{template.name}</option>
            ))}
          </select>
          <div style={{ marginTop: '6px', fontSize: '11px', color: '#556677' }}>
            Current: {houseDefault?.defaultTemplateName || '--'}
          </div>
          <div style={{ marginTop: '4px', fontSize: '11px', color: '#6A7788' }}>
            Updated: {formatDateTime(houseDefault?.updatedAt)}
          </div>
          <button
            type="button"
            onClick={() => onApply({
              locationId: location.id,
              shiftId: shift.id,
              eocType: 'house',
              templateId: houseTemplateId
            })}
            style={{ ...actionButton, marginTop: '8px' }}
            disabled={!canManageTemplates || isOffline || !houseTemplateId}
          >
            Apply House Default
          </button>
        </div>

        <div style={{ border: '1px solid rgba(17,47,82,0.10)', borderRadius: '8px', padding: '10px', backgroundColor: '#FFFFFF' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#1A3553', marginBottom: '6px' }}>Van Default</div>
          <select
            value={vanTemplateId}
            onChange={event => setVanTemplateId(event.target.value)}
            style={selectStyle}
            disabled={!canManageTemplates || isOffline}
          >
            <option value="">Select template</option>
            {activeVanTemplates.map(template => (
              <option key={template.id} value={template.id}>{template.name}</option>
            ))}
          </select>
          <div style={{ marginTop: '6px', fontSize: '11px', color: '#556677' }}>
            Current: {vanDefault?.defaultTemplateName || '--'}
          </div>
          <div style={{ marginTop: '4px', fontSize: '11px', color: '#6A7788' }}>
            Updated: {formatDateTime(vanDefault?.updatedAt)}
          </div>
          <button
            type="button"
            onClick={() => onApply({
              locationId: location.id,
              shiftId: shift.id,
              eocType: 'van',
              templateId: vanTemplateId
            })}
            style={{ ...actionButton, marginTop: '8px' }}
            disabled={!canManageTemplates || isOffline || !vanTemplateId}
          >
            Apply Van Default
          </button>
        </div>
      </div>
    </div>
  )
}

export default EocTemplateScopeCard
