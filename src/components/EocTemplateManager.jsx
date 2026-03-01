/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { LOCATIONS, SHIFTS, isShiftAllowedForMainLocation } from '../data/eocConstants'
import { getAvailableMainLocationsForUser, isAdminRole, locationIdToMainLocation } from '../utils/orgModel'
import {
  assignDefaultTemplateForScope,
  deleteTemplateAndReassignScopes,
  getTemplateAssignmentMapKey,
  previewDefaultAssignmentImpact
} from '../services/eocTemplateService'
import { notifySuccess } from '../utils/toast'
import { showConfirmDialog } from '../utils/dialogs'
import AppModal from './AppModal'
import EocTemplateEditorDrawer from './EocTemplateEditorDrawer'
import EocTemplateScopeCard from './EocTemplateScopeCard'

function toMillis(value) {
  if (!value) return 0
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (typeof value?.seconds === 'number') return value.seconds * 1000
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeTemplateItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      category: String(item?.category || '').trim(),
      label: String(item?.label || '').trim(),
      order: Number(item?.order) || index + 1,
      active: item?.active !== false
    }))
    .filter(item => item.category && item.label)
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
}

function sortByUpdated(items) {
  return [...items].sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt))
}

function isOwnedByUser(user, template) {
  if (!template) return false
  const authUid = String(user?.authUid || '').trim()
  const userId = String(user?.id || '').trim()
  if (authUid && String(template.ownerAuthUid || '').trim() === authUid) return true
  if (userId && String(template.ownerUserId || '').trim() === userId) return true
  return false
}

function canEditTemplate(user, template) {
  if (isAdminRole(user?.role)) return true
  return isOwnedByUser(user, template)
}

function locationLabel(locationId) {
  return LOCATIONS.find(location => location.id === locationId)?.label || locationId
}

function matchesTemplateSearch(template, searchValue) {
  const normalizedSearch = String(searchValue || '').trim().toLowerCase()
  if (!normalizedSearch) return true
  const name = String(template?.name || '').toLowerCase()
  const owner = String(template?.ownerName || '').toLowerCase()
  const itemMatch = (Array.isArray(template?.items) ? template.items : []).some(item => (
    String(item?.category || '').toLowerCase().includes(normalizedSearch)
    || String(item?.label || '').toLowerCase().includes(normalizedSearch)
  ))
  return name.includes(normalizedSearch) || owner.includes(normalizedSearch) || itemMatch
}

