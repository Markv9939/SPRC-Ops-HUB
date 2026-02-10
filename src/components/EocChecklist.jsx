import { useState, useEffect } from 'react'
import { db } from '../firebase'
import { doc, getDoc, updateDoc, addDoc, collection, serverTimestamp, writeBatch, query, orderBy, onSnapshot } from 'firebase/firestore'
import { EOC_CHECKLIST_TEMPLATE, VANS } from '../data/eocConstants'

function EocChecklist({ assignmentId, user, onComplete, onBack }) {
  const [assignment, setAssignment] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [templateItems, setTemplateItems] = useState([])
  const [staffCompleting, setStaffCompleting] = useState('')
  const [vehicleName, setVehicleName] = useState('')
  const [vinNumber, setVinNumber] = useState('')
  const [odometerReading, setOdometerReading] = useState('')
  const [answers, setAnswers] = useState({})
  // For "Repair" items: { itemId: { description } }
  const [repairDetails, setRepairDetails] = useState({})
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadAssignment() {
      try {
        const snap = await getDoc(doc(db, 'eocAssignments', assignmentId))
        if (!snap.exists()) {
          setError('Assignment not found')
          setLoading(false)
          return
        }
        const data = snap.data()
        if (data.status !== 'pending' && data.status !== 'missed') {
          setError(`This EOC has already been ${data.status}`)
          setLoading(false)
          return
        }
        const vanLabel = VANS.find(v => v.id === data.vanId)?.label || ''
        setStaffCompleting(user?.name || '')
        setVehicleName(vanLabel)
        setAssignment({ id: snap.id, ...data })
      } catch (err) {
        console.error('Error loading assignment:', err)
        setError('Failed to load assignment')
      } finally {
        setLoading(false)
      }
    }
    loadAssignment()
  }, [assignmentId])

  useEffect(() => {
    const q = query(collection(db, 'eocChecklistTemplate'), orderBy('order', 'asc'))
    const unsub = onSnapshot(q, (snap) => {
      setTemplateItems(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    return () => unsub()
  }, [])

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
    if (templateItems.length === 0) return EOC_CHECKLIST_TEMPLATE
    const filtered = templateItems.filter(i => i.active !== false)
    return filtered.length > 0 ? filtered : EOC_CHECKLIST_TEMPLATE
  })()

  const validate = () => {
    if (!staffCompleting.trim()) return 'Please enter staff completing EOC'
    if (!odometerReading.trim()) return 'Please enter odometer reading'
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

  const handleSubmit = async () => {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const batch = writeBatch(db)

      // Build answers array
      const answersData = activeTemplate.map(item => ({
        itemId: item.id,
        label: item.label,
        category: item.category,
        status: answers[item.id],
        ...(answers[item.id] === 'repair' ? {
          description: repairDetails[item.id]?.description || ''
        } : {})
      }))

      const issueItems = answersData.filter(a => a.status === 'repair')

      // 1. Create submission doc
      const submissionRef = doc(collection(db, 'eocSubmissions'))
      batch.set(submissionRef, {
        assignmentId,
        locationId: assignment.locationId,
        shiftId: assignment.shiftId,
        vanId: assignment.vanId,
        dueDate: assignment.dueDate,
        staffCompleting: staffCompleting.trim(),
        vehicleName: vehicleName.trim(),
        vinNumber: vinNumber.trim(),
        odometerReading: odometerReading.trim(),
        answers: answersData,
        issueCount: issueItems.length,
        submittedByUserId: user.id,
        submittedByName: user.name,
        submittedAt: serverTimestamp(),
        createdAt: serverTimestamp()
      })

      // 2. Update assignment status
      const assignmentRef = doc(db, 'eocAssignments', assignmentId)
      batch.update(assignmentRef, {
        status: 'completed',
        submissionId: submissionRef.id,
        updatedAt: serverTimestamp()
      })

      // 3. Create issue docs + supervisor alerts for each attention item
      for (const issue of issueItems) {
        const issueRef = doc(collection(db, 'eocIssues'))
        batch.set(issueRef, {
          assignmentId,
          submissionId: submissionRef.id,
          locationId: assignment.locationId,
          shiftId: assignment.shiftId,
          vanId: assignment.vanId,
          itemId: issue.itemId,
          label: issue.label,
          category: issue.category,
          description: issue.description,
          severity: 'medium',
          status: 'open',
          reportedByUserId: user.id,
          reportedByName: user.name,
          createdAt: serverTimestamp()
        })

        const alertRef = doc(collection(db, 'supervisorAlerts'))
        batch.set(alertRef, {
          type: 'eoc_issue',
          issueId: issueRef.id,
          assignmentId,
          locationId: assignment.locationId,
          severity: 'medium',
          message: `EOC issue: ${issue.label} — ${issue.description}`,
          techName: user.name,
          read: false,
          createdAt: serverTimestamp()
        })
      }

      await batch.commit()
      onComplete()
    } catch (err) {
      console.error('Error submitting EOC:', err)
      setError('Failed to submit. Please try again.')
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

  if (error && !assignment) {
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

  // Group items by category
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
            background: 'none', border: 'none', fontSize: '24px',
            cursor: 'pointer', color: '#8899aa', padding: '4px'
          }}
        >
          ←
        </button>
        <div>
          <h2 style={{ margin: 0, fontSize: '18px', color: '#e8e8e8' }}>EOC Checklist</h2>
          <div style={{ fontSize: '13px', color: '#8899aa' }}>
            Due: {assignment.dueDate} &bull; {assignment.locationId}
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
        <div style={{ fontSize: '12px', color: '#8899aa', marginBottom: '8px' }}>Vehicle Receiving Inspection</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
          <input
            className="input"
            value={vehicleName}
            onChange={(e) => setVehicleName(e.target.value)}
            placeholder="Vehicle name (e.g., Girls Php Van)"
          />
          <input
            className="input"
            value={vinNumber}
            onChange={(e) => setVinNumber(e.target.value)}
            placeholder="VIN number"
          />
          <input
            className="input"
            value={odometerReading}
            onChange={(e) => setOdometerReading(e.target.value)}
            placeholder="Odometer reading"
          />
        </div>
      </div>

      {categories.map(cat => (
        <div key={cat} style={{ marginBottom: '20px' }}>
          <div className="eoc-category-header">{cat}</div>
          <div style={{ display: 'flex', gap: '8px', fontSize: '11px', color: '#8899aa', margin: '6px 0 10px' }}>
            <span style={{ minWidth: '52px' }}>OK</span>
            <span style={{ minWidth: '72px' }}>REPAIR</span>
            <span>If repair, add details</span>
          </div>
          {activeTemplate.filter(i => i.category === cat).map(item => (
            <div key={item.id} className="eoc-item">
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

      <button
        className={`btn ${allAnswered ? 'btn-finish' : 'btn-disabled'}`}
        onClick={handleSubmit}
        disabled={submitting || !allAnswered}
        style={{ width: '100%', fontSize: '18px', borderRadius: 'var(--radius)' }}
      >
        {submitting ? 'Submitting...' : 'Submit EOC'}
      </button>
    </div>
  )
}

export default EocChecklist
