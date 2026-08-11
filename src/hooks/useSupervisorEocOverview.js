import { useEffect, useMemo, useState } from 'react'
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { db } from '../firebase'
import { buildCurrentEocStatusRows, buildEocCompletionHistory, findMissingBhtAssignments } from '../utils/supervisorEocModel'

export default function useSupervisorEocOverview(inEocScope) {
  const [tasks, setTasks] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [shiftAssignments, setShiftAssignments] = useState([])
  const [templateAssignments, setTemplateAssignments] = useState([])
  const [historyLimit, setHistoryLimit] = useState(50)

  useEffect(() => {
    const unsubs = [
      onSnapshot(query(collection(db, 'eocTasks'), limit(500)), snap => setTasks(snap.docs.map(item => ({ id: item.id, ...item.data() })).filter(row => !inEocScope || inEocScope(row.locationId)))),
      onSnapshot(query(collection(db, 'eocSubmissions'), orderBy('submittedAt', 'desc'), limit(historyLimit)), snap => setSubmissions(snap.docs.map(item => ({ id: item.id, ...item.data() })).filter(row => !inEocScope || inEocScope(row.locationId)))),
      onSnapshot(query(collection(db, 'shiftAssignments'), where('active', '==', true)), snap => setShiftAssignments(snap.docs.map(item => ({ id: item.id, ...item.data() })).filter(row => !inEocScope || inEocScope(row.locationId)))),
      onSnapshot(collection(db, 'eocTemplateAssignments'), snap => setTemplateAssignments(snap.docs.map(item => ({ id: item.id, ...item.data() })).filter(row => !inEocScope || inEocScope(row.locationId))))
    ]
    return () => unsubs.forEach(unsub => unsub())
  }, [historyLimit, inEocScope])

  return useMemo(() => ({
    statusRows: buildCurrentEocStatusRows(tasks),
    historyRows: buildEocCompletionHistory(submissions, tasks.filter(task => task.status === 'missed')).slice(0, historyLimit),
    missingAssignments: findMissingBhtAssignments(templateAssignments, shiftAssignments),
    loadMoreHistory: () => setHistoryLimit(value => value + 50)
  }), [historyLimit, shiftAssignments, submissions, tasks, templateAssignments])
}
