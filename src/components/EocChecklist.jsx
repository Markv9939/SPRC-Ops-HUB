import { useState, useEffect } from 'react'
import { db } from '../firebase'
import { doc, getDoc, collection, serverTimestamp, query, orderBy, onSnapshot, where, getDocs, runTransaction } from 'firebase/firestore'
import { EOC_VAN_TEMPLATE, EOC_HOUSE_TEMPLATE, VANS, LOCATIONS } from '../data/eocConstants'
import { assertExpectedVersion, formatVersionConflictMessage, getVersionNumber } from '../services/versioning'
import { requireOnline } from '../utils/networkGuard'

function EocChecklist({ taskId, user, onComplete, onBack, isOffline = false }) {
  const [task, setTask] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [templateItems, setTemplateItems] = useState([])
  const [staffCompleting, setStaffCompleting] = useState('')
  const [vehicleName, setVehicleName] = useState('')
  const [vinNumber, setVinNumber] = useState('')
  const [odometerReading, setOdometerReading] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [eocType, setEocType] = useState('')
  const [answers, setAnswers] = useState({})
  const [repairDetails, setRepairDetails] = useState({})
  const [error, setError] = useState('')

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
          ? eligibleUserIds.includes(user?.id)
          : (!data.assigneeUserId || data.assigneeUserId === user?.id)
        if (!canCurrentUserComplete) {
          setError('You are not eligible to complete this EOC task.')
          setLoading(false)
          return
        }

        const nextType = data.taskType || data.eocType || ''
        setEocType(nextType)

        if (nextType === 'van') {
          const vanLabel = VANS.find(v => v.id === data.vanId)?.label || ''
          setVehicleName(vanLabel)
        } else {
          setVehicleName('')
          setVinNumber('')
        }

        setStaffCompleting(user?.name || '')
        setTask({ id: snap.id, ...data, version: getVersionNumber(data) })
      } catch (err) {
        console.error('Error loading task:', err)
        setError('Failed to load task')
      } finally {
        setLoading(false)
      }
    }

    loadTask()
  }, [taskId, user?.id, user?.name])

  useEffect(() => {
    if (!eocType) return

    const q = query(
      collection(db, 'eocChecklistTemplate'),
      where('eocType', '==', eocType),
      orderBy('order', 'asc')
    )

    const unsub = onSnapshot(q, (snap) => {
      setTemplateItems(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })

    return () => unsub()
  }, [eocType])

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

  const setAnswer = (itemId, value) => {
    setAnswers(prev => ({ ...prev, [itemId]: value }))
    if (value === 'ok') {
      setRepairDetails(prev => {
        const next = { ...prev }
        delete next[itemId]
        return next
      })
    }
  }

  const setRepairField = (itemId, value) => {
    setRepairDetails(prev => ({
      ...prev,
      [itemId]: { description: value }
    }))
  }

  const activeTemplate = (() => {
    const fallback = eocType === 'van' ? EOC_VAN_TEMPLATE : EOC_HOUSE_TEMPLATE
    if (templateItems.length === 0) return fallback
    const filtered = templateItems.filter(i => i.active !== false)
    return filtered.length > 0 ? filtered : fallback
  })()

  const validate = () => {
    if (!staffCompleting.trim()) return 'Please enter staff completing EOC'
    if (eocType === 'van' && !odometerReading.trim()) return 'Please enter odometer reading'

    for (const item of activeTemplate) {
      if (!answers[item.id]) return `Please complete all checklist items (missing: ${item.label})`
      if (answers[item.id] === 'repair') {
        const detail = repairDetails[item.id]
        if (!detail || !detail.description.trim()) {
          return `Please describe the repair for: ${item.label}`
        }
      }
    }

    return null
  }

  const handleMarkAllOk = () => {
    const nextAnswers = {}
    for (const item of activeTemplate) {
      nextAnswers[item.id] = 'ok'
    }
    setAnswers(nextAnswers)
    setRepairDetails({})
    setError('')
  }

  const handleSubmit = async () => {
    if (isOffline) {
      requireOnline('submitting EOC')
      return
    }

    const validationError = validate()
    if (validationError) {
      setError(validationError)
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
          ? latestEligibleUserIds.includes(user?.id)
          : (!latestTask.assigneeUserId || latestTask.assigneeUserId === user?.id)
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
          vanId: task.vanId || null,
          dueDate: task.dueDate,
          staffCompleting: staffCompleting.trim(),
          eocType,
          vehicleId: vehicleId || null,
          vehicleName: vehicleName.trim(),
          vinNumber: vinNumber.trim(),
          odometerReading: eocType === 'van' ? odometerReading.trim() : '',
          answers: answersData,
          issueCount: issueItems.length,
          submittedByUserId: user.id,
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
          completedByUserId: user.id,
          completedByName: user.name,
          version: nextVersion,
          updatedAt: serverTimestamp()
        })

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
            reportedByUserId: user.id,
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

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#556677' }}>
        Loading checklist...
      </div>
    )
  }

  if (error && !task) {
    return (
      <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
        <div className="glass-card" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <p style={{ color: '#C94A3F', marginBottom: '16px' }}>{error}</p>
          <button className="btn" onClick={onBack} style={{ background: 'rgba(255,255,255,0.06)', color: '#e8e8e8' }}>
            Back
          </button>
        </div>
      </div>
    )
  }

  const categories = []
  const seen = new Set()
  for (const item of activeTemplate) {
    if (!seen.has(item.category)) {
      seen.add(item.category)
      categories.push(item.category)
    }
  }

  const allAnswered = activeTemplate.every(item => answers[item.id])

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto', paddingBottom: '100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '24px',
            cursor: 'pointer',
            color: '#8899aa',
            padding: '4px'
          }}
        >
          {'<-'}
        </button>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px', color: '#e8e8e8' }}>
            {eocType === 'van' ? 'Van EOC Checklist' : 'House EOC Checklist'}
          </h2>
          <div style={{ fontSize: '13px', color: '#8899aa' }}>
            Due: {task?.dueDate} - {task?.locationId}
          </div>
        </div>
      </div>

      <div className="glass-card" style={{ padding: '14px', marginBottom: '16px' }}>
        <div style={{ fontSize: '12px', color: '#8899aa', marginBottom: '8px' }}>Staff Completing EOC</div>
        <input
          className="input"
          value={staffCompleting}
          onChange={(e) => setStaffCompleting(e.target.value)}
          placeholder="Staff name(s)"
          style={{ marginBottom: '10px' }}
        />
        {eocType === 'van' ? (
          <>
            <div style={{ fontSize: '12px', color: '#8899aa', marginBottom: '8px' }}>Vehicle Receiving Inspection</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
              <input className="input" value={vehicleName} readOnly placeholder="Vehicle name" />
              <input className="input" value={vinNumber} readOnly placeholder="VIN number" />
              <input
                className="input"
                value={odometerReading}
                onChange={(e) => setOdometerReading(e.target.value)}
                placeholder="Odometer reading"
              />
            </div>
            {(!vehicleName || !vinNumber) && (
              <div style={{ marginTop: '8px', fontSize: '12px', color: '#FF9800' }}>
                Vehicle details missing - ask supervisor to set vehicle name/VIN.
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: '13px', color: '#8899aa' }}>
            House: {LOCATIONS.find(l => l.id === task?.locationId)?.label || task?.locationId}
          </div>
        )}
      </div>

      <div style={{ marginBottom: '14px' }}>
        <button
          className="btn btn-eoc"
          onClick={handleMarkAllOk}
          style={{ width: '100%', fontSize: '14px', borderRadius: '8px' }}
        >
          Mark All OK
        </button>
      </div>

      {categories.map(cat => (
        <div key={cat} style={{ marginBottom: '20px' }}>
          <div className="eoc-category-header">{cat}</div>
          <div style={{ display: 'flex', gap: '8px', fontSize: '11px', color: '#8899aa', margin: '6px 0 10px' }}>
            <span style={{ minWidth: '52px' }}>OK</span>
            <span style={{ minWidth: '72px' }}>REPAIR</span>
            <span>If repair, add details</span>
          </div>
          {activeTemplate.filter(i => i.category === cat).map((item, idx) => (
            <div
              key={item.id}
              className="eoc-item"
              style={{
                background: idx % 2 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
                borderRadius: '10px',
                padding: '12px',
                border: '1px solid rgba(255,255,255,0.06)'
              }}
            >
              <div style={{ marginBottom: '8px', fontSize: '14px', color: '#e8e8e8' }}>
                {item.label}
              </div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: answers[item.id] === 'repair' ? '10px' : '0' }}>
                <button
                  className={`chip ${answers[item.id] === 'ok' ? 'chip-ok' : 'chip-unselected'}`}
                  onClick={() => setAnswer(item.id, 'ok')}
                >
                  OK
                </button>
                <button
                  className={`chip ${answers[item.id] === 'repair' ? 'chip-attention' : 'chip-unselected'}`}
                  onClick={() => setAnswer(item.id, 'repair')}
                >
                  Repair
                </button>
              </div>

              {answers[item.id] === 'repair' && (
                <div className="eoc-item-attention">
                  <input
                    className="input"
                    placeholder="If repair, note changes needed..."
                    value={repairDetails[item.id]?.description || ''}
                    onChange={(e) => setRepairField(item.id, e.target.value)}
                    style={{ marginBottom: '8px' }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      ))}

      <div style={{ fontSize: '12px', color: '#8899aa', marginBottom: '16px' }}>
        Checklist must be completed on a weekly basis by staff on the first day of each shift. To be turned in to Supervisor following day.
      </div>

      {error && (
        <div style={{ color: '#C94A3F', fontSize: '13px', marginBottom: '12px', textAlign: 'center' }}>
          {error}
        </div>
      )}
      {isOffline && (
        <div style={{ color: '#FF9800', fontSize: '12px', marginBottom: '12px', textAlign: 'center' }}>
          Offline mode is active. EOC submission is disabled until connection is restored.
        </div>
      )}

      <button
        className={`btn ${allAnswered ? 'btn-finish' : 'btn-disabled'}`}
        onClick={handleSubmit}
        disabled={submitting || !allAnswered || isOffline}
        style={{ width: '100%', fontSize: '18px', borderRadius: 'var(--radius)' }}
      >
        {submitting ? 'Submitting...' : 'Submit EOC'}
      </button>
    </div>
  )
}

export default EocChecklist

