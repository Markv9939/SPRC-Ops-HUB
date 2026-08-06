import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { db } from '../firebase'
import { collection, query, where, orderBy, onSnapshot, Timestamp, doc, getDoc, getDocs, getDocsFromServer, updateDoc, serverTimestamp, writeBatch, runTransaction } from 'firebase/firestore'
import { ChevronRight } from 'lucide-react'
import * as XLSX from 'xlsx'
import DashboardSummaryPanel from './DashboardSummaryPanel'
import SupervisorEocPanel from './SupervisorEocPanel'
import CompliancePanel from './CompliancePanel'
import PropertiesPanel from './PropertiesPanel'
import FleetPanel from './FleetPanel'
import CintasPanel from './CintasPanel'
import AccessGrantPanel from './AccessGrantPanel'
import SupervisorDebriefsPanel from './SupervisorDebriefsPanel'
import TransportDetailsDrawer from './TransportDetailsDrawer'
import TransportRecordPage from './TransportRecordPage'
import { LOCATIONS, VANS, getShiftLabel, getShiftOptionsForMainLocation, isShiftAllowedForMainLocation } from '../data/eocConstants'
import { hardDeleteDerivedAssignment, syncDerivedAssignmentForUser } from '../services/assignmentService'
import { notifySuccess } from '../utils/toast'
import { showConfirmDialog, showPromptDialog } from '../utils/dialogs'
import { writeAuditLog as writeAuditEntry } from '../services/notificationService'
import { assertExpectedVersion, formatVersionConflictMessage, getVersionNumber } from '../services/versioning'
import { COMPANY_EMAIL_DOMAIN, getEmailDomain, isCompanyEmail, normalizeEmail } from '../services/authProfileService'
import useUserScope from '../hooks/useUserScope'
import useScopedIssues from '../hooks/useScopedIssues'
import useScopedFleet from '../hooks/useScopedFleet'
import {
  formatTransportRecordDate,
  formatTransportRecordTime,
  getTransportStatusBadgeClass,
  isCompletedTransportRecord,
  isOverdueTransportRecord
} from '../utils/transportRecord'
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
  getHouseOptionsForMainLocation,
  isAdminRole,
  isBhtRole,
  normalizeHouseId,
  normalizeMainLocation,
  normalizeRole,
  normalizeTransportSite,
  requiresHouseSelection,
  roleOptionsForActor
} from '../utils/orgModel'

function normalizeVanIdList(values, fallbackVanId = '') {
  const base = Array.isArray(values) ? values : []
  const normalized = base
    .map(value => String(value || '').trim().toLowerCase())
    .filter(Boolean)
  const fallback = String(fallbackVanId || '').trim().toLowerCase()
  const merged = fallback ? [...normalized, fallback] : normalized
  return [...new Set(merged)]
}

function buildIssueLocationIds({ role, locationId, mainLocation }) {
  const normalizedRole = normalizeRole(role)
  if (normalizedRole === 'admin') return ['lone_mountain', 'mesquite', 'test_house', 'res']
  if (normalizedRole === 'supervisor') {
    if (mainLocation === 'OTC') return ['lone_mountain', 'mesquite', 'test_house']
    if (mainLocation === 'RES') return ['res']
    return []
  }
  const exactLocation = String(locationId || '').trim().toLowerCase()
  return ['lone_mountain', 'mesquite', 'test_house', 'res'].includes(exactLocation) ? [exactLocation] : []
}

function buildEmailLinkPayload({ appUserId, email, actorUser }) {
  const normalizedEmail = normalizeEmail(email)
  const domain = getEmailDomain(normalizedEmail)
  const company = isCompanyEmail(normalizedEmail)
  return {
    userId: appUserId,
    email: normalizedEmail,
    emailDomain: domain,
    emailType: company ? 'company' : 'external',
    externalGoogleAllowed: !company,
    externalReason: company ? null : `Approved by ${actorUser?.name || 'admin'} for Ops Hub access`,
    externalApprovedByUserId: company ? null : actorUser?.id || null,
    externalApprovedByName: company ? null : actorUser?.name || null,
    externalApprovedAt: company ? null : serverTimestamp(),
    active: true,
    updatedAt: serverTimestamp()
  }
}

function buildInternalUserId(name, existingIds = []) {
  const baseId = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'user'

  const existingIdSet = new Set(
    (Array.isArray(existingIds) ? existingIds : [])
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  )

  if (!existingIdSet.has(baseId)) return baseId

  let suffix = 2
  while (existingIdSet.has(`${baseId}_${suffix}`)) suffix += 1
  return `${baseId}_${suffix}`
}

function getTransportDestinationSummary(transport) {
  const destinations = Array.isArray(transport?.destinations) ? transport.destinations : []
  const destinationText = destinations
    .map(destination => destination?.name || destination?.address || '')
    .filter(Boolean)
    .join(', ')
  if (destinationText) return destinationText

  const stops = Array.isArray(transport?.stops) ? transport.stops : []
  return stops
    .map(stop => stop?.destinationName || stop?.destinationAddress || stop?.name || stop?.address || '')
    .filter(Boolean)
    .join(', ')
}

function getTransportAccessibleLabel(transport) {
  const clients = Array.isArray(transport?.clients) && transport.clients.length > 0
    ? transport.clients.join(', ')
    : 'no client recorded'
  const date = formatTransportRecordDate(transport?.departedAt)
  const driver = transport?.createdByName || 'unknown driver'
  const status = transport?.status || 'unknown status'
  return `View transport for ${clients}, ${date}, ${driver}, ${status}`
}

