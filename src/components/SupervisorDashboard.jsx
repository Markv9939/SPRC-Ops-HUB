import { useState, useEffect, useMemo, useCallback } from 'react'
import { db, auth } from '../firebase'
import { collection, query, where, orderBy, onSnapshot, Timestamp, doc, setDoc, getDocs, updateDoc, serverTimestamp, addDoc, writeBatch, runTransaction } from 'firebase/firestore'
import { signInAnonymously, signOut } from 'firebase/auth'
import * as XLSX from 'xlsx'
import SupervisorEocPanel from './SupervisorEocPanel'
import CompliancePanel from './CompliancePanel'
import AccessGrantPanel from './AccessGrantPanel'
import { LOCATIONS, SHIFTS, VANS } from '../data/eocConstants'
import { hashPin } from '../utils/pinHash'
import { assertExpectedVersion, formatVersionConflictMessage, getVersionNumber } from '../services/versioning'
import { getAuthPolicy, setAuthScopeEnforced } from '../services/authPolicyService'
import { notifySuccess } from '../utils/toast'
import { getStatus } from '../utils/complianceStatus'

const TAB_LABELS = {
  dashboard: '\u{1F4C8} Dashboard',
  transports: '\u{1F4CA} Transports',
  users: '\u{1F465} Users',
  assignments: '\u{1F4CB} Assignments',
  eoc: '\u{1F527} EOC',
  compliance: '\u{1F4CB} Compliance',
  audit: '\u{1F9FE} Audit'
}
const TAB_KEYS = Object.keys(TAB_LABELS)
const TRANSPORT_SITES = new Set(['PHP', 'RTC'])
const COMPLIANCE_SITES = new Set(['RTC', 'OTC'])

