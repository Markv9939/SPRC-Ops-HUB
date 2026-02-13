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
import { hardDeleteDerivedAssignment, syncDerivedAssignmentForUser } from '../services/assignmentService'
import { notifySuccess } from '../utils/toast'
import { showConfirmDialog, showPromptDialog } from '../utils/dialogs'
import { getStatus } from '../utils/complianceStatus'
import {
  GLOBAL_SCOPE,
  MAIN_LOCATIONS,
  MAIN_LOCATION_OTC,
  ROLE_BHT,
  buildAuthorizedLocations,
  buildBhtLocationId,
  canActorManageRole,
  formatRoleLabel,
  getAllowedVanIdsForMainLocation,
  getAvailableMainLocationsForUser,
  getHouseOptionsForMainLocation,
  isAdminRole,
  isBhtRole,
  locationIdToMainLocation,
  normalizeHouseId,
  normalizeMainLocation,
  normalizeRole,
  normalizeScopeValues,
  normalizeTransportSite,
  requiresHouseSelection,
  roleOptionsForActor
} from '../utils/orgModel'

const TAB_LABELS = {
  dashboard: '\u{1F4C8} Dashboard',
  transports: '\u{1F4CA} Transports',
  users: '\u{1F465} Users',
  eoc: '\u{1F527} EOC',
  compliance: '\u{1F4CB} Compliance',
  audit: '\u{1F9FE} Audit'
}
const TAB_KEYS = Object.keys(TAB_LABELS)
const TRANSPORT_SITES = new Set(MAIN_LOCATIONS)
const COMPLIANCE_SITES = new Set(MAIN_LOCATIONS)
const COMPLIANCE_CATEGORY_LABELS = {
  fpcc: 'FPCC',
  tb_test: 'TB Test',
  cpr_first_aid: 'CPR & First Aid',
  food_handlers: 'Food Handlers',
  drivers_license: "Driver's License",
  annual_orientation: 'Annual Orientation',
  performance_evaluation: 'Performance Evaluation',
  education: 'Education Verification',
  resume: 'Resume'
}

function locationScopeAlias(locationId) {
  const normalizedMainLocation = locationIdToMainLocation(locationId)
  if (normalizedMainLocation) return normalizedMainLocation

  const normalized = String(locationId || '').trim().toUpperCase()
  return normalizeMainLocation(normalized) || normalized
}

function normalizeComplianceSite(siteId) {
  return locationScopeAlias(siteId)
}