function SupervisorDashboard({
  user,
  isOffline = false,
  eocAlerts = [],
  fleetAlerts = [],
  debriefAlerts = [],
  activeTab: controlledActiveTab = 'dashboard',
  onActiveTabChange,
  navigationTarget = null,
  onNavigationHandled,
  transportRecordId = null,
  transportRecordMode = 'list',
  onOpenTransportPanel,
  onOpenTransportRecord,
  onCloseTransportDetails,
  onBackToTransportLog
}) {
  const activeTab = controlledActiveTab
  const setActiveTab = useCallback((nextTab) => {
    const resolvedTab = typeof nextTab === 'function' ? nextTab(activeTab) : nextTab
    onActiveTabChange?.(resolvedTab)
  }, [activeTab, onActiveTabChange])
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 1024)
  const [transports, setTransports] = useState([])
  const [filteredTransports, setFilteredTransports] = useState([])
  const [transportsLoaded, setTransportsLoaded] = useState(false)
  const [fallbackTransport, setFallbackTransport] = useState(null)
  const [transportLoadState, setTransportLoadState] = useState('idle')
  const [transportLoadError, setTransportLoadError] = useState('')
  const [transportLoadRetry, setTransportLoadRetry] = useState(0)
  const transportRowRefs = useRef(new Map())
  const transportResultsHeadingRef = useRef(null)
  const selectionWasFilteredRef = useRef(false)
  const previousSelectionIdRef = useRef(null)
  const previousTransportModeRef = useRef(transportRecordMode)
  const transportListScrollRef = useRef(0)

  // Dashboard stats
  // Filters
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [transportSiteFilter, setTransportSiteFilter] = useState('ALL')
  const [transportStatusFilter, setTransportStatusFilter] = useState('all')
  const [transportReasonFilter, setTransportReasonFilter] = useState('')
  const [selectedDriver, setSelectedDriver] = useState('')
  const [overdueFilter, setOverdueFilter] = useState('all')
  const [clientSearch, setClientSearch] = useState('')
  const [focusedDebriefId, setFocusedDebriefId] = useState(null)

  const [drivers, setDrivers] = useState([])

  // Compliance dashboard summary
  const [complianceItems, setComplianceItems] = useState([])
  const [auditLogs, setAuditLogs] = useState([])

  // User Management
  const [users, setUsers] = useState([])
  const [editingUser, setEditingUser] = useState(null)
  const [userForm, setUserForm] = useState({
    id: '',
    name: '',
    role: '',
    location: '',
    house: '',
    shiftId: '',
    vanId: '',
    vanIds: [],
    email: '',
    issueLocationIds: [],
    active: true
  })

  // ── Scope derivation (extracted to shared hook) ──
  const {
    isAdmin,
    primaryScopes,
    activeBackupGrants,
    managedMainLocations,
    defaultManagedMainLocation,
    allowedComplianceSites,
    inTransportScope,
    inComplianceScope,
    inEocScope
  } = useUserScope(user)

  // ── Real-time data from shared hooks ──
  // (Must be declared AFTER useUserScope so inEocScope/inComplianceScope are initialized.)
  // Note: eocAlerts and fleetAlerts are passed as props from App.jsx (already subscribed there)
  // to avoid duplicate Firestore listeners.
  const { issues: eocIssues, overdueTasks: eocOverdueTasks } = useScopedIssues({ inEocScope })
  const { overdueTasks: fleetOverdueTasks, upcomingTasks: fleetUpcomingTasks } = useScopedFleet({ inComplianceScope })

  const actorRoleOptions = useMemo(
    () => roleOptionsForActor(user?.role),
    [user?.role]
  )

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const handler = (e) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    if (!isAdmin && activeTab === 'audit') {
      setActiveTab('dashboard')
    }
  }, [activeTab, isAdmin, setActiveTab])

  useEffect(() => {
    if (!navigationTarget?.type) return
    if (navigationTarget.type === 'issue') {
      setActiveTab('eoc')
      return
    }
    if (navigationTarget.type === 'fleet') {
      setActiveTab('fleet')
      onNavigationHandled?.()
    }
    if (navigationTarget.type === 'debrief') {
      setFocusedDebriefId(navigationTarget.debriefId || null)
      setActiveTab('debriefs')
      onNavigationHandled?.()
    }
  }, [navigationTarget, onNavigationHandled, setActiveTab])



  // Compliance items listener (not yet extracted to a hook)
  useEffect(() => {
    const unsubCompliance = onSnapshot(
      collection(db, 'complianceItems'),
      (snap) => setComplianceItems(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    return () => unsubCompliance()
  }, [])

  const applyLoadedUsers = useCallback((userDocs) => {
    const usersData = userDocs
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
        const normalizedVanIds = normalizeVanIdList(loadedUser.vanIds, loadedUser.vanId)
        return {
          ...loadedUser,
          role: normalizedRole,
          location: normalizedLocation,
          site: normalizedLocation,
          house: normalizedHouse || '',
          shiftId: String(loadedUser.shiftId || '').trim(),
          vanIds: normalizedVanIds,
          vanId: normalizedVanIds[0] || ''
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

  const loadUsers = useCallback(async () => {
    try {
      const usersSnapshot = await getDocsFromServer(collection(db, 'users'))
      applyLoadedUsers(usersSnapshot.docs)
    } catch (error) {
      console.warn('Server user fetch failed, falling back to default Firestore read:', error)
      const usersSnapshot = await getDocs(collection(db, 'users'))
      applyLoadedUsers(usersSnapshot.docs)
    }
  }, [applyLoadedUsers])

  useEffect(() => {
    // Set default to current month
    const now = new Date()
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0)

    setStartDate(firstDay.toISOString().split('T')[0])
    setEndDate(lastDay.toISOString().split('T')[0])
  }, [])

  useEffect(() => {
    const unsubUsers = onSnapshot(
      collection(db, 'users'),
      (snapshot) => applyLoadedUsers(snapshot.docs),
      (err) => console.error('User live update failed:', err)
    )
    return () => unsubUsers()
  }, [applyLoadedUsers])

  useEffect(() => {
    loadUsers().catch((error) => {
      console.error('Initial user fetch failed:', error)
    })
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
    await writeAuditEntry({ action, collectionPath, documentId, reason, actorUser: user, extra })
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

  const blockIfOffline = (actionLabel) => {
    if (!isOffline) return false
    alert(`Offline mode: ${actionLabel} is unavailable until connection is restored.`)
    return true
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
    vanIds: [],
    email: '',
    issueLocationIds: [],
    active: true
  }), [])

  const handleAddUser = () => {
    if (!isAdminRole(user?.role)) {
      alert('Only admins can create login-capable accounts. Supervisors can edit existing BHT operational assignments.')
      return
    }
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
      _version: getVersionNumber(managedUser),
      role: normalizedRole,
      location: normalizedLocation,
      site: normalizedLocation,
      house: normalizeHouseId(managedUser?.house || managedUser?.locationId),
      shiftId: String(managedUser?.shiftId || '').trim(),
      vanIds: normalizeVanIdList(managedUser?.vanIds, managedUser?.vanId),
      vanId: normalizeVanIdList(managedUser?.vanIds, managedUser?.vanId)[0] || ''
    })
    setEditingUser(managedUser.id)
  }

  const handleSaveUser = async () => {
    if (blockIfOffline('saving users')) return

    const isNewUser = editingUser === 'new'

    if (isNewUser && !isAdminRole(user?.role)) {
      alert('Only admins can create login-capable accounts.')
      return
    }

    if (!String(userForm.name || '').trim()) {
      alert('Please fill in the required name field.')
      return
    }

    try {
      const normalizedRole = normalizeRole(userForm.role || '')
      const appUserId = isNewUser
        ? buildInternalUserId(userForm.name, users.map(managedUser => managedUser.id))
        : String(userForm.id || '').trim()
      const normalizedEmail = normalizeEmail(userForm.email)
      const adminFallbackEmail = (
        normalizedRole === 'admin' && appUserId === user?.id
          ? normalizeEmail(user?.authEmail || user?.email)
          : ''
      )
      const resolvedEmail = normalizedEmail || adminFallbackEmail

      if (!normalizedRole) {
        alert('Please select a role.')
        return
      }

      if (!appUserId) {
        alert('Unable to generate an internal user ID from that name. Use at least one letter or number.')
        return
      }

      if (isAdminRole(user?.role) && userForm.active === true && !resolvedEmail) {
        alert(`Enter the user's approved Google email. Company email normally ends in @${COMPANY_EMAIL_DOMAIN}.`)
        return
      }

      if (resolvedEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(resolvedEmail)) {
        alert('Enter a valid Google email address.')
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
      let normalizedVanIds = []
      let primaryVanId = ''
      let normalizedLocationId = null
      let normalizedShiftId = ''

      if (isBhtRole(normalizedRole)) {
        if (!normalizedLocation) {
          alert('BHT users must have a location.')
          return
        }

        normalizedHouse = normalizeHouseId(userForm.house)
        if (requiresHouseSelection(normalizedLocation) && !normalizedHouse) {
          alert('OTC BHTs must be assigned to Mesquite House, Lone Mountain, or Test House.')
          return
        }

        normalizedVanIds = normalizeVanIdList(userForm.vanIds, userForm.vanId)
        const allowedVans = getAllowedVanIdsForMainLocation(normalizedLocation)
        if (normalizedVanIds.length === 0) {
          alert(`Please select at least one van for ${normalizedLocation}.`)
          return
        }
        const hasInvalidVan = normalizedVanIds.some(vanId => !allowedVans.includes(vanId))
        if (hasInvalidVan) {
          alert(`One or more selected vans are invalid for ${normalizedLocation}.`)
          return
        }
        primaryVanId = normalizedVanIds[0]

        normalizedShiftId = String(userForm.shiftId || '').trim()
        if (!normalizedShiftId || !isShiftAllowedForMainLocation(normalizedLocation, normalizedShiftId)) {
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
      const issueLocationIds = buildIssueLocationIds({
        role: normalizedRole,
        mainLocation: normalizedLocation,
        locationId: normalizedLocationId
      })

      const payload = {
        name: userForm.name,
        email: resolvedEmail || null,
        emailDomain: resolvedEmail ? getEmailDomain(resolvedEmail) : null,
        emailType: resolvedEmail ? (isCompanyEmail(resolvedEmail) ? 'company' : 'external') : null,
        externalGoogleAllowed: resolvedEmail ? !isCompanyEmail(resolvedEmail) : false,
        externalReason: resolvedEmail && !isCompanyEmail(resolvedEmail)
          ? `Approved by ${user?.name || 'admin'} for Ops Hub access`
          : null,
        externalApprovedByUserId: resolvedEmail && !isCompanyEmail(resolvedEmail) ? user?.id || null : null,
        externalApprovedByName: resolvedEmail && !isCompanyEmail(resolvedEmail) ? user?.name || null : null,
        externalApprovedAt: resolvedEmail && !isCompanyEmail(resolvedEmail) ? serverTimestamp() : null,
        role: normalizedRole,
        site: normalizedRole === 'admin' ? GLOBAL_SCOPE : normalizedLocation,
        location: normalizedRole === 'admin' ? GLOBAL_SCOPE : normalizedLocation,
        house: isBhtRole(normalizedRole) ? normalizedHouse || null : null,
        locationId: isBhtRole(normalizedRole) ? normalizedLocationId : null,
        shiftId: isBhtRole(normalizedRole) ? normalizedShiftId : null,
        vanId: isBhtRole(normalizedRole) ? primaryVanId : null,
        vanIds: isBhtRole(normalizedRole) ? normalizedVanIds : [],
        active: userForm.active === true,
        authorizedLocations,
        issueLocationIds,
        updatedAt: serverTimestamp()
      }
      if (!isNewUser && isAdminRole(user?.role)) {
        const latestBeforeSave = await getDoc(doc(db, 'users', appUserId))
        const previousEmail = normalizeEmail(latestBeforeSave.data()?.email)
        if (previousEmail && resolvedEmail && previousEmail !== resolvedEmail) {
          const oldLinkSnap = await getDoc(doc(db, 'userEmailLinks', previousEmail))
          if (oldLinkSnap.exists() && oldLinkSnap.data()?.linkedAuthUid) {
            const confirmed = await showConfirmDialog(
              'This email is already linked to a Google sign-in. Changing it will deactivate the old email link and require the user to sign in with the new approved email.',
              {
                title: 'Change linked email?',
                tone: 'warning',
                confirmText: 'Change email',
                cancelText: 'Cancel'
              }
            )
            if (!confirmed) return
          }
        }
      }

      let userProfileSaved = false
      const persistUserAndAssignment = async () => {
        await runTransaction(db, async (transaction) => {
          const userRef = doc(db, 'users', appUserId)
          const emailLinkRef = resolvedEmail ? doc(db, 'userEmailLinks', resolvedEmail) : null
          const latestSnap = await transaction.get(userRef)
          const emailLinkSnap = emailLinkRef ? await transaction.get(emailLinkRef) : null
          let nextVersion = 1
          let previousEmail = ''
          const existingEmailLink = emailLinkSnap?.exists() ? emailLinkSnap.data() : null

          if (editingUser === 'new') {
            if (latestSnap.exists()) throw new Error('A user with this ID already exists.')
          } else {
            if (!latestSnap.exists()) throw new Error('User record no longer exists.')
            const latest = latestSnap.data()
            previousEmail = normalizeEmail(latest.email)
            const versionCheck = assertExpectedVersion({
              expectedVersion: userForm._version,
              currentVersion: getVersionNumber(latest),
              documentId: appUserId,
              recordLabel: 'User'
            })
            nextVersion = versionCheck.nextVersion
          }

          if (editingUser === 'new') {
            transaction.set(userRef, {
              ...payload,
              version: 1,
              createdAt: serverTimestamp()
            })
          } else {
            transaction.update(userRef, {
              ...payload,
              version: nextVersion
            })
          }

          if (isAdminRole(user?.role) && resolvedEmail) {
            if (existingEmailLink?.userId && existingEmailLink.userId !== appUserId) {
              throw new Error('That email is already approved for another user.')
            }
            const emailLinkPayload = buildEmailLinkPayload({
              appUserId,
              email: resolvedEmail,
              actorUser: user
            })
            transaction.set(emailLinkRef, {
              ...emailLinkPayload,
              linkedAuthUid: existingEmailLink?.linkedAuthUid || null,
              linkedAt: existingEmailLink?.linkedAt || null,
              version: getVersionNumber(existingEmailLink) + 1,
              createdAt: existingEmailLink?.createdAt || serverTimestamp()
            }, { merge: true })

            if (previousEmail && previousEmail !== resolvedEmail) {
              transaction.set(doc(db, 'userEmailLinks', previousEmail), {
                active: false,
                linkedAuthUid: null,
                linkedAt: null,
                updatedAt: serverTimestamp()
              }, { merge: true })
            }
          }
        })
        userProfileSaved = true

        await syncDerivedAssignmentForUser(appUserId, {
          name: userForm.name,
          role: normalizedRole,
          locationId: normalizedLocationId,
          shiftId: normalizedShiftId,
          vanId: primaryVanId,
          vanIds: normalizedVanIds,
          active: userForm.active === true
        })
      }

      try {
        await persistUserAndAssignment()
      } catch (persistError) {
        if (userProfileSaved) {
          console.error('User saved but derived assignment sync failed:', persistError)
          alert('User profile saved, but the BHT assignment sync was denied by Firestore rules. Deploy the latest rules, then edit and save this user once more.')
          setEditingUser(null)
          loadUsers()
          return
        }
        if (persistError?.code === 'permission-denied' && isAdminRole(user?.role)) {
          alert('Admin save was denied by Firestore rules. Sign out, sign in with the approved admin Google email, and confirm the strict rules match this app version.')
          return
        }
        throw persistError
      }

      notifySuccess('User saved successfully')
      setEditingUser(null)
      loadUsers()
    } catch (error) {
      console.error('Error saving user:', error)
      alert(formatVersionConflictMessage(error, 'Error saving user: ' + error.message))
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
        vanIds: normalizeVanIdList(targetUser?.vanIds, targetUser?.vanId),
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
    const shiftOptions = isBhtRole(normalizedFormRole)
      ? getShiftOptionsForMainLocation(effectiveLocation)
      : []
    const locationOptions = isAdmin ? MAIN_LOCATIONS : managedMainLocations

    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
        <div>
          <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
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
              border: '2px solid rgba(17,47,82,0.20)',
              borderRadius: '6px',
              fontSize: '14px',
              boxSizing: 'border-box',
              backgroundColor: 'rgba(17,47,82,0.10)',
              color: 'var(--text-primary)'
            }}
          />
        </div>
        <div>
          <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
            Approved Google Email *
          </label>
          <input
            type="email"
            value={userForm.email || ''}
            onChange={(e) => setUserForm({ ...userForm, email: normalizeEmail(e.target.value) })}
            placeholder={`name@${COMPANY_EMAIL_DOMAIN}`}
            disabled={!isAdmin}
            style={{
              width: '100%',
              padding: '8px',
              border: '2px solid rgba(17,47,82,0.20)',
              borderRadius: '6px',
              fontSize: '14px',
              boxSizing: 'border-box',
              backgroundColor: isAdmin ? 'rgba(17,47,82,0.10)' : 'rgba(17,47,82,0.04)',
              color: 'var(--text-primary)'
            }}
          />
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
            {isNewUser
              ? `Internal ID will be generated automatically: ${buildInternalUserId(userForm.name, users.map(managedUser => managedUser.id))}`
              : `Internal ID: ${userForm.id}`}
          </div>
        </div>
        <div>
          <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
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
                vanId: nextRole === ROLE_BHT ? prev.vanId : '',
                vanIds: nextRole === ROLE_BHT ? normalizeVanIdList(prev.vanIds, prev.vanId) : []
              }))
            }}
            style={{
              width: '100%',
              padding: '8px',
              border: '2px solid rgba(17,47,82,0.20)',
              borderRadius: '6px',
              fontSize: '14px',
              boxSizing: 'border-box',
              backgroundColor: 'rgba(17,47,82,0.10)',
              color: 'var(--text-primary)'
            }}
          >
            <option value="">Select Role...</option>
            {actorRoleOptions.map(roleOption => (
              <option key={roleOption} value={roleOption}>{formatRoleLabel(roleOption)}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
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
                shiftId: isShiftAllowedForMainLocation(nextLocation, prev.shiftId) ? prev.shiftId : '',
                vanIds: normalizeVanIdList(prev.vanIds, prev.vanId).filter(vanId => allowedVans.includes(vanId)),
                vanId: normalizeVanIdList(prev.vanIds, prev.vanId).find(vanId => allowedVans.includes(vanId)) || ''
              }))
            }}
            disabled={locationSelectDisabled}
            style={{
              width: '100%',
              padding: '8px',
              border: '2px solid rgba(17,47,82,0.20)',
              borderRadius: '6px',
              fontSize: '14px',
              boxSizing: 'border-box',
              backgroundColor: locationSelectDisabled ? 'rgba(17,47,82,0.04)' : 'rgba(17,47,82,0.10)',
              color: 'var(--text-primary)',
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
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
              OTC House *
            </label>
            <select
              value={normalizeHouseId(userForm.house)}
              onChange={(e) => setUserForm({ ...userForm, house: normalizeHouseId(e.target.value) })}
              style={{
                width: '100%',
                padding: '8px',
                border: '2px solid rgba(17,47,82,0.20)',
                borderRadius: '6px',
                fontSize: '14px',
                boxSizing: 'border-box',
                backgroundColor: 'rgba(17,47,82,0.10)',
                color: 'var(--text-primary)'
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
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
              Vans * (select one or more)
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '8px', border: '2px solid rgba(17,47,82,0.20)', borderRadius: '6px', backgroundColor: 'rgba(17,47,82,0.10)' }}>
              {vanOptions.length === 0 ? (
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Select location first</span>
              ) : vanOptions.map(vanOption => {
                const normalizedCurrentVanIds = normalizeVanIdList(userForm.vanIds, userForm.vanId)
                const selected = normalizedCurrentVanIds.includes(vanOption.id)
                return (
                  <button
                    key={vanOption.id}
                    type="button"
                    onClick={() => {
                      const nextVanIds = selected
                        ? normalizedCurrentVanIds.filter(vanId => vanId !== vanOption.id)
                        : [...normalizedCurrentVanIds, vanOption.id]
                      setUserForm(prev => ({
                        ...prev,
                        vanIds: nextVanIds,
                        vanId: nextVanIds[0] || ''
                      }))
                    }}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '999px',
                      border: selected ? '1px solid #2F7D57' : '1px solid rgba(17,47,82,0.32)',
                      backgroundColor: selected ? 'rgba(76,175,80,0.18)' : 'rgba(17,47,82,0.05)',
                      color: selected ? '#2F7D57' : 'var(--text-primary)',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    {selected ? '\u2713 ' : ''}{vanOption.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {isBhtRole(normalizedFormRole) && (
          <div>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
              Shift *
            </label>
            <select
              value={userForm.shiftId}
              onChange={(e) => setUserForm({ ...userForm, shiftId: e.target.value })}
              style={{
                width: '100%',
                padding: '8px',
                border: '2px solid rgba(17,47,82,0.20)',
                borderRadius: '6px',
                fontSize: '14px',
                boxSizing: 'border-box',
                backgroundColor: 'rgba(17,47,82,0.10)',
                color: 'var(--text-primary)'
              }}
            >
              <option value="">Select Shift...</option>
              {shiftOptions.map(shiftOption => (
                <option key={shiftOption.id} value={shiftOption.id}>{shiftOption.label}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
            Active
          </label>
          <select
            value={userForm.active}
            onChange={(e) => setUserForm({ ...userForm, active: e.target.value === 'true' })}
            style={{
              width: '100%',
              padding: '8px',
              border: '2px solid rgba(17,47,82,0.20)',
              borderRadius: '6px',
              fontSize: '14px',
              boxSizing: 'border-box',
              backgroundColor: 'rgba(17,47,82,0.10)',
              color: 'var(--text-primary)'
            }}
          >
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>
      </div>
    )
  }

  useEffect(() => {
    if (!startDate || !endDate) return undefined
    setTransportsLoaded(false)

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
      setTransportsLoaded(true)
    }, (error) => {
      console.error('Transport live update failed:', error)
      setTransportsLoaded(true)
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
    } else if (transportStatusFilter === 'active') {
      filtered = filtered.filter(t => !isCompletedTransport(t))
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

  const isCompletedTransport = (transport) => isCompletedTransportRecord(transport)

  const isOverdue = (transport) => isOverdueTransportRecord(transport)

  const formatTime = (timestamp) => formatTransportRecordTime(timestamp, '--:--')

  const formatDate = (timestamp) => formatTransportRecordDate(timestamp, { fallback: '--' })

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

  const subscribedSelectedTransport = useMemo(
    () => transports.find(transport => transport.id === transportRecordId) || null,
    [transportRecordId, transports]
  )
  const selectedFilteredIndex = useMemo(
    () => filteredTransports.findIndex(transport => transport.id === transportRecordId),
    [filteredTransports, transportRecordId]
  )
  const selectedTransport = subscribedSelectedTransport
    || (fallbackTransport?.id === transportRecordId ? fallbackTransport : null)
  const effectiveTransportLoadState = subscribedSelectedTransport
    ? 'ready'
    : transportRecordId && transportLoadState === 'idle'
      ? 'loading'
      : transportLoadState
  const transportPositionLabel = selectedFilteredIndex >= 0
    ? `${selectedFilteredIndex + 1} of ${filteredTransports.length}`
    : ''
  const canGoPreviousTransport = selectedFilteredIndex > 0
  const canGoNextTransport = selectedFilteredIndex >= 0 && selectedFilteredIndex < filteredTransports.length - 1

  useEffect(() => {
    if (!transportRecordId) {
      setFallbackTransport(null)
      setTransportLoadState('idle')
      setTransportLoadError('')
      return undefined
    }
    if (subscribedSelectedTransport) {
      setFallbackTransport(null)
      setTransportLoadState('ready')
      setTransportLoadError('')
      return undefined
    }
    if (!transportsLoaded) {
      setTransportLoadState('loading')
      return undefined
    }

    let cancelled = false
    setFallbackTransport(null)
    setTransportLoadState('loading')
    setTransportLoadError('')

    getDoc(doc(db, 'transports', transportRecordId))
      .then(snapshot => {
        if (cancelled) return
        if (!snapshot.exists()) {
          setTransportLoadState('not-found')
          return
        }
        const loadedTransport = {
          id: snapshot.id,
          ...snapshot.data(),
          site: normalizeTransportSite(snapshot.data()?.site)
        }
        if (!inTransportScope(loadedTransport.site)) {
          setTransportLoadState('access-denied')
          return
        }
        setFallbackTransport(loadedTransport)
        setTransportLoadState('ready')
      })
      .catch(error => {
        if (cancelled) return
        console.error('Transport fallback load failed:', error)
        setTransportLoadError(error?.message || 'The transport could not be loaded.')
        setTransportLoadState('error')
      })

    return () => {
      cancelled = true
    }
  }, [
    inTransportScope,
    subscribedSelectedTransport,
    transportLoadRetry,
    transportRecordId,
    transportsLoaded
  ])

  useEffect(() => {
    if (previousSelectionIdRef.current !== transportRecordId) {
      previousSelectionIdRef.current = transportRecordId
      selectionWasFilteredRef.current = false
    }
    if (!transportRecordId) return
    if (selectedFilteredIndex >= 0) {
      selectionWasFilteredRef.current = true
      return
    }
    if (!selectionWasFilteredRef.current) return

    selectionWasFilteredRef.current = false
    onCloseTransportDetails?.()
    window.requestAnimationFrame(() => transportResultsHeadingRef.current?.focus())
  }, [onCloseTransportDetails, selectedFilteredIndex, transportRecordId])

  useEffect(() => {
    if (!transportRecordId || selectedFilteredIndex < 0) return
    transportRowRefs.current.get(transportRecordId)?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth'
    })
  }, [selectedFilteredIndex, transportRecordId])

  useEffect(() => {
    const previousMode = previousTransportModeRef.current
    previousTransportModeRef.current = transportRecordMode

    if (previousMode !== 'full' && transportRecordMode === 'full') {
      window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'auto' }))
      return
    }
    if (previousMode === 'full' && transportRecordMode !== 'full') {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          window.scrollTo({ top: transportListScrollRef.current, behavior: 'auto' })
        })
      })
    }
  }, [transportRecordMode])

  const retryTransportLoad = useCallback(() => {
    setTransportLoadRetry(previous => previous + 1)
  }, [])

  const selectTransportAtIndex = useCallback((index) => {
    const target = filteredTransports[index]
    if (!target?.id) return
    if (transportRecordMode === 'full') {
      onOpenTransportRecord?.(target.id, { replace: true })
    } else {
      onOpenTransportPanel?.(target.id, { replace: true })
    }
  }, [filteredTransports, onOpenTransportPanel, onOpenTransportRecord, transportRecordMode])

  const openPreviousTransport = useCallback(() => {
    if (canGoPreviousTransport) selectTransportAtIndex(selectedFilteredIndex - 1)
  }, [canGoPreviousTransport, selectTransportAtIndex, selectedFilteredIndex])

  const openNextTransport = useCallback(() => {
    if (canGoNextTransport) selectTransportAtIndex(selectedFilteredIndex + 1)
  }, [canGoNextTransport, selectTransportAtIndex, selectedFilteredIndex])

  const openSelectedTransportFullRecord = useCallback(() => {
    if (!transportRecordId) return
    transportListScrollRef.current = window.scrollY
    onOpenTransportRecord?.(transportRecordId)
  }, [onOpenTransportRecord, transportRecordId])

  const exportToExcel = () => {
    const sanitizeForExcelCell = (value) => {
      const text = typeof value === 'string' ? value : String(value ?? '')
      return /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text
    }

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
        'Date': sanitizeForExcelCell(formatDate(t.departedAt)),
        'Departed': sanitizeForExcelCell(formatTime(t.departedAt)),
        'Returned': sanitizeForExcelCell(formatTime(t.returnedAt)),
        'Driver': sanitizeForExcelCell(t.createdByName || ''),
        'Location': sanitizeForExcelCell(t.site || ''),
        'Clients': sanitizeForExcelCell(t.clients?.join(', ') || ''),
        'Reasons': sanitizeForExcelCell(t.reasons?.join(', ') || ''),
        'Destinations': sanitizeForExcelCell(destinationsText),
        'Status': sanitizeForExcelCell(t.status || ''),
        'Overdue': isOverdue(t) ? 'YES' : 'NO',
        'Notes': sanitizeForExcelCell(t.notes || '')
      }
    })

    const worksheet = XLSX.utils.json_to_sheet(data)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Transports')

    const filename = `transports_${startDate}_to_${endDate}.xlsx`
    XLSX.writeFile(workbook, filename)
  }

  const clearTransportFilters = () => {
    setTransportSiteFilter('ALL')
    setTransportStatusFilter('all')
    setTransportReasonFilter('')
    setSelectedDriver('')
    setOverdueFilter('all')
    setClientSearch('')
  }
  return (
    <div className="supervisor-dashboard" style={{ padding: '20px', maxWidth: '1440px', margin: '0 auto' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px'
      }}>
        <h2 style={{ margin: 0, color: 'var(--text-primary)' }}>
          {isAdmin ? 'Admin' : 'Supervisor'} Dashboard
        </h2>
      </div>

      <div style={{
        backgroundColor: 'rgba(17,47,82,0.06)',
        borderRadius: '10px',
        border: '1px solid rgba(17,47,82,0.20)',
        padding: '12px 14px',
        marginBottom: '16px'
      }}>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
          Scope
        </div>
        {isAdmin ? (
          <div style={{ fontSize: '13px', color: '#2F7D57' }}>
            Global access (all locations)
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
              Primary: {primaryScopes.length > 0 ? primaryScopes.join(', ') : 'None'}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
              Backup: {activeBackupGrants.length > 0 ? '' : 'None'}
            </div>
            {activeBackupGrants.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {activeBackupGrants.map(grant => (
                  <span
                    key={grant.id}
                    style={{
                      fontSize: '11px',
                      color: '#B07A28',
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
          color: '#B07A28',
          textAlign: 'center'
        }}>
          Offline mode is active. Supervisor/Admin write actions are disabled until connection is restored.
        </div>
      )}

      {/* EOC Tab */}
      {activeTab === 'eoc' && (
        <SupervisorEocPanel
          user={user}
          isOffline={isOffline}
          targetIssueId={navigationTarget?.type === 'issue' ? navigationTarget.issueId : null}
          onTargetIssueHandled={onNavigationHandled}
        />
      )}

      {/* Debriefs Tab */}
      {activeTab === 'debriefs' && (
        <SupervisorDebriefsPanel
          inEocScope={inEocScope}
          focusedDebriefId={focusedDebriefId}
        />
      )}

      {/* Compliance Tab */}
      {activeTab === 'compliance' && (
        <CompliancePanel
          user={user}
          scopeSites={isAdmin ? null : allowedComplianceSites}
        />
      )}

      {/* Properties Tab */}
      {activeTab === 'properties' && (
        <PropertiesPanel
          user={user}
          scopeSites={isAdmin ? null : allowedComplianceSites}
          onOpenTab={setActiveTab}
        />
      )}

      {/* Fleet Tab */}
      {activeTab === 'fleet' && (
        <FleetPanel
          user={user}
          scopeSites={isAdmin ? null : allowedComplianceSites}
        />
      )}

      {/* Cintas Tab */}
      {activeTab === 'cintas' && (
        <CintasPanel
          user={user}
          scopeSites={isAdmin ? null : allowedComplianceSites}
        />
      )}

      {/* Audit Tab (Admin) */}
      {activeTab === 'audit' && isAdmin && (
        <div>
          <div style={{
            backgroundColor: 'rgba(17,47,82,0.08)',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '20px',
            border: '1px solid rgba(229,57,53,0.2)',
            backdropFilter: 'blur(12px)'
          }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', color: 'var(--text-primary)' }}>
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
                      border: '1px solid rgba(17,47,82,0.14)',
                      backgroundColor: 'rgba(17,47,82,0.05)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)' }}>
                        {(log.action || 'action').toUpperCase()} &bull; {log.collectionPath || '--'} &bull; {log.documentId || '--'}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        {formatDate(log.createdAt)} {formatTime(log.createdAt)}
                      </div>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      By: {log.performedByName || log.performedByUserId || 'Unknown'}
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--text-primary)', marginTop: '6px' }}>
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
            backgroundColor: 'rgba(17,47,82,0.08)',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '20px',
            border: '1px solid rgba(229,57,53,0.2)',
            backdropFilter: 'blur(12px)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-primary)' }}>Users ({users.length})</h3>
              <button
                onClick={handleAddUser}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#2F7D57',
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
                backgroundColor: 'rgba(17,47,82,0.05)',
                padding: '20px',
                borderRadius: '8px',
                marginBottom: '20px',
                border: '2px solid #CD4E42'
              }}>
                <h4 style={{ margin: '0 0 16px 0', color: 'var(--text-primary)' }}>
                  Add New User
                </h4>
                {renderUserEditorFields(true)}
                <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                  <button
                    onClick={handleSaveUser}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: '#2F7D57',
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
                const managedUserVanIds = normalizeVanIdList(managedUser.vanIds, managedUser.vanId)
                return (
                  <div
                    key={managedUser.id}
                    style={{
                      padding: '16px',
                      borderRadius: '8px',
                      border: isEditingThisUser ? '2px solid #CD4E42' : '1px solid rgba(17,47,82,0.14)',
                      backgroundColor: managedUser.active ? 'rgba(17,47,82,0.05)' : 'rgba(17,47,82,0.03)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px', flex: 1 }}>
                        <div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Name</div>
                          <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{managedUser.name}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                            Internal ID: {managedUser.id}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Approved Google Email</div>
                          <div style={{ fontSize: '14px' }}>
                            {managedUser.email || '--'}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Role</div>
                          <div style={{ fontSize: '14px' }}>{formatRoleLabel(managedUser.role)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Location</div>
                          <div style={{ fontSize: '14px' }}>
                            {isAdminRole(managedUser.role) ? 'GLOBAL (full access)' : (managedUserLocation || '--')}
                          </div>
                        </div>
                        {isBhtRole(managedUser.role) && (
                          <div>
                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>House / Shift / Van</div>
                            <div style={{ fontSize: '14px' }}>
                              {managedUserLocation === MAIN_LOCATION_OTC
                                ? (getHouseOptionsForMainLocation(MAIN_LOCATION_OTC).find(option => option.id === managedUserHouse)?.label || '--')
                                : 'N/A'}
                              {' '} - {' '}
                              {(getShiftLabel(managedUser.shiftId) || '--')}
                              {' '} - {' '}
                              {(managedUserVanIds.length > 0
                                ? managedUserVanIds.map(vanId => (VANS.find(v => v.id === vanId)?.label || vanId)).join(', ')
                                : '--')}
                            </div>
                          </div>
                        )}
                        <div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Status</div>
                          <div style={{
                            fontSize: '12px',
                            fontWeight: 'bold',
                            color: managedUser.active ? '#2F7D57' : '#999'
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
                            backgroundColor: '#CD4E42',
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
                            backgroundColor: '#B75E54',
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
                        borderTop: '1px solid rgba(17,47,82,0.20)'
                      }}>
                        <h4 style={{ margin: '0 0 16px 0', color: 'var(--text-primary)' }}>
                          Edit User
                        </h4>
                        {renderUserEditorFields(false)}
                        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                          <button
                            onClick={handleSaveUser}
                            style={{
                              padding: '10px 20px',
                              backgroundColor: '#2F7D57',
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
        <DashboardSummaryPanel
          user={user}
          isOffline={isOffline}
          isMobile={isMobile}
          eocIssues={eocIssues}
          eocOverdueTasks={eocOverdueTasks}
          fleetOverdueTasks={fleetOverdueTasks}
          fleetUpcomingTasks={fleetUpcomingTasks}
          eocAlerts={eocAlerts}
          fleetAlerts={fleetAlerts}
          debriefAlerts={debriefAlerts}
          complianceItems={complianceItems}
          inComplianceScope={inComplianceScope}
          inTransportScope={inTransportScope}
          onNavigateTab={setActiveTab}
          onDrilldownToTransports={({ startDate: sd, endDate: ed, site, status, reason, driver }) => {
            setStartDate(sd)
            setEndDate(ed)
            setTransportSiteFilter(site)
            setTransportStatusFilter(status)
            setTransportReasonFilter(reason)
            setSelectedDriver(driver)
            setOverdueFilter('all')
            setClientSearch('')
            setActiveTab('transports')
          }}
        />
      )}


      {/* Transports Tab */}
      {activeTab === 'transports' && (
        transportRecordMode === 'full' && transportRecordId ? (
          <TransportRecordPage
            transport={selectedTransport}
            loadState={effectiveTransportLoadState}
            errorMessage={transportLoadError}
            onRetry={retryTransportLoad}
            onBackToLog={onBackToTransportLog}
            onPrevious={openPreviousTransport}
            onNext={openNextTransport}
            canPrevious={canGoPreviousTransport}
            canNext={canGoNextTransport}
            positionLabel={transportPositionLabel}
          />
        ) : (
        <div>
          {/* Filters */}
          <div style={{
        backgroundColor: 'rgba(17,47,82,0.08)',
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
          <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-primary)' }}>Filters</h3>
          <button
            type="button"
            onClick={clearTransportFilters}
            style={{
              padding: '8px 14px',
              backgroundColor: 'rgba(17,47,82,0.20)',
              color: 'var(--text-primary)',
              border: '1px solid rgba(17,47,82,0.32)',
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
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
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
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
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
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
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
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
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
              <option value="active">Active Only</option>
              <option value="completed">Completed Only</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
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
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
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
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
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
          <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
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
            backgroundColor: filteredTransports.length > 0 ? '#2F7D57' : 'rgba(17,47,82,0.10)',
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
        backgroundColor: 'rgba(17,47,82,0.08)',
        borderRadius: '12px',
        padding: '20px',
        border: '1px solid #eee'
      }}>
        <h3
          ref={transportResultsHeadingRef}
          tabIndex={-1}
          style={{ margin: '0 0 16px 0', fontSize: '16px', color: 'var(--text-primary)', outline: 'none' }}
        >
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
            {filteredTransports.map(t => {
              const selected = t.id === transportRecordId
              const overdue = isOverdue(t)
              const destinationSummary = getTransportDestinationSummary(t)
              const reasonSummary = Array.isArray(t.reasons) ? t.reasons.filter(Boolean).join(', ') : ''
              return (
              <div
                key={t.id}
                ref={element => {
                  if (element) transportRowRefs.current.set(t.id, element)
                  else transportRowRefs.current.delete(t.id)
                }}
                className={`management-transport-row ${selected ? 'management-transport-row-selected' : ''} ${overdue ? 'management-transport-row-overdue' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={getTransportAccessibleLabel(t)}
                aria-pressed={selected}
                onClick={() => onOpenTransportPanel?.(t.id)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onOpenTransportPanel?.(t.id)
                  }
                }}
              >
                {overdue && (
                  <span className="badge badge-overdue management-transport-overdue-badge">OVERDUE</span>
                )}

                <div className="management-transport-row-grid">
                  <div className="management-transport-field">
                    <span>Date</span>
                    <strong>{formatDate(t.departedAt)}</strong>
                  </div>
                  <div className="management-transport-field">
                    <span>Driver</span>
                    <strong>{t.createdByName || 'Not recorded'}</strong>
                  </div>
                  <div className="management-transport-field">
                    <span>Client(s)</span>
                    <strong>{t.clients?.join(', ') || 'Not recorded'}</strong>
                  </div>
                  <div className="management-transport-field management-transport-field-wide">
                    <span>Destination / Reason</span>
                    <strong>{destinationSummary || reasonSummary || 'Not recorded'}</strong>
                  </div>
                  <div className="management-transport-field">
                    <span>Status</span>
                    <strong><span className={getTransportStatusBadgeClass(t.status)}>{t.status || 'unknown'}</span></strong>
                  </div>
                  <div className="management-transport-view-cue" aria-hidden="true">
                    <span>View details</span>
                    <ChevronRight size={20} />
                  </div>
                </div>
              </div>
              )
            })}
          </div>
        )}
      </div>

      {transportRecordMode === 'panel' && transportRecordId && (
        <TransportDetailsDrawer
          transport={selectedTransport}
          loadState={effectiveTransportLoadState}
          errorMessage={transportLoadError}
          onRetry={retryTransportLoad}
          onClose={onCloseTransportDetails}
          onOpenFull={openSelectedTransportFullRecord}
          onPrevious={openPreviousTransport}
          onNext={openNextTransport}
          canPrevious={canGoPreviousTransport}
          canNext={canGoNextTransport}
          positionLabel={transportPositionLabel}
        />
      )}
        </div>
        )
      )}
    </div>
  )
}

export default SupervisorDashboard