function SupervisorDashboard({ user, isOffline = false }) {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 600)
  const [transports, setTransports] = useState([])
  const [filteredTransports, setFilteredTransports] = useState([])

  // Dashboard stats
  const [dashMonth, setDashMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [dashSite, setDashSite] = useState('ALL')
  const [dashTransports, setDashTransports] = useState([])
  const [dashLoading, setDashLoading] = useState(false)

  // Filters
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [transportSiteFilter, setTransportSiteFilter] = useState('ALL')
  const [transportStatusFilter, setTransportStatusFilter] = useState('all')
  const [transportReasonFilter, setTransportReasonFilter] = useState('')
  const [selectedDriver, setSelectedDriver] = useState('')
  const [overdueFilter, setOverdueFilter] = useState('all')
  const [clientSearch, setClientSearch] = useState('')
  const [isDashboardDrilldownActive, setIsDashboardDrilldownActive] = useState(false)
  const [drilldownLabel, setDrilldownLabel] = useState('')

  const [drivers, setDrivers] = useState([])

  // EOC Dashboard summary
  const [eocIssues, setEocIssues] = useState([])
  const [eocOverdueTasks, setEocOverdueTasks] = useState([])
  const [eocAlerts, setEocAlerts] = useState([])
  const [queueView, setQueueView] = useState('issues')
  const [queueLocationFilter, setQueueLocationFilter] = useState('all')
  const [eocIssueActionNotes, setEocIssueActionNotes] = useState({})

  // Compliance dashboard summary
  const [complianceItems, setComplianceItems] = useState([])
  const [auditLogs, setAuditLogs] = useState([])

  // User Management
  const [users, setUsers] = useState([])
  const [editingUser, setEditingUser] = useState(null)
  const [userForm, setUserForm] = useState({ id: '', name: '', pin: '', role: 'tech', site: 'PHP', active: true })
  const [authScopeEnforced, setAuthScopeEnforcedState] = useState(false)
  const [authPolicyLoading, setAuthPolicyLoading] = useState(false)

  // Assignment Management
  const [shiftAssignments, setShiftAssignments] = useState([])
  const [editingAssignment, setEditingAssignment] = useState(null)
  const [assignmentForm, setAssignmentForm] = useState({
    bhtUserId: '', locationId: '', shiftId: '', vanIds: [], isHousePrimary: false, active: true
  })

  const isAdmin = user?.role === 'admin'
  const availableTabKeys = isAdmin ? TAB_KEYS : TAB_KEYS.filter(k => k !== 'audit')
  const rawScopes = useMemo(
    () => (Array.isArray(user?.authorizedLocations) ? user.authorizedLocations : []),
    [user?.authorizedLocations]
  )
  const normalizedScopes = useMemo(() => (
    [...new Set([
      ...(user?.site ? [user.site] : []),
      ...rawScopes
    ].map(v => String(v || '').trim().toUpperCase()))]
  ), [rawScopes, user?.site])
  const primaryScopes = useMemo(() => (
    [...new Set([
      ...(Array.isArray(user?.primaryScopes) ? user.primaryScopes : []),
      ...(user?.site ? [user.site] : [])
    ].map(v => String(v || '').trim().toUpperCase()).filter(Boolean))]
  ), [user?.primaryScopes, user?.site])
  const activeBackupGrants = useMemo(
    () => (Array.isArray(user?.activeBackupGrants)
      ? user.activeBackupGrants.filter(grant => grant?.state === 'active')
      : []),
    [user?.activeBackupGrants]
  )
  const allowedTransportSites = useMemo(
    () => (isAdmin ? [] : normalizedScopes.filter(v => TRANSPORT_SITES.has(v))),
    [isAdmin, normalizedScopes]
  )
  const allowedComplianceSites = useMemo(
    () => (isAdmin ? [] : normalizedScopes.filter(v => COMPLIANCE_SITES.has(v))),
    [isAdmin, normalizedScopes]
  )
  const inTransportScope = useCallback(
    (site) => isAdmin || allowedTransportSites.includes(String(site || '').trim().toUpperCase()),
    [allowedTransportSites, isAdmin]
  )
  const inComplianceScope = useCallback(
    (site) => isAdmin || allowedComplianceSites.includes(String(site || '').trim().toUpperCase()),
    [allowedComplianceSites, isAdmin]
  )

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 600px)')
    const handler = (e) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    if (!isAdmin && activeTab === 'audit') {
      setActiveTab('dashboard')
    }
  }, [activeTab, isAdmin])

  // Real-time EOC issues + overdue tasks for dashboard summary
  useEffect(() => {
    const unsubIssues = onSnapshot(
      query(collection(db, 'eocIssues'), where('status', 'in', ['open', 'in_progress']), orderBy('createdAt', 'desc')),
      (snap) => setEocIssues(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    const unsubOverdueTasks = onSnapshot(
      query(collection(db, 'eocTasks'), where('status', '==', 'overdue')),
      (snap) => {
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        rows.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
        setEocOverdueTasks(rows)
      }
    )
    const unsubAlerts = onSnapshot(
      query(collection(db, 'alerts'), where('read', '==', false)),
      (snap) => {
        const rows = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(alertItem => alertItem.type === 'eoc_issue')
        rows.sort((a, b) => {
          const aMs = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0
          const bMs = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0
          return bMs - aMs
        })
        setEocAlerts(rows)
      }
    )
    const unsubCompliance = onSnapshot(
      collection(db, 'complianceItems'),
      (snap) => setComplianceItems(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    return () => { unsubIssues(); unsubOverdueTasks(); unsubAlerts(); unsubCompliance() }
  }, [])

  // Load BHT Assignments
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'shiftAssignments'), orderBy('bhtUserName', 'asc')),
      (snap) => {
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        setShiftAssignments(rows.filter(a => !a.deletedAt && a.deleted !== true))
      }
    )
    return unsub
  }, [])

  const updateIssueActionNote = (issueId, note) => {
    setEocIssueActionNotes(prev => ({
      ...prev,
      [issueId]: note
    }))
  }

  const clearIssueActionNote = (issueId) => {
    setEocIssueActionNotes(prev => {
      if (!(issueId in prev)) return prev
      const next = { ...prev }
      delete next[issueId]
      return next
    })
  }

  const getIssueActionNote = (issueId) => String(eocIssueActionNotes[issueId] || '')

  const handleDashStartIssue = async (issueId, progressNote) => {
    if (blockIfOffline('starting issue progress')) return

    const trimmedProgressNote = String(progressNote || '').trim()
    if (!trimmedProgressNote) {
      alert('Note is required before moving an issue to in progress.')
      return
    }

    const selectedIssue = eocIssues.find(issue => issue.id === issueId)
    if (!selectedIssue) {
      alert('Issue no longer exists.')
      return
    }
    const expectedVersion = getVersionNumber(selectedIssue)

    try {
      await runTransaction(db, async (transaction) => {
        const issueRef = doc(db, 'eocIssues', issueId)
        const issueSnap = await transaction.get(issueRef)
        if (!issueSnap.exists()) {
          throw new Error('Issue no longer exists.')
        }

        const latestIssue = issueSnap.data()
        const { nextVersion } = assertExpectedVersion({
          expectedVersion,
          currentVersion: getVersionNumber(latestIssue),
          documentId: issueId,
          recordLabel: 'EOC Issue'
        })

        transaction.update(issueRef, {
          status: 'in_progress',
          inProgressNotes: trimmedProgressNote,
          inProgressAt: serverTimestamp(),
          inProgressByUserId: user?.id || null,
          inProgressByName: user?.name || null,
          version: nextVersion,
          updatedAt: serverTimestamp()
        })
      })
      await createIssueStatusNotification({
        issue: selectedIssue,
        nextStatus: 'in_progress',
        note: trimmedProgressNote
      })

      await writeAuditLog({
        action: 'issue_in_progress',
        collectionPath: 'eocIssues',
        documentId: issueId,
        reason: trimmedProgressNote
      })
      clearIssueActionNote(issueId)
    } catch (err) {
      console.error('Error moving issue to in_progress:', err)
      alertVersionConflict(err, 'Failed to start issue progress')
    }
  }

  const handleDashResolveIssue = async (issueId, resolveNote) => {
    if (blockIfOffline('resolving issues')) return

    const trimmedResolveNote = String(resolveNote || '').trim()
    if (!trimmedResolveNote) {
      alert('Resolution note is required.')
      return
    }

    const selectedIssue = eocIssues.find(issue => issue.id === issueId)
    if (!selectedIssue) {
      alert('Issue no longer exists.')
      return
    }
    const expectedVersion = getVersionNumber(selectedIssue)

    try {
      await runTransaction(db, async (transaction) => {
        const issueRef = doc(db, 'eocIssues', issueId)
        const issueSnap = await transaction.get(issueRef)
        if (!issueSnap.exists()) {
          throw new Error('Issue no longer exists.')
        }

        const latestIssue = issueSnap.data()
        const { nextVersion } = assertExpectedVersion({
          expectedVersion,
          currentVersion: getVersionNumber(latestIssue),
          documentId: issueId,
          recordLabel: 'EOC Issue'
        })

        transaction.update(issueRef, {
          status: 'resolved',
          resolvedNotes: trimmedResolveNote,
          resolvedAt: serverTimestamp(),
          resolvedByUserId: user?.id || null,
          resolvedByName: user?.name || null,
          version: nextVersion,
          updatedAt: serverTimestamp()
        })
      })

      // Close any open alerts tied to this issue as part of resolution lifecycle.
      const relatedAlerts = await getDocs(
        query(collection(db, 'alerts'), where('issueId', '==', issueId))
      )
      const alertBatch = writeBatch(db)
      let alertMutations = 0
      relatedAlerts.docs.forEach(alertDoc => {
        if (alertDoc.data().type !== 'eoc_issue' || alertDoc.data().read === true) return
        alertBatch.update(alertDoc.ref, {
          read: true,
          resolvedAt: serverTimestamp(),
          resolvedByUserId: user?.id || null,
          resolvedByName: user?.name || null,
          version: getVersionNumber(alertDoc.data()) + 1,
          updatedAt: serverTimestamp()
        })
        alertMutations += 1
      })

      if (alertMutations > 0) {
        await alertBatch.commit()
      }
      await createIssueStatusNotification({
        issue: selectedIssue,
        nextStatus: 'resolved',
        note: trimmedResolveNote
      })
      await writeAuditLog({
        action: 'issue_resolved',
        collectionPath: 'eocIssues',
        documentId: issueId,
        reason: trimmedResolveNote
      })
      clearIssueActionNote(issueId)
    } catch (err) {
      console.error('Error resolving issue:', err)
      alertVersionConflict(err, 'Failed to resolve issue')
    }
  }

  const handleMarkAlertRead = async (alertId) => {
    if (blockIfOffline('marking alerts as read')) return

    const selectedAlert = eocAlerts.find(alertRow => alertRow.id === alertId)
    try {
      await updateDoc(doc(db, 'alerts', alertId), {
        read: true,
        readAt: serverTimestamp(),
        readByUserId: user?.id || null,
        readByName: user?.name || null,
        version: getVersionNumber(selectedAlert) + 1,
        updatedAt: serverTimestamp()
      })
    } catch (err) {
      console.error('Error marking alert read:', err)
      alert('Failed to mark alert as read')
    }
  }

  const loadUsers = useCallback(async () => {
    const usersSnapshot = await getDocs(collection(db, 'users'))
    const usersData = usersSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }))
    setUsers(usersData.filter(u => !u.deletedAt && u.deleted !== true))
  }, [])

  const loadAuthPolicyState = useCallback(async () => {
    if (!isAdmin) return
    setAuthPolicyLoading(true)
    try {
      const policy = await getAuthPolicy()
      setAuthScopeEnforcedState(policy.authScopeEnforced === true)
    } catch (error) {
      console.error('Failed to load auth policy:', error)
      setAuthScopeEnforcedState(false)
    } finally {
      setAuthPolicyLoading(false)
    }
  }, [isAdmin])

  useEffect(() => {
    // Set default to current month
    const now = new Date()
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0)

    setStartDate(firstDay.toISOString().split('T')[0])
    setEndDate(lastDay.toISOString().split('T')[0])

    // Load users
    loadUsers()
    loadAuthPolicyState()
  }, [loadAuthPolicyState, loadUsers])

  useEffect(() => {
    if (!isAdmin) {
      setAuditLogs([])
      return
    }

    const unsub = onSnapshot(
      query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc')),
      (snap) => setAuditLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    return unsub
  }, [isAdmin])

  const techUsers = users.filter(u => u.role === 'tech' && u.active)

  const writeAuditLog = async ({ action, collectionPath, documentId, reason, extra = {} }) => {
    if (!user?.id || !user?.name) return
    await addDoc(collection(db, 'auditLogs'), {
      action,
      collectionPath,
      documentId,
      performedByUserId: user.id,
      performedByName: user.name,
      reason,
      createdAt: serverTimestamp(),
      ...extra
    })
  }

  const createIssueStatusNotification = async ({ issue, nextStatus, note }) => {
    if (!issue?.locationId || !issue?.reportedByUserId) return
    const actorName = user?.name || 'Supervisor'
    const statusLabel = nextStatus === 'resolved' ? 'resolved' : 'in progress'
    await addDoc(collection(db, 'alerts'), {
      type: 'eoc_issue_update',
      issueId: issue.id,
      taskId: issue.taskId || null,
      locationId: issue.locationId,
      eocType: issue.eocType || null,
      severity: issue.severity || 'medium',
      targetUserId: issue.reportedByUserId,
      targetUserName: issue.reportedByName || null,
      status: nextStatus,
      statusNote: note,
      actorUserId: user?.id || null,
      actorName,
      message: `${actorName} marked "${issue.label || 'Issue'}" as ${statusLabel}.`,
      read: false,
      version: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    })
  }

  const promptDeleteReason = (label) => {
    const reason = prompt(`Enter reason for ${label}:`)
    if (reason === null) return null
    if (!reason.trim()) {
      alert('Reason is required.')
      return null
    }
    return reason.trim()
  }

  const alertVersionConflict = (error, fallbackMessage) => {
    if (error?.code === 'version-conflict') {
      alert(formatVersionConflictMessage(error))
      return true
    }
    alert(fallbackMessage)
    return false
  }

  const blockIfOffline = (actionLabel) => {
    if (!isOffline) return false
    alert(`Offline mode: ${actionLabel} is unavailable until connection is restored.`)
    return true
  }

  const refreshAdminAuthSession = async () => {
    if (user?.role !== 'admin') return false
    try {
      if (auth.currentUser) {
        await signOut(auth)
      }
    } catch (signOutError) {
      console.warn('Admin auth sign-out before refresh failed:', signOutError)
    }

    try {
      await signInAnonymously(auth)
      return true
    } catch (signInError) {
      console.error('Admin auth refresh failed:', signInError)
      return false
    }
  }

  const handleAddUser = () => {
    setEditingUser('new')
    setUserForm({ id: '', name: '', pin: '', role: 'tech', site: 'PHP', active: true })
  }

  const handleEditUser = (user) => {
    setEditingUser(user.id)
    setUserForm({ ...user, pin: '' })
  }

  const handleSaveUser = async () => {
    if (blockIfOffline('saving users')) return

    if (!userForm.id || !userForm.name || !userForm.pin) {
      alert('Please fill in all required fields (ID, Name, PIN)')
      return
    }

    if (userForm.pin.length !== 4 || !/^\d+$/.test(userForm.pin)) {
      alert('PIN must be exactly 4 digits')
      return
    }

    try {
      const pinHash = await hashPin(userForm.pin)
      const payload = {
        name: userForm.name,
        pinHash,
        pinVersion: 'v1_sha256',
        pinUpdatedAt: serverTimestamp(),
        role: userForm.role,
        site: userForm.site,
        active: userForm.active,
        authorizedLocations: userForm.authorizedLocations || null,
        updatedAt: serverTimestamp()
      }
      if (editingUser === 'new') {
        await setDoc(doc(db, 'users', userForm.id), {
          ...payload,
          createdAt: serverTimestamp()
        })
      } else {
        await updateDoc(doc(db, 'users', userForm.id), payload)
      }
      notifySuccess('User saved successfully')
      setEditingUser(null)
      loadUsers()
    } catch (error) {
      console.error('Error saving user:', error)
      alert('Error saving user: ' + error.message)
    }
  }

  const handleDeleteUser = async (userId) => {
    if (blockIfOffline('deleting users')) return

    if (!confirm(`Soft-delete user ${userId}?`)) return

    const reason = promptDeleteReason(`soft-delete of user ${userId}`)
    if (!reason) return

    try {
      await updateDoc(doc(db, 'users', userId), {
        deleted: true,
        deletedAt: serverTimestamp(),
        deletedByUserId: user?.id || null,
        deletedByName: user?.name || null,
        deleteReason: reason,
        active: false,
        updatedAt: serverTimestamp()
      })
      await writeAuditLog({
        action: 'soft_delete',
        collectionPath: 'users',
        documentId: userId,
        reason
      })
      notifySuccess('User soft-deleted')
      loadUsers()
    } catch (error) {
      console.error('Error deleting user:', error)
      alert('Error deleting user: ' + error.message)
    }
  }

  const handleHardDeleteUser = async (userId) => {
    if (blockIfOffline('hard-deleting users')) return

    if (!isAdmin) {
      alert('Only admin can hard-delete records.')
      return
    }

    if (userId === user?.id) {
      alert('You cannot hard-delete your own user while logged in.')
      return
    }

    if (!confirm(`Permanently hard-delete user ${userId}? This cannot be undone.`)) return

    const reason = promptDeleteReason(`hard-delete of user ${userId}`)
    if (!reason) return

    try {
      const batch = writeBatch(db)
      const auditRef = doc(collection(db, 'auditLogs'))
      batch.set(auditRef, {
        action: 'hard_delete',
        collectionPath: 'users',
        documentId: userId,
        performedByUserId: user?.id || null,
        performedByName: user?.name || null,
        reason,
        createdAt: serverTimestamp()
      })
      batch.delete(doc(db, 'users', userId))
      await batch.commit()
      notifySuccess('User hard-deleted')
      loadUsers()
    } catch (error) {
      console.error('Error hard deleting user:', error)
      alert('Error hard deleting user: ' + error.message)
    }
  }

  const handleSetAuthScopeEnforced = async (enabled) => {
    if (blockIfOffline('updating auth scope policy')) return
    if (!isAdmin) {
      alert('Only admin can change auth scope policy.')
      return
    }

    if (enabled === true && !(user?.authClaimsReady && user?.authClaimRole === 'admin')) {
      alert('Cannot enable strict auth mode from this session. Log in with admin custom claims first.')
      return
    }

    if (authScopeEnforced === enabled) return
    const reason = prompt(`Enter reason for ${enabled ? 'enabling' : 'disabling'} strict auth scope enforcement:`)
    if (reason === null) return
    if (!reason.trim()) {
      alert('Reason is required.')
      return
    }

    try {
      await setAuthScopeEnforced({
        enabled,
        actorUserId: user?.id || null,
        actorName: user?.name || null,
        reason
      })
      await writeAuditLog({
        action: enabled ? 'auth_scope_enforcement_enable' : 'auth_scope_enforcement_disable',
        collectionPath: 'appSettings',
        documentId: 'security',
        reason: reason.trim()
      })
      setAuthScopeEnforcedState(enabled)
      notifySuccess(`Strict auth mode ${enabled ? 'enabled' : 'disabled'}`)
    } catch (error) {
      console.error('Failed to update auth scope policy:', error)
      alert('Failed to update auth scope policy.')
    }
  }

  const handleCancelEdit = () => {
    setEditingUser(null)
    setUserForm({ id: '', name: '', pin: '', role: 'tech', site: 'PHP', active: true })
  }

  const renderUserEditorFields = (isNewUser) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
      <div>
        <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
          User ID *
        </label>
        <input
          type="text"
          value={userForm.id}
          onChange={(e) => setUserForm({ ...userForm, id: e.target.value })}
          disabled={!isNewUser}
          placeholder="e.g., tech3"
          style={{
            width: '100%',
            padding: '8px',
            border: '2px solid rgba(255,255,255,0.1)',
            borderRadius: '6px',
            fontSize: '14px',
            boxSizing: 'border-box',
            backgroundColor: !isNewUser ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.06)',
            color: '#e8e8e8'
          }}
        />
      </div>
      <div>
        <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
          Name *
        </label>
        <input
          type="text"
          value={userForm.name}
          onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}
          placeholder="Full Name"
          style={{
            width: '100%',
            padding: '8px',
            border: '2px solid rgba(255,255,255,0.1)',
            borderRadius: '6px',
            fontSize: '14px',
            boxSizing: 'border-box',
            backgroundColor: 'rgba(255,255,255,0.06)',
            color: '#e8e8e8'
          }}
        />
      </div>
      <div>
        <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
          PIN (4 digits) * {!isNewUser ? '(set new PIN to rotate)' : ''}
        </label>
        <input
          type="text"
          value={userForm.pin}
          onChange={(e) => setUserForm({ ...userForm, pin: e.target.value.replace(/\D/g, '') })}
          placeholder="1234"
          maxLength="4"
          style={{
            width: '100%',
            padding: '8px',
            border: '2px solid rgba(255,255,255,0.1)',
            borderRadius: '6px',
            fontSize: '14px',
            boxSizing: 'border-box',
            backgroundColor: 'rgba(255,255,255,0.06)',
            color: '#e8e8e8'
          }}
        />
      </div>
      <div>
        <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
          Role
        </label>
        <select
          value={userForm.role}
          onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
          style={{
            width: '100%',
            padding: '8px',
            border: '2px solid rgba(255,255,255,0.1)',
            borderRadius: '6px',
            fontSize: '14px',
            boxSizing: 'border-box',
            backgroundColor: 'rgba(255,255,255,0.06)',
            color: '#e8e8e8'
          }}
        >
          <option value="tech">Tech</option>
          <option value="supervisor">Supervisor</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <div>
        <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
          Site
        </label>
        <select
          value={userForm.site}
          onChange={(e) => setUserForm({ ...userForm, site: e.target.value })}
          style={{
            width: '100%',
            padding: '8px',
            border: '2px solid rgba(255,255,255,0.1)',
            borderRadius: '6px',
            fontSize: '14px',
            boxSizing: 'border-box',
            backgroundColor: 'rgba(255,255,255,0.06)',
            color: '#e8e8e8'
          }}
        >
          <option value="PHP">PHP</option>
          <option value="RTC">RTC</option>
        </select>
      </div>
      <div>
        <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
          Active
        </label>
        <select
          value={userForm.active}
          onChange={(e) => setUserForm({ ...userForm, active: e.target.value === 'true' })}
          style={{
            width: '100%',
            padding: '8px',
            border: '2px solid rgba(255,255,255,0.1)',
            borderRadius: '6px',
            fontSize: '14px',
            boxSizing: 'border-box',
            backgroundColor: 'rgba(255,255,255,0.06)',
            color: '#e8e8e8'
          }}
        >
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </div>
    </div>
  )

  // Assignment handlers
  const handleAddAssignment = () => {
    setEditingAssignment('new')
    setAssignmentForm({ bhtUserId: '', locationId: '', shiftId: '', vanIds: [], isHousePrimary: false, active: true })
  }

  const handleEditAssignment = (a) => {
    setEditingAssignment(a.id)
    setAssignmentForm({
      bhtUserId: a.bhtUserId,
      locationId: a.locationId,
      shiftId: a.shiftId,
      vanIds: a.vanIds || [],
      isHousePrimary: a.isHousePrimary || false,
      active: a.active !== false
    })
  }

  const handleSaveAssignment = async () => {
    if (blockIfOffline('saving assignments')) return

    if (!assignmentForm.bhtUserId || !assignmentForm.locationId || !assignmentForm.shiftId) {
      alert('Please select a BHT, location, and shift')
      return
    }

    const selectedUser = users.find(u => u.id === assignmentForm.bhtUserId)
    if (!selectedUser) {
      alert('Selected user not found')
      return
    }

    // Validate: if isHousePrimary is true, check no other active assignment at same location+shift is also primary
    if (assignmentForm.isHousePrimary) {
      const conflicting = shiftAssignments.find(a =>
        a.active &&
        a.locationId === assignmentForm.locationId &&
        a.shiftId === assignmentForm.shiftId &&
        a.isHousePrimary &&
        a.id !== editingAssignment
      )
      if (conflicting) {
        alert(`${conflicting.bhtUserName} is already the House Primary for this location/shift. Remove their primary status first.`)
        return
      }
    }

    const payload = {
      bhtUserId: assignmentForm.bhtUserId,
      bhtUserName: selectedUser.name,
      locationId: assignmentForm.locationId,
      shiftId: assignmentForm.shiftId,
      vanIds: assignmentForm.vanIds,
      isHousePrimary: assignmentForm.isHousePrimary,
      active: assignmentForm.active
    }

    const persistAssignment = async () => {
      if (editingAssignment === 'new') {
        const createdRef = await addDoc(collection(db, 'shiftAssignments'), {
          ...payload,
          version: 1,
          effectiveFrom: serverTimestamp(),
          effectiveTo: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        })

        try {
          await writeAuditLog({
            action: 'assignment_create',
            collectionPath: 'shiftAssignments',
            documentId: createdRef.id,
            reason: 'Supervisor created assignment',
            extra: { locationId: payload.locationId, shiftId: payload.shiftId }
          })
        } catch (auditErr) {
          console.warn('Assignment saved but audit log write failed:', auditErr)
        }
      } else {
        const currentAssignment = shiftAssignments.find(a => a.id === editingAssignment)
        const expectedVersion = getVersionNumber(currentAssignment)
        await runTransaction(db, async (transaction) => {
          const assignmentRef = doc(db, 'shiftAssignments', editingAssignment)
          const assignmentSnap = await transaction.get(assignmentRef)
          if (!assignmentSnap.exists()) {
            throw new Error('Assignment no longer exists.')
          }

          const latestAssignment = assignmentSnap.data()
          const { nextVersion } = assertExpectedVersion({
            expectedVersion,
            currentVersion: getVersionNumber(latestAssignment),
            documentId: editingAssignment,
            recordLabel: 'Assignment'
          })

          transaction.update(assignmentRef, {
            ...payload,
            version: nextVersion,
            updatedAt: serverTimestamp()
          })
        })

        try {
          await writeAuditLog({
            action: 'assignment_update',
            collectionPath: 'shiftAssignments',
            documentId: editingAssignment,
            reason: 'Supervisor updated assignment',
            extra: { locationId: payload.locationId, shiftId: payload.shiftId }
          })
        } catch (auditErr) {
          console.warn('Assignment updated but audit log write failed:', auditErr)
        }
      }
    }

    try {
      await persistAssignment()
      notifySuccess(editingAssignment === 'new' ? 'Assignment created' : 'Assignment updated')
      setEditingAssignment(null)
    } catch (err) {
      let activeError = err
      console.error('Error saving assignment:', activeError)

      if (activeError?.code === 'permission-denied' && user?.role === 'admin') {
        const tokenRole = String(user?.authClaimRole || '').trim() || '(none)'
        const refreshed = await refreshAdminAuthSession()
        if (refreshed) {
          try {
            await persistAssignment()
            notifySuccess('Assignment saved after refreshing admin auth session.')
            setEditingAssignment(null)
            return
          } catch (retryErr) {
            console.error('Retry failed after admin auth refresh:', retryErr)
            activeError = retryErr
          }
        }

        alert(`Admin save failed due to auth scope mismatch (token role: ${tokenRole}). Lock/logout, sign in again, and confirm latest Firestore rules are deployed.`)
        return
      }

      if (activeError?.code === 'version-conflict') {
        alert(formatVersionConflictMessage(activeError))
      } else if (activeError?.code === 'permission-denied') {
        alert('Failed to save assignment: your account is not scoped for that location.')
      } else {
        alert('Failed to save assignment: ' + activeError.message)
      }
    }
  }

  const handleDeleteAssignment = async (id) => {
    if (blockIfOffline('deleting assignments')) return

    if (!confirm('Soft-delete this assignment?')) return

    const reason = promptDeleteReason('soft-delete of assignment')
    if (!reason) return

    try {
      const currentAssignment = shiftAssignments.find(a => a.id === id)
      const expectedVersion = getVersionNumber(currentAssignment)
      await runTransaction(db, async (transaction) => {
        const assignmentRef = doc(db, 'shiftAssignments', id)
        const assignmentSnap = await transaction.get(assignmentRef)
        if (!assignmentSnap.exists()) {
          throw new Error('Assignment no longer exists.')
        }

        const latestAssignment = assignmentSnap.data()
        const { nextVersion } = assertExpectedVersion({
          expectedVersion,
          currentVersion: getVersionNumber(latestAssignment),
          documentId: id,
          recordLabel: 'Assignment'
        })

        transaction.update(assignmentRef, {
          deleted: true,
          deletedAt: serverTimestamp(),
          deletedByUserId: user?.id || null,
          deletedByName: user?.name || null,
          deleteReason: reason,
          active: false,
          version: nextVersion,
          updatedAt: serverTimestamp()
        })
      })
      await writeAuditLog({
        action: 'soft_delete',
        collectionPath: 'shiftAssignments',
        documentId: id,
        reason
      })
      notifySuccess('Assignment soft-deleted')
    } catch (err) {
      console.error('Error deleting assignment:', err)
      alertVersionConflict(err, 'Failed to delete assignment')
    }
  }

  const handleHardDeleteAssignment = async (id) => {
    if (blockIfOffline('hard-deleting assignments')) return

    if (!isAdmin) {
      alert('Only admin can hard-delete records.')
      return
    }

    if (!confirm('Permanently hard-delete this assignment? This cannot be undone.')) return

    const reason = promptDeleteReason('hard-delete of assignment')
    if (!reason) return

    try {
      const batch = writeBatch(db)
      const auditRef = doc(collection(db, 'auditLogs'))
      batch.set(auditRef, {
        action: 'hard_delete',
        collectionPath: 'shiftAssignments',
        documentId: id,
        performedByUserId: user?.id || null,
        performedByName: user?.name || null,
        reason,
        createdAt: serverTimestamp()
      })
      batch.delete(doc(db, 'shiftAssignments', id))
      await batch.commit()
      notifySuccess('Assignment hard-deleted')
    } catch (err) {
      console.error('Error hard deleting assignment:', err)
      alert('Failed to hard-delete assignment')
    }
  }

  const toggleVanId = (vanId) => {
    setAssignmentForm(prev => ({
      ...prev,
      vanIds: prev.vanIds.includes(vanId)
        ? prev.vanIds.filter(v => v !== vanId)
        : [...prev.vanIds, vanId]
    }))
  }

  const handleQueueReassign = (task) => {
    setActiveTab('assignments')
    setEditingAssignment('new')
    setAssignmentForm({
      bhtUserId: task.assigneeUserId || '',
      locationId: task.locationId || '',
      shiftId: task.shiftId || '',
      vanIds: task.taskType === 'van' && task.vanId ? [task.vanId] : [],
      isHousePrimary: task.taskType === 'house',
      active: true
    })
  }

  const toDateInputValue = (value) => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const isCompletedTransport = (transport) => {
    const status = String(transport?.status || '').toLowerCase()
    return status === 'returned' || status === 'closed'
  }

  const handleDashboardDrilldown = (type, value = '') => {
    const startOfMonth = new Date(dashMonth.getFullYear(), dashMonth.getMonth(), 1)
    const endOfMonth = new Date(dashMonth.getFullYear(), dashMonth.getMonth() + 1, 0)

    setStartDate(toDateInputValue(startOfMonth))
    setEndDate(toDateInputValue(endOfMonth))
    setTransportSiteFilter(dashSite)
    setTransportStatusFilter('completed')
    setTransportReasonFilter('')
    setSelectedDriver('')
    setOverdueFilter('all')
    setClientSearch('')

    if (type === 'reason' && value) {
      setTransportReasonFilter(value)
      setDrilldownLabel(`Reason: ${value}`)
    } else if (type === 'tech' && value) {
      setSelectedDriver(value)
      setDrilldownLabel(`Tech: ${value}`)
    } else {
      setDrilldownLabel('Total completed transports')
    }

    setIsDashboardDrilldownActive(true)
    setActiveTab('transports')
  }

  const clearDashboardDrilldown = () => {
    setTransportSiteFilter('ALL')
    setTransportStatusFilter('all')
    setTransportReasonFilter('')
    setSelectedDriver('')
    setIsDashboardDrilldownActive(false)
    setDrilldownLabel('')
  }

  useEffect(() => {
    if (!startDate || !endDate) return

    const transportsRef = collection(db, 'transports')

    const startTimestamp = Timestamp.fromDate(new Date(startDate + 'T00:00:00'))
    const endTimestamp = Timestamp.fromDate(new Date(endDate + 'T23:59:59'))

    const q = query(
      transportsRef,
      where('departedAt', '>=', startTimestamp),
      where('departedAt', '<=', endTimestamp),
      orderBy('departedAt', 'desc')
    )

    const unsubscribe = onSnapshot(q, (snapshot) => {
      let data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }))

      data = data.filter(t => inTransportScope(t.site))
      setTransports(data)

      // Extract unique drivers
      const uniqueDrivers = [...new Set(data.map(t => t.createdByName))].filter(Boolean)
      setDrivers(uniqueDrivers)
    })

    return () => unsubscribe()
  }, [startDate, endDate, inTransportScope])

  useEffect(() => {
    let filtered = [...transports]

    if (transportSiteFilter !== 'ALL') {
      filtered = filtered.filter(t => String(t.site || '').trim().toUpperCase() === transportSiteFilter)
    }

    if (transportStatusFilter === 'completed') {
      filtered = filtered.filter(t => isCompletedTransport(t))
    }

    if (transportReasonFilter) {
      filtered = filtered.filter(t => t.reasons?.includes(transportReasonFilter))
    }

    // Driver filter
    if (selectedDriver) {
      filtered = filtered.filter(t => t.createdByName === selectedDriver)
    }

    // Overdue filter
    if (overdueFilter === 'yes') {
      filtered = filtered.filter(t => isOverdue(t))
    } else if (overdueFilter === 'no') {
      filtered = filtered.filter(t => !isOverdue(t))
    }

    // Client search (fuzzy)
    if (clientSearch.trim()) {
      const searchLower = clientSearch.toLowerCase()
      filtered = filtered.filter(t =>
        t.clients?.some(client => client.toLowerCase().includes(searchLower))
      )
    }

    setFilteredTransports(filtered)
  }, [transports, transportSiteFilter, transportStatusFilter, transportReasonFilter, selectedDriver, overdueFilter, clientSearch])

  // Dashboard data fetch
  useEffect(() => {
    if (activeTab !== 'dashboard') return

    const fetchDashData = async () => {
      setDashLoading(true)
      try {
        const startOfMonth = Timestamp.fromDate(dashMonth)
        const startOfNext = Timestamp.fromDate(new Date(dashMonth.getFullYear(), dashMonth.getMonth() + 1, 1))

        const q = query(
          collection(db, 'transports'),
          where('departedAt', '>=', startOfMonth),
          where('departedAt', '<', startOfNext),
          orderBy('departedAt', 'desc')
        )

        const snapshot = await getDocs(q)
        let data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))

        // Client-side filters
        data = data.filter(t => inTransportScope(t.site))
        data = data.filter(t => isCompletedTransport(t))
        if (dashSite !== 'ALL') {
          data = data.filter(t => t.site === dashSite)
        }

        setDashTransports(data)
      } catch (error) {
        console.error('Error fetching dashboard data:', error)
        setDashTransports([])
      }
      setDashLoading(false)
    }

    fetchDashData()
  }, [activeTab, dashMonth, dashSite, inTransportScope])

  // Dashboard aggregation
  const dashStats = useMemo(() => {
    const reasonCounts = {}
    const techCounts = {}
    const paperworkCounts = {}

    dashTransports.forEach(t => {
      // Reasons
      if (t.reasons && t.reasons.length > 0) {
        t.reasons.forEach(r => {
          reasonCounts[r] = (reasonCounts[r] || 0) + 1
        })
      }
      // Tech
      const tech = t.createdByName || 'Unknown'
      techCounts[tech] = (techCounts[tech] || 0) + 1
      // DC Paperwork
      const pw = t.dcPaperworkStatus || 'unknown'
      paperworkCounts[pw] = (paperworkCounts[pw] || 0) + 1
    })

    const sortDesc = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1])

    return {
      total: dashTransports.length,
      byReason: sortDesc(reasonCounts),
      byTech: sortDesc(techCounts),
      byPaperwork: sortDesc(paperworkCounts)
    }
  }, [dashTransports])

  const complianceSummary = useMemo(() => {
    const summary = { overdue: 0, upcoming: 0, current: 0, none: 0, total: 0 }
    const scoped = complianceItems.filter(item => {
      if (isAdmin) return true
      if (!item.employeeSite) return false
      return inComplianceScope(item.employeeSite)
    })
    scoped.forEach(item => {
      const status = getStatus(item.dueDate)
      if (status === 'overdue') summary.overdue += 1
      else if (status === 'upcoming') summary.upcoming += 1
      else if (status === 'current') summary.current += 1
      else summary.none += 1
    })
    summary.total = scoped.length
    return summary
  }, [complianceItems, inComplianceScope, isAdmin])

  const isOverdue = (transport) => {
    if (transport.status === 'closed' || transport.status === 'returned') {
      return false
    }

    if (!transport.departedAt) return false

    const departedDate = transport.departedAt.toDate ? transport.departedAt.toDate() : new Date(transport.departedAt)
    const hoursSinceDeparted = (Date.now() - departedDate.getTime()) / (1000 * 60 * 60)

    return hoursSinceDeparted > 8
  }

  const formatTime = (timestamp) => {
    if (!timestamp) return '--:--'
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const formatDate = (timestamp) => {
    if (!timestamp) return '--'
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
    return date.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric'
    })
  }

  const formatScopeExpiry = (value) => {
    if (!value) return '--'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '--'
    return date.toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const locationMatchesQueueFilter = (locationId) => {
    if (queueLocationFilter === 'all') return true
    return locationId === queueLocationFilter
  }

  const filteredIssueQueue = eocIssues.filter(issue => locationMatchesQueueFilter(issue.locationId))
  const filteredOverdueTaskQueue = eocOverdueTasks.filter(task => locationMatchesQueueFilter(task.locationId))
  const filteredAlertQueue = eocAlerts.filter(alert => locationMatchesQueueFilter(alert.locationId))

  const queueCounts = {
    issues: filteredIssueQueue.length,
    overdue: filteredOverdueTaskQueue.length,
    alerts: filteredAlertQueue.length
  }

  const transportReasonOptions = useMemo(() => {
    const reasonSet = new Set()
    transports.forEach((transport) => {
      if (!Array.isArray(transport?.reasons)) return
      transport.reasons.forEach((reason) => {
        const value = String(reason || '').trim()
        if (value) {
          reasonSet.add(value)
        }
      })
    })

    const options = [...reasonSet].sort((a, b) => a.localeCompare(b))
    if (transportReasonFilter && !reasonSet.has(transportReasonFilter)) {
      options.unshift(transportReasonFilter)
    }
    return options
  }, [transports, transportReasonFilter])

  const exportToExcel = () => {
    const data = filteredTransports.map(t => {
      const destinationsText = t.destinations && t.destinations.length > 0
        ? t.destinations.map((d, i) => {
            const num = `${i + 1}.`
            if (d.name && d.address) {
              return `${num} ${d.name} (${d.address})`
            } else if (d.address) {
              return `${num} ${d.address}`
            } else if (d.name) {
              return `${num} ${d.name}`
            }
            return `${num} (no address)`
          }).join(' | ')
        : ''

      return {
        'Date': formatDate(t.departedAt),
        'Departed': formatTime(t.departedAt),
        'Returned': formatTime(t.returnedAt),
        'Driver': t.createdByName || '',
        'Site': t.site || '',
        'Clients': t.clients?.join(', ') || '',
        'Reasons': t.reasons?.join(', ') || '',
        'Destinations': destinationsText,
        'Arrivals': t.stops?.length || 0,
        'Status': t.status || '',
        'Overdue': isOverdue(t) ? 'YES' : 'NO',
        'Notes': t.notes || ''
      }
    })

    const worksheet = XLSX.utils.json_to_sheet(data)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Transports')

    const filename = `transports_${startDate}_to_${endDate}.xlsx`
    XLSX.writeFile(workbook, filename)
  }

  const selectStyle = {
    padding: '6px 10px',
    border: '2px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    fontSize: '13px',
    background: 'rgba(255,255,255,0.06)',
    color: '#e8e8e8'
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px'
      }}>
        <h2 style={{ margin: 0, color: '#e8e8e8' }}>
          {isAdmin ? 'Admin' : 'Supervisor'} Dashboard
        </h2>
      </div>

      <div style={{
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderRadius: '10px',
        border: '1px solid rgba(255,255,255,0.1)',
        padding: '12px 14px',
        marginBottom: '16px'
      }}>
        <div style={{ fontSize: '12px', color: '#8899aa', marginBottom: '6px' }}>
          Scope
        </div>
        {isAdmin ? (
          <div style={{ fontSize: '13px', color: '#4CAF50' }}>
            Global access (all locations)
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ fontSize: '13px', color: '#e8e8e8' }}>
              Primary: {primaryScopes.length > 0 ? primaryScopes.join(', ') : 'None'}
            </div>
            <div style={{ fontSize: '13px', color: '#e8e8e8' }}>
              Backup: {activeBackupGrants.length > 0 ? '' : 'None'}
            </div>
            {activeBackupGrants.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {activeBackupGrants.map(grant => (
                  <span
                    key={grant.id}
                    style={{
                      fontSize: '11px',
                      color: '#FF9800',
                      border: '1px solid rgba(255,152,0,0.3)',
                      borderRadius: '999px',
                      padding: '3px 8px',
                      backgroundColor: 'rgba(255,152,0,0.12)'
                    }}
                  >
                    {String(grant.locationId || '').toUpperCase()} until {formatScopeExpiry(grant.expiresAtIso)}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {isOffline && (
        <div style={{
          marginBottom: '16px',
          fontSize: '12px',
          color: '#FF9800',
          textAlign: 'center'
        }}>
          Offline mode is active. Supervisor/Admin write actions are disabled until connection is restored.
        </div>
      )}

      {/* Tabs - dropdown on mobile, button strip on desktop */}
      {isMobile ? (
        <div style={{ marginBottom: '20px' }}>
          <select
            value={activeTab}
            onChange={(e) => setActiveTab(e.target.value)}
            style={{
              width: '100%',
              padding: '12px 16px',
              backgroundColor: 'rgba(229,57,53,0.15)',
              color: '#e8e8e8',
              border: '2px solid #E53935',
              borderRadius: '10px',
              fontSize: '15px',
              fontWeight: 'bold',
              cursor: 'pointer',
              appearance: 'none',
              WebkitAppearance: 'none',
              backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%278%27 viewBox=%270 0 12 8%27%3E%3Cpath fill=%27%23E53935%27 d=%27M6 8L0 0h12z%27/%3E%3C/svg%3E")',
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 14px center',
              backgroundSize: '12px'
            }}
          >
            {availableTabKeys.map(tab => (
              <option key={tab} value={tab}>{TAB_LABELS[tab]}</option>
            ))}
          </select>
        </div>
      ) : (
        <div style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '20px',
          borderBottom: '2px solid rgba(255,255,255,0.08)',
          flexWrap: 'wrap'
        }}>
          {availableTabKeys.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '12px 24px',
                backgroundColor: activeTab === tab ? '#E53935' : 'transparent',
                color: activeTab === tab ? 'white' : '#8899aa',
                border: 'none',
                borderBottom: activeTab === tab ? '3px solid #E53935' : 'none',
                borderRadius: '8px 8px 0 0',
                fontSize: '14px',
                fontWeight: 'bold',
                cursor: 'pointer',
                marginBottom: '-2px'
              }}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
      )}

      {/* EOC Tab */}
      {activeTab === 'eoc' && <SupervisorEocPanel user={user} isOffline={isOffline} />}

      {/* Compliance Tab */}
      {activeTab === 'compliance' && (
        <CompliancePanel
          user={user}
          scopeSites={isAdmin ? null : allowedComplianceSites}
        />
      )}

      {/* Audit Tab (Admin) */}
      {activeTab === 'audit' && isAdmin && (
        <div>
          <div style={{
            backgroundColor: 'rgba(255,255,255,0.05)',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '20px',
            border: '1px solid rgba(229,57,53,0.2)',
            backdropFilter: 'blur(12px)'
          }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', color: '#e8e8e8' }}>
              Audit Logs ({auditLogs.length})
            </h3>

            {auditLogs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#556677' }}>
                No audit entries yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {auditLogs.map(log => (
                  <div
                    key={log.id}
                    style={{
                      padding: '12px',
                      borderRadius: '8px',
                      border: '1px solid rgba(255,255,255,0.08)',
                      backgroundColor: 'rgba(255,255,255,0.03)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 700, fontSize: '13px', color: '#e8e8e8' }}>
                        {(log.action || 'action').toUpperCase()} &bull; {log.collectionPath || '--'} &bull; {log.documentId || '--'}
                      </div>
                      <div style={{ fontSize: '12px', color: '#8899aa' }}>
                        {formatDate(log.createdAt)} {formatTime(log.createdAt)}
                      </div>
                    </div>
                    <div style={{ fontSize: '12px', color: '#8899aa', marginTop: '4px' }}>
                      By: {log.performedByName || log.performedByUserId || 'Unknown'}
                    </div>
                    <div style={{ fontSize: '13px', color: '#e8e8e8', marginTop: '6px' }}>
                      Reason: {log.reason || '(none)'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Assignments Tab */}
      {activeTab === 'assignments' && (
        <div>
          <div style={{
            backgroundColor: 'rgba(255,255,255,0.05)',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '20px',
            border: '1px solid rgba(229,57,53,0.2)',
            backdropFilter: 'blur(12px)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', color: '#e8e8e8' }}>BHT Assignments ({shiftAssignments.length})</h3>
              <button
                onClick={handleAddAssignment}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#4CAF50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                + New Assignment
              </button>
            </div>

            {editingAssignment && (
              <div style={{
                backgroundColor: 'rgba(255,255,255,0.03)',
                padding: '20px',
                borderRadius: '8px',
                marginBottom: '20px',
                border: '2px solid #E53935'
              }}>
                <h4 style={{ margin: '0 0 16px 0', color: '#e8e8e8' }}>
                  {editingAssignment === 'new' ? 'New Assignment' : 'Edit Assignment'}
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                  <div>
                    <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>BHT *</label>
                    <select
                      value={assignmentForm.bhtUserId}
                      onChange={(e) => setAssignmentForm({ ...assignmentForm, bhtUserId: e.target.value })}
                      disabled={editingAssignment !== 'new'}
                      style={selectStyle}
                    >
                      <option value="">Select BHT...</option>
                      {techUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>Location *</label>
                    <select
                      value={assignmentForm.locationId}
                      onChange={(e) => setAssignmentForm({ ...assignmentForm, locationId: e.target.value })}
                      style={selectStyle}
                    >
                      <option value="">Select Location...</option>
                      {LOCATIONS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>Shift *</label>
                    <select
                      value={assignmentForm.shiftId}
                      onChange={(e) => setAssignmentForm({ ...assignmentForm, shiftId: e.target.value })}
                      style={selectStyle}
                    >
                      <option value="">Select Shift...</option>
                      {SHIFTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>House Primary</label>
                    <select
                      value={assignmentForm.isHousePrimary ? 'true' : 'false'}
                      onChange={(e) => setAssignmentForm({ ...assignmentForm, isHousePrimary: e.target.value === 'true' })}
                      style={selectStyle}
                    >
                      <option value="false">No</option>
                      <option value="true">Yes</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>Active</label>
                    <select
                      value={assignmentForm.active ? 'true' : 'false'}
                      onChange={(e) => setAssignmentForm({ ...assignmentForm, active: e.target.value === 'true' })}
                      style={selectStyle}
                    >
                      <option value="true">Active</option>
                      <option value="false">Inactive</option>
                    </select>
                  </div>
                </div>

                <div style={{ marginTop: '12px' }}>
                  <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>Assigned Vans (multi-select)</label>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {VANS.map(v => (
                      <button
                        key={v.id}
                        className={`chip ${assignmentForm.vanIds.includes(v.id) ? 'chip-selected' : 'chip-unselected'}`}
                        onClick={() => toggleVanId(v.id)}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                  <button
                    onClick={handleSaveAssignment}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: '#4CAF50',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: 'bold',
                      cursor: 'pointer'
                    }}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingAssignment(null)}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: '#999',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: 'bold',
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {shiftAssignments.map(a => (
                <div
                  key={a.id}
                  style={{
                    padding: '16px',
                    borderRadius: '8px',
                    border: a.active ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(255,255,255,0.04)',
                    backgroundColor: a.active ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.01)',
                    opacity: a.active ? 1 : 0.6,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '4px' }}>
                      {a.bhtUserName}
                      {!a.active && <span style={{ color: '#999', fontSize: '11px', marginLeft: '8px' }}>INACTIVE</span>}
                    </div>
                    <div style={{ fontSize: '13px', color: '#8899aa' }}>
                      {LOCATIONS.find(l => l.id === a.locationId)?.label || a.locationId}
                      {' '}&bull;{' '}
                      {SHIFTS.find(s => s.id === a.shiftId)?.label || a.shiftId}
                      {a.vanIds?.length > 0 && (
                        <span> &bull; {a.vanIds.map(v => VANS.find(van => van.id === v)?.label || v).join(', ')}</span>
                      )}
                      {a.isHousePrimary && (
                        <span style={{ color: '#4CAF50', marginLeft: '8px' }}>House Primary</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => handleEditAssignment(a)}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: '#E53935',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        cursor: 'pointer'
                      }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteAssignment(a.id)}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: '#f44336',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        cursor: 'pointer'
                      }}
                    >
                      Soft Delete
                    </button>
                    {isAdmin && (
                      <button
                        onClick={() => handleHardDeleteAssignment(a.id)}
                        style={{
                          padding: '8px 16px',
                          backgroundColor: '#7B1FA2',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 'bold',
                          cursor: 'pointer'
                        }}
                      >
                        Hard Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {shiftAssignments.length === 0 && (
                <div style={{ textAlign: 'center', padding: '30px', color: '#556677' }}>
                  No assignments yet. Create one to assign a BHT to a location, shift, and van(s).
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* User Management Tab */}
      {activeTab === 'users' && (
        <div>
          <div style={{
            backgroundColor: 'rgba(255,255,255,0.05)',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '20px',
            border: '1px solid rgba(229,57,53,0.2)',
            backdropFilter: 'blur(12px)'
          }}>
            {isAdmin && (
              <div style={{
                marginBottom: '14px',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.08)',
                backgroundColor: 'rgba(255,255,255,0.03)'
              }}>
                <div style={{ fontSize: '13px', color: '#e8e8e8', fontWeight: 'bold', marginBottom: '6px' }}>
                  Auth Scope Enforcement
                </div>
                <div style={{ fontSize: '12px', color: '#8899aa', marginBottom: '8px' }}>
                  Status: {authPolicyLoading ? 'loading...' : (authScopeEnforced ? 'ENFORCED (claims required)' : 'HYBRID (claims optional)')}
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => handleSetAuthScopeEnforced(true)}
                    disabled={isOffline || authPolicyLoading || authScopeEnforced}
                    style={{
                      padding: '8px 14px',
                      backgroundColor: (isOffline || authPolicyLoading || authScopeEnforced) ? 'rgba(255,255,255,0.08)' : '#E53935',
                      color: (isOffline || authPolicyLoading || authScopeEnforced) ? '#8899aa' : 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      cursor: (isOffline || authPolicyLoading || authScopeEnforced) ? 'not-allowed' : 'pointer'
                    }}
                  >
                    Enable Strict Mode
                  </button>
                  <button
                    onClick={() => handleSetAuthScopeEnforced(false)}
                    disabled={isOffline || authPolicyLoading || !authScopeEnforced}
                    style={{
                      padding: '8px 14px',
                      backgroundColor: (isOffline || authPolicyLoading || !authScopeEnforced) ? 'rgba(255,255,255,0.08)' : '#4CAF50',
                      color: (isOffline || authPolicyLoading || !authScopeEnforced) ? '#8899aa' : 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      cursor: (isOffline || authPolicyLoading || !authScopeEnforced) ? 'not-allowed' : 'pointer'
                    }}
                  >
                    Disable Strict Mode
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', color: '#e8e8e8' }}>Users ({users.length})</h3>
              <button
                onClick={handleAddUser}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#4CAF50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                + Add New User
              </button>
            </div>

            {editingUser === 'new' && (
              <div style={{
                backgroundColor: 'rgba(255,255,255,0.03)',
                padding: '20px',
                borderRadius: '8px',
                marginBottom: '20px',
                border: '2px solid #E53935'
              }}>
                <h4 style={{ margin: '0 0 16px 0', color: '#e8e8e8' }}>
                  Add New User
                </h4>
                {renderUserEditorFields(true)}
                <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                  <button
                    onClick={handleSaveUser}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: '#4CAF50',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: 'bold',
                      cursor: 'pointer'
                    }}
                  >
                    Save
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: '#999',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: 'bold',
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {users.map((managedUser) => {
                const isEditingThisUser = editingUser === managedUser.id
                return (
                  <div
                    key={managedUser.id}
                    style={{
                      padding: '16px',
                      borderRadius: '8px',
                      border: isEditingThisUser ? '2px solid #E53935' : '1px solid rgba(255,255,255,0.08)',
                      backgroundColor: managedUser.active ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.01)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px', flex: 1 }}>
                        <div>
                          <div style={{ fontSize: '11px', color: '#8899aa' }}>ID</div>
                          <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{managedUser.id}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: '11px', color: '#8899aa' }}>Name</div>
                          <div style={{ fontSize: '14px' }}>{managedUser.name}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: '11px', color: '#8899aa' }}>PIN Storage</div>
                          <div style={{ fontSize: '14px', fontFamily: 'monospace' }}>
                            {managedUser.pinHash ? 'hashed (v1)' : (managedUser.pin ? 'legacy plaintext' : 'unset')}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: '11px', color: '#8899aa' }}>Role</div>
                          <div style={{ fontSize: '14px', textTransform: 'capitalize' }}>{managedUser.role}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: '11px', color: '#8899aa' }}>Site</div>
                          <div style={{ fontSize: '14px' }}>{managedUser.site}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: '11px', color: '#8899aa' }}>Status</div>
                          <div style={{
                            fontSize: '12px',
                            fontWeight: 'bold',
                            color: managedUser.active ? '#4CAF50' : '#999'
                          }}>
                            {managedUser.active ? 'ACTIVE' : 'INACTIVE'}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', marginLeft: '16px', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => handleEditUser(managedUser)}
                          style={{
                            padding: '8px 16px',
                            backgroundColor: '#E53935',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '12px',
                            fontWeight: 'bold',
                            cursor: 'pointer'
                          }}
                        >
                          {isEditingThisUser ? 'Editing' : 'Edit'}
                        </button>
                        <button
                          onClick={() => handleDeleteUser(managedUser.id)}
                          style={{
                            padding: '8px 16px',
                            backgroundColor: '#f44336',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '12px',
                            fontWeight: 'bold',
                            cursor: 'pointer'
                          }}
                        >
                          Soft Delete
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => handleHardDeleteUser(managedUser.id)}
                            style={{
                              padding: '8px 16px',
                              backgroundColor: '#7B1FA2',
                              color: 'white',
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: 'bold',
                              cursor: 'pointer'
                            }}
                          >
                            Hard Delete
                          </button>
                        )}
                      </div>
                    </div>

                    {isEditingThisUser && (
                      <div style={{
                        marginTop: '16px',
                        paddingTop: '16px',
                        borderTop: '1px solid rgba(255,255,255,0.1)'
                      }}>
                        <h4 style={{ margin: '0 0 16px 0', color: '#e8e8e8' }}>
                          Edit User
                        </h4>
                        {renderUserEditorFields(false)}
                        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                          <button
                            onClick={handleSaveUser}
                            style={{
                              padding: '10px 20px',
                              backgroundColor: '#4CAF50',
                              color: 'white',
                              border: 'none',
                              borderRadius: '8px',
                              fontSize: '14px',
                              fontWeight: 'bold',
                              cursor: 'pointer'
                            }}
                          >
                            Save
                          </button>
                          <button
                            onClick={handleCancelEdit}
                            style={{
                              padding: '10px 20px',
                              backgroundColor: '#999',
                              color: 'white',
                              border: 'none',
                              borderRadius: '8px',
                              fontSize: '14px',
                              fontWeight: 'bold',
                              cursor: 'pointer'
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {isAdmin && (
              <AccessGrantPanel
                currentUser={user}
                users={users}
                isOffline={isOffline}
              />
            )}
          </div>
        </div>
      )}

      {/* Dashboard Tab */}
      {activeTab === 'dashboard' && (
        <div>
          {/* EOC Summary */}
            {(eocIssues.length > 0 || eocOverdueTasks.length > 0 || eocAlerts.length > 0) && (
              <div style={{
                backgroundColor: 'rgba(255,255,255,0.05)',
              borderRadius: '12px',
              padding: '20px',
              marginBottom: '20px',
              border: '1px solid rgba(229,57,53,0.2)',
              backdropFilter: 'blur(12px)'
            }}>
              <h3 style={{ margin: '0 0 14px 0', fontSize: '16px', color: '#e8e8e8' }}>EOC Status</h3>

              {/* Clickable KPI cards */}
              <div style={{ display: 'flex', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => setQueueView('issues')}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: 'rgba(255,87,34,0.15)',
                    borderRadius: '8px',
                    textAlign: 'center',
                    border: queueView === 'issues' ? '2px solid #FF5722' : '1px solid rgba(255,87,34,0.3)',
                    cursor: 'pointer',
                    color: 'inherit'
                  }}
                >
                  <div style={{ fontSize: '12px', color: '#FF5722' }}>Open Issues</div>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#FF5722' }}>{eocIssues.length}</div>
                </button>
                <button
                  onClick={() => setQueueView('overdue')}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: 'rgba(255,152,0,0.15)',
                    borderRadius: '8px',
                    textAlign: 'center',
                    border: queueView === 'overdue' ? '2px solid #FF9800' : '1px solid rgba(255,152,0,0.3)',
                    cursor: 'pointer',
                    color: 'inherit'
                  }}
                >
                  <div style={{ fontSize: '12px', color: '#FF9800' }}>Overdue Tasks</div>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#FF9800' }}>{eocOverdueTasks.length}</div>
                </button>
                <button
                  onClick={() => setQueueView('alerts')}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: 'rgba(33,150,243,0.15)',
                    borderRadius: '8px',
                    textAlign: 'center',
                    border: queueView === 'alerts' ? '2px solid #2196F3' : '1px solid rgba(33,150,243,0.3)',
                    cursor: 'pointer',
                    color: 'inherit'
                  }}
                >
                  <div style={{ fontSize: '12px', color: '#64B5F6' }}>Unread Alerts</div>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#64B5F6' }}>{eocAlerts.length}</div>
                </button>
              </div>

              {/* Queue controls */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '10px',
                marginBottom: '12px'
              }}>
                <div>
                  <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
                    Queue
                  </label>
                  <select
                    value={queueView}
                    onChange={(e) => setQueueView(e.target.value)}
                    style={selectStyle}
                  >
                    <option value="issues">Active Issues ({queueCounts.issues})</option>
                    <option value="overdue">Overdue Tasks ({queueCounts.overdue})</option>
                    <option value="alerts">Unread Alerts ({queueCounts.alerts})</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
                    Location
                  </label>
                  <select
                    value={queueLocationFilter}
                    onChange={(e) => setQueueLocationFilter(e.target.value)}
                    style={selectStyle}
                  >
                    <option value="all">All Locations</option>
                    {LOCATIONS.map(loc => (
                      <option key={loc.id} value={loc.id}>{loc.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Queue list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {queueView === 'issues' && filteredIssueQueue.length === 0 && (
                  <div style={{ color: '#8899aa', fontSize: '13px' }}>No active issues for this filter.</div>
                )}
                {queueView === 'issues' && filteredIssueQueue.map(issue => (
                  <div key={issue.id} style={{
                    padding: '12px',
                    borderRadius: '8px',
                    border: issue.severity === 'high' ? '2px solid #FF5722' : '1px solid rgba(255,255,255,0.08)',
                    backgroundColor: 'rgba(255,255,255,0.04)'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 700, fontSize: '14px' }}>{issue.label}</span>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <span className={`chip severity-${issue.severity}`} style={{ fontSize: '11px', textTransform: 'capitalize' }}>
                          {issue.severity}
                        </span>
                        <span className="chip" style={{ fontSize: '11px', textTransform: 'uppercase' }}>
                          {issue.status || 'open'}
                        </span>
                      </div>
                    </div>
                    <div style={{ fontSize: '13px', color: '#8899aa', marginBottom: '4px' }}>{issue.description}</div>
                    <div style={{ fontSize: '12px', color: '#556677', marginBottom: '8px' }}>
                      {LOCATIONS.find(l => l.id === issue.locationId)?.label || issue.locationId} &bull; {issue.reportedByName}
                      {issue.vanId ? ` \u00B7 ${VANS.find(v => v.id === issue.vanId)?.label || issue.vanId}` : ''}
                    </div>

                    {(issue.status === 'open' || issue.status === 'in_progress') && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <input
                          className="input"
                          placeholder="Status note (required)..."
                          value={getIssueActionNote(issue.id)}
                          onChange={e => updateIssueActionNote(issue.id, e.target.value)}
                          style={{ width: '100%', padding: '6px 10px', fontSize: '13px' }}
                        />
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          {issue.status === 'open' && (
                            <button
                              onClick={() => handleDashStartIssue(issue.id, getIssueActionNote(issue.id))}
                              style={{
                                padding: '6px 14px', backgroundColor: 'rgba(255,255,255,0.06)', color: '#e8e8e8',
                                border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
                                cursor: 'pointer'
                              }}
                            >
                              In Progress
                            </button>
                          )}
                          <button
                            onClick={() => handleDashResolveIssue(issue.id, getIssueActionNote(issue.id))}
                            style={{
                              padding: '6px 14px', backgroundColor: '#4CAF50', color: 'white',
                              border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
                              cursor: 'pointer'
                            }}
                          >
                            Resolve
                          </button>
                          <button
                            onClick={() => clearIssueActionNote(issue.id)}
                            style={{
                              padding: '6px 14px', backgroundColor: 'rgba(255,255,255,0.06)', color: '#8899aa',
                              border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer'
                            }}
                          >
                            Clear Note
                          </button>
                        </div>
                      </div>
                    )}
                    {issue.status === 'in_progress' && issue.inProgressByName && (
                      <div style={{ fontSize: '11px', color: '#8899aa', marginTop: '6px' }}>
                        In progress by {issue.inProgressByName}
                      </div>
                    )}
                  </div>
                ))}

                {queueView === 'overdue' && filteredOverdueTaskQueue.length === 0 && (
                  <div style={{ color: '#8899aa', fontSize: '13px' }}>No overdue tasks for this filter.</div>
                )}
                {queueView === 'overdue' && filteredOverdueTaskQueue.map(task => (
                  <div key={task.id} style={{
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.08)',
                    backgroundColor: 'rgba(255,255,255,0.04)'
                  }}>
                    <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px' }}>
                      {task.taskType === 'house'
                        ? 'House EOC'
                        : `Van EOC (${VANS.find(v => v.id === task.vanId)?.label || task.vanId || 'Van'})`}
                    </div>
                    <div style={{ fontSize: '12px', color: '#556677', marginBottom: '8px' }}>
                      {LOCATIONS.find(l => l.id === task.locationId)?.label || task.locationId}
                      {' '} &bull; {SHIFTS.find(s => s.id === task.shiftId)?.label || task.shiftId}
                      {' '} &bull; Due {task.dueDate}
                      {' '} &bull; Assigned {task.assigneeUserName || task.assigneeUserId || 'Unassigned'}
                    </div>
                    <button
                      onClick={() => handleQueueReassign(task)}
                      style={{
                        padding: '6px 14px',
                        backgroundColor: 'rgba(255,255,255,0.06)',
                        color: '#e8e8e8',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Open Reassign Flow
                    </button>
                  </div>
                ))}

                {queueView === 'alerts' && filteredAlertQueue.length === 0 && (
                  <div style={{ color: '#8899aa', fontSize: '13px' }}>No unread alerts for this filter.</div>
                )}
                {queueView === 'alerts' && filteredAlertQueue.map(alertItem => (
                  <div key={alertItem.id} style={{
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.08)',
                    backgroundColor: 'rgba(255,255,255,0.04)'
                  }}>
                    <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '4px' }}>
                      {alertItem.type || 'Alert'}
                    </div>
                    <div style={{ fontSize: '13px', color: '#8899aa', marginBottom: '6px' }}>
                      {alertItem.message || '(no message)'}
                    </div>
                    <div style={{ fontSize: '12px', color: '#556677', marginBottom: '8px' }}>
                      {LOCATIONS.find(l => l.id === alertItem.locationId)?.label || alertItem.locationId || 'Unknown location'}
                      {' '} &bull; {formatDate(alertItem.createdAt)} {formatTime(alertItem.createdAt)}
                      {alertItem.techName ? ` \u00B7 ${alertItem.techName}` : ''}
                    </div>
                    <button
                      onClick={() => handleMarkAlertRead(alertItem.id)}
                      style={{
                        padding: '6px 14px',
                        backgroundColor: '#2196F3',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Mark Read
                    </button>
                  </div>
                ))}
              </div>
              </div>
            )}

            {/* Compliance Summary */}
            {complianceSummary.total > 0 && (
              <div style={{
                backgroundColor: 'rgba(255,255,255,0.05)',
                borderRadius: '12px',
                padding: '20px',
                marginBottom: '20px',
                border: '1px solid rgba(229,57,53,0.2)',
                backdropFilter: 'blur(12px)'
              }}>
                <h3 style={{ margin: '0 0 14px 0', fontSize: '16px', color: '#e8e8e8' }}>Compliance Status</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                  <div style={{
                    padding: '10px 20px',
                    backgroundColor: 'rgba(244,67,54,0.15)',
                    borderRadius: '8px',
                    textAlign: 'center',
                    border: '1px solid rgba(244,67,54,0.3)'
                  }}>
                    <div style={{ fontSize: '12px', color: '#f44336' }}>Overdue</div>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#f44336' }}>{complianceSummary.overdue}</div>
                  </div>
                  <div style={{
                    padding: '10px 20px',
                    backgroundColor: 'rgba(255,152,0,0.15)',
                    borderRadius: '8px',
                    textAlign: 'center',
                    border: '1px solid rgba(255,152,0,0.3)'
                  }}>
                    <div style={{ fontSize: '12px', color: '#FF9800' }}>Due Soon</div>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#FF9800' }}>{complianceSummary.upcoming}</div>
                  </div>
                  <div style={{
                    padding: '10px 20px',
                    backgroundColor: 'rgba(76,175,80,0.15)',
                    borderRadius: '8px',
                    textAlign: 'center',
                    border: '1px solid rgba(76,175,80,0.3)'
                  }}>
                    <div style={{ fontSize: '12px', color: '#4CAF50' }}>Current</div>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#4CAF50' }}>{complianceSummary.current}</div>
                  </div>
                  {complianceSummary.none > 0 && (
                    <div style={{
                      padding: '10px 20px',
                      backgroundColor: 'rgba(255,255,255,0.04)',
                      borderRadius: '8px',
                      textAlign: 'center',
                      border: '1px solid rgba(255,255,255,0.1)'
                    }}>
                      <div style={{ fontSize: '12px', color: '#8899aa' }}>No Due Date</div>
                      <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#e8e8e8' }}>{complianceSummary.none}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Filter row */}
            <div style={{
              backgroundColor: 'rgba(255,255,255,0.05)',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '20px',
            border: '1px solid rgba(229,57,53,0.2)',
            backdropFilter: 'blur(12px)'
          }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '12px',
              alignItems: 'center'
            }}>
              <div>
                <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
                  Month
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    onClick={() => setDashMonth(new Date(dashMonth.getFullYear(), dashMonth.getMonth() - 1, 1))}
                    style={{
                      padding: '8px 12px',
                      backgroundColor: '#E53935',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '16px',
                      cursor: 'pointer'
                    }}
                  >&lt;</button>
                  <span style={{ fontSize: '14px', fontWeight: 'bold', minWidth: '140px', textAlign: 'center' }}>
                    {dashMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </span>
                  <button
                    onClick={() => setDashMonth(new Date(dashMonth.getFullYear(), dashMonth.getMonth() + 1, 1))}
                    style={{
                      padding: '8px 12px',
                      backgroundColor: '#E53935',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '16px',
                      cursor: 'pointer'
                    }}
                  >&gt;</button>
                </div>
              </div>
              <div>
                <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
                  Site
                </label>
                <select
                  value={dashSite}
                  onChange={(e) => setDashSite(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px',
                    border: '2px solid #eee',
                    borderRadius: '6px',
                    fontSize: '14px',
                    boxSizing: 'border-box'
                  }}
                >
                  <option value="ALL">All Sites</option>
                  <option value="PHP">PHP</option>
                  <option value="RTC">RTC</option>
                </select>
              </div>
            </div>
          </div>

          {dashLoading ? (
            <div style={{ textAlign: 'center', padding: '60px', color: '#556677' }}>
              Loading stats...
            </div>
          ) : dashStats.total === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px', color: '#556677' }}>
              No transports in this period
            </div>
          ) : (
            <>
              {/* Total card */}
              <button
                type="button"
                className="glass-card"
                onClick={() => handleDashboardDrilldown('total')}
                style={{
                  width: '100%',
                  backgroundColor: 'rgba(255,255,255,0.05)',
                  borderRadius: '12px',
                  padding: '20px',
                  marginBottom: '20px',
                  border: '1px solid #eee',
                  textAlign: 'center',
                  cursor: 'pointer'
                }}
              >
                <div style={{ fontSize: '12px', color: '#8899aa', marginBottom: '4px' }}>Total Transports</div>
                <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#E53935' }}>{dashStats.total}</div>
              </button>

              {/* Two-column breakdown */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '20px',
                marginBottom: '20px'
              }}>
                {/* By Reason */}
                <div className="glass-card" style={{
                  backgroundColor: 'rgba(255,255,255,0.05)',
                  borderRadius: '12px',
                  padding: '20px',
                  border: '1px solid #eee'
                }}>
                  <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', color: '#e8e8e8' }}>By Reason</h3>
                  {dashStats.byReason.length === 0 ? (
                    <div style={{ color: '#556677', fontSize: '14px' }}>No reasons recorded</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {dashStats.byReason.map(([reason, count]) => (
                        <button
                          key={reason}
                          type="button"
                          onClick={() => handleDashboardDrilldown('reason', reason)}
                          style={{
                            width: '100%',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '8px 12px',
                            backgroundColor: 'rgba(255,255,255,0.04)',
                            borderRadius: '6px',
                            border: '1px solid rgba(255,255,255,0.08)',
                            cursor: 'pointer'
                          }}
                        >
                          <span style={{ fontSize: '14px' }}>{reason}</span>
                          <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#E53935' }}>{count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* By Tech */}
                <div className="glass-card" style={{
                  backgroundColor: 'rgba(255,255,255,0.05)',
                  borderRadius: '12px',
                  padding: '20px',
                  border: '1px solid #eee'
                }}>
                  <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', color: '#e8e8e8' }}>By Tech</h3>
                  {dashStats.byTech.length === 0 ? (
                    <div style={{ color: '#556677', fontSize: '14px' }}>No tech activity recorded</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {dashStats.byTech.map(([tech, count]) => (
                        <button
                          key={tech}
                          type="button"
                          onClick={() => handleDashboardDrilldown('tech', tech)}
                          style={{
                            width: '100%',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '8px 12px',
                            backgroundColor: 'rgba(255,255,255,0.04)',
                            borderRadius: '6px',
                            border: '1px solid rgba(255,255,255,0.08)',
                            cursor: 'pointer'
                          }}
                        >
                          <span style={{ fontSize: '14px' }}>{tech}</span>
                          <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#E53935' }}>{count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* DC Paperwork */}
              <div className="glass-card" style={{
                backgroundColor: 'rgba(255,255,255,0.05)',
                borderRadius: '12px',
                padding: '20px',
                border: '1px solid rgba(229,57,53,0.2)',
                backdropFilter: 'blur(12px)'
              }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', color: '#e8e8e8' }}>DC Paperwork</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                  {dashStats.byPaperwork.map(([status, count]) => (
                    <div key={status} style={{
                      padding: '10px 20px',
                      backgroundColor:
                        status === 'collected' ? 'rgba(76,175,80,0.15)' :
                        status === 'N/A' ? 'rgba(255,255,255,0.04)' :
                        status === 'unknown' ? 'rgba(255,152,0,0.15)' :
                        'rgba(229,57,53,0.15)',
                      borderRadius: '8px',
                      textAlign: 'center'
                    }}>
                      <div style={{ fontSize: '12px', color: '#8899aa', textTransform: 'capitalize' }}>{status}</div>
                      <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#e8e8e8' }}>{count}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Transports Tab */}
      {activeTab === 'transports' && (
        <div>
          {/* Filters */}
          <div style={{
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderRadius: '12px',
        padding: '20px',
        marginBottom: '20px',
        border: '1px solid #eee'
      }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', color: '#e8e8e8' }}>Filters</h3>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '12px',
          marginBottom: '12px'
        }}>
          <div>
            <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                border: '2px solid #eee',
                borderRadius: '6px',
                fontSize: '14px',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                border: '2px solid #eee',
                borderRadius: '6px',
                fontSize: '14px',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
              Site
            </label>
            <select
              value={transportSiteFilter}
              onChange={(e) => setTransportSiteFilter(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                border: '2px solid #eee',
                borderRadius: '6px',
                fontSize: '14px',
                boxSizing: 'border-box'
              }}
            >
              <option value="ALL">All Sites</option>
              <option value="PHP">PHP</option>
              <option value="RTC">RTC</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
              Status
            </label>
            <select
              value={transportStatusFilter}
              onChange={(e) => setTransportStatusFilter(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                border: '2px solid #eee',
                borderRadius: '6px',
                fontSize: '14px',
                boxSizing: 'border-box'
              }}
            >
              <option value="all">All Statuses</option>
              <option value="completed">Completed Only</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
              Driver
            </label>
            <select
              value={selectedDriver}
              onChange={(e) => setSelectedDriver(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                border: '2px solid #eee',
                borderRadius: '6px',
                fontSize: '14px',
                boxSizing: 'border-box'
              }}
            >
              <option value="">All Drivers</option>
              {drivers.map(driver => (
                <option key={driver} value={driver}>{driver}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
              Reason
            </label>
            <select
              value={transportReasonFilter}
              onChange={(e) => setTransportReasonFilter(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                border: '2px solid #eee',
                borderRadius: '6px',
                fontSize: '14px',
                boxSizing: 'border-box'
              }}
            >
              <option value="">All Reasons</option>
              {transportReasonOptions.map(reason => (
                <option key={reason} value={reason}>{reason}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
              Overdue
            </label>
            <select
              value={overdueFilter}
              onChange={(e) => setOverdueFilter(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                border: '2px solid #eee',
                borderRadius: '6px',
                fontSize: '14px',
                boxSizing: 'border-box'
              }}
            >
              <option value="all">All</option>
              <option value="yes">Overdue Only</option>
              <option value="no">Not Overdue</option>
            </select>
          </div>
        </div>

        <div>
          <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
            Search Client
          </label>
          <input
            type="text"
            value={clientSearch}
            onChange={(e) => setClientSearch(e.target.value)}
            placeholder="Type client name..."
            style={{
              width: '100%',
              padding: '8px',
              border: '2px solid #eee',
              borderRadius: '6px',
              fontSize: '14px',
              boxSizing: 'border-box'
            }}
          />
        </div>

        {isDashboardDrilldownActive && (
          <div style={{
            marginTop: '12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
            padding: '10px 12px',
            backgroundColor: 'rgba(229,57,53,0.12)',
            border: '1px solid rgba(229,57,53,0.35)',
            borderRadius: '8px'
          }}>
            <div style={{ fontSize: '12px', color: '#e8e8e8' }}>
              Active drill-down: {drilldownLabel || 'Dashboard context'}
            </div>
            <button
              type="button"
              onClick={clearDashboardDrilldown}
              style={{
                padding: '6px 12px',
                backgroundColor: 'rgba(255,255,255,0.1)',
                color: '#e8e8e8',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: '6px',
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              Clear Drill-down
            </button>
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{
        display: 'flex',
        gap: '12px',
        marginBottom: '20px'
      }}>
        <button
          onClick={exportToExcel}
          disabled={filteredTransports.length === 0}
          style={{
            padding: '12px 24px',
            backgroundColor: filteredTransports.length > 0 ? '#4CAF50' : 'rgba(255,255,255,0.06)',
            color: filteredTransports.length > 0 ? 'white' : '#556677',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 'bold',
            cursor: filteredTransports.length > 0 ? 'pointer' : 'not-allowed'
          }}
        >
          Export to Excel ({filteredTransports.length})
        </button>
      </div>

      {/* Results */}
      <div style={{
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderRadius: '12px',
        padding: '20px',
        border: '1px solid #eee'
      }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', color: '#e8e8e8' }}>
          Transports ({filteredTransports.length})
        </h3>

        {filteredTransports.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#556677' }}>
            No transports found
          </div>
        ) : (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}>
            {filteredTransports.map(t => (
              <div
                key={t.id}
                style={{
                  padding: '16px',
                  borderRadius: '8px',
                  border: isOverdue(t) ? '2px solid #FF5722' : '1px solid rgba(255,255,255,0.08)',
                  backgroundColor: 'rgba(255,255,255,0.03)',
                  position: 'relative'
                }}
              >
                {isOverdue(t) && (
                  <div style={{
                    position: 'absolute',
                    top: '-8px',
                    right: '12px',
                    backgroundColor: '#FF5722',
                    color: 'white',
                    padding: '4px 12px',
                    borderRadius: '12px',
                    fontSize: '11px',
                    fontWeight: 'bold'
                  }}>
                    OVERDUE
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
                  <div>
                    <div style={{ fontSize: '11px', color: '#8899aa' }}>Date</div>
                    <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{formatDate(t.departedAt)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: '#8899aa' }}>Driver</div>
                    <div style={{ fontSize: '14px' }}>{t.createdByName}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: '#8899aa' }}>Client(s)</div>
                    <div style={{ fontSize: '14px' }}>{t.clients?.join(', ') || 'None'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: '#8899aa' }}>Stops</div>
                    <div style={{ fontSize: '14px' }}>{t.stops?.length || 0}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: '#8899aa' }}>Status</div>
                    <div style={{
                      fontSize: '12px',
                      fontWeight: 'bold',
                      color:
                        t.status === 'open' ? '#856404' :
                        t.status === 'arrived' ? '#0C5460' :
                        t.status === 'returned' ? '#155724' :
                        t.status === 'closed' ? '#2E7D32' :
                        '#666'
                    }}>
                      {t.status?.toUpperCase()}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
        </div>
      )}
    </div>
  )
}

export default SupervisorDashboard
