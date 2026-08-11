import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Pencil
} from 'lucide-react'
import { db } from '../firebase'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where
} from 'firebase/firestore'
import { EOC_HOUSE_TEMPLATE, EOC_VAN_TEMPLATE, LOCATIONS, TEMPLATE_SCOPE_OTC_SHARED, VANS, getTemplateScopeForShift } from '../data/eocConstants'
import { formatVersionConflictMessage, getVersionNumber } from '../services/versioning'
import { parseMileageValue } from '../utils/fleetStatus'
import { deleteOfflineDraft, getOfflineDraft, saveOfflineDraft } from '../services/offlineStore'
import { getEocDraftId, queueEocSubmission, submitEocSubmissionOnline } from '../services/offlineSyncService'
import { notifySuccess } from '../utils/toast'
import { normalizeEocTemplateItems } from '../utils/eocTemplateModel'
import {
  findFirstIncompleteEocItemIndex,
  getEocCategoryProgress,
  getEocChecklistProgress,
  isEocIssueDetailMissing
} from '../utils/eocGuidedFlow'

const DRAFT_SAVE_DEBOUNCE_MS = 700

function getDraftDocId(taskId, userId) {
  return `${String(taskId || '').trim()}__${String(userId || '').trim()}`
}

function formatDueLabel(task) {
  const dueAt = task?.dueAt?.toDate ? task.dueAt.toDate() : (task?.dueAt ? new Date(task.dueAt) : null)
  if (dueAt && !Number.isNaN(dueAt.getTime())) {
    return dueAt.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
  }
  return task?.dueDate || '--'
}

