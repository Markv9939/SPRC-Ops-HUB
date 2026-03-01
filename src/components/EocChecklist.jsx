import { useEffect, useMemo, useRef, useState } from 'react'
import { db } from '../firebase'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where
} from 'firebase/firestore'
import { EOC_HOUSE_TEMPLATE, EOC_VAN_TEMPLATE, LOCATIONS, TEMPLATE_SCOPE_OTC_SHARED, VANS, getTemplateScopeForShift } from '../data/eocConstants'
import { assertExpectedVersion, formatVersionConflictMessage, getVersionNumber } from '../services/versioning'
import { requireOnline } from '../utils/networkGuard'

const DRAFT_SAVE_DEBOUNCE_MS = 700

function getDraftDocId(taskId, userId) {
  return `${String(taskId || '').trim()}__${String(userId || '').trim()}`
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
  const [focusedItemId, setFocusedItemId] = useState('')

  const normalizedUserId = String(user?.id || '').trim()
  const normalizedAuthUid = String(user?.authUid || '').trim()
  const orderedItemsRef = useRef([])
  const draftTimerRef = useRef(null)
  const lastSavedPayloadRef = useRef('')
  const isDraftLoadedRef = useRef(false)
  const itemRefs = useRef({})
  const repairInputRefs = useRef({})

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

    const normalizeLibraryItems = (items) => (
      (Array.isArray(items) ? items : [])
        .map((item, index) => ({
          id: item?.id || `tpl-item-${index + 1}`,
          category: String(item?.category || '').trim(),
          label: String(item?.label || '').trim(),
          order: Number(item?.order) || (index + 1),
          active: item?.active !== false
        }))
        .filter(item => item.category && item.label)
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
    )

    const templateId = String(task?.templateId || '').trim()
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
    if (templateId) {
      const templateRef = doc(db, 'eocTemplateLibrary', templateId)
      unsubAssignedTemplate = onSnapshot(
        templateRef,
        (snap) => {
          if (!snap.exists()) {
            console.warn('Assigned template not found. Falling back to legacy scope template.', templateId)
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
        exactTemplateItems = snap.docs.map(d => ({ id: d.id, ...d.data() }))
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
          sharedTemplateItems = snap.docs.map(d => ({ id: d.id, ...d.data() }))
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
        legacyTemplateItems = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(item => !String(item.templateScope || '').trim())
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
  }, [eocType, task?.shiftId, task?.templateScope, task?.templateId])

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
    const fallback = eocType === 'van' ? EOC_VAN_TEMPLATE : EOC_HOUSE_TEMPLATE
    if (templateItems.length === 0) return fallback
    const filtered = templateItems.filter(i => i.active !== false)
    return filtered.length > 0 ? filtered : fallback
  }, [eocType, templateItems])

  useEffect(() => {
    orderedItemsRef.current = activeTemplate
  }, [activeTemplate])

  const itemsByCategory = useMemo(() => {
    const map = new Map()
    for (const item of activeTemplate) {
      if (!map.has(item.category)) map.set(item.category, [])
      map.get(item.category).push(item)
    }
    return map
  }, [activeTemplate])

  const categories = useMemo(() => Array.from(itemsByCategory.keys()), [itemsByCategory])

  const isRepairMissing = (itemId) => {
    if (answers[itemId] !== 'repair') return false
    return !String(repairDetails[itemId]?.description || '').trim()
  }

  const isRepairMissingWithState = (itemId, nextAnswers, nextRepairDetails) => {
    if (nextAnswers[itemId] !== 'repair') return false
    return !String(nextRepairDetails[itemId]?.description || '').trim()
  }

  const findFirstInvalid = () => {
    if (eocType === 'van' && !odometerReading.trim()) {
      return { type: 'odometer', message: 'Please enter odometer reading' }
    }

    for (const item of activeTemplate) {
      if (!answers[item.id]) {
        return {
          type: 'missing-answer',
          itemId: item.id,
          message: `Please complete all checklist items (missing: ${item.label})`
        }
      }
      if (answers[item.id] === 'repair' && isRepairMissing(item.id)) {
        return {
          type: 'missing-repair-note',
          itemId: item.id,
          message: `Please describe the repair for: ${item.label}`
        }
      }
    }

    return null
  }

  const jumpToItem = (itemId, focusRepairInput = false) => {
    const node = itemRefs.current[itemId]
    if (!node) return

    node.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.setTimeout(() => {
      if (focusRepairInput) {
        repairInputRefs.current[itemId]?.focus()
      } else {
        node.focus()
      }
    }, 160)
  }

  const getNextOutstandingItem = (fromItemId = '') => {
    const ordered = orderedItemsRef.current
    if (ordered.length === 0) return null

    const outstanding = ordered.filter(item => !answers[item.id] || isRepairMissing(item.id))
    if (outstanding.length === 0) return null
    if (!fromItemId) return outstanding[0]

    const fromIndex = ordered.findIndex(item => item.id === fromItemId)
    if (fromIndex < 0) return outstanding[0]

    for (let idx = fromIndex + 1; idx < ordered.length; idx += 1) {
      const item = ordered[idx]
      if (!answers[item.id] || isRepairMissing(item.id)) return item
    }

    return outstanding[0]
  }

  const getNextOutstandingItemWithState = (fromItemId, nextAnswers, nextRepairDetails) => {
    const ordered = orderedItemsRef.current
    if (ordered.length === 0) return null

    const outstanding = ordered.filter(item => !nextAnswers[item.id] || isRepairMissingWithState(item.id, nextAnswers, nextRepairDetails))
    if (outstanding.length === 0) return null
    if (!fromItemId) return outstanding[0]

    const fromIndex = ordered.findIndex(item => item.id === fromItemId)
    if (fromIndex < 0) return outstanding[0]

    for (let idx = fromIndex + 1; idx < ordered.length; idx += 1) {
      const item = ordered[idx]
      if (!nextAnswers[item.id] || isRepairMissingWithState(item.id, nextAnswers, nextRepairDetails)) return item
    }

    return outstanding[0]
  }

  const firstOutstandingItem = getNextOutstandingItem('')

  useEffect(() => {
    if (!task?.id || !normalizedUserId) return
    let cancelled = false

    async function loadDraft() {
      setDraftReady(false)
      isDraftLoadedRef.current = false
      setDraftStatus('idle')

      try {
        const draftRef = doc(db, 'eocSubmissionDrafts', getDraftDocId(task.id, normalizedUserId))
        const snap = await getDoc(draftRef)

        if (cancelled) return
        if (snap.exists()) {
          const data = snap.data()
          if (data.answers && typeof data.answers === 'object') setAnswers(data.answers)
          if (data.repairDetails && typeof data.repairDetails === 'object') setRepairDetails(data.repairDetails)
          if (typeof data.odometerReading === 'string') setOdometerReading(data.odometerReading)
          if (typeof data.vehicleName === 'string' && data.vehicleName.trim()) setVehicleName(data.vehicleName)
          if (typeof data.vinNumber === 'string' && data.vinNumber.trim()) setVinNumber(data.vinNumber)
          if (typeof data.vehicleId === 'string' && data.vehicleId.trim()) setVehicleId(data.vehicleId)
          setDraftRestoredNotice('Draft restored')
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
  }, [task?.id, normalizedUserId])

  useEffect(() => {
    if (!draftRestoredNotice) return undefined
    const timer = window.setTimeout(() => setDraftRestoredNotice(''), 2200)
    return () => window.clearTimeout(timer)
  }, [draftRestoredNotice])

  useEffect(() => {
    if (!task?.id || !normalizedUserId || !draftReady || !isDraftLoadedRef.current) return undefined
    if (submitting || isOffline) return undefined

    const payload = {
      taskId: task.id,
      locationId: task.locationId,
      shiftId: task.shiftId,
      templateScope: task.templateScope || getTemplateScopeForShift(task.shiftId) || TEMPLATE_SCOPE_OTC_SHARED,
      templateId: task.templateId || null,
      templateName: task.templateName || '',
      vanId: task.vanId || null,
      eocType,
      draftByUserId: normalizedUserId,
      draftByAuthUid: normalizedAuthUid || null,
      draftByName: user?.name || '',
      vehicleId: vehicleId || null,
      vehicleName: vehicleName || '',
      vinNumber: vinNumber || '',
      odometerReading: eocType === 'van' ? odometerReading : '',
      answers,
      repairDetails
    }

    const serialized = JSON.stringify(payload)
    if (serialized === lastSavedPayloadRef.current) return undefined

    if (draftTimerRef.current) {
      window.clearTimeout(draftTimerRef.current)
    }

    setDraftStatus('saving')
    draftTimerRef.current = window.setTimeout(async () => {
      try {
        const draftRef = doc(db, 'eocSubmissionDrafts', getDraftDocId(task.id, normalizedUserId))
        await setDoc(draftRef, {
          ...payload,
          version: 1,
          lastTouchedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }, { merge: true })
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
  }, [answers, draftReady, eocType, isOffline, normalizedAuthUid, normalizedUserId, odometerReading, repairDetails, submitting, task?.id, task?.locationId, task?.shiftId, task?.templateScope, task?.templateId, task?.templateName, task?.vanId, user?.name, vehicleId, vehicleName, vinNumber])

  const setAnswer = (itemId, value) => {
    setError('')
    let nextAnswers = answers
    let nextRepairDetails = repairDetails

    nextAnswers = { ...answers, [itemId]: value }
    setAnswers(nextAnswers)

    if (value === 'ok') {
      nextRepairDetails = { ...repairDetails }
      delete nextRepairDetails[itemId]
      setRepairDetails(nextRepairDetails)
    } else {
      nextRepairDetails = { ...repairDetails }
      window.setTimeout(() => {
        repairInputRefs.current[itemId]?.focus()
      }, 80)
    }

    const currentItem = activeTemplate.find(item => item.id === itemId)
    if (!currentItem) return

    const currentCategoryItems = activeTemplate.filter(item => item.category === currentItem.category)
    const categoryIsNowComplete = currentCategoryItems.every(item => nextAnswers[item.id] && !isRepairMissingWithState(item.id, nextAnswers, nextRepairDetails))
    if (!categoryIsNowComplete) return

    const nextItem = getNextOutstandingItemWithState(itemId, nextAnswers, nextRepairDetails)
    if (!nextItem) return
    window.setTimeout(() => jumpToItem(nextItem.id, isRepairMissingWithState(nextItem.id, nextAnswers, nextRepairDetails)), 140)
  }

  const setRepairField = (itemId, value) => {
    setError('')
    setRepairDetails(prev => ({
      ...prev,
      [itemId]: { description: value }
    }))
  }

  const allAnswered = activeTemplate.every(item => Boolean(answers[item.id]))

  const handleSubmit = async () => {
    if (isOffline) {
      requireOnline('submitting EOC')
      return
    }

    const invalid = findFirstInvalid()
    if (invalid) {
      setError(invalid.message)
      if (invalid.itemId) {
        jumpToItem(invalid.itemId, invalid.type === 'missing-repair-note')
      }
      return
    }

    if (!task) {
      setError('Task not available')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const answersData = activeTemplate.map(item => ({
        itemId: item.id,
        label: item.label,
        category: item.category,
        status: answers[item.id],
        ...(answers[item.id] === 'repair'
          ? { description: repairDetails[item.id]?.description || '' }
          : {})
      }))

      const issueItems = answersData.filter(a => a.status === 'repair')

      await runTransaction(db, async (transaction) => {
        const taskRef = doc(db, 'eocTasks', task.id)
        const taskSnap = await transaction.get(taskRef)
        if (!taskSnap.exists()) {
          throw new Error('Task no longer exists.')
        }

        const latestTask = taskSnap.data()
        if (latestTask.status !== 'pending' && latestTask.status !== 'overdue') {
          throw new Error(`This EOC task is already ${latestTask.status}.`)
        }

        const latestEligibleUserIds = Array.isArray(latestTask.eligibleUserIds) ? latestTask.eligibleUserIds : []
        const canCurrentUserComplete = latestEligibleUserIds.length > 0
          ? latestEligibleUserIds.map(v => String(v || '').trim()).includes(normalizedUserId)
          : (!latestTask.assigneeUserId || String(latestTask.assigneeUserId || '').trim() === normalizedUserId)
        if (!canCurrentUserComplete) {
          throw new Error('You are not eligible to complete this EOC task.')
        }

        const { nextVersion } = assertExpectedVersion({
          expectedVersion: getVersionNumber(task),
          currentVersion: getVersionNumber(latestTask),
          documentId: task.id,
          recordLabel: 'EOC Task'
        })

        const submissionRef = doc(collection(db, 'eocSubmissions'))
        transaction.set(submissionRef, {
          taskId: task.id,
          locationId: task.locationId,
          shiftId: task.shiftId,
          templateScope: task.templateScope || getTemplateScopeForShift(task.shiftId) || TEMPLATE_SCOPE_OTC_SHARED,
          templateId: task.templateId || null,
          templateName: task.templateName || '',
          vanId: task.vanId || null,
          dueDate: task.dueDate,
          staffCompleting: user.name,
          eocType,
          vehicleId: vehicleId || null,
          vehicleName: vehicleName.trim(),
          vinNumber: vinNumber.trim(),
          odometerReading: eocType === 'van' ? odometerReading.trim() : '',
          answers: answersData,
          issueCount: issueItems.length,
          submittedByUserId: normalizedUserId,
          submittedByName: user.name,
          version: 1,
          submittedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        })

        transaction.update(taskRef, {
          status: 'completed',
          submissionId: submissionRef.id,
          completedAt: serverTimestamp(),
          completedByUserId: normalizedUserId,
          completedByName: user.name,
          version: nextVersion,
          updatedAt: serverTimestamp()
        })

        if (normalizedAuthUid) {
          const draftRef = doc(db, 'eocSubmissionDrafts', getDraftDocId(task.id, normalizedUserId))
          const draftSnap = await transaction.get(draftRef)
          if (draftSnap.exists()) {
            const draftData = draftSnap.data()
            if (String(draftData?.draftByAuthUid || '').trim() === normalizedAuthUid) {
              transaction.delete(draftRef)
            }
          }
        }

        for (const issue of issueItems) {
          const issueRef = doc(collection(db, 'eocIssues'))
          transaction.set(issueRef, {
            taskId: task.id,
            submissionId: submissionRef.id,
            locationId: task.locationId,
            shiftId: task.shiftId,
            vanId: task.vanId || null,
            eocType,
            itemId: issue.itemId,
            label: issue.label,
            category: issue.category,
            description: issue.description,
            severity: 'medium',
            status: 'open',
            reportedByUserId: normalizedUserId,
            reportedByName: user.name,
            version: 1,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          })

          const alertRef = doc(collection(db, 'alerts'))
          transaction.set(alertRef, {
            type: 'eoc_issue',
            issueId: issueRef.id,
            taskId: task.id,
            locationId: task.locationId,
            eocType,
            severity: 'medium',
            message: `EOC issue: ${issue.label} - ${issue.description}`,
            bhtName: user.name,
            techName: user.name,
            read: false,
            version: 1,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          })
        }
      })

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

  const jumpToNextOutstanding = () => {
    const nextItem = getNextOutstandingItem(focusedItemId)
    if (!nextItem) return
    jumpToItem(nextItem.id, isRepairMissing(nextItem.id))
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

    if (key === 'Enter') {
      event.preventDefault()
      jumpToNextOutstanding()
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
    if (isOffline) return 'Offline: draft autosave paused'
    if (!draftReady) return 'Preparing draft...'
    if (draftStatus === 'saving') return 'Saving...'
    if (draftStatus === 'saved') return 'Saved just now'
    if (draftStatus === 'error') return 'Draft save failed. Retrying on next change.'
    return 'Draft ready'
  })()

  const locationLabel = LOCATIONS.find(l => l.id === task?.locationId)?.label || task?.locationId

  return (
    <div className="eoc-checklist-page" style={{ padding: '18px', maxWidth: '760px', margin: '0 auto', paddingBottom: '150px' }}>
      <div className="eoc-header-row">
        <button
          aria-label="Back to BHT hub"
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '24px',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
            padding: '4px'
          }}
        >
          {'<-'}
        </button>
        <div>
          <h2 style={{ margin: 0, fontSize: '32px', lineHeight: 1.1, color: 'var(--text-primary)', fontWeight: 700 }}>
            {eocType === 'van' ? 'Van EOC Checklist' : 'House EOC Checklist'}
          </h2>
          <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Due: {task?.dueDate} - {locationLabel}
          </div>
        </div>
      </div>

      <div className="glass-card eoc-shell-card" style={{ padding: '14px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Completed by</div>
            <div className="badge badge-eoc-completed" style={{ fontSize: '12px' }}>{user?.name || 'Unknown User'}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Draft status</div>
            <div className="eoc-inline-note">{draftStatusText}</div>
          </div>
        </div>

        {draftRestoredNotice && (
          <div className="eoc-inline-note" style={{ marginBottom: '10px' }}>
            {draftRestoredNotice}
          </div>
        )}

        {eocType === 'van' ? (
          <>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Vehicle Receiving Inspection</div>
            <div className="eoc-meta-grid">
              <input className="input" value={vehicleName} readOnly aria-label="Vehicle name" placeholder="Vehicle name" />
              <input className="input" value={vinNumber} readOnly aria-label="VIN number" placeholder="VIN number" />
              <input
                className={`input ${!odometerReading.trim() && error ? 'input-warn' : ''}`}
                value={odometerReading}
                onChange={(e) => {
                  setError('')
                  setOdometerReading(e.target.value)
                }}
                aria-label="Odometer reading"
                placeholder="Odometer reading"
              />
            </div>
            {(!vehicleName || !vinNumber) && (
              <div style={{ marginTop: '8px', fontSize: '12px', color: '#B07A28' }}>
                Vehicle details missing - ask supervisor to set vehicle name/VIN.
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            House: {locationLabel}
          </div>
        )}
      </div>

      {categories.map(cat => {
        const categoryItems = itemsByCategory.get(cat) || []

        return (
          <div key={cat} style={{ marginBottom: '18px' }}>
            <div className="eoc-category-header">{cat}</div>
            {categoryItems.map((item, idx) => (
              <div
                key={item.id}
                ref={(node) => { itemRefs.current[item.id] = node }}
                tabIndex={0}
                onFocus={() => setFocusedItemId(item.id)}
                onKeyDown={(event) => handleItemKeyDown(event, item)}
                className="eoc-item"
                style={{
                  background: idx % 2 === 0 ? '#FFFFFF' : '#FCFAF7',
                  borderRadius: '10px',
                  padding: '12px',
                  border: '1px solid rgba(17,47,82,0.16)',
                  boxShadow: '0 2px 8px rgba(17,47,82,0.08)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
                  <div style={{ fontSize: '16px', color: 'var(--text-primary)', fontWeight: 600 }}>
                    {idx + 1}. {item.label}
                  </div>
                  <span className={`badge ${answers[item.id] ? (answers[item.id] === 'repair' ? 'badge-overdue' : 'badge-eoc-completed') : 'badge-eoc-pending'}`}>
                    {answers[item.id] ? answers[item.id].toUpperCase() : 'UNANSWERED'}
                  </span>
                </div>
                <div className="eoc-answer-grid" style={{ marginBottom: answers[item.id] === 'repair' ? '10px' : '0' }}>
                  <button
                    className={`chip ${answers[item.id] === 'ok' ? 'chip-ok' : 'chip-unselected'}`}
                    onClick={() => setAnswer(item.id, 'ok')}
                    aria-label={`Set ${item.label} to OK`}
                    style={{ justifyContent: 'center', minHeight: '46px', fontSize: '16px' }}
                  >
                    OK
                  </button>
                  <button
                    className={`chip ${answers[item.id] === 'repair' ? 'chip-attention' : 'chip-unselected'}`}
                    onClick={() => setAnswer(item.id, 'repair')}
                    aria-label={`Set ${item.label} to repair`}
                    style={{ justifyContent: 'center', minHeight: '46px', fontSize: '16px' }}
                  >
                    Repair
                  </button>
                </div>

                {answers[item.id] === 'repair' && (
                  <div className="eoc-item-attention">
                    <div style={{ fontSize: '12px', color: '#8E611D', marginBottom: '6px' }}>
                      Repair note required
                    </div>
                    <input
                      ref={(node) => { repairInputRefs.current[item.id] = node }}
                      className={`input ${isRepairMissing(item.id) ? 'input-warn' : ''}`}
                      aria-label={`Repair note for ${item.label}`}
                      placeholder="If repair, note changes needed..."
                      value={repairDetails[item.id]?.description || ''}
                      onChange={(e) => setRepairField(item.id, e.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          jumpToNextOutstanding()
                        }
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      })}

      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
        Checklist must be completed on a weekly basis by staff on the first day of each shift. To be turned in to Supervisor following day.
      </div>

      {error && (
        <div style={{ color: '#C94A3F', fontSize: '13px', marginBottom: '12px', textAlign: 'center' }}>
          {error}
        </div>
      )}
      {isOffline && (
        <div style={{ color: '#B07A28', fontSize: '12px', marginBottom: '12px', textAlign: 'center' }}>
          Offline mode is active. EOC submission is disabled until connection is restored.
        </div>
      )}

      <div className="eoc-sticky-actions">
        <button
          type="button"
          className="btn"
          onClick={jumpToNextOutstanding}
          disabled={!firstOutstandingItem}
          style={{
            width: '48%',
            fontSize: '16px',
            borderRadius: 'var(--radius)',
            background: '#F1EFEA',
            color: 'var(--text-secondary)',
            border: '1px solid #D8D1C6'
          }}
        >
          Next Unanswered
        </button>
        <button
          className={`btn ${allAnswered ? 'btn-finish' : 'btn-disabled'}`}
          onClick={handleSubmit}
          disabled={submitting || !allAnswered || isOffline}
          style={{ width: '50%', fontSize: '18px', borderRadius: 'var(--radius)' }}
        >
          {submitting ? 'Submitting...' : 'Submit EOC'}
        </button>
      </div>
    </div>
  )
}

export default EocChecklist


