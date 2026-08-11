/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from 'react'
import { EOC_HOUSE_TEMPLATE, EOC_VAN_TEMPLATE } from '../data/eocConstants'
import {
  createEmptyEocTemplateItem,
  findDuplicateEocTrackingIds,
  normalizeEocTemplateItems
} from '../utils/eocTemplateModel'

function emptyItem(order = 1) {
  return createEmptyEocTemplateItem(order)
}

function normalizeTemplateItems(items) {
  return normalizeEocTemplateItems(items)
}

function buildInitialForm(initialTemplate) {
  return {
    name: String(initialTemplate?.name || '').trim(),
    eocType: String(initialTemplate?.eocType || 'house').trim() === 'van' ? 'van' : 'house',
    status: String(initialTemplate?.status || 'active').trim() === 'archived' ? 'archived' : 'active',
    items: normalizeTemplateItems(initialTemplate?.items || []).length > 0
      ? normalizeTemplateItems(initialTemplate?.items || [])
      : [emptyItem(1)]
  }
}

function EocTemplateEditorDrawer({
  isOpen,
  isMobile = false,
  initialTemplate,
  isEditing = false,
  canManageTemplates = false,
  isOffline = false,
  onClose,
  onSave
}) {
  const [form, setForm] = useState(() => buildInitialForm(initialTemplate))
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setForm(buildInitialForm(initialTemplate))
    setError('')
  }, [initialTemplate, isOpen])

  const normalizedItems = useMemo(() => normalizeTemplateItems(form.items), [form.items])

  if (!isOpen) return null

  const isDisabled = !canManageTemplates || isOffline

  const setPreset = (type) => {
    const preset = type === 'van' ? EOC_VAN_TEMPLATE : EOC_HOUSE_TEMPLATE
    setForm(previous => ({
      ...previous,
      eocType: type,
      items: normalizeTemplateItems(preset)
    }))
  }

  const handleSave = async (assignNow) => {
    setError('')
    const normalizedName = String(form.name || '').trim()
    if (!normalizedName) {
      setError('Template name is required.')
      return
    }
    if (normalizedItems.length === 0) {
      setError('Add at least one valid item before saving.')
      return
    }
    if (findDuplicateEocTrackingIds(normalizedItems).length > 0) {
      setError('Two checklist items have the same permanent tracking ID. Remove and recreate one of the duplicate items.')
      return
    }
    await onSave({
      name: normalizedName,
      eocType: form.eocType,
      status: form.status,
      items: normalizedItems
    }, { assignNow })
  }

  const overlayStyle = {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(7, 20, 36, 0.48)',
    display: 'flex',
    justifyContent: isMobile ? 'center' : 'flex-end',
    alignItems: 'stretch',
    zIndex: 1200,
    padding: isMobile ? '8px' : '0'
  }

  const panelStyle = {
    width: isMobile ? '100%' : 'min(860px, 74vw)',
    maxWidth: '100%',
    height: isMobile ? '100%' : '100vh',
    backgroundColor: '#FFFFFF',
    borderLeft: isMobile ? 'none' : '1px solid rgba(17,47,82,0.16)',
    borderRadius: isMobile ? '12px' : '0',
    boxShadow: isMobile ? '0 16px 44px rgba(13,38,64,0.30)' : '-12px 0 28px rgba(13,38,64,0.22)',
    display: 'flex',
    flexDirection: 'column'
  }

  const headerStyle = {
    padding: '14px 16px 10px 16px',
    borderBottom: '1px solid rgba(17,47,82,0.10)',
    backgroundColor: '#F7FAFD'
  }

  const inputStyle = {
    width: '100%',
    padding: '8px 10px',
    border: '2px solid rgba(17,47,82,0.18)',
    borderRadius: '7px',
    fontSize: '13px',
    boxSizing: 'border-box'
  }

  const selectStyle = {
    ...inputStyle,
    backgroundColor: '#FFFFFF'
  }

  const actionButton = {
    padding: '8px 12px',
    borderRadius: '7px',
    border: 'none',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    backgroundColor: 'rgba(17,47,82,0.10)',
    color: '#1A3553'
  }

  return (
    <div style={overlayStyle} role="presentation" onClick={onClose}>
      <div style={panelStyle} role="dialog" aria-modal="true" onClick={event => event.stopPropagation()}>
        <div style={headerStyle}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#1A3553', marginBottom: '4px' }}>
            {isEditing ? 'Edit Template' : 'New Template'}
          </div>
          <div style={{ fontSize: '12px', color: '#556677' }}>
            Build template items in one place, then save and assign.
          </div>
        </div>

        <div style={{ padding: '14px 16px', overflowY: 'auto', flex: 1 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px', marginBottom: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', color: '#556677', display: 'block', marginBottom: '4px' }}>Template Name</label>
              <input
                value={form.name}
                onChange={event => setForm({ ...form, name: event.target.value })}
                style={inputStyle}
                placeholder="RES Night Safety"
                disabled={isDisabled}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: '#556677', display: 'block', marginBottom: '4px' }}>EOC Type</label>
              <select
                value={form.eocType}
                onChange={event => setForm({ ...form, eocType: event.target.value })}
                style={selectStyle}
                disabled={isDisabled || isEditing}
              >
                <option value="house">House</option>
                <option value="van">Van</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', color: '#556677', display: 'block', marginBottom: '4px' }}>Status</label>
              <select
                value={form.status}
                onChange={event => setForm({ ...form, status: event.target.value })}
                style={selectStyle}
                disabled={isDisabled}
              >
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
            <button type="button" onClick={() => setPreset('house')} style={actionButton} disabled={isDisabled}>Load Standard House</button>
            <button type="button" onClick={() => setPreset('van')} style={actionButton} disabled={isDisabled}>Load Standard Van</button>
            <button
              type="button"
              onClick={() => setForm(previous => ({
                ...previous,
                items: [...previous.items, emptyItem(previous.items.length + 1)]
              }))}
              style={actionButton}
              disabled={isDisabled}
            >
              Add Item
            </button>
          </div>

          <div style={{ fontSize: '12px', color: '#556677', marginBottom: '8px' }}>
            Items: {normalizedItems.length}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {form.items.map((item, index) => (
              <div
                key={item.trackingId || item.id || `template-item-${index}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile ? '1fr' : '1fr 1.6fr 1.35fr 72px 102px 118px 60px 60px 74px',
                  gap: '8px',
                  alignItems: 'center',
                  padding: '8px',
                  border: '1px solid rgba(17,47,82,0.12)',
                  borderRadius: '8px',
                  backgroundColor: '#F8FBFF'
                }}
              >
                <input
                  value={item.category}
                  onChange={event => {
                    const nextItems = [...form.items]
                    nextItems[index] = { ...nextItems[index], category: event.target.value }
                    setForm({ ...form, items: nextItems })
                  }}
                  style={inputStyle}
                  placeholder="Category"
                  disabled={isDisabled}
                />
                <input
                  value={item.label}
                  onChange={event => {
                    const nextItems = [...form.items]
                    nextItems[index] = { ...nextItems[index], label: event.target.value }
                    setForm({ ...form, items: nextItems })
                  }}
                  style={inputStyle}
                  placeholder="Checklist item"
                  disabled={isDisabled}
                />
                <input
                  value={item.helpText || ''}
                  onChange={event => {
                    const nextItems = [...form.items]
                    nextItems[index] = { ...nextItems[index], helpText: event.target.value }
                    setForm({ ...form, items: nextItems })
                  }}
                  style={inputStyle}
                  placeholder="Optional staff guidance"
                  disabled={isDisabled}
                />
                <input
                  type="number"
                  value={item.order}
                  onChange={event => {
                    const nextItems = [...form.items]
                    nextItems[index] = { ...nextItems[index], order: event.target.value }
                    setForm({ ...form, items: nextItems })
                  }}
                  style={inputStyle}
                  disabled={isDisabled}
                />
                <select
                  value={item.requiresPhotoOnIssue ? 'required' : 'optional'}
                  onChange={event => {
                    const nextItems = [...form.items]
                    nextItems[index] = { ...nextItems[index], requiresPhotoOnIssue: event.target.value === 'required' }
                    setForm({ ...form, items: nextItems })
                  }}
                  style={selectStyle}
                  disabled={isDisabled}
                  aria-label={`Photo requirement for ${item.label || `item ${index + 1}`}`}
                >
                  <option value="optional">Photo optional</option>
                  <option value="required">Photo required</option>
                </select>
                <select
                  value={item.active ? 'true' : 'false'}
                  onChange={event => {
                    const nextItems = [...form.items]
                    nextItems[index] = { ...nextItems[index], active: event.target.value === 'true' }
                    setForm({ ...form, items: nextItems })
                  }}
                  style={selectStyle}
                  disabled={isDisabled}
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
                <button
                  type="button"
                  onClick={() => {
                    if (index === 0) return
                    const nextItems = [...form.items]
                    const previousItem = nextItems[index - 1]
                    nextItems[index - 1] = nextItems[index]
                    nextItems[index] = previousItem
                    setForm({ ...form, items: nextItems })
                  }}
                  style={actionButton}
                  disabled={isDisabled || index === 0}
                >
                  Up
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (index >= form.items.length - 1) return
                    const nextItems = [...form.items]
                    const nextItem = nextItems[index + 1]
                    nextItems[index + 1] = nextItems[index]
                    nextItems[index] = nextItem
                    setForm({ ...form, items: nextItems })
                  }}
                  style={actionButton}
                  disabled={isDisabled || index >= form.items.length - 1}
                >
                  Down
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const nextItems = form.items.filter((_, itemIndex) => itemIndex !== index)
                    setForm({ ...form, items: nextItems.length > 0 ? nextItems : [emptyItem(1)] })
                  }}
                  style={actionButton}
                  disabled={isDisabled}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          {error && (
            <div style={{ marginTop: '12px', fontSize: '12px', color: '#B24B3E' }}>
              {error}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(17,47,82,0.10)', display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={actionButton}>Cancel</button>
          <button
            type="button"
            onClick={() => handleSave(false)}
            style={{ ...actionButton, backgroundColor: '#CD4E42', color: '#FFFFFF' }}
            disabled={isDisabled}
          >
            {isEditing ? 'Save Template' : 'Create Template'}
          </button>
          <button
            type="button"
            onClick={() => handleSave(true)}
            style={{ ...actionButton, backgroundColor: '#153E66', color: '#FFFFFF' }}
            disabled={isDisabled}
          >
            Save & Assign
          </button>
        </div>
      </div>
    </div>
  )
}

export default EocTemplateEditorDrawer
