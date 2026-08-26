/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { LOCATIONS, SHIFTS, isShiftAllowedForMainLocation } from '../data/eocConstants'
import { getAvailableMainLocationsForUser, isAdminRole, locationIdToMainLocation } from '../utils/orgModel'
import {
  assignDefaultTemplateForScope,
  deleteTemplateAndReassignScopes,
  getTemplateAssignmentMapKey,
  previewDefaultAssignmentImpact,
  previewTemplatePurge,
  purgeUnusedTemplate,
  rejectTemplateArchiveRequest,
  requestTemplateArchive,
  saveEocSectionToLibrary,
  savePublishedTemplateVersion
} from '../services/eocTemplateService'
import { normalizeEocTemplateDefinition } from '../utils/eocTemplateModel'
import {
  createEocTemplateDraftId,
  deleteEocTemplateDraft,
  saveEocTemplateDraft,
  watchEocTemplateDrafts
} from '../services/eocTemplateDraftService'
import { notifySuccess } from '../utils/toast'
import { showConfirmDialog } from '../utils/dialogs'
import AppModal from './AppModal'
import EocTemplateEditorDrawer from './EocTemplateEditorDrawer'
import EocTemplateScopeCard from './EocTemplateScopeCard'
import useEocTemplateBuilderAccess from '../hooks/useEocTemplateBuilderAccess'

function toMillis(value) {
  if (!value) return 0
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (typeof value?.seconds === 'number') return value.seconds * 1000
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
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
  const normalized = normalizeEocTemplateDefinition(template, { includeIncomplete: true })
  const itemMatch = normalized.sections.some(section => (
    String(section.title || '').toLowerCase().includes(normalizedSearch)
    || section.questions.some(question => String(question.label || '').toLowerCase().includes(normalizedSearch))
  ))
  return name.includes(normalizedSearch) || owner.includes(normalizedSearch) || itemMatch
}

function templateQuestionCount(template) {
  return normalizeEocTemplateDefinition(template, { includeIncomplete: true }).sections
    .reduce((count, section) => count + section.questions.length, 0)
}

