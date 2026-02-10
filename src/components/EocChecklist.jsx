import { useState, useEffect } from 'react'
import { db } from '../firebase'
import { doc, getDoc, updateDoc, addDoc, collection, serverTimestamp, writeBatch } from 'firebase/firestore'
import { EOC_CHECKLIST_TEMPLATE } from '../data/eocConstants'

function EocChecklist({ assignmentId, user, onComplete, onBack }) {
  const [assignment, setAssignment] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [answers, setAnswers] = useState({})
  // For "Needs Attention" items: { itemId: { description, severity } }
  const [attentionDetails, setAttentionDetails] = useState({})
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

  const setAnswer = (itemId, value) => {
    setAnswers(prev => ({ ...prev, [itemId]: value }))
    if (value === 'ok') {
      setAttentionDetails(prev => {
        const next = { ...prev }
        delete next[itemId]
        return next
      })
    }
  }

  const setAttentionField = (itemId, field, value) => {
    setAttentionDetails(prev => ({
      ...prev,
      [itemId]: { ...(prev[itemId] || { description: '', severity: 'low' }), [field]: value }
    }))
  }

  const validate = () => {
    for (const item of EOC_CHECKLIST_TEMPLATE) {
      if (!answers[item.id]) return `Please complete all checklist items (missing: ${item.label})`
      if (answers[item.id] === 'attention') {
        const detail = attentionDetails[item.id]
        if (!detail || !detail.description.trim()) {
          return `Please describe the issue for: ${item.label}`
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
      const answersData = EOC_CHECKLIST_TEMPLATE.map(item => ({
        itemId: item.id,
        label: item.label,
        category: item.category,
        status: answers[item.id],
        ...(answers[item.id] === 'attention' ? {
          description: attentionDetails[item.id]?.description || '',
          severity: attentionDetails[item.id]?.severity || 'low'
        } : {})
      }))

      const issueItems = answersData.filter(a => a.status === 'attention')

      // 1. Create submission doc
      const submissionRef = doc(collection(db, 'eocSubmissions'))
      batch.set(submissionRef, {
        assignmentId,
        locationId: assignment.locationId,
        shiftId: assignment.shiftId,
        vanId: assignment.vanId,
        dueDate: assignment.dueDate,
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
          severity: issue.severity,
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
          severity: issue.severity,
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
  for (const item of EOC_CHECKLIST_TEMPLATE) {
    if (!seen.has(item.category)) {
      seen.add(item.category)
      categories.push(item.category)
    }
  }

  const allAnswered = EOC_CHECKLIST_TEMPLATE.every(item => answers[item.id])

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

      {categories.map(cat => (
        <div key={cat} style={{ marginBottom: '20px' }}>
          <div className="eoc-category-header">{cat}</div>
          {EOC_CHECKLIST_TEMPLATE.filter(i => i.category === cat).map(item => (
            <div key={item.id} className="eoc-item">
              <div style={{ marginBottom: '8px', fontSize: '14px', color: '#e8e8e8' }}>
                {item.label}
              </div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: answers[item.id] === 'attention' ? '10px' : '0' }}>
                <button
                  className={`chip ${answers[item.id] === 'ok' ? 'chip-ok' : 'chip-unselected'}`}
                  onClick={() => setAnswer(item.id, 'ok')}
                >
                  OK
                </button>
                <button
                  className={`chip ${answers[item.id] === 'attention' ? 'chip-attention' : 'chip-unselected'}`}
                  onClick={() => setAnswer(item.id, 'attention')}
                >
                  Needs Attention
                </button>
              </div>

              {answers[item.id] === 'attention' && (
                <div className="eoc-item-attention">
                  <input
                    className="input"
                    placeholder="Describe the issue..."
                    value={attentionDetails[item.id]?.description || ''}
                    onChange={(e) => setAttentionField(item.id, 'description', e.target.value)}
                    style={{ marginBottom: '8px' }}
                  />
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {['low', 'medium', 'high'].map(sev => (
                      <button
                        key={sev}
                        className={`chip ${(attentionDetails[item.id]?.severity || 'low') === sev ? `severity-${sev}` : 'chip-unselected'}`}
                        onClick={() => setAttentionField(item.id, 'severity', sev)}
                        style={{ textTransform: 'capitalize', fontSize: '12px' }}
                      >
                        {sev}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}

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