function formatComplianceCategory(category) {
  const normalized = String(category || '').trim().toLowerCase()
  if (!normalized) return 'Compliance item'
  if (COMPLIANCE_CATEGORY_LABELS[normalized]) {
    return COMPLIANCE_CATEGORY_LABELS[normalized]
  }
  return normalized
    .split('_')
    .filter(Boolean)
    .map(token => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ')
}

function formatComplianceSiteLabel(siteId) {
  const normalized = normalizeComplianceSite(siteId)
  if (!normalized) return 'Unknown Location'
  if (normalized === 'OTC') return 'OTC (Mesquite / Lone Mountain)'
  return normalized
}

function getComplianceItemSite(item) {
  return normalizeComplianceSite(item?.employeeSite || item?.site || item?.locationId)
}

function getComplianceItemDueMs(item) {
  const dueValue = item?.dueDate
  if (!dueValue) return Number.POSITIVE_INFINITY
  const dueDate = dueValue.toDate ? dueValue.toDate() : new Date(dueValue)
  const ms = dueDate.getTime()
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY
}

function SupervisorDashboard({ user, isOffline = false }) {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 600)
  const [headerOffset, setHeaderOffset] = useState(64)
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

  const [drivers, setDrivers] = useState([])

  // EOC Dashboard summary
  const [eocIssues, setEocIssues] = useState([])
  const [eocOverdueTasks, setEocOverdueTasks] = useState([])
  const [eocAlerts, setEocAlerts] = useState([])
  const [queueView, setQueueView] = useState('issues')
  const [queueLocationFilter, setQueueLocationFilter] = useState('all')
  const [eocIssueActionNotes, setEocIssueActionNotes] = useState({})
  const [overdueTaskActionId, setOverdueTaskActionId] = useState(null)
  const [overdueTaskActionMode, setOverdueTaskActionMode] = useState(null)
  const [overdueTaskActionReason, setOverdueTaskActionReason] = useState('')
  const [overdueTaskActionSubmitting, setOverdueTaskActionSubmitting] = useState(false)

  // Compliance dashboard summary
  const [complianceItems, setComplianceItems] = useState([])
  const [auditLogs, setAuditLogs] = useState([])

  // User Management
  const [users, setUsers] = useState([])
  const [editingUser, setEditingUser] = useState(null)
  const [userForm, setUserForm] = useState({
    id: '',
    name: '',
    pin: '',
    role: '',
    location: '',
    house: '',
    shiftId: '',
    vanId: '',
    active: true
  })

  const isAdmin = isAdminRole(user?.role)
  const availableTabKeys = isAdmin ? TAB_KEYS : TAB_KEYS.filter(k => k !== 'audit')
  const actorRoleOptions = useMemo(
    () => roleOptionsForActor(user?.role),
    [user?.role]
  )
  const managedMainLocations = useMemo(() => {
    const scopedLocations = getAvailableMainLocationsForUser(user)
    if (isAdmin) return [...MAIN_LOCATIONS]
    return scopedLocations.length > 0 ? scopedLocations : [MAIN_LOCATION_OTC]
  }, [isAdmin, user])
  const defaultManagedMainLocation = managedMainLocations[0] || MAIN_LOCATION_OTC
  const rawScopes = useMemo(
    () => (Array.isArray(user?.authorizedLocations) ? user.authorizedLocations : []),
    [user?.authorizedLocations]
  )
  const normalizedScopes = useMemo(
    () => normalizeScopeValues([
      ...(user?.site ? [user.site] : []),
      ...rawScopes
    ]),
    [rawScopes, user?.site]
  )
  const primaryScopes = useMemo(() => (
    normalizeScopeValues([
      ...(Array.isArray(user?.primaryScopes) ? user.primaryScopes : []),
      ...(user?.site ? [user.site] : [])
    ])
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
    () => (isAdmin
      ? []
      : [...new Set(
          normalizedScopes
            .map(scope => normalizeComplianceSite(scope))
            .filter(scope => COMPLIANCE_SITES.has(scope))
        )]),
    [isAdmin, normalizedScopes]
  )
  const inTransportScope = useCallback(
    (site) => isAdmin || allowedTransportSites.includes(normalizeTransportSite(site)),
    [allowedTransportSites, isAdmin]
  )
  const inComplianceScope = useCallback(
    (site) => isAdmin || allowedComplianceSites.includes(normalizeComplianceSite(site)),
    [allowedComplianceSites, isAdmin]
  )
  const inEocScope = useCallback(
    (locationId) => {
      if (isAdmin) return true
      const normalizedLocation = String(locationId || '').trim().toUpperCase()
      if (!normalizedLocation) return false
      const aliasedLocation = locationScopeAlias(normalizedLocation)
      return normalizedScopes.includes(normalizedLocation) || normalizedScopes.includes(aliasedLocation)
    },
    [isAdmin, normalizedScopes]
  )

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 600px)')
    const handler = (e) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    const readHeaderHeight = () => {
      const headerEl = document.querySelector('.header')
      if (!headerEl) return
      const measuredHeight = Math.max(56, Math.ceil(headerEl.getBoundingClientRect().height))
      setHeaderOffset(prev => (prev === measuredHeight ? prev : measuredHeight))
    }

    readHeaderHeight()
    window.addEventListener('resize', readHeaderHeight)
    return () => window.removeEventListener('resize', readHeaderHeight)
  }, [])

  useEffect(() => {
    if (!isAdmin && activeTab === 'audit') {
      setActiveTab('dashboard')
    }
  }, [activeTab, isAdmin])

  useEffect(() => {
    if (queueView === 'overdue') return
    setOverdueTaskActionId(null)
    setOverdueTaskActionMode(null)
    setOverdueTaskActionReason('')
    setOverdueTaskActionSubmitting(false)
  }, [queueView])

  // Real-time EOC issues + overdue tasks for dashboard summary
  useEffect(() => {
    const unsubIssues = onSnapshot(
      query(collection(db, 'eocIssues'), where('status', 'in', ['open', 'in_progress']), orderBy('createdAt', 'desc')),
      (snap) => {
        const rows = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(issue => inEocScope(issue.locationId))
        setEocIssues(rows)
      }
    )
    const unsubOverdueTasks = onSnapshot(
      query(collection(db, 'eocTasks'), where('status', '==', 'overdue')),
      (snap) => {
        const rows = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(task => inEocScope(task.locationId))
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
          .filter(alertItem => inEocScope(alertItem.locationId))
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
  }, [inEocScope])

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
    const usersData = usersSnapshot.docs
      .map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      }))
      .map((loadedUser) => {
        const normalizedRole = normalizeRole(loadedUser.role)
        const normalizedLocation = isAdminRole(normalizedRole)
          ? GLOBAL_SCOPE
          : (normalizeMainLocation(loadedUser.location || loadedUser.site || loadedUser.locationId) || '')
        const normalizedHouse = normalizeHouseId(loadedUser.house || loadedUser.locationId)
        return {
          ...loadedUser,
          role: normalizedRole,
          location: normalizedLocation,
          site: normalizedLocation,
          house: normalizedHouse || '',
          shiftId: String(loadedUser.shiftId || '').trim(),
          vanId: loadedUser.vanId || ''
        }
      })
      .filter(loadedUser => !loadedUser.deletedAt && loadedUser.deleted !== true)

    if (isAdmin) {
      setUsers(usersData)
      return
    }

    const actorScopeSet = new Set(managedMainLocations)
    setUsers(usersData.filter(loadedUser => (
      isBhtRole(loadedUser.role)
      && actorScopeSet.has(normalizeMainLocation(loadedUser.location || loadedUser.site || loadedUser.locationId))
    )))
  }, [isAdmin, managedMainLocations])

  useEffect(() => {
    // Set default to current month
    const now = new Date()
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0)

    setStartDate(firstDay.toISOString().split('T')[0])
    setEndDate(lastDay.toISOString().split('T')[0])

    // Load users
    loadUsers()
  }, [loadUsers])

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

  const promptDeleteReason = async (label) => {
    const reason = await showPromptDialog(`Enter reason for ${label}:`, {
      title: 'Reason Required',
      tone: 'warning',
      confirmText: 'Continue',
      cancelText: 'Cancel',
      placeholder: 'Enter reason'
    })
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
    if (!isAdminRole(user?.role)) return false
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

  const buildDefaultUserForm = useCallback(() => ({
    id: '',
    name: '',
    pin: '',
    role: '',
    location: '',
    house: '',
    shiftId: '',
    vanId: '',
    active: true
  }), [])

  const handleAddUser = () => {
    if (actorRoleOptions.length === 0) {
      alert('Your account does not have permission to manage users.')
      return
    }

    setEditingUser('new')
    setUserForm(buildDefaultUserForm())
  }

  const handleEditUser = (managedUser) => {
    const normalizedRole = normalizeRole(managedUser?.role)
    if (!canActorManageRole(user?.role, normalizedRole)) {
      alert('You can only edit BHT users.')
      return
    }

    const normalizedLocation = normalizedRole === 'admin'
      ? GLOBAL_SCOPE
      : (normalizeMainLocation(managedUser?.location || managedUser?.site || managedUser?.locationId) || defaultManagedMainLocation)

    setUserForm({
      ...managedUser,
      role: normalizedRole,
      location: normalizedLocation,
      site: normalizedLocation,
      house: normalizeHouseId(managedUser?.house || managedUser?.locationId),
      shiftId: String(managedUser?.shiftId || '').trim(),
      vanId: String(managedUser?.vanId || '').trim().toLowerCase(),
      pin: ''
    })
    setEditingUser(managedUser.id)
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
      const normalizedRole = normalizeRole(userForm.role || '')

      if (!normalizedRole) {
        alert('Please select a role.')
        return
      }

      if (!canActorManageRole(user?.role, normalizedRole)) {
        alert('You do not have permission to create this role.')
        return
      }

      const normalizedLocation = normalizedRole === 'admin'
        ? GLOBAL_SCOPE
        : normalizeMainLocation(userForm.location)

      if (normalizedRole !== 'admin' && !normalizedLocation) {
        alert('Please select a valid location.')
        return
      }

      if (!isAdmin && normalizedLocation && !managedMainLocations.includes(normalizedLocation)) {
        alert('You can only assign users to your own location.')
        return
      }

      let normalizedHouse = ''
      let normalizedVanId = ''
      let normalizedLocationId = null
      let normalizedShiftId = ''

      if (isBhtRole(normalizedRole)) {
        if (!normalizedLocation) {
          alert('BHT users must have a location.')
          return
        }

        normalizedHouse = normalizeHouseId(userForm.house)
        if (requiresHouseSelection(normalizedLocation) && !normalizedHouse) {
          alert('OTC BHTs must be assigned to Mesquite House or Lone Mountain.')
          return
        }

        normalizedVanId = String(userForm.vanId || '').trim().toLowerCase()
        const allowedVans = getAllowedVanIdsForMainLocation(normalizedLocation)
        if (!normalizedVanId || !allowedVans.includes(normalizedVanId)) {
          alert(`Please select a valid van for ${normalizedLocation}.`)
          return
        }

        normalizedShiftId = String(userForm.shiftId || '').trim()
        if (!normalizedShiftId || !SHIFTS.some(shiftOption => shiftOption.id === normalizedShiftId)) {
          alert('Please select a valid shift for this BHT user.')
          return
        }

        normalizedLocationId = buildBhtLocationId(normalizedLocation, normalizedHouse)
        if (!normalizedLocationId) {
          alert('Please select a valid BHT location assignment.')
          return
        }
      }

      const authorizedLocations = buildAuthorizedLocations({
        role: normalizedRole,
        mainLocation: normalizedLocation,
        houseId: normalizedHouse
      })

      const payload = {
        name: userForm.name,
        pinHash,
        pinVersion: 'v1_sha256',
        pinUpdatedAt: serverTimestamp(),
        role: normalizedRole,
        site: normalizedRole === 'admin' ? GLOBAL_SCOPE : normalizedLocation,
        location: normalizedRole === 'admin' ? GLOBAL_SCOPE : normalizedLocation,
        house: isBhtRole(normalizedRole) ? normalizedHouse || null : null,
        locationId: isBhtRole(normalizedRole) ? normalizedLocationId : null,
        shiftId: isBhtRole(normalizedRole) ? normalizedShiftId : null,
        vanId: isBhtRole(normalizedRole) ? normalizedVanId : null,
        active: userForm.active === true,
        authorizedLocations,
        updatedAt: serverTimestamp()
      }
      const persistUserAndAssignment = async () => {
        if (editingUser === 'new') {
          await setDoc(doc(db, 'users', userForm.id), {
            ...payload,
            createdAt: serverTimestamp()
          })
        } else {
          await updateDoc(doc(db, 'users', userForm.id), payload)
        }

        await syncDerivedAssignmentForUser(userForm.id, {
          name: userForm.name,
          role: normalizedRole,
          locationId: normalizedLocationId,
          shiftId: normalizedShiftId,
          vanId: normalizedVanId,
          active: userForm.active === true
        })
      }

      try {
        await persistUserAndAssignment()
      } catch (persistError) {
        if (persistError?.code === 'permission-denied' && isAdminRole(user?.role)) {
          const tokenRole = String(user?.authClaimRole || '').trim() || '(none)'
          const refreshed = await refreshAdminAuthSession()
          if (refreshed) {
            try {
              await persistUserAndAssignment()
              notifySuccess('User saved after refreshing admin auth session.')
              setEditingUser(null)
              loadUsers()
              return
            } catch (retryErr) {
              console.error('Retry failed after admin auth refresh:', retryErr)
              throw retryErr
            }
          }
          alert(`Admin save failed due to auth scope mismatch (token role: ${tokenRole}). Lock/logout, sign in again, and confirm latest Firestore rules are deployed.`)
          return
        }
        throw persistError
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

    if (!(await showConfirmDialog(`Soft-delete user ${userId}?`, {
      title: 'Soft Delete User',
      tone: 'danger',
      confirmText: 'Soft Delete'
    }))) return

    const reason = await promptDeleteReason(`soft-delete of user ${userId}`)
    if (!reason) return
    const targetUser = users.find(candidate => candidate.id === userId)

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
      await syncDerivedAssignmentForUser(userId, {
        name: targetUser?.name || userId,
        role: targetUser?.role || 'bht',
        locationId: targetUser?.locationId || null,
        shiftId: targetUser?.shiftId || '',
        vanId: targetUser?.vanId || '',
        active: false
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

    if (!(await showConfirmDialog(`Permanently hard-delete user ${userId}? This cannot be undone.`, {
      title: 'Hard Delete User',
      tone: 'danger',
      confirmText: 'Hard Delete'
    }))) return

    const reason = await promptDeleteReason(`hard-delete of user ${userId}`)
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
      await hardDeleteDerivedAssignment(userId)
      notifySuccess('User hard-deleted')
      loadUsers()
    } catch (error) {
      console.error('Error hard deleting user:', error)
      alert('Error hard deleting user: ' + error.message)
    }
  }

  const handleCancelEdit = () => {
    setEditingUser(null)
    setUserForm(buildDefaultUserForm())
  }

  const renderUserEditorFields = (isNewUser) => {
    const normalizedFormRole = normalizeRole(userForm.role || '')
    const isAdminFormRole = normalizedFormRole === 'admin'
    const hasRoleSelection = Boolean(normalizedFormRole)
    const locationSelectDisabled = isAdminFormRole || !hasRoleSelection
    const effectiveLocation = normalizedFormRole === 'admin'
      ? GLOBAL_SCOPE
      : normalizeMainLocation(userForm.location)
    const showHouseSelect = isBhtRole(normalizedFormRole) && requiresHouseSelection(effectiveLocation)
    const houseOptions = getHouseOptionsForMainLocation(effectiveLocation)
    const vanOptions = isBhtRole(normalizedFormRole)
      ? VANS.filter(v => getAllowedVanIdsForMainLocation(effectiveLocation).includes(v.id))
      : []
    const locationOptions = isAdmin ? MAIN_LOCATIONS : managedMainLocations

    return (
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
            placeholder="e.g., bht3"
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
            value={normalizedFormRole || ''}
            onChange={(e) => {
              const nextRole = normalizeRole(e.target.value)
              const nextLocation = nextRole === 'admin'
                ? GLOBAL_SCOPE
                : normalizeMainLocation(userForm.location)
              setUserForm(prev => ({
                ...prev,
                role: nextRole,
                location: nextLocation,
                house: nextRole === ROLE_BHT ? prev.house : '',
                shiftId: nextRole === ROLE_BHT ? prev.shiftId : '',
                vanId: nextRole === ROLE_BHT ? prev.vanId : ''
              }))
            }}
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
            <option value="">Select Role...</option>
            {actorRoleOptions.map(roleOption => (
              <option key={roleOption} value={roleOption}>{formatRoleLabel(roleOption)}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
            Location
          </label>
          <select
            value={locationSelectDisabled ? (isAdminFormRole ? GLOBAL_SCOPE : '') : (effectiveLocation || '')}
            onChange={(e) => {
              const nextLocation = normalizeMainLocation(e.target.value)
              const allowedVans = getAllowedVanIdsForMainLocation(nextLocation)
              setUserForm(prev => ({
                ...prev,
                location: nextLocation,
                house: requiresHouseSelection(nextLocation) ? prev.house : '',
                vanId: allowedVans.includes(prev.vanId) ? prev.vanId : ''
              }))
            }}
            disabled={locationSelectDisabled}
            style={{
              width: '100%',
              padding: '8px',
              border: '2px solid rgba(255,255,255,0.1)',
              borderRadius: '6px',
              fontSize: '14px',
              boxSizing: 'border-box',
              backgroundColor: locationSelectDisabled ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.06)',
              color: '#e8e8e8',
              cursor: locationSelectDisabled ? 'not-allowed' : 'pointer'
            }}
          >
            {locationSelectDisabled ? (
              isAdminFormRole ? (
                <option value={GLOBAL_SCOPE}>GLOBAL (full access)</option>
              ) : (
                <option value="">Select role first</option>
              )
            ) : (
              <>
                <option value="">Select Location...</option>
                {locationOptions.map(locationId => (
                  <option key={locationId} value={locationId}>{locationId}</option>
                ))}
              </>
            )}
          </select>
        </div>
        {showHouseSelect && (
          <div>
            <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
              OTC House *
            </label>
            <select
              value={normalizeHouseId(userForm.house)}
              onChange={(e) => setUserForm({ ...userForm, house: normalizeHouseId(e.target.value) })}
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
              <option value="">Select House...</option>
              {houseOptions.map(option => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </div>
        )}
        {isBhtRole(normalizedFormRole) && (
          <div>
            <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
              Van *
            </label>
            <select
              value={userForm.vanId}
              onChange={(e) => setUserForm({ ...userForm, vanId: String(e.target.value || '').trim().toLowerCase() })}
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
              <option value="">Select Van...</option>
              {vanOptions.map(vanOption => (
                <option key={vanOption.id} value={vanOption.id}>{vanOption.label}</option>
              ))}
            </select>
          </div>
        )}
        {isBhtRole(normalizedFormRole) && (
          <div>
            <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
              Shift *
            </label>
            <select
              value={userForm.shiftId}
              onChange={(e) => setUserForm({ ...userForm, shiftId: e.target.value })}
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
              <option value="">Select Shift...</option>
              {SHIFTS.map(shiftOption => (
                <option key={shiftOption.id} value={shiftOption.id}>{shiftOption.label}</option>
              ))}
            </select>
          </div>
        )}
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
  }
  const resetOverdueTaskActionState = () => {
    setOverdueTaskActionId(null)
    setOverdueTaskActionMode(null)
    setOverdueTaskActionReason('')
    setOverdueTaskActionSubmitting(false)
  }

  const openOverdueTaskIgnore = (task) => {
    setOverdueTaskActionId(task.id)
    setOverdueTaskActionMode('ignore')
    setOverdueTaskActionReason('')
    setOverdueTaskActionSubmitting(false)
  }

  const handleOverdueTaskIgnore = async (task) => {
    if (blockIfOffline('ignoring overdue tasks')) return
    if (!task?.id) return

    const reason = String(overdueTaskActionReason || '').trim()
    if (!reason) {
      alert('Ignore reason is required for audit history.')
      return
    }

    setOverdueTaskActionSubmitting(true)
    try {
      const expectedVersion = getVersionNumber(task)
      await runTransaction(db, async (transaction) => {
        const taskRef = doc(db, 'eocTasks', task.id)
        const taskSnap = await transaction.get(taskRef)
        if (!taskSnap.exists()) {
          throw new Error('Task no longer exists.')
        }

        const latestTask = taskSnap.data()
        if (latestTask.status !== 'overdue') {
          throw new Error('Task is no longer overdue.')
        }

        const { nextVersion } = assertExpectedVersion({
          expectedVersion,
          currentVersion: getVersionNumber(latestTask),
          documentId: task.id,
          recordLabel: 'EOC Task'
        })

        transaction.update(taskRef, {
          status: 'ignored',
          ignoredAt: serverTimestamp(),
          ignoredByUserId: user?.id || null,
          ignoredByName: user?.name || null,
          ignoredReason: reason,
          version: nextVersion,
          updatedAt: serverTimestamp()
        })
      })

      await writeAuditLog({
        action: 'eoc_task_ignore',
        collectionPath: 'eocTasks',
        documentId: task.id,
        reason,
        extra: {
          locationId: task.locationId || '',
          shiftId: task.shiftId || '',
          dueDate: task.dueDate || ''
        }
      })

      notifySuccess('Overdue task ignored')
      resetOverdueTaskActionState()
    } catch (error) {
      console.error('Failed to ignore overdue task:', error)
      alertVersionConflict(error, error?.message || 'Failed to ignore overdue task')
      setOverdueTaskActionSubmitting(false)
      return
    }

    setOverdueTaskActionSubmitting(false)
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

  const getMonthDateRange = useCallback((referenceDate = new Date()) => {
    const startOfMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1)
    const endOfMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0)
    return {
      startDate: toDateInputValue(startOfMonth),
      endDate: toDateInputValue(endOfMonth)
    }
  }, [])

  const clearTransportFilters = useCallback(() => {
    const { startDate: defaultStartDate, endDate: defaultEndDate } = getMonthDateRange()
    setStartDate(defaultStartDate)
    setEndDate(defaultEndDate)
    setTransportSiteFilter('ALL')
    setTransportStatusFilter('all')
    setTransportReasonFilter('')
    setSelectedDriver('')
    setOverdueFilter('all')
    setClientSearch('')
  }, [getMonthDateRange])

  const handleDashboardDrilldown = (type, value = '') => {
    const { startDate: monthStartDate, endDate: monthEndDate } = getMonthDateRange(dashMonth)
    setStartDate(monthStartDate)
    setEndDate(monthEndDate)
    setTransportSiteFilter(dashSite)
    setTransportStatusFilter('completed')
    setTransportReasonFilter(type === 'reason' && value ? value : '')
    setSelectedDriver(type === 'bht' && value ? value : '')
    setOverdueFilter('all')
    setClientSearch('')
    setActiveTab('transports')
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
      })).map(item => ({
        ...item,
        site: normalizeTransportSite(item.site)
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
      filtered = filtered.filter(t => normalizeTransportSite(t.site) === transportSiteFilter)
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
        let data = snapshot.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .map(item => ({ ...item, site: normalizeTransportSite(item.site) }))

        // Client-side filters
        data = data.filter(t => inTransportScope(t.site))
        data = data.filter(t => isCompletedTransport(t))
        if (dashSite !== 'ALL') {
          data = data.filter(t => normalizeTransportSite(t.site) === dashSite)
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
      // BHT
      const bhtName = t.createdByName || 'Unknown'
      techCounts[bhtName] = (techCounts[bhtName] || 0) + 1
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

  const scopedComplianceItems = useMemo(
    () => complianceItems.filter(item => inComplianceScope(getComplianceItemSite(item))),
    [complianceItems, inComplianceScope]
  )

  const complianceSummary = useMemo(() => {
    const summary = { overdue: 0, upcoming: 0, current: 0, none: 0, total: 0 }
    scopedComplianceItems.forEach(item => {
      const status = getStatus(item.dueDate)
      if (status === 'overdue') summary.overdue += 1
      else if (status === 'upcoming') summary.upcoming += 1
      else if (status === 'current') summary.current += 1
      else summary.none += 1
    })
    summary.total = scopedComplianceItems.length
    return summary
  }, [scopedComplianceItems])

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

  const locationMatchesQueueFilter = useCallback((locationId) => {
    if (queueLocationFilter === 'all') return true
    const normalizedFilter = String(queueLocationFilter || '').trim().toUpperCase()
    if (!normalizedFilter) return true

    const normalizedLocation = String(locationId || '').trim().toUpperCase()
    if (!normalizedLocation) return false
    const aliasedLocation = locationScopeAlias(normalizedLocation)

    return normalizedLocation === normalizedFilter || aliasedLocation === normalizedFilter
  }, [queueLocationFilter])

  const complianceMatchesQueueFilter = useCallback((item) => {
    if (queueLocationFilter === 'all') return true
    const normalizedFilter = String(queueLocationFilter || '').trim().toUpperCase()
    if (!normalizedFilter) return true

    const complianceSite = getComplianceItemSite(item)
    if (!complianceSite) return false
    if (complianceSite === normalizedFilter) return true

    const mappedFilterSite = normalizeComplianceSite(queueLocationFilter)
    return complianceSite === mappedFilterSite
  }, [queueLocationFilter])

  const filteredIssueQueue = useMemo(
    () => eocIssues.filter(issue => locationMatchesQueueFilter(issue.locationId)),
    [eocIssues, locationMatchesQueueFilter]
  )
  const filteredOverdueTaskQueue = useMemo(
    () => eocOverdueTasks.filter(task => locationMatchesQueueFilter(task.locationId)),
    [eocOverdueTasks, locationMatchesQueueFilter]
  )
  const filteredAlertQueue = useMemo(
    () => eocAlerts.filter(alert => locationMatchesQueueFilter(alert.locationId)),
    [eocAlerts, locationMatchesQueueFilter]
  )
  const filteredComplianceOverdueQueue = useMemo(() => (
    scopedComplianceItems
      .filter(item => getStatus(item.dueDate) === 'overdue')
      .filter(item => complianceMatchesQueueFilter(item))
      .sort((a, b) => getComplianceItemDueMs(a) - getComplianceItemDueMs(b))
  ), [complianceMatchesQueueFilter, scopedComplianceItems])
  const filteredComplianceUpcomingQueue = useMemo(() => (
    scopedComplianceItems
      .filter(item => getStatus(item.dueDate) === 'upcoming')
      .filter(item => complianceMatchesQueueFilter(item))
      .sort((a, b) => getComplianceItemDueMs(a) - getComplianceItemDueMs(b))
  ), [complianceMatchesQueueFilter, scopedComplianceItems])

  const queueCounts = {
    issues: filteredIssueQueue.length,
    overdue: filteredOverdueTaskQueue.length + filteredComplianceOverdueQueue.length,
    upcomingCompliance: filteredComplianceUpcomingQueue.length,
    alerts: filteredAlertQueue.length
  }

  const hasQueueData = (
    eocIssues.length > 0 ||
    eocOverdueTasks.length > 0 ||
    eocAlerts.length > 0 ||
    complianceSummary.overdue > 0 ||
    complianceSummary.upcoming > 0
  )

  const queueLocationOptions = useMemo(() => {
    const options = LOCATIONS.map(loc => ({ value: loc.id, label: loc.label }))
    const seenValues = new Set(options.map(option => String(option.value || '').trim().toUpperCase()))
    const discoveredLocations = new Set()

    const addMappedSite = (locationId) => {
      const mapped = locationScopeAlias(locationId)
      if (mapped) discoveredLocations.add(mapped)
    }

    eocIssues.forEach(issue => addMappedSite(issue.locationId))
    eocOverdueTasks.forEach(task => addMappedSite(task.locationId))
    eocAlerts.forEach(alertItem => addMappedSite(alertItem.locationId))
    scopedComplianceItems.forEach(item => {
      const site = getComplianceItemSite(item)
      if (site) discoveredLocations.add(site)
    })

    ;[...discoveredLocations].sort().forEach(site => {
      if (seenValues.has(site)) return
      options.push({ value: site, label: `Location: ${site}` })
      seenValues.add(site)
    })

    return options
  }, [eocAlerts, eocIssues, eocOverdueTasks, scopedComplianceItems])

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
        'Location': t.site || '',
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
  const tabRailStyle = {
    position: 'sticky',
    top: `${headerOffset}px`,
    zIndex: 95,
    marginBottom: '20px',
    paddingTop: '8px',
    paddingBottom: '6px',
    background: 'linear-gradient(180deg, rgba(15,25,35,0.98) 0%, rgba(15,25,35,0.9) 72%, rgba(15,25,35,0) 100%)',
    backdropFilter: 'blur(8px)'
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
      <div style={tabRailStyle}>
        {isMobile ? (
          <div>
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
      </div>

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
                const managedUserLocation = normalizeMainLocation(managedUser.location || managedUser.site || managedUser.locationId)
                const managedUserHouse = normalizeHouseId(managedUser.house || managedUser.locationId)
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
                          <div style={{ fontSize: '14px' }}>{formatRoleLabel(managedUser.role)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: '11px', color: '#8899aa' }}>Location</div>
                          <div style={{ fontSize: '14px' }}>
                            {isAdminRole(managedUser.role) ? 'GLOBAL (full access)' : (managedUserLocation || '--')}
                          </div>
                        </div>
                        {isBhtRole(managedUser.role) && (
                          <div>
                            <div style={{ fontSize: '11px', color: '#8899aa' }}>House / Shift / Van</div>
                            <div style={{ fontSize: '14px' }}>
                              {managedUserLocation === MAIN_LOCATION_OTC
                                ? `${managedUserHouse === 'MESQUITE' ? 'Mesquite House' : (managedUserHouse === 'LONE_MOUNTAIN' ? 'Lone Mountain' : '--')}`
                                : 'N/A'}
                              {' '} - {' '}
                              {(SHIFTS.find(s => s.id === managedUser.shiftId)?.label || managedUser.shiftId || '--')}
                              {' '} - {' '}
                              {(VANS.find(v => v.id === managedUser.vanId)?.label || managedUser.vanId || '--')}
                            </div>
                          </div>
                        )}
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
            {hasQueueData && (
              <div style={{
                backgroundColor: 'rgba(255,255,255,0.05)',
              borderRadius: '12px',
              padding: '20px',
              marginBottom: '20px',
              border: '1px solid rgba(229,57,53,0.2)',
              backdropFilter: 'blur(12px)'
            }}>
              <h3 style={{ margin: '0 0 14px 0', fontSize: '16px', color: '#e8e8e8' }}>EOC + Compliance Status</h3>

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
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#FF9800' }}>
                    {eocOverdueTasks.length + complianceSummary.overdue}
                  </div>
                </button>
                <button
                  onClick={() => setQueueView('compliance_upcoming')}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: 'rgba(76,175,80,0.15)',
                    borderRadius: '8px',
                    textAlign: 'center',
                    border: queueView === 'compliance_upcoming' ? '2px solid #4CAF50' : '1px solid rgba(76,175,80,0.3)',
                    cursor: 'pointer',
                    color: 'inherit'
                  }}
                >
                  <div style={{ fontSize: '12px', color: '#4CAF50' }}>Upcoming Compliance</div>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#4CAF50' }}>{complianceSummary.upcoming}</div>
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
                    <option value="compliance_upcoming">Upcoming Compliance ({queueCounts.upcomingCompliance})</option>
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
                    {queueLocationOptions.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
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

                {queueView === 'overdue' && filteredOverdueTaskQueue.length === 0 && filteredComplianceOverdueQueue.length === 0 && (
                  <div style={{ color: '#8899aa', fontSize: '13px' }}>No overdue EOC or compliance tasks for this filter.</div>
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
                      {' '} &bull; Eligible {Array.isArray(task.eligibleUserIds) ? task.eligibleUserIds.length : (task.assigneeUserId ? 1 : 0)}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => openOverdueTaskIgnore(task)}
                        style={{
                          padding: '6px 14px',
                          backgroundColor: 'rgba(255,152,0,0.16)',
                          color: '#FFB74D',
                          border: '1px solid rgba(255,152,0,0.35)',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        Ignore Task
                      </button>
                      <button
                        onClick={() => setActiveTab('users')}
                        style={{
                          padding: '6px 14px',
                          backgroundColor: 'rgba(33,150,243,0.15)',
                          color: '#90CAF9',
                          border: '1px solid rgba(33,150,243,0.35)',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        Manage Users
                      </button>
                    </div>

                    {overdueTaskActionId === task.id && overdueTaskActionMode === 'ignore' && (
                      <div style={{
                        marginTop: '10px',
                        padding: '10px',
                        borderRadius: '8px',
                        border: '1px solid rgba(255,152,0,0.35)',
                        backgroundColor: 'rgba(255,152,0,0.08)'
                      }}>
                        <div style={{ fontSize: '12px', color: '#FFB74D', marginBottom: '8px', fontWeight: 700 }}>
                          Ignore overdue task (audit reason required)
                        </div>
                        <textarea
                          value={overdueTaskActionReason}
                          onChange={(event) => setOverdueTaskActionReason(event.target.value)}
                          placeholder="Reason for ignoring this overdue task"
                          rows={2}
                          style={{
                            width: '100%',
                            padding: '8px 10px',
                            border: '2px solid rgba(255,255,255,0.1)',
                            borderRadius: '6px',
                            fontSize: '13px',
                            boxSizing: 'border-box',
                            backgroundColor: 'rgba(255,255,255,0.06)',
                            color: '#e8e8e8'
                          }}
                        />
                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                          <button
                            onClick={() => handleOverdueTaskIgnore(task)}
                            disabled={overdueTaskActionSubmitting}
                            style={{
                              padding: '6px 14px',
                              backgroundColor: overdueTaskActionSubmitting ? 'rgba(255,255,255,0.08)' : '#FF9800',
                              color: overdueTaskActionSubmitting ? '#8899aa' : '#1f2933',
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '13px',
                              fontWeight: 700,
                              cursor: overdueTaskActionSubmitting ? 'not-allowed' : 'pointer'
                            }}
                          >
                            Confirm Ignore
                          </button>
                          <button
                            onClick={resetOverdueTaskActionState}
                            disabled={overdueTaskActionSubmitting}
                            style={{
                              padding: '6px 14px',
                              backgroundColor: 'rgba(255,255,255,0.06)',
                              color: '#8899aa',
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '13px',
                              cursor: overdueTaskActionSubmitting ? 'not-allowed' : 'pointer'
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {queueView === 'overdue' && filteredComplianceOverdueQueue.map(item => (
                  <div key={`compliance-overdue-${item.id}`} style={{
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid rgba(244,67,54,0.35)',
                    backgroundColor: 'rgba(244,67,54,0.08)'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 700, fontSize: '14px' }}>
                        Compliance: {formatComplianceCategory(item.category)}
                      </span>
                      <span className="chip" style={{
                        fontSize: '11px',
                        color: '#f44336',
                        border: '1px solid rgba(244,67,54,0.45)',
                        backgroundColor: 'rgba(244,67,54,0.08)'
                      }}>
                        OVERDUE
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#556677', marginBottom: '8px' }}>
                      {item.employeeName || 'Unknown employee'}
                      {' '} &bull; {formatComplianceSiteLabel(getComplianceItemSite(item))}
                      {' '} &bull; Due {formatDate(item.dueDate)}
                    </div>
                    {item.notes && (
                      <div style={{ fontSize: '12px', color: '#8899aa', marginBottom: '8px' }}>
                        Notes: {item.notes}
                      </div>
                    )}
                    <button
                      onClick={() => setActiveTab('compliance')}
                      style={{
                        padding: '6px 14px',
                        backgroundColor: 'rgba(244,67,54,0.16)',
                        color: '#ffcdd2',
                        border: '1px solid rgba(244,67,54,0.35)',
                        borderRadius: '6px',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Open Compliance Tab
                    </button>
                  </div>
                ))}

                {queueView === 'compliance_upcoming' && filteredComplianceUpcomingQueue.length === 0 && (
                  <div style={{ color: '#8899aa', fontSize: '13px' }}>No upcoming compliance tasks for this filter.</div>
                )}
                {queueView === 'compliance_upcoming' && filteredComplianceUpcomingQueue.map(item => (
                  <div key={`compliance-upcoming-${item.id}`} style={{
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid rgba(76,175,80,0.35)',
                    backgroundColor: 'rgba(76,175,80,0.08)'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 700, fontSize: '14px' }}>
                        Compliance: {formatComplianceCategory(item.category)}
                      </span>
                      <span className="chip" style={{
                        fontSize: '11px',
                        color: '#81C784',
                        border: '1px solid rgba(76,175,80,0.45)',
                        backgroundColor: 'rgba(76,175,80,0.08)'
                      }}>
                        DUE SOON
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#556677', marginBottom: '8px' }}>
                      {item.employeeName || 'Unknown employee'}
                      {' '} &bull; {formatComplianceSiteLabel(getComplianceItemSite(item))}
                      {' '} &bull; Due {formatDate(item.dueDate)}
                    </div>
                    {item.notes && (
                      <div style={{ fontSize: '12px', color: '#8899aa', marginBottom: '8px' }}>
                        Notes: {item.notes}
                      </div>
                    )}
                    <button
                      onClick={() => setActiveTab('compliance')}
                      style={{
                        padding: '6px 14px',
                        backgroundColor: 'rgba(76,175,80,0.16)',
                        color: '#c8e6c9',
                        border: '1px solid rgba(76,175,80,0.35)',
                        borderRadius: '6px',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Open Compliance Tab
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
                      {(alertItem.bhtName || alertItem.techName) ? ` \u00B7 ${alertItem.bhtName || alertItem.techName}` : ''}
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
                  Location
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
                  <option value="ALL">All Locations</option>
                  {MAIN_LOCATIONS.map(locationId => (
                    <option key={locationId} value={locationId}>{locationId}</option>
                  ))}
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

                {/* By BHT */}
                <div className="glass-card" style={{
                  backgroundColor: 'rgba(255,255,255,0.05)',
                  borderRadius: '12px',
                  padding: '20px',
                  border: '1px solid #eee'
                }}>
                  <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', color: '#e8e8e8' }}>By BHT</h3>
                  {dashStats.byTech.length === 0 ? (
                    <div style={{ color: '#556677', fontSize: '14px' }}>No BHT activity recorded</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {dashStats.byTech.map(([tech, count]) => (
                        <button
                          key={tech}
                          type="button"
                          onClick={() => handleDashboardDrilldown('bht', tech)}
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
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
          marginBottom: '16px'
        }}>
          <h3 style={{ margin: 0, fontSize: '16px', color: '#e8e8e8' }}>Filters</h3>
          <button
            type="button"
            onClick={clearTransportFilters}
            style={{
              padding: '8px 14px',
              backgroundColor: 'rgba(255,255,255,0.1)',
              color: '#e8e8e8',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 'bold',
              cursor: 'pointer'
            }}
          >
            Clear Filters
          </button>
        </div>

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
              Location
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
              <option value="ALL">All Locations</option>
              {MAIN_LOCATIONS.map(locationId => (
                <option key={locationId} value={locationId}>{locationId}</option>
              ))}
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
              BHT
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