function EocTemplateManager({ user, isOffline = false }) {
  const [templates, setTemplates] = useState([])
  const [sectionLibrary, setSectionLibrary] = useState([])
  const [drafts, setDrafts] = useState([])
  const [archiveRequests, setArchiveRequests] = useState([])
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
    archiveRequestId: '',
    isWorking: false
  })
  const [archiveRequestModal, setArchiveRequestModal] = useState({
    isOpen: false,
    template: null,
    reason: '',
    isWorking: false
  })
  const [purgeModal, setPurgeModal] = useState({
    isOpen: false,
    template: null,
    impact: null,
    pin: '',
    reason: '',
    isWorking: false
  })

  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 900 : false))
  const builderAccess = useEocTemplateBuilderAccess()

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 900)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => onSnapshot(
    collection(db, 'eocSectionLibrary'),
    snapshot => setSectionLibrary(snapshot.docs.map(sectionDoc => ({ id: sectionDoc.id, ...sectionDoc.data() }))),
    error => console.error('Error loading EOC section library:', error)
  ), [])

  useEffect(() => watchEocTemplateDrafts(
    user,
    nextDrafts => setDrafts(sortByUpdated(nextDrafts)),
    error => console.error('Error loading EOC template drafts:', error)
  ), [user])

  const isAdmin = isAdminRole(user?.role)
  const canManageTemplates = isAdmin || user?.role === 'supervisor'

  useEffect(() => {
    if (!isAdmin) {
      setArchiveRequests([])
      return undefined
    }
    return onSnapshot(
      query(collection(db, 'eocTemplateArchiveRequests'), where('status', '==', 'pending')),
      snapshot => setArchiveRequests(sortByUpdated(snapshot.docs.map(requestDoc => ({ id: requestDoc.id, ...requestDoc.data() })))),
      error => console.error('Error loading EOC template archive requests:', error)
    )
  }, [isAdmin])

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
  const builderEnabled = isAdmin || (
    builderAccess.supervisorEnabled
    && (
      builderAccess.enabledLocationIds.length === 0
      || scopedLocations.some(location => builderAccess.enabledLocationIds.includes(String(location.id || '').trim().toLowerCase()))
    )
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
    if (!builderEnabled) return
    setEditorTemplate({
      name: '',
      eocType: 'house',
      status: 'active',
      items: [],
      _draftId: createEocTemplateDraftId(user)
    })
    setIsEditorOpen(true)
  }

  const openEditTemplate = (template) => {
    if (!builderEnabled) return
    if (!canEditTemplate(user, template)) return
    const existingDraft = drafts.find(draft => draft.targetTemplateId === template.id)
    setEditorTemplate(existingDraft ? {
      ...existingDraft.template,
      id: template.id,
      _draftId: existingDraft.id,
      _cloneMeta: existingDraft.cloneMeta || null
    } : {
      ...template,
      _draftId: createEocTemplateDraftId(user, template.id)
    })
    setIsEditorOpen(true)
  }

  const openDraft = (draft) => {
    const targetTemplate = draft.targetTemplateId
      ? templates.find(template => template.id === draft.targetTemplateId)
      : null
    if (draft.targetTemplateId && !targetTemplate) {
      alert('The template connected to this draft no longer exists.')
      return
    }
    setEditorTemplate({
      ...draft.template,
      ...(targetTemplate ? { id: targetTemplate.id } : {}),
      _draftId: draft.id,
      _cloneMeta: draft.cloneMeta || null
    })
    setIsEditorOpen(true)
  }

  const handleDeleteDraft = async (draft) => {
    const confirmed = await showConfirmDialog(`Discard draft "${draft.templateName || 'Untitled template'}"?`, {
      title: 'Discard Draft',
      tone: 'warning',
      confirmText: 'Discard'
    })
    if (!confirmed) return
    try {
      await deleteEocTemplateDraft(draft.id)
      notifySuccess('Draft discarded')
    } catch (error) {
      console.error('Error deleting EOC template draft:', error)
      alert('Draft could not be discarded.')
    }
  }

  const handleDraftChange = useCallback(async (template) => {
    if (!editorTemplate?._draftId) return
    await saveEocTemplateDraft({
      draftId: editorTemplate._draftId,
      user,
      template,
      targetTemplateId: editorTemplate.id || '',
      cloneMeta: editorTemplate._cloneMeta || null
    })
  }, [editorTemplate, user])

  const handleSaveTemplate = async (payload, options = { assignNow: false }) => {
    if (!canManageTemplates) {
      alert('You do not have permission to manage templates.')
      return
    }
    if (isOffline) {
      alert('Offline mode: template changes are unavailable until you reconnect.')
      return
    }

    const normalizedTemplate = normalizeEocTemplateDefinition(payload)
    if (!payload.name || !String(payload.name || '').trim()) {
      alert('Template name is required.')
      return
    }
    const questionCount = normalizedTemplate.sections.reduce((count, section) => count + section.questions.length, 0)
    if (questionCount === 0) {
      alert('Add at least one valid question.')
      return
    }

    try {
      const templateId = String(editorTemplate?.id || '').trim()
      let existingTemplate = null
      if (templateId) {
        existingTemplate = templates.find(template => template.id === templateId)
        if (!existingTemplate) {
          alert('Template no longer exists. Refresh and try again.')
          return
        }
        if (!canEditTemplate(user, existingTemplate)) {
          alert('You can only edit your own templates. Clone this template to customize it.')
          return
        }
      }

      const saved = await savePublishedTemplateVersion({
        actor: user,
        templateId,
        existingTemplate,
        payload: normalizedTemplate,
        cloneMeta: editorTemplate?._cloneMeta || null
      })
      notifySuccess(existingTemplate ? `Template version ${saved.versionNumber} published` : 'Template saved to library')

      const savedTemplate = {
        id: saved.templateId,
        name: saved.templateName,
        eocType: saved.eocType,
        publishedVersion: saved.versionNumber,
        publishedVersionId: saved.versionId
      }
      setSmartTemplate(savedTemplate)
      setPreferredTemplateIds(previous => ({ ...previous, [savedTemplate.eocType]: savedTemplate.id }))
      if (editorTemplate?._draftId) await deleteEocTemplateDraft(editorTemplate._draftId)
      setIsEditorOpen(false)

      if (options?.assignNow) {
        setActiveView('assignments')
        setQuickAssign((previous) => ({ ...previous, eocType: savedTemplate.eocType, templateId: savedTemplate.id }))
      }
    } catch (error) {
      console.error('Error saving template:', error)
      throw new Error(error?.message || 'Failed to save template.')
    }
  }

  const handleCloneTemplate = (template) => {
    if (!builderEnabled) return
    if (!canManageTemplates) {
      alert('You do not have permission to clone templates.')
      return
    }
    const clone = normalizeEocTemplateDefinition({
      ...template,
      name: `${String(template.name || 'Template').trim()} (Copy)`
    }, { includeIncomplete: true })
    setEditorTemplate({
      ...clone,
      _draftId: createEocTemplateDraftId(user),
      _cloneMeta: {
        clonedFromTemplateId: template.id,
        clonedFromTemplateName: template.name || '',
        clonedFromVersion: template.publishedVersion || template.version || null
      }
    })
    setIsEditorOpen(true)
  }

  const handleSaveSection = async (section, eocType) => {
    if (isOffline) {
      alert('Reconnect before saving a section to the library.')
      return
    }
    try {
      await saveEocSectionToLibrary({ section, eocType })
      notifySuccess('Section saved to the library')
    } catch (error) {
      console.error('Error saving section:', error)
      alert(error?.message || 'Failed to save section.')
    }
  }

  const handleOpenAssignForTemplate = (template) => {
    const resolvedType = String(template.eocType || 'house').trim() === 'van' ? 'van' : 'house'
    setActiveView('assignments')
    setQuickAssign((previous) => ({ ...previous, eocType: resolvedType, templateId: template.id }))
    setPreferredTemplateIds(previous => ({ ...previous, [resolvedType]: template.id }))
  }

  const handleDeleteTemplate = async (template, archiveRequest = null) => {
    if (!isAdmin) {
      if (!isOwnedByUser(user, template)) {
        alert('You can request archive only for templates you own.')
        return
      }
      setArchiveRequestModal({ isOpen: true, template, reason: '', isWorking: false })
      return
    }
    if (isOffline) {
      alert('Offline mode: archiving templates is unavailable.')
      return
    }

    const impactedAssignments = assignments.filter(assignment => assignment.defaultTemplateId === template.id)
    if (impactedAssignments.length === 0) {
      const confirmed = await showConfirmDialog(`Archive template "${template.name}"?`, {
        title: 'Archive Template',
        tone: 'warning',
        confirmText: 'Archive'
      })
      if (!confirmed) return
      await deleteTemplateAndReassignScopes({
        templateId: template.id,
        replacementTemplate: null,
        archiveRequestId: archiveRequest?.id || '',
        reason: archiveRequest?.reason || 'Archived unused template from the template library.'
      })
      notifySuccess('Template archived')
      return
    }

    const replacementOptions = activeTemplates.filter((candidate) => (
      candidate.id !== template.id
      && String(candidate.eocType || '').trim() === String(template.eocType || '').trim()
    ))

    if (replacementOptions.length === 0) {
      alert('Archive blocked: this template is assigned and no replacement template is available for this type.')
      return
    }

    setDeleteModal({
      isOpen: true,
      template,
      replacementId: replacementOptions[0].id,
      options: replacementOptions,
      impactedCount: impactedAssignments.length,
      archiveRequestId: archiveRequest?.id || '',
      isWorking: false
    })
  }

  const submitArchiveRequest = async () => {
    const reason = String(archiveRequestModal.reason || '').trim()
    if (!archiveRequestModal.template || !reason) {
      alert('Enter a reason for the archive request.')
      return
    }
    try {
      setArchiveRequestModal(previous => ({ ...previous, isWorking: true }))
      await requestTemplateArchive({ templateId: archiveRequestModal.template.id, reason })
      notifySuccess('Archive request sent to admins')
      setArchiveRequestModal({ isOpen: false, template: null, reason: '', isWorking: false })
    } catch (error) {
      console.error('Error requesting template archive:', error)
      alert(error?.message || 'Failed to send archive request.')
      setArchiveRequestModal(previous => ({ ...previous, isWorking: false }))
    }
  }

  const closeDeleteModal = () => {
    setDeleteModal({
      isOpen: false,
      template: null,
      replacementId: '',
      options: [],
      impactedCount: 0,
      archiveRequestId: '',
      isWorking: false
    })
  }

  const confirmDeleteWithReplacement = async () => {
    if (!deleteModal.template || !deleteModal.replacementId) return
    const replacementTemplate = deleteModal.options.find(option => option.id === deleteModal.replacementId)
    if (!replacementTemplate) {
      alert('Select a replacement template before archiving.')
      return
    }

    try {
      setDeleteModal(previous => ({ ...previous, isWorking: true }))
      const result = await deleteTemplateAndReassignScopes({
        actor: user,
        templateId: deleteModal.template.id,
        replacementTemplate,
        archiveRequestId: deleteModal.archiveRequestId
      })
      notifySuccess(`Template archived. ${result.reassignedScopeCount} scope(s) reassigned.`)
      closeDeleteModal()
    } catch (error) {
      console.error('Error archiving template:', error)
      alert('Failed to archive template.')
      setDeleteModal(previous => ({ ...previous, isWorking: false }))
    }
  }

  const rejectArchiveRequest = async (archiveRequest) => {
    const confirmed = await showConfirmDialog(`Decline the archive request for "${archiveRequest.templateName}"?`, {
      title: 'Decline Archive Request',
      tone: 'warning',
      confirmText: 'Decline'
    })
    if (!confirmed) return
    try {
      await rejectTemplateArchiveRequest({ archiveRequestId: archiveRequest.id, reason: 'Archive request declined by admin.' })
      notifySuccess('Archive request declined')
    } catch (error) {
      console.error('Error declining archive request:', error)
      alert(error?.message || 'Archive request could not be declined.')
    }
  }

  const openPurgeTemplate = async (template) => {
    if (!isAdmin || isOffline || template?.status !== 'archived') return
    try {
      const impact = await previewTemplatePurge(template.id)
      setPurgeModal({ isOpen: true, template, impact, pin: '', reason: '', isWorking: false })
    } catch (error) {
      console.error('Error previewing template deletion:', error)
      alert(error?.message || 'Permanent deletion could not be checked.')
    }
  }

  const confirmPurgeTemplate = async () => {
    if (!purgeModal.template || !purgeModal.impact?.purgeAllowed) return
    try {
      setPurgeModal(previous => ({ ...previous, isWorking: true }))
      await purgeUnusedTemplate({
        templateId: purgeModal.template.id,
        adminProfileId: user.id,
        pin: purgeModal.pin,
        reason: purgeModal.reason
      })
      notifySuccess('Unused archived template permanently deleted')
      setPurgeModal({ isOpen: false, template: null, impact: null, pin: '', reason: '', isWorking: false })
    } catch (error) {
      console.error('Error permanently deleting template:', error)
      alert(error?.message || 'Template could not be permanently deleted.')
      setPurgeModal(previous => ({ ...previous, isWorking: false }))
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
          `Existing EOCs kept on their current version: ${impact.totalCount}`,
          `- Pending: ${impact.pendingCount}`,
          `- Overdue: ${impact.overdueCount}`,
          '',
          'The new default begins with the next EOC cycle.'
        ].join('\n'),
        {
          title: 'Apply Default Template',
          tone: 'warning',
          confirmText: 'Apply'
        }
      )
      if (!confirmed) return

      await assignDefaultTemplateForScope({
        actor: user,
        locationId,
        shiftId,
        eocType,
        templateId: selectedTemplate.id,
        templateName: selectedTemplate.name || '',
        templateVersion: selectedTemplate.publishedVersion || selectedTemplate.version || null,
        templateVersionId: selectedTemplate.publishedVersionId || null
      })
      notifySuccess('Default updated. Existing EOC tasks keep their current template version.')
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
          {!builderEnabled && (
            <div style={{ ...sectionCardStyle, borderColor: 'rgba(17,47,82,0.22)', color: '#556677', fontSize: '13px' }}>
              Template building is currently in a controlled pilot. You can review templates and manage assignments; an admin can enable building for your locations.
            </div>
          )}

          <div style={sectionCardStyle}>
            <div className="eoc-template-filter-grid">
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
              <button type="button" onClick={openNewTemplate} style={primaryButton} disabled={!canManageTemplates || !builderEnabled || isOffline}>New Template</button>
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

          {drafts.length > 0 && (
            <div style={sectionCardStyle}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#1A3553' }}>Your Drafts ({drafts.length})</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {drafts.map(draft => (
                  <div key={draft.id} className="eoc-template-draft-row" style={{ border: '1px solid rgba(17,47,82,0.14)', borderRadius: '7px', padding: '9px 10px', backgroundColor: '#FFFFFF' }}>
                    <div className="eoc-template-draft-copy"><strong style={{ display: 'block', fontSize: '13px', color: '#1A3553' }}>{draft.templateName || 'Untitled template'}</strong><span style={{ fontSize: '12px', color: '#556677' }}>{String(draft.eocType || 'house').toUpperCase()} {draft.targetTemplateId ? '| Unpublished changes' : '| New template'}</span></div>
                    <div className="eoc-template-draft-actions"><button type="button" style={subtleButton} onClick={() => openDraft(draft)} disabled={isOffline}>Resume</button><button type="button" style={subtleButton} onClick={() => handleDeleteDraft(draft)} disabled={isOffline}>Discard</button></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isAdmin && archiveRequests.length > 0 && (
            <div style={{ ...sectionCardStyle, borderColor: 'rgba(205,78,66,0.35)' }}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#1A3553' }}>Archive Requests ({archiveRequests.length})</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {archiveRequests.map((archiveRequest) => {
                  const template = templates.find(candidate => candidate.id === archiveRequest.templateId)
                  return (
                    <div key={archiveRequest.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', border: '1px solid rgba(17,47,82,0.14)', borderRadius: '7px', padding: '9px 10px', backgroundColor: '#FFFFFF', flexWrap: 'wrap' }}>
                      <div><strong style={{ display: 'block', fontSize: '13px', color: '#1A3553' }}>{archiveRequest.templateName || 'Template'}</strong><span style={{ display: 'block', fontSize: '12px', color: '#556677' }}>Requested by {archiveRequest.requestedByName || 'Supervisor'}</span><span style={{ display: 'block', fontSize: '12px', color: '#556677', marginTop: '3px' }}>{archiveRequest.reason}</span></div>
                      <div style={{ display: 'flex', gap: '6px' }}><button type="button" style={primaryButton} onClick={() => template ? handleDeleteTemplate(template, archiveRequest) : alert('This template no longer exists.')} disabled={!template || isOffline}>Review</button><button type="button" style={subtleButton} onClick={() => rejectArchiveRequest(archiveRequest)} disabled={isOffline}>Decline</button></div>
                    </div>
                  )
                })}
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
                            Questions: {templateQuestionCount(template)} | Status: {template.status || 'active'}
                            {assignedCount > 0 ? ` | Default in ${assignedCount} scope(s)` : ''}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          <button type="button" style={subtleButton} onClick={() => openEditTemplate(template)} disabled={!canManageTemplates || !builderEnabled || isOffline}>Edit</button>
                          <button type="button" style={subtleButton} onClick={() => handleCloneTemplate(template)} disabled={!canManageTemplates || !builderEnabled || isOffline}>Clone</button>
                          <button type="button" style={subtleButton} onClick={() => handleOpenAssignForTemplate(template)} disabled={!canManageTemplates || isOffline}>Assign</button>
                          {template.status !== 'archived' && <button type="button" style={subtleButton} onClick={() => handleDeleteTemplate(template)} disabled={isOffline}>{isAdmin ? 'Archive' : 'Request Archive'}</button>}
                          {isAdmin && template.status === 'archived' && <button type="button" style={subtleButton} onClick={() => openPurgeTemplate(template)} disabled={isOffline}>Delete Permanently</button>}
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
                          Owner: {template.ownerName || '--'} | Questions: {templateQuestionCount(template)}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <button type="button" style={subtleButton} onClick={() => handleCloneTemplate(template)} disabled={!canManageTemplates || !builderEnabled || isOffline}>Clone</button>
                        <button type="button" style={subtleButton} onClick={() => handleOpenAssignForTemplate(template)} disabled={!canManageTemplates || isOffline}>Assign</button>
                        <button type="button" style={subtleButton} onClick={() => openEditTemplate(template)} disabled={!isAdmin || !builderEnabled || isOffline}>Edit</button>
                        {isAdmin && template.status === 'archived' && <button type="button" style={subtleButton} onClick={() => openPurgeTemplate(template)} disabled={isOffline}>Delete Permanently</button>}
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
            Choose defaults by location + shift. Changes begin with the next EOC cycle after one confirmation.
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
        canManageTemplates={canManageTemplates && builderEnabled}
        isOffline={isOffline}
        sectionLibrary={sectionLibrary}
        onSaveSection={handleSaveSection}
        onDraftChange={handleDraftChange}
        onClose={() => setIsEditorOpen(false)}
        onSave={handleSaveTemplate}
      />

      <AppModal
        isOpen={deleteModal.isOpen}
        tone="warning"
        title="Archive Template"
        maxWidth="500px"
        footer={[
          <button key="cancel" type="button" style={subtleButton} onClick={closeDeleteModal}>
            Cancel
          </button>,
          <button key="delete" type="button" style={primaryButton} onClick={confirmDeleteWithReplacement} disabled={deleteModal.isWorking || !deleteModal.replacementId}>
            {deleteModal.isWorking ? 'Archiving...' : 'Archive + Reassign'}
          </button>
        ]}
      >
        <div style={{ fontSize: '14px', color: '#2D3F53', marginBottom: '8px' }}>
          This template is currently assigned in <strong>{deleteModal.impactedCount}</strong> scope(s).
        </div>
        <div style={{ fontSize: '13px', color: '#556677', marginBottom: '10px' }}>
          Choose a replacement template to apply before archiving.
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

      <AppModal
        isOpen={archiveRequestModal.isOpen}
        tone="warning"
        title="Request Template Archive"
        maxWidth="500px"
        footer={[
          <button key="cancel" type="button" style={subtleButton} onClick={() => setArchiveRequestModal({ isOpen: false, template: null, reason: '', isWorking: false })} disabled={archiveRequestModal.isWorking}>Cancel</button>,
          <button key="request" type="button" style={primaryButton} onClick={submitArchiveRequest} disabled={archiveRequestModal.isWorking || !String(archiveRequestModal.reason || '').trim()}>{archiveRequestModal.isWorking ? 'Sending...' : 'Send Request'}</button>
        ]}
      >
        <div style={{ fontSize: '13px', color: '#556677', marginBottom: '10px' }}>
          Admins will review assignments and choose a replacement if this template is in use.
        </div>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#1A3553' }}>
          Reason
          <textarea
            rows={4}
            value={archiveRequestModal.reason}
            onChange={event => setArchiveRequestModal(previous => ({ ...previous, reason: event.target.value }))}
            placeholder="Why should this template be archived?"
            style={{ ...filterInputStyle, width: '100%', marginTop: '5px', resize: 'vertical' }}
            disabled={archiveRequestModal.isWorking}
          />
        </label>
      </AppModal>

      <AppModal
        isOpen={purgeModal.isOpen}
        tone="danger"
        title="Permanently Delete Template"
        maxWidth="520px"
        footer={[
          <button key="cancel" type="button" style={subtleButton} onClick={() => setPurgeModal({ isOpen: false, template: null, impact: null, pin: '', reason: '', isWorking: false })} disabled={purgeModal.isWorking}>Cancel</button>,
          <button key="purge" type="button" style={primaryButton} onClick={confirmPurgeTemplate} disabled={purgeModal.isWorking || !purgeModal.impact?.purgeAllowed || !/^\d{6}$/.test(purgeModal.pin) || String(purgeModal.reason || '').trim().length < 8}>{purgeModal.isWorking ? 'Deleting...' : 'Delete Permanently'}</button>
        ]}
      >
        <p style={{ margin: '0 0 10px', fontSize: '13px', color: '#556677' }}>This is limited to archived templates with no assignments, EOC tasks, submissions, or issues. Published versions will also be removed.</p>
        {purgeModal.impact && <div style={{ marginBottom: '10px', padding: '9px', backgroundColor: purgeModal.impact.purgeAllowed ? 'rgba(40,120,80,0.08)' : 'rgba(183,94,84,0.1)', borderRadius: '7px', fontSize: '12px', color: '#2D3F53' }}>Assignments: {purgeModal.impact.assignments} | Tasks: {purgeModal.impact.tasks} | Submissions: {purgeModal.impact.submissions} | Issues: {purgeModal.impact.issues} | Versions: {purgeModal.impact.versions}<br /><strong>{purgeModal.impact.purgeAllowed ? 'Safe deletion checks passed.' : 'Deletion is blocked because this template has operational history.'}</strong></div>}
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#1A3553', marginBottom: '9px' }}>Reason<textarea rows={3} value={purgeModal.reason} onChange={event => setPurgeModal(previous => ({ ...previous, reason: event.target.value }))} style={{ ...filterInputStyle, width: '100%', marginTop: '5px', resize: 'vertical' }} disabled={purgeModal.isWorking} /></label>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#1A3553' }}>Your 6-digit admin PIN<input type="password" inputMode="numeric" maxLength={6} value={purgeModal.pin} onChange={event => setPurgeModal(previous => ({ ...previous, pin: event.target.value.replace(/\D/g, '').slice(0, 6) }))} style={{ ...filterInputStyle, width: '100%', marginTop: '5px' }} disabled={purgeModal.isWorking || !purgeModal.impact?.purgeAllowed} /></label>
      </AppModal>
    </div>
  )
}

export default EocTemplateManager
