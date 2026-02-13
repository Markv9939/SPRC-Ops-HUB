import { useState, useEffect, useMemo } from 'react'
import { db } from '../firebase'
import {
  collection, query, where, orderBy, onSnapshot, getDocs,
  doc, updateDoc, serverTimestamp, addDoc, deleteDoc, writeBatch
} from 'firebase/firestore'
import { LOCATIONS, SHIFTS, VANS, EOC_VAN_TEMPLATE, EOC_HOUSE_TEMPLATE } from '../data/eocConstants'
import { notifySuccess } from '../utils/toast'

function templateDiffKey(item) {
  return `${String(item?.category || '').trim().toLowerCase()}::${String(item?.label || '').trim().toLowerCase()}`
}

function normalizeTemplatePayload(templateForm, templateType) {
  return {
    category: templateForm.category.trim(),
    label: templateForm.label.trim(),
    order: Number(templateForm.order) || 0,
    active: templateForm.active !== false,
    eocType: templateType
  }
}

function SupervisorEocPanel({ user, isOffline = false }) {
  const LEGACY_ASSIGNMENTS_READ_ONLY = true
  const [subTab, setSubTab] = useState('compliance') // compliance | assignments | issues | template | vehicles
  const [assignments, setAssignments] = useState([])
  const [issues, setIssues] = useState([])
  const [publishedTemplateItems, setPublishedTemplateItems] = useState([])
  const [draftTemplateItems, setDraftTemplateItems] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [loadingAssignments, setLoadingAssignments] = useState(true)
  const [loadingIssues, setLoadingIssues] = useState(true)
  const [loadingPublishedTemplate, setLoadingPublishedTemplate] = useState(true)
  const [loadingDraftTemplate, setLoadingDraftTemplate] = useState(true)
  const [loadingVehicles, setLoadingVehicles] = useState(true)

  // Filters
  const [filterLocation, setFilterLocation] = useState('all')
  const [filterShift, setFilterShift] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterSeverity, setFilterSeverity] = useState('all')
  const [filterIssueStatus, setFilterIssueStatus] = useState('open')
  const [filterEocType, setFilterEocType] = useState('all')

  // Template editor
  const [editingTemplateId, setEditingTemplateId] = useState(null)
  const [templateForm, setTemplateForm] = useState({ category: '', label: '', order: 0, active: true })
  const [templateType, setTemplateType] = useState('house')
  const [templateVersionNote, setTemplateVersionNote] = useState('')
  const [lastPublishedVersion, setLastPublishedVersion] = useState(null)

  const [editingVehicleId, setEditingVehicleId] = useState(null)
  const [vehicleForm, setVehicleForm] = useState({ name: '', vin: '', vanId: '', locationId: '', active: true })

  // Resolve modal
  const [resolvingIssue, setResolvingIssue] = useState(null)
  const [resolveNotes, setResolveNotes] = useState('')

  // Load assignments
  useEffect(() => {
    const q = query(collection(db, 'eocAssignments'), orderBy('dueDate', 'desc'))
    const unsub = onSnapshot(q, (snap) => {
      setAssignments(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoadingAssignments(false)
    })
    return unsub
  }, [])

  // Load issues
  useEffect(() => {
    const q = query(collection(db, 'eocIssues'), orderBy('createdAt', 'desc'))
    const unsub = onSnapshot(q, (snap) => {
      setIssues(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoadingIssues(false)
    })
    return unsub
  }, [])

  // Load published template items
  useEffect(() => {
    const q = query(
      collection(db, 'eocChecklistTemplate'),
      where('eocType', '==', templateType),
      orderBy('order', 'asc')
    )
    const unsub = onSnapshot(q, (snap) => {
      setPublishedTemplateItems(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoadingPublishedTemplate(false)
    })
    return unsub
  }, [templateType])

  // Load draft template items
  useEffect(() => {
    const q = query(
      collection(db, 'eocTemplateDrafts'),
      where('eocType', '==', templateType),
      orderBy('order', 'asc')
    )
    const unsub = onSnapshot(q, (snap) => {
      setDraftTemplateItems(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoadingDraftTemplate(false)
    })
    return unsub
  }, [templateType])

  const resetTemplateDraftEditor = () => {
    setEditingTemplateId(null)
    setTemplateForm({ category: '', label: '', order: 0, active: true })
    setTemplateVersionNote('')
  }

  const handleTemplateTypeChange = (nextType) => {
    if (nextType === templateType) return
    resetTemplateDraftEditor()
    setTemplateType(nextType)
  }

  useEffect(() => {
    const versionQuery = query(
      collection(db, 'eocTemplateVersions'),
      where('eocType', '==', templateType)
    )

    const unsub = onSnapshot(versionQuery, (snap) => {
      if (snap.empty) {
        setLastPublishedVersion(null)
        return
      }
      const latest = snap.docs
        .map(record => ({ id: record.id, ...record.data() }))
        .sort((a, b) => Number(b.version || 0) - Number(a.version || 0))[0]
      setLastPublishedVersion(latest || null)
    })

    return unsub
  }, [templateType])

  // Load vehicles
  useEffect(() => {
    const q = query(collection(db, 'eocVehicles'), orderBy('name', 'asc'))
    const unsub = onSnapshot(q, (snap) => {
      setVehicles(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoadingVehicles(false)
    })
    return unsub
  }, [])

  const filteredAssignments = assignments.filter(a => {
    if (filterLocation !== 'all' && a.locationId !== filterLocation) return false
    if (filterShift !== 'all' && a.shiftId !== filterShift) return false
    if (filterStatus !== 'all' && a.status !== filterStatus) return false
    if (filterEocType !== 'all' && a.eocType !== filterEocType) return false
    return true
  })

  const filteredIssues = issues.filter(i => {
    if (filterLocation !== 'all' && i.locationId !== filterLocation) return false
    if (filterSeverity !== 'all' && i.severity !== filterSeverity) return false
    if (filterIssueStatus !== 'all' && i.status !== filterIssueStatus) return false
    return true
  })

  const templateDiff = useMemo(() => {
    const publishedByKey = new Map()
    const draftByKey = new Map()

    for (const item of publishedTemplateItems) {
      publishedByKey.set(templateDiffKey(item), item)
    }
    for (const item of draftTemplateItems) {
      draftByKey.set(templateDiffKey(item), item)
    }

    const added = []
    const removed = []
    const changed = []
    let unchangedCount = 0

    for (const [key, draftItem] of draftByKey.entries()) {
      if (!publishedByKey.has(key)) {
        added.push(draftItem)
        continue
      }
      const publishedItem = publishedByKey.get(key)
      if ((Number(draftItem.order) || 0) !== (Number(publishedItem.order) || 0) || (draftItem.active !== false) !== (publishedItem.active !== false)) {
        changed.push({ publishedItem, draftItem })
      } else {
        unchangedCount += 1
      }
    }

    for (const [key, publishedItem] of publishedByKey.entries()) {
      if (!draftByKey.has(key)) {
        removed.push(publishedItem)
      }
    }

    return {
      added,
      removed,
      changed,
      unchangedCount,
      hasChanges: added.length > 0 || removed.length > 0 || changed.length > 0
    }
  }, [publishedTemplateItems, draftTemplateItems])

  const isTemplateAdmin = user?.role === 'admin'
  const defaultTemplateItems = templateType === 'van' ? EOC_VAN_TEMPLATE : EOC_HOUSE_TEMPLATE

  const blockTemplateMutation = (actionLabel) => {
    if (!isTemplateAdmin) {
      alert('Only admin can edit or publish templates.')
      return true
    }
    if (isOffline) {
      alert(`Offline mode: ${actionLabel} is unavailable until connection is restored.`)
      return true
    }
    return false
  }

  const handleResolveIssue = async () => {
    if (!resolvingIssue) return
    if (!resolveNotes.trim()) {
      alert('Resolution note is required.')
      return
    }
    try {
      await updateDoc(doc(db, 'eocIssues', resolvingIssue.id), {
        status: 'resolved',
        resolvedNotes: resolveNotes.trim(),
        resolvedAt: serverTimestamp(),
        resolvedByUserId: user?.id || null,
        resolvedByName: user?.name || null,
        updatedAt: serverTimestamp()
      })
      if (resolvingIssue?.locationId && resolvingIssue?.reportedByUserId) {
        await addDoc(collection(db, 'alerts'), {
          type: 'eoc_issue_update',
          issueId: resolvingIssue.id,
          taskId: resolvingIssue.taskId || null,
          locationId: resolvingIssue.locationId,
          eocType: resolvingIssue.eocType || null,
          severity: resolvingIssue.severity || 'medium',
          targetUserId: resolvingIssue.reportedByUserId,
          targetUserName: resolvingIssue.reportedByName || null,
          status: 'resolved',
          statusNote: resolveNotes.trim(),
          actorUserId: user?.id || null,
          actorName: user?.name || 'Supervisor',
          message: `${user?.name || 'Supervisor'} marked "${resolvingIssue.label || 'Issue'}" as resolved.`,
          read: false,
          version: 1,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        })
      }
      setResolvingIssue(null)
      setResolveNotes('')
      notifySuccess('Issue resolved')
    } catch (err) {
      console.error('Error resolving issue:', err)
      alert('Failed to resolve issue')
    }
  }

  const handleUpdateVan = async (assignmentId, vanId) => {
    if (LEGACY_ASSIGNMENTS_READ_ONLY) {
      alert('Legacy eocAssignments are read-only. Use Assignment Engine (shiftAssignments) in Supervisor Dashboard.')
      return
    }
    try {
      await updateDoc(doc(db, 'eocAssignments', assignmentId), {
        vanId,
        updatedAt: serverTimestamp()
      })
    } catch (err) {
      console.error('Error updating van:', err)
      alert('Failed to update van')
    }
  }

  const handleSaveTemplateItem = async () => {
    if (blockTemplateMutation('saving template drafts')) return
    if (!templateForm.category.trim() || !templateForm.label.trim()) {
      alert('Category and label are required')
      return
    }

    const payload = normalizeTemplatePayload(templateForm, templateType)

    try {
      if (editingTemplateId) {
        await updateDoc(doc(db, 'eocTemplateDrafts', editingTemplateId), {
          ...payload,
          updatedAt: serverTimestamp(),
          updatedByUserId: user?.id || null,
          updatedByName: user?.name || null
        })
      } else {
        await addDoc(collection(db, 'eocTemplateDrafts'), {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdByUserId: user?.id || null,
          createdByName: user?.name || null
        })
      }
      setEditingTemplateId(null)
      setTemplateForm({ category: '', label: '', order: 0, active: true })
      notifySuccess(editingTemplateId ? 'Draft item updated' : 'Draft item added')
    } catch (err) {
      console.error('Error saving template draft item:', err)
      alert('Failed to save draft item')
    }
  }

  const handleEditTemplateItem = (item) => {
    setEditingTemplateId(item.id)
    setTemplateForm({
      category: item.category || '',
      label: item.label || '',
      order: item.order || 0,
      active: item.active !== false
    })
  }

  const handleDeleteTemplateItem = async (id) => {
    if (blockTemplateMutation('deleting template drafts')) return
    if (!confirm('Delete this draft checklist item?')) return
    try {
      await deleteDoc(doc(db, 'eocTemplateDrafts', id))
      notifySuccess('Draft item deleted')
    } catch (err) {
      console.error('Error deleting template draft item:', err)
      alert('Failed to delete draft item')
    }
  }

  const replaceDraftFromItems = async (items, sourceLabel) => {
    const existingDraftSnap = await getDocs(query(
      collection(db, 'eocTemplateDrafts'),
      where('eocType', '==', templateType)
    ))

    const batch = writeBatch(db)
    existingDraftSnap.docs.forEach(d => batch.delete(d.ref))

    items.forEach((item, idx) => {
      const ref = doc(collection(db, 'eocTemplateDrafts'))
      batch.set(ref, {
        category: String(item.category || '').trim(),
        label: String(item.label || '').trim(),
        order: Number(item.order) || idx + 1,
        active: item.active !== false,
        eocType: templateType,
        source: sourceLabel,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdByUserId: user?.id || null,
        createdByName: user?.name || null
      })
    })

    await batch.commit()
    setEditingTemplateId(null)
    setTemplateForm({ category: '', label: '', order: 0, active: true })
  }

  const handleDraftFromPublished = async () => {
    if (blockTemplateMutation('starting template draft')) return
    if (draftTemplateItems.length > 0 && !confirm('Replace current draft with the latest published template?')) return

    const sourceItems = publishedTemplateItems.length > 0
      ? publishedTemplateItems
      : defaultTemplateItems.map((item, idx) => ({ ...item, order: idx + 1, active: true }))

    if (sourceItems.length === 0) {
      alert('No template items are available to initialize this draft.')
      return
    }

    try {
      await replaceDraftFromItems(sourceItems, 'published_snapshot')
      notifySuccess('Draft initialized from published template')
    } catch (err) {
      console.error('Error creating draft from published template:', err)
      alert('Failed to initialize draft from published template')
    }
  }

  const handleDraftFromDefaults = async () => {
    if (blockTemplateMutation('seeding template defaults')) return
    if (!confirm('Replace current draft with default template items?')) return
    try {
      const seededItems = defaultTemplateItems.map((item, idx) => ({
        category: item.category,
        label: item.label,
        order: idx + 1,
        active: true
      }))
      await replaceDraftFromItems(seededItems, 'default_seed')
      notifySuccess('Draft reset to default template')
    } catch (err) {
      console.error('Error replacing draft from defaults:', err)
      alert('Failed to seed default draft')
    }
  }

  const handleDiscardDraft = async () => {
    if (blockTemplateMutation('discarding template draft')) return
    if (!confirm('Discard all draft changes for this template type?')) return
    try {
      const existingDraftSnap = await getDocs(query(
        collection(db, 'eocTemplateDrafts'),
        where('eocType', '==', templateType)
      ))
      const batch = writeBatch(db)
      existingDraftSnap.docs.forEach(d => batch.delete(d.ref))
      await batch.commit()
      setEditingTemplateId(null)
      setTemplateForm({ category: '', label: '', order: 0, active: true })
      setTemplateVersionNote('')
      notifySuccess('Draft discarded')
    } catch (err) {
      console.error('Error discarding template draft:', err)
      alert('Failed to discard draft')
    }
  }

  const handlePublishTemplate = async () => {
    if (blockTemplateMutation('publishing template')) return

    if (draftTemplateItems.length === 0) {
      alert('Draft is empty. Build a draft before publishing.')
      return
    }
    if (!templateDiff.hasChanges) {
      alert('No draft changes detected. Update the draft before publishing.')
      return
    }
    if (!templateVersionNote.trim()) {
      alert('Version note is required before publishing.')
      return
    }
    if (!confirm('Publish draft to the live template now?')) return

    try {
      const publishedSnap = await getDocs(query(
        collection(db, 'eocChecklistTemplate'),
        where('eocType', '==', templateType)
      ))
      const draftSnap = await getDocs(query(
        collection(db, 'eocTemplateDrafts'),
        where('eocType', '==', templateType),
        orderBy('order', 'asc')
      ))
      const versionSnap = await getDocs(query(
        collection(db, 'eocTemplateVersions'),
        where('eocType', '==', templateType)
      ))

      const latestVersion = versionSnap.empty
        ? 0
        : Math.max(...versionSnap.docs.map(d => Number(d.data()?.version || 0)))
      const nextVersion = latestVersion + 1
      const normalizedDraft = draftSnap.docs.map((d, index) => {
        const data = d.data() || {}
        return {
          category: String(data.category || '').trim(),
          label: String(data.label || '').trim(),
          order: Number(data.order) || index + 1,
          active: data.active !== false,
          eocType: templateType
        }
      })

      const batch = writeBatch(db)
      publishedSnap.docs.forEach(d => batch.delete(d.ref))
      draftSnap.docs.forEach(d => batch.delete(d.ref))

      normalizedDraft.forEach((item) => {
        const ref = doc(collection(db, 'eocChecklistTemplate'))
        batch.set(ref, {
          ...item,
          templateVersion: nextVersion,
          publishedAt: serverTimestamp(),
          publishedByUserId: user?.id || null,
          publishedByName: user?.name || null
        })
      })

      const versionRef = doc(collection(db, 'eocTemplateVersions'))
      batch.set(versionRef, {
        eocType: templateType,
        version: nextVersion,
        versionNote: templateVersionNote.trim(),
        itemCount: normalizedDraft.length,
        addedCount: templateDiff.added.length,
        removedCount: templateDiff.removed.length,
        changedCount: templateDiff.changed.length,
        unchangedCount: templateDiff.unchangedCount,
        publishedByUserId: user?.id || null,
        publishedByName: user?.name || null,
        publishedAt: serverTimestamp(),
        items: normalizedDraft
      })

      await batch.commit()
      setTemplateVersionNote('')
      setEditingTemplateId(null)
      setTemplateForm({ category: '', label: '', order: 0, active: true })
      notifySuccess('Template published')
    } catch (err) {
      console.error('Error publishing template draft:', err)
      alert('Failed to publish draft')
    }
  }

  const handleSaveVehicle = async () => {
    if (!vehicleForm.name.trim() || !vehicleForm.vin.trim()) {
      alert('Vehicle name and VIN are required')
      return
    }
    const payload = {
      name: vehicleForm.name.trim(),
      vin: vehicleForm.vin.trim(),
      vanId: vehicleForm.vanId || null,
      locationId: vehicleForm.locationId || null,
      active: vehicleForm.active !== false
    }
    try {
      if (editingVehicleId) {
        await updateDoc(doc(db, 'eocVehicles', editingVehicleId), payload)
      } else {
        await addDoc(collection(db, 'eocVehicles'), payload)
      }
      setEditingVehicleId(null)
      setVehicleForm({ name: '', vin: '', vanId: '', locationId: '', active: true })
      notifySuccess(editingVehicleId ? 'Vehicle updated' : 'Vehicle added')
    } catch (err) {
      console.error('Error saving vehicle:', err)
      alert('Failed to save vehicle')
    }
  }

  const handleEditVehicle = (v) => {
    setEditingVehicleId(v.id)
    setVehicleForm({
      name: v.name || '',
      vin: v.vin || '',
      vanId: v.vanId || '',
      locationId: v.locationId || '',
      active: v.active !== false
    })
  }

  const handleDeleteVehicle = async (id) => {
    if (!confirm('Delete this vehicle?')) return
    try {
      await deleteDoc(doc(db, 'eocVehicles', id))
      notifySuccess('Vehicle deleted')
    } catch (err) {
      console.error('Error deleting vehicle:', err)
      alert('Failed to delete vehicle')
    }
  }

  const locationLabel = (id) => LOCATIONS.find(l => l.id === id)?.label || id
  const shiftLabel = (id) => SHIFTS.find(s => s.id === id)?.label || id
  const vanLabel = (id) => VANS.find(v => v.id === id)?.label || id || 'None'

  const statusBadge = (status) => {
    const cls = {
      pending: 'badge-eoc-pending',
      completed: 'badge-eoc-completed',
      missed: 'badge-eoc-missed'
    }
    return <span className={`badge ${cls[status] || ''}`}>{status}</span>
  }

  const severityBadge = (severity) => (
    <span className={`chip severity-${severity}`} style={{ fontSize: '11px', textTransform: 'capitalize' }}>
      {severity}
    </span>
  )

  const selectStyle = {
    padding: '6px 10px',
    border: '2px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    fontSize: '13px',
    background: 'rgba(255,255,255,0.06)',
    color: '#e8e8e8'
  }

  const tabBtnStyle = (active) => ({
    padding: '8px 16px',
    backgroundColor: active ? '#E53935' : 'rgba(255,255,255,0.06)',
    color: active ? 'white' : '#8899aa',
    border: 'none',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer'
  })

  return (
    <div>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button style={tabBtnStyle(subTab === 'compliance')} onClick={() => setSubTab('compliance')}>
          Compliance
        </button>
        <button style={tabBtnStyle(subTab === 'assignments')} onClick={() => setSubTab('assignments')}>
          Assignments
        </button>
        <button style={tabBtnStyle(subTab === 'issues')} onClick={() => setSubTab('issues')}>
          Issues ({issues.filter(i => i.status === 'open').length})
        </button>
        <button style={tabBtnStyle(subTab === 'template')} onClick={() => setSubTab('template')}>
          Template
        </button>
        <button style={tabBtnStyle(subTab === 'vehicles')} onClick={() => setSubTab('vehicles')}>
          Vehicles
        </button>
      </div>

      {/* ===== COMPLIANCE TAB ===== */}
      {subTab === 'compliance' && (
        <div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <select value={filterLocation} onChange={e => setFilterLocation(e.target.value)} style={selectStyle}>
              <option value="all">All Locations</option>
              {LOCATIONS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
            <select value={filterShift} onChange={e => setFilterShift(e.target.value)} style={selectStyle}>
              <option value="all">All Shifts</option>
              {SHIFTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={selectStyle}>
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="completed">Completed</option>
              <option value="missed">Missed</option>
            </select>
            <select value={filterEocType} onChange={e => setFilterEocType(e.target.value)} style={selectStyle}>
              <option value="all">All Types</option>
              <option value="house">House</option>
              <option value="van">Van</option>
            </select>
          </div>

          {loadingAssignments ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#556677' }}>Loading...</div>
          ) : filteredAssignments.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#556677' }}>No assignments found</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredAssignments.map(a => (
                <div key={a.id} style={{
                  padding: '14px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.08)',
                  backgroundColor: 'rgba(255,255,255,0.05)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 700, fontSize: '14px' }}>
                      {locationLabel(a.locationId)} — {shiftLabel(a.shiftId)}
                    </span>
                    {statusBadge(a.status)}
                  </div>
                  <div style={{ fontSize: '13px', color: '#8899aa' }}>
                    Due: {a.dueDate} &bull; Tech: {a.assignedTechName || 'Unassigned'}
                    {a.eocType ? ` \u00B7 ${a.eocType.toUpperCase()}` : ''}
                    {a.vanId ? ` \u00B7 ${vanLabel(a.vanId)}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== ASSIGNMENTS TAB ===== */}
      {subTab === 'assignments' && (
        <div>
          {LEGACY_ASSIGNMENTS_READ_ONLY && (
            <div style={{ marginBottom: '10px', fontSize: '12px', color: '#FF9800' }}>
              Legacy `eocAssignments` records are read-only in this panel. Use `Assignments` tab in Supervisor Dashboard for active workflow changes.
            </div>
          )}
          <p style={{ fontSize: '13px', color: '#8899aa', marginBottom: '16px' }}>
            Manage upcoming assignments — reassign techs or override van assignments.
          </p>
          {loadingAssignments ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#556677' }}>Loading...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {assignments.filter(a => a.status === 'pending').map(a => (
                <div key={a.id} style={{
                  padding: '14px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.08)',
                  backgroundColor: 'rgba(255,255,255,0.05)'
                }}>
                  <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '8px' }}>
                    {locationLabel(a.locationId)} — {shiftLabel(a.shiftId)} {a.eocType ? `(${a.eocType.toUpperCase()})` : ''}
                  </div>
                  <div style={{ fontSize: '13px', color: '#8899aa', marginBottom: '8px' }}>
                    Due: {a.dueDate}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <div>
                      <label style={{ fontSize: '11px', color: '#556677' }}>Tech</label>
                      <div style={{ fontSize: '13px', fontWeight: 600 }}>
                        {a.assignedTechName || 'Unassigned'}
                      </div>
                    </div>
                    {a.eocType === 'van' && (
                      <div>
                        <label style={{ fontSize: '11px', color: '#556677', display: 'block' }}>Van</label>
                        <select
                          value={a.vanId || ''}
                          onChange={e => handleUpdateVan(a.id, e.target.value || null)}
                          disabled={LEGACY_ASSIGNMENTS_READ_ONLY}
                          style={selectStyle}
                        >
                          <option value="">None</option>
                          {VANS.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {assignments.filter(a => a.status === 'pending').length === 0 && (
                <div style={{ textAlign: 'center', padding: '30px', color: '#556677' }}>
                  No pending assignments
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===== ISSUES TAB ===== */}
      {subTab === 'issues' && (
        <div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <select value={filterLocation} onChange={e => setFilterLocation(e.target.value)} style={selectStyle}>
              <option value="all">All Locations</option>
              {LOCATIONS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
            <select value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)} style={selectStyle}>
              <option value="all">All Severity</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <select value={filterIssueStatus} onChange={e => setFilterIssueStatus(e.target.value)} style={selectStyle}>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="all">All</option>
            </select>
          </div>

          {loadingIssues ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#556677' }}>Loading...</div>
          ) : filteredIssues.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#556677' }}>No issues found</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredIssues.map(issue => (
                <div key={issue.id} style={{
                  padding: '14px',
                  borderRadius: '8px',
                  border: issue.severity === 'high' ? '2px solid #FF5722' : '1px solid rgba(255,255,255,0.08)',
                  backgroundColor: 'rgba(255,255,255,0.05)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 700, fontSize: '14px' }}>
                      {issue.label}
                    </span>
                    {severityBadge(issue.severity)}
                  </div>
                  <div style={{ fontSize: '13px', color: '#8899aa', marginBottom: '4px' }}>
                    {issue.description}
                  </div>
                  <div style={{ fontSize: '12px', color: '#556677', marginBottom: '8px' }}>
                    {locationLabel(issue.locationId)} &bull; {issue.reportedByName}
                    {issue.vanId ? ` \u00B7 ${vanLabel(issue.vanId)}` : ''}
                  </div>

                  {issue.status === 'open' ? (
                    resolvingIssue?.id === issue.id ? (
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input
                          className="input"
                          placeholder="Resolution notes..."
                          value={resolveNotes}
                          onChange={e => setResolveNotes(e.target.value)}
                          style={{ flex: 1, padding: '6px 10px', fontSize: '13px' }}
                        />
                        <button
                          onClick={handleResolveIssue}
                          style={{
                            padding: '6px 14px', backgroundColor: '#4CAF50', color: 'white',
                            border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
                            cursor: 'pointer'
                          }}
                        >
                          Resolve
                        </button>
                        <button
                          onClick={() => { setResolvingIssue(null); setResolveNotes('') }}
                          style={{
                            padding: '6px 14px', backgroundColor: 'rgba(255,255,255,0.06)', color: '#8899aa',
                            border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer'
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setResolvingIssue(issue)}
                        style={{
                          padding: '6px 14px', backgroundColor: 'rgba(255,255,255,0.06)', color: '#e8e8e8',
                          border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        Mark Resolved
                      </button>
                    )
                  ) : (
                    <div style={{ fontSize: '12px', color: '#4CAF50', fontWeight: 600 }}>
                      Resolved {issue.resolvedNotes ? `— ${issue.resolvedNotes}` : ''}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== TEMPLATE TAB ===== */}
      {subTab === 'template' && (
        <div>
          <p style={{ fontSize: '13px', color: '#8899aa', marginBottom: '16px' }}>
            Draft -&gt; Diff -&gt; Publish workflow. Draft edits do not affect active checklists until publish.
          </p>
          <div style={{ marginBottom: '12px' }}>
            <select value={templateType} onChange={e => handleTemplateTypeChange(e.target.value)} style={selectStyle}>
              <option value="house">House Template</option>
              <option value="van">Van Template</option>
            </select>
          </div>

          {(loadingPublishedTemplate || loadingDraftTemplate) ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#556677' }}>Loading template data...</div>
          ) : (
            <>
              <div style={{
                backgroundColor: 'rgba(255,255,255,0.03)',
                borderRadius: '10px',
                border: '1px solid rgba(255,255,255,0.08)',
                padding: '12px',
                marginBottom: '12px'
              }}>
                <div style={{ fontSize: '12px', color: '#8899aa', marginBottom: '8px' }}>
                  Live template: {publishedTemplateItems.length} item(s)
                  {lastPublishedVersion ? ` · v${lastPublishedVersion.version || 0}` : ' · not published yet'}
                  {lastPublishedVersion?.versionNote ? ` · "${lastPublishedVersion.versionNote}"` : ''}
                </div>
                <div style={{ fontSize: '12px', color: '#8899aa', marginBottom: '8px' }}>
                  Draft: {draftTemplateItems.length} item(s) · {templateDiff.hasChanges ? 'changes detected' : 'no changes'}
                </div>
                {!isTemplateAdmin && (
                  <div style={{ fontSize: '12px', color: '#FF9800' }}>
                    Read-only: only admin can edit drafts and publish templates.
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                <button onClick={handleDraftFromPublished} style={tabBtnStyle(true)} disabled={!isTemplateAdmin || isOffline}>
                  {draftTemplateItems.length > 0 ? 'Reset Draft From Published' : 'Start Draft From Published'}
                </button>
                <button onClick={handleDraftFromDefaults} style={tabBtnStyle(false)} disabled={!isTemplateAdmin || isOffline}>
                  Replace Draft With Defaults
                </button>
                <button onClick={handleDiscardDraft} style={tabBtnStyle(false)} disabled={!isTemplateAdmin || isOffline || draftTemplateItems.length === 0}>
                  Discard Draft
                </button>
              </div>

              <div style={{
                backgroundColor: 'rgba(255,255,255,0.05)',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '16px',
                border: '1px solid rgba(255,255,255,0.08)'
              }}>
                <h4 style={{ margin: '0 0 12px 0', color: '#e8e8e8', fontSize: '14px' }}>
                  {editingTemplateId ? 'Edit Draft Item' : 'Add Draft Item'}
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '11px', color: '#556677' }}>Category</label>
                    <input
                      className="input"
                      value={templateForm.category}
                      onChange={e => setTemplateForm({ ...templateForm, category: e.target.value })}
                      disabled={!isTemplateAdmin || isOffline}
                      placeholder="Exterior"
                      style={{ fontSize: '13px' }}
                    />
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <label style={{ fontSize: '11px', color: '#556677' }}>Label</label>
                    <input
                      className="input"
                      value={templateForm.label}
                      onChange={e => setTemplateForm({ ...templateForm, label: e.target.value })}
                      disabled={!isTemplateAdmin || isOffline}
                      placeholder="Tire condition and pressure"
                      style={{ fontSize: '13px' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: '#556677' }}>Order</label>
                    <input
                      className="input"
                      type="number"
                      value={templateForm.order}
                      onChange={e => setTemplateForm({ ...templateForm, order: e.target.value })}
                      disabled={!isTemplateAdmin || isOffline}
                      style={{ fontSize: '13px' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: '#556677', display: 'block' }}>Active</label>
                    <select
                      value={templateForm.active ? 'true' : 'false'}
                      onChange={e => setTemplateForm({ ...templateForm, active: e.target.value === 'true' })}
                      disabled={!isTemplateAdmin || isOffline}
                      style={selectStyle}
                    >
                      <option value="true">Active</option>
                      <option value="false">Inactive</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <button onClick={handleSaveTemplateItem} style={tabBtnStyle(true)} disabled={!isTemplateAdmin || isOffline}>
                    {editingTemplateId ? 'Save Changes' : 'Add Item'}
                  </button>
                  {editingTemplateId && (
                    <button
                      onClick={() => { setEditingTemplateId(null); setTemplateForm({ category: '', label: '', order: 0, active: true }) }}
                      style={tabBtnStyle(false)}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>

              <div style={{
                backgroundColor: 'rgba(255,255,255,0.03)',
                borderRadius: '10px',
                border: '1px solid rgba(255,255,255,0.08)',
                padding: '12px',
                marginBottom: '12px'
              }}>
                <div style={{ fontSize: '12px', color: '#e8e8e8', marginBottom: '6px', fontWeight: 700 }}>
                  Draft vs Published Diff
                </div>
                <div style={{ fontSize: '12px', color: '#8899aa', marginBottom: '6px' }}>
                  Added: {templateDiff.added.length} · Removed: {templateDiff.removed.length} · Changed: {templateDiff.changed.length} · Unchanged: {templateDiff.unchangedCount}
                </div>
                {templateDiff.hasChanges ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: '#8899aa' }}>
                    {templateDiff.added.slice(0, 5).map(item => (
                      <div key={`add:${item.id || templateDiffKey(item)}`}>+ {item.category} · {item.label}</div>
                    ))}
                    {templateDiff.removed.slice(0, 5).map(item => (
                      <div key={`remove:${item.id || templateDiffKey(item)}`}>- {item.category} · {item.label}</div>
                    ))}
                    {templateDiff.changed.slice(0, 5).map(entry => (
                      <div key={`change:${entry.draftItem.id || templateDiffKey(entry.draftItem)}`}>
                        ~ {entry.draftItem.category} · {entry.draftItem.label} (order {entry.publishedItem.order || 0} -&gt; {entry.draftItem.order || 0}, {(entry.publishedItem.active !== false) ? 'active' : 'inactive'} -&gt; {(entry.draftItem.active !== false) ? 'active' : 'inactive'})
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: '12px', color: '#8899aa' }}>
                    No publishable differences yet.
                  </div>
                )}
              </div>

              <div style={{
                backgroundColor: 'rgba(255,255,255,0.05)',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '16px',
                border: '1px solid rgba(255,255,255,0.08)'
              }}>
                <h4 style={{ margin: '0 0 10px 0', color: '#e8e8e8', fontSize: '14px' }}>Publish Draft</h4>
                <div style={{ marginBottom: '10px' }}>
                  <label style={{ fontSize: '11px', color: '#556677', display: 'block', marginBottom: '4px' }}>
                    Version Note (required)
                  </label>
                  <input
                    className="input"
                    value={templateVersionNote}
                    onChange={e => setTemplateVersionNote(e.target.value)}
                    disabled={!isTemplateAdmin || isOffline}
                    placeholder="What changed in this publish?"
                    style={{ fontSize: '13px' }}
                  />
                </div>
                <button
                  onClick={handlePublishTemplate}
                  style={tabBtnStyle(true)}
                  disabled={!isTemplateAdmin || isOffline || draftTemplateItems.length === 0 || !templateDiff.hasChanges}
                >
                  Publish Draft
                </button>
              </div>

              {draftTemplateItems.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', color: '#556677' }}>
                  No draft items yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {draftTemplateItems.map(item => (
                    <div key={item.id} style={{
                      padding: '12px',
                      borderRadius: '8px',
                      border: '1px solid rgba(255,255,255,0.08)',
                      backgroundColor: 'rgba(255,255,255,0.05)'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontWeight: 700, fontSize: '14px' }}>
                          {item.category} — {item.label}
                        </span>
                        <span className="badge" style={{ background: item.active === false ? 'rgba(255,255,255,0.06)' : 'rgba(76,175,80,0.15)', color: '#e8e8e8' }}>
                          {item.active === false ? 'Inactive' : 'Active'}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: '#8899aa', marginBottom: '8px' }}>
                        Order: {item.order || 0}
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => handleEditTemplateItem(item)} style={tabBtnStyle(false)} disabled={!isTemplateAdmin || isOffline}>Edit</button>
                        <button onClick={() => handleDeleteTemplateItem(item.id)} style={tabBtnStyle(false)} disabled={!isTemplateAdmin || isOffline}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ===== VEHICLES TAB ===== */}
      {subTab === 'vehicles' && (
        <div>
          <p style={{ fontSize: '13px', color: '#8899aa', marginBottom: '16px' }}>
            Manage vehicle details (name, VIN) and assign vans to locations.
          </p>

          <div style={{
            backgroundColor: 'rgba(255,255,255,0.05)',
            borderRadius: '12px',
            padding: '16px',
            marginBottom: '16px',
            border: '1px solid rgba(255,255,255,0.08)'
          }}>
            <h4 style={{ margin: '0 0 12px 0', color: '#e8e8e8', fontSize: '14px' }}>
              {editingVehicleId ? 'Edit Vehicle' : 'Add Vehicle'}
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '11px', color: '#556677' }}>Vehicle Name</label>
                <input
                  className="input"
                  value={vehicleForm.name}
                  onChange={e => setVehicleForm({ ...vehicleForm, name: e.target.value })}
                  placeholder="Girls Php Van"
                  style={{ fontSize: '13px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#556677' }}>VIN</label>
                <input
                  className="input"
                  value={vehicleForm.vin}
                  onChange={e => setVehicleForm({ ...vehicleForm, vin: e.target.value })}
                  placeholder="VIN number"
                  style={{ fontSize: '13px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#556677', display: 'block' }}>Van</label>
                <select
                  value={vehicleForm.vanId}
                  onChange={e => setVehicleForm({ ...vehicleForm, vanId: e.target.value })}
                  style={selectStyle}
                >
                  <option value="">None</option>
                  {VANS.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#556677', display: 'block' }}>Location</label>
                <select
                  value={vehicleForm.locationId}
                  onChange={e => setVehicleForm({ ...vehicleForm, locationId: e.target.value })}
                  style={selectStyle}
                >
                  <option value="">Unassigned</option>
                  {LOCATIONS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#556677', display: 'block' }}>Active</label>
                <select
                  value={vehicleForm.active ? 'true' : 'false'}
                  onChange={e => setVehicleForm({ ...vehicleForm, active: e.target.value === 'true' })}
                  style={selectStyle}
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button onClick={handleSaveVehicle} style={tabBtnStyle(true)}>
                {editingVehicleId ? 'Save Changes' : 'Add Vehicle'}
              </button>
              {editingVehicleId && (
                <button
                  onClick={() => { setEditingVehicleId(null); setVehicleForm({ name: '', vin: '', vanId: '', locationId: '', active: true }) }}
                  style={tabBtnStyle(false)}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>

          {loadingVehicles ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#556677' }}>Loading...</div>
          ) : vehicles.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#556677' }}>No vehicles found</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {vehicles.map(v => (
                <div key={v.id} style={{
                  padding: '12px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.08)',
                  backgroundColor: 'rgba(255,255,255,0.05)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ fontWeight: 700, fontSize: '14px' }}>{v.name}</span>
                    <span className="badge" style={{ background: v.active === false ? 'rgba(255,255,255,0.06)' : 'rgba(76,175,80,0.15)', color: '#e8e8e8' }}>
                      {v.active === false ? 'Inactive' : 'Active'}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#8899aa', marginBottom: '8px' }}>
                    VIN: {v.vin || '--'} &bull; Van: {vanLabel(v.vanId)} &bull; Location: {v.locationId ? locationLabel(v.locationId) : 'Unassigned'}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => handleEditVehicle(v)} style={tabBtnStyle(false)}>Edit</button>
                    <button onClick={() => handleDeleteVehicle(v.id)} style={tabBtnStyle(false)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default SupervisorEocPanel