function EocTemplateManager({ user, isOffline = false }) {
  const [templates, setTemplates] = useState([])
  const [assignments, setAssignments] = useState([])
  const [loadingTemplates, setLoadingTemplates] = useState(true)
  const [loadingAssignments, setLoadingAssignments] = useState(true)
  const [templatesError, setTemplatesError] = useState('')
  const [assignmentsError, setAssignmentsError] = useState('')

  const [activeView, setActiveView] = useState('library')
  const [searchValue, setSearchValue] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [ownerFilter, setOwnerFilter] = useState('all')

  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [editorTemplate, setEditorTemplate] = useState(null)
  const [smartTemplate, setSmartTemplate] = useState(null)

  const [preferredTemplateIds, setPreferredTemplateIds] = useState({ house: '', van: '' })
  const [quickAssign, setQuickAssign] = useState({
    locationId: '',
    shiftId: '',
    eocType: 'house',
    templateId: ''
  })

  const [deleteModal, setDeleteModal] = useState({
    isOpen: false,
    template: null,
    replacementId: '',
    options: [],
    impactedCount: 0,
    isWorking: false
  })

  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 900 : false))

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 900)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const isAdmin = isAdminRole(user?.role)
  const canManageTemplates = isAdmin || user?.role === 'supervisor'

  const availableMainLocations = useMemo(() => {
    const values = getAvailableMainLocationsForUser(user)
    return new Set(values)
  }, [user])

  const scopedLocations = useMemo(() => {
    if (isAdmin) return LOCATIONS
    return LOCATIONS.filter(location => availableMainLocations.has(locationIdToMainLocation(location.id)))
  }, [availableMainLocations, isAdmin])

  const allowedLocationIds = useMemo(
    () => new Set(scopedLocations.map(location => String(location.id || '').trim().toLowerCase())),
    [scopedLocations]
  )

  useEffect(() => {
    setLoadingTemplates(true)
    setTemplatesError('')
    const unsubscribe = onSnapshot(
      collection(db, 'eocTemplateLibrary'),
      (snapshot) => {
        setTemplates(snapshot.docs.map(templateDoc => ({ id: templateDoc.id, ...templateDoc.data() })))
        setLoadingTemplates(false)
      },
      (error) => {
        console.error('Error loading template library:', error)
        setTemplatesError(`Unable to load template library (${error.code || 'unknown-error'}).`)
        setLoadingTemplates(false)
      }
    )
    return unsubscribe
  }, [])

  useEffect(() => {
    setLoadingAssignments(true)
    setAssignmentsError('')
    const unsubscribe = onSnapshot(
      collection(db, 'eocTemplateAssignments'),
      (snapshot) => {
        const nextAssignments = snapshot.docs
          .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
          .filter(item => (isAdmin ? true : allowedLocationIds.has(String(item.locationId || '').trim().toLowerCase())))
        setAssignments(nextAssignments)
        setLoadingAssignments(false)
      },
      (error) => {
        console.error('Error loading template assignments:', error)
        setAssignmentsError(`Unable to load assignments (${error.code || 'unknown-error'}).`)
        setLoadingAssignments(false)
      }
    )
    return unsubscribe
  }, [allowedLocationIds, isAdmin])

  const templatesSorted = useMemo(() => sortByUpdated(templates), [templates])
  const activeTemplates = useMemo(
    () => templatesSorted.filter(template => String(template.status || '').trim() !== 'archived'),
    [templatesSorted]
  )

  const filteredTemplates = useMemo(() => (
    templatesSorted.filter((template) => {
      if (typeFilter !== 'all' && String(template.eocType || '').trim() !== typeFilter) return false
      if (statusFilter !== 'all' && String(template.status || '').trim() !== statusFilter) return false
      if (ownerFilter === 'mine' && !isOwnedByUser(user, template)) return false
      if (ownerFilter === 'shared' && isOwnedByUser(user, template)) return false
      return matchesTemplateSearch(template, searchValue)
    })
  ), [ownerFilter, searchValue, statusFilter, templatesSorted, typeFilter, user])

  const myTemplates = useMemo(
    () => filteredTemplates.filter(template => isOwnedByUser(user, template)),
    [filteredTemplates, user]
  )
  const sharedTemplates = useMemo(
    () => filteredTemplates.filter(template => !isOwnedByUser(user, template)),
    [filteredTemplates, user]
  )

  const templatesByType = useMemo(() => ({
    house: activeTemplates.filter(template => String(template.eocType || '').trim() === 'house'),
    van: activeTemplates.filter(template => String(template.eocType || '').trim() === 'van')
  }), [activeTemplates])

  const assignmentMap = useMemo(() => {
    const mapped = new Map()
    assignments.forEach((assignment) => {
      const key = getTemplateAssignmentMapKey(assignment.locationId, assignment.shiftId, assignment.eocType)
      mapped.set(key, assignment)
    })
    return mapped
  }, [assignments])

  const scopes = useMemo(() => {
    const rows = []
    scopedLocations.forEach((location) => {
      const mainLocation = locationIdToMainLocation(location.id)
      const shifts = SHIFTS.filter(shift => isShiftAllowedForMainLocation(mainLocation, shift.id))
      shifts.forEach((shift) => rows.push({ location, shift }))
    })
    return rows
  }, [scopedLocations])

  const quickShiftOptions = useMemo(() => {
    if (!quickAssign.locationId) return []
    const mainLocation = locationIdToMainLocation(quickAssign.locationId)
    return SHIFTS.filter(shift => isShiftAllowedForMainLocation(mainLocation, shift.id))
  }, [quickAssign.locationId])

  const quickTemplateOptions = useMemo(
    () => (quickAssign.eocType === 'van' ? templatesByType.van : templatesByType.house),
    [quickAssign.eocType, templatesByType.house, templatesByType.van]
  )

  useEffect(() => {
    setQuickAssign((previous) => {
      const normalizedLocation = String(previous.locationId || '').trim().toLowerCase()
      if (normalizedLocation && allowedLocationIds.has(normalizedLocation)) return previous
      return { ...previous, locationId: scopedLocations[0]?.id || '', shiftId: '' }
    })
  }, [allowedLocationIds, scopedLocations])

  useEffect(() => {
    setQuickAssign((previous) => {
      if (!previous.locationId) return previous
      const validShifts = new Set(
        SHIFTS
          .filter(shift => isShiftAllowedForMainLocation(locationIdToMainLocation(previous.locationId), shift.id))
          .map(shift => shift.id)
      )
      if (!previous.shiftId || validShifts.has(previous.shiftId)) return previous
      return { ...previous, shiftId: '' }
    })
  }, [quickAssign.locationId])

  useEffect(() => {
    setQuickAssign((previous) => {
      if (!previous.templateId) return previous
      const isStillValid = quickTemplateOptions.some(template => template.id === previous.templateId)
      if (isStillValid) return previous
      return { ...previous, templateId: '' }
    })
  }, [quickTemplateOptions])

  const openNewTemplate = () => {
    setEditorTemplate({ name: '', eocType: 'house', status: 'active', items: [] })
    setIsEditorOpen(true)
  }

  const openEditTemplate = (template) => {
    if (!canEditTemplate(user, template)) return
    setEditorTemplate(template)
    setIsEditorOpen(true)
  }

  const handleSaveTemplate = async (payload, options = { assignNow: false }) => {
    if (!canManageTemplates) {
      alert('You do not have permission to manage templates.')
      return
    }
    if (isOffline) {
      alert('Offline mode: template changes are unavailable until you reconnect.')
      return
    }

    const normalizedItems = normalizeTemplateItems(payload.items)
    if (!payload.name || !String(payload.name || '').trim()) {
      alert('Template name is required.')
      return
    }
    if (normalizedItems.length === 0) {
      alert('Add at least one valid template item.')
      return
    }

    try {
      let templateId = String(editorTemplate?.id || '').trim()
      if (templateId) {
        const existingTemplate = templates.find(template => template.id === templateId)
        if (!existingTemplate) {
          alert('Template no longer exists. Refresh and try again.')
          return
        }
        if (!canEditTemplate(user, existingTemplate)) {
          alert('You can only edit your own templates. Clone this template to customize it.')
          return
        }

        await updateDoc(doc(db, 'eocTemplateLibrary', templateId), {
          name: String(payload.name || '').trim(),
          eocType: payload.eocType,
          status: payload.status,
          items: normalizedItems,
          updatedByUserId: user?.id || null,
          updatedByName: user?.name || null,
          updatedByAuthUid: user?.authUid || null,
          updatedAt: serverTimestamp(),
          version: Number(existingTemplate.version || 0) + 1
        })
        notifySuccess('Template updated')
      } else {
        const created = await addDoc(collection(db, 'eocTemplateLibrary'), {
          name: String(payload.name || '').trim(),
          eocType: payload.eocType,
          status: payload.status,
          items: normalizedItems,
          ownerUserId: user?.id || null,
          ownerName: user?.name || null,
          ownerAuthUid: user?.authUid || null,
          ownerRole: user?.role || null,
          createdByUserId: user?.id || null,
          createdByName: user?.name || null,
          createdByAuthUid: user?.authUid || null,
          updatedByUserId: user?.id || null,
          updatedByName: user?.name || null,
          updatedByAuthUid: user?.authUid || null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          version: 1
        })
        templateId = created.id
        notifySuccess('Template saved to library')
      }

      const savedTemplate = {
        id: templateId,
        name: String(payload.name || '').trim(),
        eocType: payload.eocType
      }
      setSmartTemplate(savedTemplate)
      setPreferredTemplateIds(previous => ({ ...previous, [savedTemplate.eocType]: savedTemplate.id }))
      setIsEditorOpen(false)

      if (options?.assignNow) {
        setActiveView('assignments')
        setQuickAssign((previous) => ({ ...previous, eocType: savedTemplate.eocType, templateId: savedTemplate.id }))
      }
    } catch (error) {
      console.error('Error saving template:', error)
      alert('Failed to save template.')
    }
  }

  const handleCloneTemplate = async (template) => {
    if (!canManageTemplates) {
      alert('You do not have permission to clone templates.')
      return
    }
    if (isOffline) {
      alert('Offline mode: cloning templates is unavailable.')
      return
    }

    try {
      const cloneName = `${String(template.name || 'Template').trim()} (Copy)`
      const cloneType = String(template.eocType || 'house').trim() === 'van' ? 'van' : 'house'
      const created = await addDoc(collection(db, 'eocTemplateLibrary'), {
        name: cloneName,
        eocType: cloneType,
        status: 'active',
        items: normalizeTemplateItems(template.items),
        ownerUserId: user?.id || null,
        ownerName: user?.name || null,
        ownerAuthUid: user?.authUid || null,
        ownerRole: user?.role || null,
        createdByUserId: user?.id || null,
        createdByName: user?.name || null,
        createdByAuthUid: user?.authUid || null,
        updatedByUserId: user?.id || null,
        updatedByName: user?.name || null,
        updatedByAuthUid: user?.authUid || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        version: 1,
        clonedFromTemplateId: template.id,
        clonedFromTemplateName: template.name || ''
      })
      setSmartTemplate({ id: created.id, name: cloneName, eocType: cloneType })
      notifySuccess('Template copied. Open it in My Templates to edit.')
    } catch (error) {
      console.error('Error cloning template:', error)
      alert('Failed to clone template.')
    }
  }

  const handleOpenAssignForTemplate = (template) => {
    const resolvedType = String(template.eocType || 'house').trim() === 'van' ? 'van' : 'house'
    setActiveView('assignments')
    setQuickAssign((previous) => ({ ...previous, eocType: resolvedType, templateId: template.id }))
    setPreferredTemplateIds(previous => ({ ...previous, [resolvedType]: template.id }))
  }

  const handleDeleteTemplate = async (template) => {
    if (!isAdmin) {
      alert('Only admins can delete templates.')
      return
    }
    if (isOffline) {
      alert('Offline mode: deleting templates is unavailable.')
      return
    }

    const impactedAssignments = assignments.filter(assignment => assignment.defaultTemplateId === template.id)
    if (impactedAssignments.length === 0) {
      const confirmed = await showConfirmDialog(`Delete template "${template.name}"?`, {
        title: 'Delete Template',
        tone: 'danger',
        confirmText: 'Delete'
      })
      if (!confirmed) return
      await deleteDoc(doc(db, 'eocTemplateLibrary', template.id))
      notifySuccess('Template deleted')
      return
    }

    const replacementOptions = activeTemplates.filter((candidate) => (
      candidate.id !== template.id
      && String(candidate.eocType || '').trim() === String(template.eocType || '').trim()
    ))

    if (replacementOptions.length === 0) {
      alert('Delete blocked: this template is assigned and no replacement template is available for this type.')
      return
    }

    setDeleteModal({
      isOpen: true,
      template,
      replacementId: replacementOptions[0].id,
      options: replacementOptions,
      impactedCount: impactedAssignments.length,
      isWorking: false
    })
  }

  const closeDeleteModal = () => {
    setDeleteModal({
      isOpen: false,
      template: null,
      replacementId: '',
      options: [],
      impactedCount: 0,
      isWorking: false
    })
  }

  const confirmDeleteWithReplacement = async () => {
    if (!deleteModal.template || !deleteModal.replacementId) return
    const replacementTemplate = deleteModal.options.find(option => option.id === deleteModal.replacementId)
    if (!replacementTemplate) {
      alert('Select a replacement template before deleting.')
      return
    }

    try {
      setDeleteModal(previous => ({ ...previous, isWorking: true }))
      const result = await deleteTemplateAndReassignScopes({
        actor: user,
        templateId: deleteModal.template.id,
        replacementTemplate
      })
      notifySuccess(`Template deleted. ${result.reassignedScopeCount} scope(s) reassigned.`)
      closeDeleteModal()
    } catch (error) {
      console.error('Error deleting template:', error)
      alert('Failed to delete template.')
      setDeleteModal(previous => ({ ...previous, isWorking: false }))
    }
  }

  const applyDefaultForScope = async ({ locationId, shiftId, eocType, templateId }) => {
    if (!canManageTemplates) {
      alert('You do not have permission to assign defaults.')
      return
    }
    if (isOffline) {
      alert('Offline mode: default assignment is unavailable.')
      return
    }

    const selectedTemplate = activeTemplates.find(template => template.id === templateId)
    if (!locationId || !shiftId || !templateId || !selectedTemplate) {
      alert('Location, shift, and template are required.')
      return
    }

    try {
      const impact = await previewDefaultAssignmentImpact({
        locationId,
        shiftId,
        eocType,
        templateId: selectedTemplate.id,
        templateName: selectedTemplate.name || ''
      })

      const confirmed = await showConfirmDialog(
        [
          `Set ${selectedTemplate.name} as the default ${String(eocType || '').toUpperCase()} template?`,
          '',
          `Location: ${locationLabel(locationId)}`,
          `Shift: ${shiftId}`,
          '',
          `Incomplete EOCs impacted: ${impact.totalCount}`,
          `- Pending: ${impact.pendingCount}`,
          `- Overdue: ${impact.overdueCount}`
        ].join('\n'),
        {
          title: 'Apply Default Template',
          tone: 'warning',
          confirmText: 'Apply'
        }
      )
      if (!confirmed) return

      const result = await assignDefaultTemplateForScope({
        actor: user,
        locationId,
        shiftId,
        eocType,
        templateId: selectedTemplate.id,
        templateName: selectedTemplate.name || ''
      })
      notifySuccess(`Default updated. ${result.updatedTasks} incomplete EOC task(s) switched immediately.`)
      setPreferredTemplateIds(previous => ({ ...previous, [eocType]: selectedTemplate.id }))
    } catch (error) {
      console.error('Error assigning default template:', error)
      alert('Failed to assign default template.')
    }
  }

  const sectionCardStyle = {
    border: '1px solid rgba(17,47,82,0.16)',
    borderRadius: '12px',
    padding: '14px',
    backgroundColor: 'rgba(17,47,82,0.06)',
    marginBottom: '14px'
  }

  const filterInputStyle = {
    padding: '8px 10px',
    border: '2px solid rgba(17,47,82,0.18)',
    borderRadius: '7px',
    fontSize: '13px',
    color: '#1A3553',
    boxSizing: 'border-box',
    backgroundColor: '#FFFFFF'
  }

  const subtleButton = {
    padding: '8px 12px',
    backgroundColor: 'rgba(17,47,82,0.12)',
    color: '#1A3553',
    border: 'none',
    borderRadius: '7px',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer'
  }

  const primaryButton = {
    ...subtleButton,
    backgroundColor: '#CD4E42',
    color: '#FFFFFF'
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setActiveView('library')}
          style={{ ...subtleButton, backgroundColor: activeView === 'library' ? '#CD4E42' : subtleButton.backgroundColor, color: activeView === 'library' ? '#FFFFFF' : subtleButton.color }}
        >
          Library
        </button>
        <button
          type="button"
          onClick={() => setActiveView('assignments')}
          style={{ ...subtleButton, backgroundColor: activeView === 'assignments' ? '#CD4E42' : subtleButton.backgroundColor, color: activeView === 'assignments' ? '#FFFFFF' : subtleButton.color }}
        >
          Assignments
        </button>
      </div>

      {activeView === 'library' && (
        <>
          <p style={{ fontSize: '13px', color: '#556677', marginBottom: '12px' }}>
            Manage template library in one place. Use clone to customize shared templates without changing anyone else&apos;s template.
          </p>

          <div style={sectionCardStyle}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) repeat(3, minmax(150px, 0.5fr)) auto', gap: '8px', alignItems: 'center' }}>
              <input
                value={searchValue}
                onChange={event => setSearchValue(event.target.value)}
                style={filterInputStyle}
                placeholder="Search templates, owner, or item text"
              />
              <select value={typeFilter} onChange={event => setTypeFilter(event.target.value)} style={filterInputStyle}>
                <option value="all">All types</option>
                <option value="house">House</option>
                <option value="van">Van</option>
              </select>
              <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} style={filterInputStyle}>
                <option value="all">All status</option>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
              <select value={ownerFilter} onChange={event => setOwnerFilter(event.target.value)} style={filterInputStyle}>
                <option value="all">All owners</option>
                <option value="mine">Mine</option>
                <option value="shared">Shared</option>
              </select>
              <button type="button" onClick={openNewTemplate} style={primaryButton} disabled={!canManageTemplates || isOffline}>New Template</button>
            </div>
          </div>

          {smartTemplate && (
            <div style={{ ...sectionCardStyle, backgroundColor: 'rgba(205,78,66,0.08)' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#1A3553', marginBottom: '6px' }}>
                Saved: {smartTemplate.name}
              </div>
              <div style={{ fontSize: '12px', color: '#556677', marginBottom: '8px' }}>
                Next step: assign this template to location + shift defaults.
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button type="button" style={primaryButton} onClick={() => handleOpenAssignForTemplate(smartTemplate)}>Assign This Template</button>
                <button type="button" style={subtleButton} onClick={() => setSmartTemplate(null)}>Dismiss</button>
              </div>
            </div>
          )}

          <div style={sectionCardStyle}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#1A3553' }}>My Templates ({myTemplates.length})</h4>
            {loadingTemplates ? (
              <div style={{ fontSize: '13px', color: '#556677' }}>Loading templates...</div>
            ) : templatesError ? (
              <div style={{ fontSize: '13px', color: '#B75E54' }}>{templatesError}</div>
            ) : myTemplates.length === 0 ? (
              <div style={{ fontSize: '13px', color: '#556677' }}>No personal templates match your filters.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {myTemplates.map((template) => {
                  const assignedCount = assignments.filter(assignment => assignment.defaultTemplateId === template.id).length
                  return (
                    <div key={template.id} style={{ border: '1px solid rgba(17,47,82,0.14)', borderRadius: '10px', padding: '10px', backgroundColor: '#FFFFFF' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: 700, color: '#1A3553' }}>
                            {template.name} ({String(template.eocType || '').toUpperCase()})
                          </div>
                          <div style={{ fontSize: '12px', color: '#556677' }}>
                            Items: {Array.isArray(template.items) ? template.items.length : 0} | Status: {template.status || 'active'}
                            {assignedCount > 0 ? ` | Default in ${assignedCount} scope(s)` : ''}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          <button type="button" style={subtleButton} onClick={() => openEditTemplate(template)} disabled={!canManageTemplates || isOffline}>Edit</button>
                          <button type="button" style={subtleButton} onClick={() => handleCloneTemplate(template)} disabled={!canManageTemplates || isOffline}>Clone</button>
                          <button type="button" style={subtleButton} onClick={() => handleOpenAssignForTemplate(template)} disabled={!canManageTemplates || isOffline}>Assign</button>
                          <button type="button" style={subtleButton} onClick={() => handleDeleteTemplate(template)} disabled={!isAdmin || isOffline}>Delete</button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div style={sectionCardStyle}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#1A3553' }}>Shared Templates ({sharedTemplates.length})</h4>
            {loadingTemplates ? (
              <div style={{ fontSize: '13px', color: '#556677' }}>Loading templates...</div>
            ) : templatesError ? (
              <div style={{ fontSize: '13px', color: '#B75E54' }}>{templatesError}</div>
            ) : sharedTemplates.length === 0 ? (
              <div style={{ fontSize: '13px', color: '#556677' }}>No shared templates match your filters.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {sharedTemplates.map((template) => (
                  <div key={template.id} style={{ border: '1px solid rgba(17,47,82,0.14)', borderRadius: '10px', padding: '10px', backgroundColor: '#FFFFFF' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontSize: '14px', fontWeight: 700, color: '#1A3553' }}>
                          {template.name} ({String(template.eocType || '').toUpperCase()})
                        </div>
                        <div style={{ fontSize: '12px', color: '#556677' }}>
                          Owner: {template.ownerName || '--'} | Items: {Array.isArray(template.items) ? template.items.length : 0}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <button type="button" style={subtleButton} onClick={() => handleCloneTemplate(template)} disabled={!canManageTemplates || isOffline}>Clone</button>
                        <button type="button" style={subtleButton} onClick={() => handleOpenAssignForTemplate(template)} disabled={!canManageTemplates || isOffline}>Assign</button>
                        <button type="button" style={subtleButton} onClick={() => openEditTemplate(template)} disabled={!isAdmin || isOffline}>Edit</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {activeView === 'assignments' && (
        <>
          <p style={{ fontSize: '13px', color: '#556677', marginBottom: '12px' }}>
            Choose defaults by location + shift. Changes apply immediately to incomplete EOCs after one confirmation.
          </p>

          <div style={sectionCardStyle}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#1A3553' }}>Quick Assign</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px', alignItems: 'center' }}>
              <select value={quickAssign.locationId} onChange={event => setQuickAssign({ ...quickAssign, locationId: event.target.value, shiftId: '' })} style={filterInputStyle} disabled={isOffline || scopedLocations.length === 0}>
                <option value="">Select location</option>
                {scopedLocations.map(location => (
                  <option key={location.id} value={location.id}>{location.label}</option>
                ))}
              </select>
              <select value={quickAssign.shiftId} onChange={event => setQuickAssign({ ...quickAssign, shiftId: event.target.value })} style={filterInputStyle} disabled={isOffline || !quickAssign.locationId}>
                <option value="">Select shift</option>
                {quickShiftOptions.map(shift => (
                  <option key={shift.id} value={shift.id}>{shift.label}</option>
                ))}
              </select>
              <select value={quickAssign.eocType} onChange={event => setQuickAssign({ ...quickAssign, eocType: event.target.value, templateId: '' })} style={filterInputStyle} disabled={isOffline}>
                <option value="house">House</option>
                <option value="van">Van</option>
              </select>
              <select value={quickAssign.templateId} onChange={event => setQuickAssign({ ...quickAssign, templateId: event.target.value })} style={filterInputStyle} disabled={isOffline}>
                <option value="">Select template</option>
                {quickTemplateOptions.map(template => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
              <button type="button" onClick={() => applyDefaultForScope(quickAssign)} style={primaryButton} disabled={!canManageTemplates || isOffline || !quickAssign.locationId || !quickAssign.shiftId || !quickAssign.templateId}>
                Apply Default
              </button>
            </div>
          </div>

          <div style={sectionCardStyle}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#1A3553' }}>Scope Cards</h4>
            {loadingAssignments ? (
              <div style={{ fontSize: '13px', color: '#556677' }}>Loading assignments...</div>
            ) : assignmentsError ? (
              <div style={{ fontSize: '13px', color: '#B75E54' }}>{assignmentsError}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {scopes.map(({ location, shift }) => {
                  const houseDefault = assignmentMap.get(getTemplateAssignmentMapKey(location.id, shift.id, 'house')) || null
                  const vanDefault = assignmentMap.get(getTemplateAssignmentMapKey(location.id, shift.id, 'van')) || null
                  return (
                    <EocTemplateScopeCard
                      key={`${location.id}::${shift.id}`}
                      location={location}
                      shift={shift}
                      houseDefault={houseDefault}
                      vanDefault={vanDefault}
                      templatesByType={templatesByType}
                      preferredTemplateIds={preferredTemplateIds}
                      canManageTemplates={canManageTemplates}
                      isOffline={isOffline}
                      onApply={applyDefaultForScope}
                    />
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      <EocTemplateEditorDrawer
        isOpen={isEditorOpen}
        isMobile={isMobile}
        initialTemplate={editorTemplate}
        isEditing={Boolean(editorTemplate?.id)}
        canManageTemplates={canManageTemplates}
        isOffline={isOffline}
        onClose={() => setIsEditorOpen(false)}
        onSave={handleSaveTemplate}
      />

      <AppModal
        isOpen={deleteModal.isOpen}
        tone="warning"
        title="Delete Template"
        maxWidth="500px"
        footer={[
          <button key="cancel" type="button" style={subtleButton} onClick={closeDeleteModal}>
            Cancel
          </button>,
          <button key="delete" type="button" style={primaryButton} onClick={confirmDeleteWithReplacement} disabled={deleteModal.isWorking || !deleteModal.replacementId}>
            {deleteModal.isWorking ? 'Deleting...' : 'Delete + Reassign'}
          </button>
        ]}
      >
        <div style={{ fontSize: '14px', color: '#2D3F53', marginBottom: '8px' }}>
          This template is currently assigned in <strong>{deleteModal.impactedCount}</strong> scope(s).
        </div>
        <div style={{ fontSize: '13px', color: '#556677', marginBottom: '10px' }}>
          Choose a replacement template to apply before deletion.
        </div>
        <select
          value={deleteModal.replacementId}
          onChange={event => setDeleteModal(previous => ({ ...previous, replacementId: event.target.value }))}
          style={{ ...filterInputStyle, width: '100%' }}
          disabled={deleteModal.isWorking}
        >
          {deleteModal.options.map(option => (
            <option key={option.id} value={option.id}>{option.name}</option>
          ))}
        </select>
      </AppModal>
    </div>
  )
}

export default EocTemplateManager
