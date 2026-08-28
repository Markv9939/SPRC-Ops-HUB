import { useEffect, useMemo, useState } from 'react'
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { buildCurrentEocStatusRows, buildEocCompletionHistory, findMissingBhtAssignments } from '../utils/supervisorEocModel'

export default function useSupervisorEocOverview({ inEocScope, exactLocationIds = [], isAdmin = false }) {
  const [tasks, setTasks] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [shiftAssignments, setShiftAssignments] = useState([])
  const [templateAssignments, setTemplateAssignments] = useState([])
  const [historyLimit, setHistoryLimit] = useState(50)
  const hasReadableScope = isAdmin || exactLocationIds.some(value => String(value || '').trim())

  useEffect(() => {
    const scopedLocations = [...new Set(exactLocationIds.map(value => String(value || '').trim().toLowerCase()).filter(Boolean))]
    if (!isAdmin && scopedLocations.length === 0) return () => {}

    const tasksQuery = isAdmin
      ? query(collection(db, 'eocTasks'), limit(500))
      : query(collection(db, 'eocTasks'), where('locationId', 'in', scopedLocations), limit(500))
    const submissionsQuery = isAdmin
      ? query(collection(db, 'eocSubmissions'), orderBy('submittedAt', 'desc'), limit(historyLimit))
      : query(collection(db, 'eocSubmissions'), where('locationId', 'in', scopedLocations))
    const shiftAssignmentsQuery = isAdmin
      ? query(collection(db, 'shiftAssignments'), where('active', '==', true))
      : query(collection(db, 'shiftAssignments'), where('locationId', 'in', scopedLocations))
    const templateAssignmentsQuery = isAdmin
      ? collection(db, 'eocTemplateAssignments')
      : query(collection(db, 'eocTemplateAssignments'), where('locationId', 'in', scopedLocations))

    const reportListenerError = label => error => console.error(`Supervisor EOC ${label} listener failed:`, error)
    const unsubs = [
      onSnapshot(tasksQuery, snap => setTasks(snap.docs.map(item => ({ id: item.id, ...item.data() })).filter(row => !inEocScope || inEocScope(row.locationId))), reportListenerError('tasks')),
      onSnapshot(submissionsQuery, snap => setSubmissions(snap.docs.map(item => ({ id: item.id, ...item.data() })).filter(row => !inEocScope || inEocScope(row.locationId))), reportListenerError('submissions')),
      onSnapshot(shiftAssignmentsQuery, snap => setShiftAssignments(snap.docs.map(item => ({ id: item.id, ...item.data() })).filter(row => row.active === true && (!inEocScope || inEocScope(row.locationId)))), reportListenerError('shift assignments')),
      onSnapshot(templateAssignmentsQuery, snap => setTemplateAssignments(snap.docs.map(item => ({ id: item.id, ...item.data() })).filter(row => !inEocScope || inEocScope(row.locationId))), reportListenerError('template assignments'))
    ]
    return () => unsubs.forEach(unsub => unsub())
  }, [exactLocationIds, historyLimit, inEocScope, isAdmin])

  return useMemo(() => ({
    statusRows: hasReadableScope ? buildCurrentEocStatusRows(tasks) : [],
    historyRows: hasReadableScope
      ? buildEocCompletionHistory(submissions, tasks.filter(task => task.status === 'missed')).slice(0, historyLimit)
      : [],
    missingAssignments: hasReadableScope ? findMissingBhtAssignments(templateAssignments, shiftAssignments) : [],
    loadMoreHistory: () => setHistoryLimit(value => value + 50)
  }), [hasReadableScope, historyLimit, shiftAssignments, submissions, tasks, templateAssignments])
}