function EocChecklist({ taskId, user, onComplete, onBack, isOffline = false }) {
  const [task, setTask] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [templateItems, setTemplateItems] = useState([])
  const [vehicleName, setVehicleName] = useState('')
  const [vinNumber, setVinNumber] = useState('')
  const [odometerReading, setOdometerReading] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [eocType, setEocType] = useState('')
  const [answers, setAnswers] = useState({})
  const [repairDetails, setRepairDetails] = useState({})
  const [error, setError] = useState('')
  const [draftReady, setDraftReady] = useState(false)
  const [draftStatus, setDraftStatus] = useState('idle')
  const [draftRestoredNotice, setDraftRestoredNotice] = useState('')
  const [currentItemIndex, setCurrentItemIndex] = useState(0)
  const [showReview, setShowReview] = useState(false)

  const normalizedUserId = String(user?.id || '').trim()
  const draftTimerRef = useRef(null)
  const lastSavedPayloadRef = useRef('')
  const isDraftLoadedRef = useRef(false)
  const initialDraftSnapshotRef = useRef(false)
  const guidedPositionReadyRef = useRef(false)
  const issueDetailInputRef = useRef(null)
  const odometerInputRef = useRef(null)

  useEffect(() => {
    async function loadTask() {
      if (!taskId) {
        setError('Task not found')
        setLoading(false)
        return
      }

      try {
        const snap = await getDoc(doc(db, 'eocTasks', taskId))
        if (!snap.exists()) {
          setError('Task not found')
          setLoading(false)
          return
        }

        const data = snap.data()
        if (data.status !== 'pending' && data.status !== 'overdue') {
          setError(`This EOC task has already been ${data.status}`)
          setLoading(false)
          return
        }

        const eligibleUserIds = Array.isArray(data.eligibleUserIds) ? data.eligibleUserIds : []
        const canCurrentUserComplete = eligibleUserIds.length > 0
          ? eligibleUserIds.map(v => String(v || '').trim()).includes(normalizedUserId)
          : (!data.assigneeUserId || String(data.assigneeUserId || '').trim() === normalizedUserId)
        if (!canCurrentUserComplete) {
          setError('You are not eligible to complete this EOC task.')
          setLoading(false)
          return
        }

        const nextType = data.taskType || data.eocType || ''
        const nextTemplateScope = String(data.templateScope || '').trim() || getTemplateScopeForShift(data.shiftId)
        setEocType(nextType)
        setTask({
          id: snap.id,
          ...data,
          templateScope: nextTemplateScope || TEMPLATE_SCOPE_OTC_SHARED,
          version: getVersionNumber(data)
        })

        if (nextType === 'van') {
          const vanLabel = VANS.find(v => v.id === data.vanId)?.label || ''
          setVehicleName(vanLabel)
        } else {
          setVehicleName('')
          setVinNumber('')
          setOdometerReading('')
        }
      } catch (err) {
        console.error('Error loading task:', err)
        setError('Failed to load task')
      } finally {
        setLoading(false)
      }
    }

    loadTask()
  }, [normalizedUserId, taskId])

  useEffect(() => {
    if (!eocType) return

    const normalizeLibraryItems = (items) => normalizeEocTemplateItems(items)

    const templateId = String(task?.templateId || '').trim()
    const templateVersionId = String(task?.templateVersionId || '').trim()
    const resolvedTemplateScope = String(task?.templateScope || '').trim() || getTemplateScopeForShift(task?.shiftId)
    let assignedTemplateItems = null
    let exactTemplateItems = []
    let sharedTemplateItems = []
    let legacyTemplateItems = []

    const applyTemplateItems = () => {
      if (Array.isArray(assignedTemplateItems) && assignedTemplateItems.length > 0) {
        setTemplateItems(assignedTemplateItems)
        return
      }
      if (exactTemplateItems.length > 0) {
        setTemplateItems(exactTemplateItems)
        return
      }
      if (sharedTemplateItems.length > 0) {
        setTemplateItems(sharedTemplateItems)
        return
      }
      if (legacyTemplateItems.length > 0) {
        setTemplateItems(legacyTemplateItems)
        return
      }
      setTemplateItems([])
    }

    let unsubAssignedTemplate = () => {}
    if (templateVersionId || templateId) {
      const templateRef = templateVersionId
        ? doc(db, 'eocTemplateVersions', templateVersionId)
        : doc(db, 'eocTemplateLibrary', templateId)
      unsubAssignedTemplate = onSnapshot(
        templateRef,
        (snap) => {
          if (!snap.exists()) {
            console.warn('Assigned template version not found. Falling back to legacy scope template.', templateVersionId || templateId)
            assignedTemplateItems = null
            applyTemplateItems()
            return
          }
          const data = snap.data() || {}
          assignedTemplateItems = normalizeLibraryItems(data.items)
          applyTemplateItems()
        },
        (err) => {
          console.error('Error loading assigned template:', err)
          assignedTemplateItems = null
          applyTemplateItems()
        }
      )
    }

    const exactQuery = query(
      collection(db, 'eocChecklistTemplate'),
      where('eocType', '==', eocType),
      where('templateScope', '==', resolvedTemplateScope || TEMPLATE_SCOPE_OTC_SHARED),
      orderBy('order', 'asc')
    )
    const unsubExact = onSnapshot(
      exactQuery,
      (snap) => {
        exactTemplateItems = normalizeLibraryItems(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        applyTemplateItems()
      },
      (err) => {
        console.error('Error loading scope template:', err)
        exactTemplateItems = []
        applyTemplateItems()
      }
    )

    let unsubShared = () => {}
    if ((resolvedTemplateScope || TEMPLATE_SCOPE_OTC_SHARED) !== TEMPLATE_SCOPE_OTC_SHARED) {
      const sharedQuery = query(
        collection(db, 'eocChecklistTemplate'),
        where('eocType', '==', eocType),
        where('templateScope', '==', TEMPLATE_SCOPE_OTC_SHARED),
        orderBy('order', 'asc')
      )
      unsubShared = onSnapshot(
        sharedQuery,
        (snap) => {
          sharedTemplateItems = normalizeLibraryItems(snap.docs.map(d => ({ id: d.id, ...d.data() })))
          applyTemplateItems()
        },
        (err) => {
          console.error('Error loading shared fallback template:', err)
          sharedTemplateItems = []
          applyTemplateItems()
        }
      )
    }

    const legacyQuery = query(
      collection(db, 'eocChecklistTemplate'),
      where('eocType', '==', eocType),
      orderBy('order', 'asc')
    )
    const unsubLegacy = onSnapshot(
      legacyQuery,
      (snap) => {
        legacyTemplateItems = normalizeLibraryItems(snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(item => !String(item.templateScope || '').trim()))
        applyTemplateItems()
      },
      (err) => {
        console.error('Error loading legacy fallback template:', err)
        legacyTemplateItems = []
        applyTemplateItems()
      }
    )

    return () => {
      unsubAssignedTemplate()
      unsubExact()
      unsubShared()
      unsubLegacy()
    }
  }, [eocType, task?.shiftId, task?.templateScope, task?.templateId, task?.templateVersionId])

  useEffect(() => {
    if (!task || eocType !== 'van') return

    async function loadVehicle() {
      try {
        if (task.vehicleId) {
          const snap = await getDoc(doc(db, 'eocVehicles', task.vehicleId))
          if (snap.exists()) {
            const v = snap.data()
            setVehicleId(snap.id)
            setVehicleName(v.name || '')
            setVinNumber(v.vin || '')
            return
          }
        }

        if (task.vanId) {
          const q = query(
            collection(db, 'eocVehicles'),
            where('vanId', '==', task.vanId),
            where('active', '==', true)
          )
          const snap = await getDocs(q)
          if (!snap.empty) {
            const docSnap = snap.docs[0]
            const v = docSnap.data()
            setVehicleId(docSnap.id)
            setVehicleName(v.name || '')
            setVinNumber(v.vin || '')
          }
        }
      } catch (err) {
        console.error('Error loading vehicle:', err)
      }
    }

    loadVehicle()
  }, [task, eocType])

  const activeTemplate = useMemo(() => {
    const fallback = normalizeEocTemplateItems(eocType === 'van' ? EOC_VAN_TEMPLATE : EOC_HOUSE_TEMPLATE)
    if (templateItems.length === 0) return fallback
    const filtered = templateItems.filter(i => i.active !== false)
    return filtered.length > 0 ? filtered : fallback
  }, [eocType, templateItems])

  const checklistProgress = useMemo(
    () => getEocChecklistProgress(activeTemplate, answers, repairDetails),
    [activeTemplate, answers, repairDetails]
  )
  const categoryProgress = useMemo(
    () => getEocCategoryProgress(activeTemplate, answers, repairDetails),
    [activeTemplate, answers, repairDetails]
  )
  const currentItem = activeTemplate[currentItemIndex] || activeTemplate[0] || null
  const currentCategoryItems = currentItem
    ? activeTemplate.filter(item => item.category === currentItem.category)
    : []
  const currentCategoryPosition = currentItem
    ? currentCategoryItems.findIndex(item => item.id === currentItem.id) + 1
    : 0

  const isRepairMissing = (itemId) => isEocIssueDetailMissing(itemId, answers, repairDetails)

  const findFirstInvalid = () => {
    if (eocType === 'van') {
      if (!odometerReading.trim()) {
        return { type: 'odometer', message: 'Enter the odometer reading before submitting.' }
      }
      if (parseMileageValue(odometerReading) === null) {
        return { type: 'odometer', message: 'Enter a valid odometer reading.' }
      }
    }

    for (const item of activeTemplate) {
      if (!answers[item.id]) {
        return {
          type: 'missing-answer',
          itemId: item.id,
          message: `Complete this checklist item: ${item.label}`
        }
      }
      if (answers[item.id] === 'repair' && isRepairMissing(item.id)) {
        return {
          type: 'missing-repair-note',
          itemId: item.id,
          message: `Describe the issue for: ${item.label}`
        }
      }
    }

    return null
  }

  const openChecklistItem = (itemId, focusIssueDetails = false) => {
    const nextIndex = activeTemplate.findIndex(item => item.id === itemId)
    if (nextIndex < 0) return
    setCurrentItemIndex(nextIndex)
    setShowReview(false)
    setError('')
    if (focusIssueDetails) {
      window.setTimeout(() => issueDetailInputRef.current?.focus(), 100)
    }
  }

  useEffect(() => {
    if (!task?.id || !normalizedUserId) return
    let cancelled = false

    async function loadDraft() {
      setDraftReady(false)
      isDraftLoadedRef.current = false
      initialDraftSnapshotRef.current = false
      guidedPositionReadyRef.current = false
      setDraftStatus('idle')
      setCurrentItemIndex(0)
      setShowReview(false)

      try {
        const localDraft = await getOfflineDraft(getEocDraftId(task.id, normalizedUserId)).catch(() => null)
        const draftRef = doc(db, 'eocSubmissionDrafts', getDraftDocId(task.id, normalizedUserId))
        const snap = isOffline ? null : await getDoc(draftRef)

        if (cancelled) return
        const data = localDraft?.payload || (snap?.exists() ? snap.data() : null)
        if (data) {
          if (data.answers && typeof data.answers === 'object') setAnswers(data.answers)
          if (data.repairDetails && typeof data.repairDetails === 'object') setRepairDetails(data.repairDetails)
          if (typeof data.odometerReading === 'string') setOdometerReading(data.odometerReading)
          if (typeof data.vehicleName === 'string' && data.vehicleName.trim()) setVehicleName(data.vehicleName)
          if (typeof data.vinNumber === 'string' && data.vinNumber.trim()) setVinNumber(data.vinNumber)
          if (typeof data.vehicleId === 'string' && data.vehicleId.trim()) setVehicleId(data.vehicleId)
          setDraftRestoredNotice(localDraft ? 'Local draft restored' : 'Draft restored')
          setDraftStatus('saved')
        }
      } catch (err) {
        console.error('Error loading EOC draft:', err)
      } finally {
        if (!cancelled) {
          isDraftLoadedRef.current = true
          setDraftReady(true)
        }
      }
    }

    loadDraft()
    return () => { cancelled = true }
  }, [isOffline, task?.id, normalizedUserId])

  useEffect(() => {
    if (!draftReady || activeTemplate.length === 0 || guidedPositionReadyRef.current) return
    const firstIncompleteIndex = findFirstIncompleteEocItemIndex(activeTemplate, answers, repairDetails)
    guidedPositionReadyRef.current = true
    if (firstIncompleteIndex < 0) {
      setCurrentItemIndex(Math.max(activeTemplate.length - 1, 0))
      setShowReview(true)
      return
    }
    setCurrentItemIndex(firstIncompleteIndex)
  }, [activeTemplate, answers, draftReady, repairDetails])

  useEffect(() => {
    if (!draftRestoredNotice) return undefined
    const timer = window.setTimeout(() => setDraftRestoredNotice(''), 2200)
    return () => window.clearTimeout(timer)
  }, [draftRestoredNotice])

  useEffect(() => {
    if (!task?.id || !normalizedUserId || !draftReady || !isDraftLoadedRef.current) return undefined
    if (submitting) return undefined

    const payload = {
      taskId: task.id,
      locationId: task.locationId,
      shiftId: task.shiftId,
      templateScope: task.templateScope || getTemplateScopeForShift(task.shiftId) || TEMPLATE_SCOPE_OTC_SHARED,
      templateId: task.templateId || null,
      templateName: task.templateName || '',
      templateVersion: Number(task.templateVersion || 0) || null,
      templateVersionId: task.templateVersionId || null,
      vanId: task.vanId || null,
      eocType,
      draftByUserId: normalizedUserId,
      draftByName: user?.name || '',
      vehicleId: vehicleId || null,
      vehicleName: vehicleName || '',
      vinNumber: vinNumber || '',
      odometerReading: eocType === 'van' ? odometerReading : '',
      answers,
      repairDetails
    }

    const serialized = JSON.stringify(payload)
    if (!initialDraftSnapshotRef.current) {
      initialDraftSnapshotRef.current = true
      lastSavedPayloadRef.current = serialized
      return undefined
    }
    if (serialized === lastSavedPayloadRef.current) return undefined

    if (draftTimerRef.current) {
      window.clearTimeout(draftTimerRef.current)
    }

    setDraftStatus('saving')
    draftTimerRef.current = window.setTimeout(async () => {
      try {
        await saveOfflineDraft(getEocDraftId(task.id, normalizedUserId), 'eoc', payload)
        if (isOffline) {
          lastSavedPayloadRef.current = serialized
          setDraftStatus('local')
          return
        }
        const draftRef = doc(db, 'eocSubmissionDrafts', getDraftDocId(task.id, normalizedUserId))
        const existingDraft = await getDoc(draftRef)
        await setDoc(draftRef, {
          ...payload,
          version: 1,
          lastTouchedAt: serverTimestamp(),
          ...(existingDraft.exists() ? {} : { createdAt: serverTimestamp() }),
          updatedAt: serverTimestamp()
        }, { merge: true })
        await deleteOfflineDraft(getEocDraftId(task.id, normalizedUserId))
        lastSavedPayloadRef.current = serialized
        setDraftStatus('saved')
      } catch (err) {
        console.error('Error autosaving EOC draft:', err)
        setDraftStatus('error')
      }
    }, DRAFT_SAVE_DEBOUNCE_MS)

    return () => {
      if (draftTimerRef.current) window.clearTimeout(draftTimerRef.current)
    }
  }, [answers, draftReady, eocType, isOffline, normalizedUserId, odometerReading, repairDetails, submitting, task?.id, task?.locationId, task?.shiftId, task?.templateScope, task?.templateId, task?.templateName, task?.templateVersion, task?.templateVersionId, task?.vanId, user?.name, vehicleId, vehicleName, vinNumber])

  const moveForwardFrom = (itemIndex, nextAnswers = answers, nextRepairDetails = repairDetails) => {
    const item = activeTemplate[itemIndex]
    if (!item || !nextAnswers[item.id]) {
      setError('Choose Looks good or Needs attention before continuing.')
      return
    }
    if (isEocIssueDetailMissing(item.id, nextAnswers, nextRepairDetails)) {
      setError('Describe the issue before continuing.')
      window.setTimeout(() => issueDetailInputRef.current?.focus(), 80)
      return
    }

    if (itemIndex < activeTemplate.length - 1) {
      setCurrentItemIndex(itemIndex + 1)
      setError('')
      return
    }

    const firstIncompleteIndex = findFirstIncompleteEocItemIndex(activeTemplate, nextAnswers, nextRepairDetails)
    if (firstIncompleteIndex >= 0) {
      setCurrentItemIndex(firstIncompleteIndex)
      setError('Complete the remaining checklist item before review.')
      return
    }

    setError('')
    setShowReview(true)
  }

  const setAnswer = (itemId, value) => {
    setError('')
    const nextAnswers = { ...answers, [itemId]: value }
    let nextRepairDetails = repairDetails
    setAnswers(nextAnswers)

    if (value === 'ok') {
      nextRepairDetails = { ...repairDetails }
      delete nextRepairDetails[itemId]
      setRepairDetails(nextRepairDetails)
      const itemIndex = activeTemplate.findIndex(item => item.id === itemId)
      window.setTimeout(() => moveForwardFrom(itemIndex, nextAnswers, nextRepairDetails), 140)
    } else {
      window.setTimeout(() => issueDetailInputRef.current?.focus(), 80)
    }
  }

  const setRepairField = (itemId, value) => {
    setError('')
    setRepairDetails(prev => ({
      ...prev,
      [itemId]: { description: value }
    }))
  }

  const allReady = checklistProgress.remainingCount === 0

  const buildSubmissionPayload = () => ({
    task,
    user,
    normalizedUserId,
    eocType,
    vehicleId,
    vehicleName,
    vinNumber,
    odometerReading,
    activeTemplate,
    answers,
    repairDetails
  })

  const handleSubmit = async () => {
    const invalid = findFirstInvalid()
    if (invalid) {
      if (invalid.type === 'odometer') window.setTimeout(() => odometerInputRef.current?.focus(), 80)
      if (invalid.itemId) openChecklistItem(invalid.itemId, invalid.type === 'missing-repair-note')
      setError(invalid.message)
      return
    }

    if (!task) {
      setError('Task not available')
      return
    }

    if (isOffline) {
      setSubmitting(true)
      try {
        const payload = buildSubmissionPayload()
        await saveOfflineDraft(getEocDraftId(task.id, normalizedUserId), 'eoc', payload)
        await queueEocSubmission(payload)
        notifySuccess('EOC saved on this device. It will sync when internet returns.')
        onComplete()
      } catch (err) {
        console.error('Error queueing offline EOC:', err)
        setError(err?.message || 'Failed to save offline EOC. Please try again.')
      } finally {
        setSubmitting(false)
      }
      return
    }

    setSubmitting(true)
    setError('')

    try {
      if (eocType === 'van' && parseMileageValue(odometerReading) === null) {
        setError('Enter a valid odometer reading.')
        setSubmitting(false)
        return
      }

      await submitEocSubmissionOnline(buildSubmissionPayload())
      onComplete()
    } catch (err) {
      console.error('Error submitting EOC:', err)
      if (err?.code === 'version-conflict') {
        setError(formatVersionConflictMessage(err))
      } else {
        setError(err?.message || 'Failed to submit. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleItemKeyDown = (event, item) => {
    const key = event.key
    const targetTag = String(event.target?.tagName || '').toLowerCase()
    const inTextInput = targetTag === 'input' || targetTag === 'textarea'

    if (!inTextInput && key === '1') {
      event.preventDefault()
      setAnswer(item.id, 'ok')
      return
    }

    if (!inTextInput && key === '2') {
      event.preventDefault()
      setAnswer(item.id, 'repair')
      return
    }

    if (!inTextInput && key === 'Enter') {
      event.preventDefault()
      moveForwardFrom(currentItemIndex)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#556677' }}>
        Loading checklist...
      </div>
    )
  }

  if (error && !task) {
    return (
      <div style={{ padding: '20px', maxWidth: '700px', margin: '0 auto' }}>
        <div className="glass-card" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <p style={{ color: '#C94A3F', marginBottom: '16px' }}>{error}</p>
          <button className="btn" onClick={onBack} style={{ background: 'rgba(17,47,82,0.10)', color: 'var(--text-primary)' }}>
            Back
          </button>
        </div>
      </div>
    )
  }

  const draftStatusText = (() => {
    if (draftStatus === 'local') return 'Saved on this device'
    if (!draftReady) return 'Preparing draft...'
    if (draftStatus === 'saving') return 'Saving...'
    if (draftStatus === 'saved') return 'Saved just now'
    if (draftStatus === 'error') return 'Draft save failed. Retrying on next change.'
    return 'Draft ready'
  })()

  const locationLabel = LOCATIONS.find(l => l.id === task?.locationId)?.label || task?.locationId

  const totalItems = checklistProgress.totalCount
  const answeredCount = checklistProgress.readyCount
  const progressPercent = checklistProgress.percent

  return (
    <div className="eoc-guided-page">
      <header className="eoc-guided-header">
        <div>
          <h2>{eocType === 'van' ? 'Van EOC' : 'House EOC'}</h2>
          <p>{locationLabel} | Due {formatDueLabel(task)}</p>
        </div>
        <div className="eoc-draft-state" data-state={draftStatus === 'error' ? 'error' : 'ready'}>
          {draftRestoredNotice || draftStatusText}
        </div>
      </header>

      <div className="eoc-guided-progress" aria-label={`${answeredCount} of ${totalItems} checklist items complete`}>
        <div className="eoc-progress-header">
          <span>{answeredCount} of {totalItems} complete</span>
          <span>{progressPercent}%</span>
        </div>
        <div className="progress-bar-container">
          <div
            className={`progress-bar-fill ${progressPercent < 100 ? 'progress-bar-fill-warning' : ''}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {eocType === 'van' ? (
        <section className="eoc-vehicle-strip" aria-label="Vehicle information">
          <div className="eoc-vehicle-field">
            <span>Vehicle</span>
            <strong>{vehicleName || 'Not listed'}</strong>
          </div>
          <div className="eoc-vehicle-field">
            <span>VIN</span>
            <strong>{vinNumber || 'Not listed'}</strong>
          </div>
          <label className="eoc-odometer-field">
            <span>Odometer reading</span>
            <input
              ref={odometerInputRef}
              className={`input ${!odometerReading.trim() && error ? 'input-warn' : ''}`}
              value={odometerReading}
              onChange={(event) => {
                setError('')
                setOdometerReading(event.target.value)
              }}
              inputMode="numeric"
              aria-label="Odometer reading"
              placeholder="Enter mileage"
            />
          </label>
          {(!vehicleName || !vinNumber) && (
            <p className="eoc-vehicle-warning">Vehicle details are incomplete. Ask a supervisor to update them.</p>
          )}
        </section>
      ) : (
        <div className="eoc-guided-meta">
          <span>House: <strong>{locationLabel}</strong></span>
          <span>Completed by: <strong>{user?.name || 'Unknown'}</strong></span>
        </div>
      )}

      {error && (
        <div className="eoc-guided-error" role="alert">{error}</div>
      )}

      <nav className="eoc-section-nav" aria-label="Checklist sections">
        {categoryProgress.map((category) => {
          const isCurrent = !showReview && currentItem?.category === category.category
          const isComplete = category.readyCount === category.totalCount
          return (
            <button
              key={category.category}
              type="button"
              className={`eoc-section-button${isCurrent ? ' is-current' : ''}${isComplete ? ' is-complete' : ''}`}
              onClick={() => {
                setCurrentItemIndex(category.firstItemIndex)
                setShowReview(false)
                setError('')
              }}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span>{category.category}</span>
              <small>{category.readyCount}/{category.totalCount}</small>
            </button>
          )
        })}
      </nav>

      {showReview ? (
        <main className="eoc-review-panel">
          <div className="eoc-review-heading">
            <div className="eoc-review-icon"><ClipboardCheck size={24} /></div>
            <div><p>Final step</p><h3>Review EOC</h3></div>
          </div>
          <div className="eoc-review-summary">
            <div><strong>{checklistProgress.completeCount}</strong><span>Looks good</span></div>
            <div className={checklistProgress.attentionCount > 0 ? 'has-attention' : ''}>
              <strong>{checklistProgress.attentionCount}</strong><span>Needs attention</span>
            </div>
          </div>
          <div className="eoc-review-sections">
            {categoryProgress.map((category) => (
              <section key={category.category} className="eoc-review-section">
                <div className="eoc-review-section-title">
                  <span>{category.category}</span><span>{category.readyCount}/{category.totalCount}</span>
                </div>
                {activeTemplate.filter(item => item.category === category.category).map((item) => (
                  <div key={item.id} className={`eoc-review-row ${answers[item.id] === 'repair' ? 'needs-attention' : ''}`}>
                    <div className="eoc-review-status" aria-hidden="true">
                      {answers[item.id] === 'repair' ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
                    </div>
                    <div className="eoc-review-copy">
                      <strong>{item.label}</strong>
                      <span>{answers[item.id] === 'repair' ? 'Needs attention' : 'Looks good'}</span>
                      {answers[item.id] === 'repair' && <p>{repairDetails[item.id]?.description}</p>}
                    </div>
                    <button
                      type="button"
                      className="eoc-icon-button"
                      onClick={() => openChecklistItem(item.id, answers[item.id] === 'repair')}
                      aria-label={`Edit ${item.label}`}
                      title="Edit item"
                    >
                      <Pencil size={17} />
                    </button>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </main>
      ) : currentItem ? (
        <main className="eoc-guided-item" tabIndex={0} onKeyDown={(event) => handleItemKeyDown(event, currentItem)}>
          <div className="eoc-guided-item-meta">
            <span>{currentItem.category}</span>
            <span>Section item {currentCategoryPosition} of {currentCategoryItems.length}</span>
          </div>
          <div className="eoc-guided-item-number">Item {currentItemIndex + 1} of {totalItems}</div>
          <h3>{currentItem.label}</h3>
          {currentItem.helpText && <p className="eoc-guided-help">{currentItem.helpText}</p>}
          <div className="eoc-guided-answers">
            <button
              type="button"
              className={`eoc-answer-button is-good${answers[currentItem.id] === 'ok' ? ' is-selected' : ''}`}
              onClick={() => setAnswer(currentItem.id, 'ok')}
              aria-pressed={answers[currentItem.id] === 'ok'}
            >
              <Check size={22} /><span>Looks good</span>
            </button>
            <button
              type="button"
              className={`eoc-answer-button is-attention${answers[currentItem.id] === 'repair' ? ' is-selected' : ''}`}
              onClick={() => setAnswer(currentItem.id, 'repair')}
              aria-pressed={answers[currentItem.id] === 'repair'}
            >
              <AlertTriangle size={21} /><span>Needs attention</span>
            </button>
          </div>
          {answers[currentItem.id] === 'repair' && (
            <div className="eoc-guided-issue">
              <label htmlFor={`eoc-issue-${currentItem.id}`}>Describe the issue</label>
              <p>Provide all relevant details that would help someone understand and address the issue.</p>
              <textarea
                id={`eoc-issue-${currentItem.id}`}
                ref={issueDetailInputRef}
                className={isRepairMissing(currentItem.id) ? 'input-warn' : ''}
                rows={4}
                value={repairDetails[currentItem.id]?.description || ''}
                onChange={(event) => setRepairField(currentItem.id, event.target.value)}
                placeholder="Describe what you observed and any details that may help."
              />
            </div>
          )}
          <div className="eoc-item-navigation">
            <button
              type="button"
              className="eoc-secondary-action"
              onClick={() => {
                setCurrentItemIndex(index => Math.max(index - 1, 0))
                setError('')
              }}
              disabled={currentItemIndex === 0}
            >
              <ArrowLeft size={18} /> Previous
            </button>
            <button
              type="button"
              className="eoc-primary-action"
              onClick={() => moveForwardFrom(currentItemIndex)}
              disabled={!answers[currentItem.id] || isRepairMissing(currentItem.id)}
            >
              {currentItemIndex === totalItems - 1 ? 'Review' : 'Continue'} <ArrowRight size={18} />
            </button>
          </div>
        </main>
      ) : null}

      {isOffline && (
        <div className="eoc-guided-offline">
          Offline: submission will stay on this device and sync when internet returns.
        </div>
      )}

      {showReview && (
        <div className="eoc-sticky-actions eoc-review-actions">
          <button
            type="button"
            className="eoc-secondary-action"
            onClick={() => {
              setShowReview(false)
              setCurrentItemIndex(Math.max(activeTemplate.length - 1, 0))
            }}
          >
            <ArrowLeft size={18} /> Back to checklist
          </button>
          <button
            type="button"
            className="eoc-primary-action"
            onClick={handleSubmit}
            disabled={submitting || !allReady}
          >
            <ClipboardCheck size={19} /> {submitting ? 'Submitting...' : 'Submit EOC'}
          </button>
        </div>
      )}
    </div>
  )
}

export default EocChecklist


