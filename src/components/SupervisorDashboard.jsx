import { useState, useEffect, useMemo, useCallback } from 'react'
import { db, auth } from '../firebase'
import { collection, query, where, orderBy, onSnapshot, Timestamp, doc, setDoc, getDocs, updateDoc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { signInAnonymously, signOut } from 'firebase/auth'
import * as XLSX from 'xlsx'
import DashboardSummaryPanel from './DashboardSummaryPanel'
import SupervisorEocPanel from './SupervisorEocPanel'
import CompliancePanel from './CompliancePanel'
import PropertiesPanel from './PropertiesPanel'
import FleetPanel from './FleetPanel'
import CintasPanel from './CintasPanel'
import AccessGrantPanel from './AccessGrantPanel'
import SupervisorDebriefsPanel from './SupervisorDebriefsPanel'
import { LOCATIONS, VANS, getShiftLabel, getShiftOptionsForMainLocation, isShiftAllowedForMainLocation } from '../data/eocConstants'
import { hashPin } from '../utils/pinHash'
import { hardDeleteDerivedAssignment, syncDerivedAssignmentForUser } from '../services/assignmentService'
import { findDuplicatePinUser } from '../services/pinConflictService'
import { notifySuccess } from '../utils/toast'
import { showConfirmDialog, showPromptDialog } from '../utils/dialogs'
import { writeAuditLog as writeAuditEntry } from '../services/notificationService'
import useUserScope from '../hooks/useUserScope'
import useScopedIssues from '../hooks/useScopedIssues'
import useScopedFleet from '../hooks/useScopedFleet'
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

const TAB_LABELS = {
  dashboard: '\u{1F4C8} Dashboard',
  transports: '\u{1F4CA} Transports',
  debriefs: 'Debriefs',
  users: '\u{1F465} Users',
  eoc: '\u{1F527} EOC',
  compliance: '\u{1F4CB} Compliance',
  properties: '\u{1F3E0} Properties',
  fleet: '\u{1F69A} Fleet',
  cintas: '\u{1F9FC} Cintas',
  audit: '\u{1F9FE} Audit'
}
const TAB_KEYS = Object.keys(TAB_LABELS)

function normalizeVanIdList(values, fallbackVanId = '') {
  const base = Array.isArray(values) ? values : []
  const normalized = base
    .map(value => String(value || '').trim().toLowerCase())
    .filter(Boolean)
  const fallback = String(fallbackVanId || '').trim().toLowerCase()
  const merged = fallback ? [...normalized, fallback] : normalized
  return [...new Set(merged)]
}

function SupervisorDashboard({
  user,
  isOffline = false,
  eocAlerts = [],
  fleetAlerts = [],
  debriefAlerts = [],
  navigationTarget = null,
  onNavigationHandled
}) {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 600)
  const [headerOffset, setHeaderOffset] = useState(64)
  const [transports, setTransports] = useState([])
  const [filteredTransports, setFilteredTransports] = useState([])

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
    pin: '',
    role: '',
    location: '',
    house: '',
    shiftId: '',
    vanId: '',
    vanIds: [],
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

  const availableTabKeys = isAdmin ? TAB_KEYS : TAB_KEYS.filter(k => k !== 'audit')
  const actorRoleOptions = useMemo(
    () => roleOptionsForActor(user?.role),
    [user?.role]
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
  }, [navigationTarget, onNavigationHandled])



  // Compliance items listener (not yet extracted to a hook)
  useEffect(() => {
    const unsubCompliance = onSnapshot(
      collection(db, 'complianceItems'),
      (snap) => setComplianceItems(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    return () => unsubCompliance()
  }, [])

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
    vanIds: [],
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
      vanIds: normalizeVanIdList(managedUser?.vanIds, managedUser?.vanId),
      vanId: normalizeVanIdList(managedUser?.vanIds, managedUser?.vanId)[0] || '',
      pin: ''
    })
    setEditingUser(managedUser.id)
  }

  const handleSaveUser = async () => {
    if (blockIfOffline('saving users')) return

    const isNewUser = editingUser === 'new'
    const hasPinInput = String(userForm.pin || '').trim().length > 0

    if (!userForm.id || !userForm.name || (isNewUser && !hasPinInput)) {
      alert(isNewUser
        ? 'Please fill in all required fields (ID, Name, PIN)'
        : 'Please fill in all required fields (ID, Name)')
      return
    }

    if (hasPinInput && (userForm.pin.length !== 4 || !/^\d+$/.test(userForm.pin))) {
      alert('PIN must be exactly 4 digits')
      return
    }

    try {
      const pinHash = hasPinInput ? await hashPin(userForm.pin) : null
      if (hasPinInput) {
        const duplicateUser = await findDuplicatePinUser(userForm.pin, {
          excludeUserId: isNewUser ? null : userForm.id
        })
        if (duplicateUser) {
          alert(`That PIN is already assigned to ${duplicateUser.name || duplicateUser.id}. Choose a different PIN.`)
          return
        }
      }

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
          alert('OTC BHTs must be assigned to Mesquite House or Lone Mountain.')
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

      const payload = {
        name: userForm.name,
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
        updatedAt: serverTimestamp()
      }
      if (pinHash) {
        payload.pinHash = pinHash
        payload.pinVersion = 'v1_sha256'
        payload.pinUpdatedAt = serverTimestamp()
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
          vanId: primaryVanId,
          vanIds: normalizedVanIds,
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
              border: '2px solid rgba(17,47,82,0.20)',
              borderRadius: '6px',
              fontSize: '14px',
              boxSizing: 'border-box',
              backgroundColor: !isNewUser ? 'rgba(17,47,82,0.04)' : 'rgba(17,47,82,0.10)',
              color: 'var(--text-primary)'
            }}
          />
        </div>
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

  const isCompletedTransport = (transport) => {
    const normalizedStatus = String(transport?.status || '').trim().toLowerCase()
    return normalizedStatus === 'closed' || normalizedStatus === 'returned'
  }

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
  const tabRailStyle = {
    position: 'sticky',
    top: `${headerOffset}px`,
    zIndex: 95,
    marginBottom: '20px',
    paddingTop: '8px',
    paddingBottom: '6px',
    background: 'linear-gradient(180deg, rgba(248,245,241,0.98) 0%, rgba(248,245,241,0.92) 72%, rgba(248,245,241,0) 100%)',
    backdropFilter: 'blur(6px)'
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
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
                color: 'var(--text-primary)',
                border: '2px solid #CD4E42',
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
            borderBottom: '2px solid rgba(17,47,82,0.14)',
            flexWrap: 'wrap'
          }}>
            {availableTabKeys.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: '12px 24px',
                  backgroundColor: activeTab === tab ? '#CD4E42' : 'transparent',
                  color: activeTab === tab ? 'white' : 'var(--text-secondary)',
                  border: 'none',
                  borderBottom: activeTab === tab ? '3px solid #CD4E42' : 'none',
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
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>ID</div>
                          <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{managedUser.id}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Name</div>
                          <div style={{ fontSize: '14px' }}>{managedUser.name}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>PIN Storage</div>
                          <div style={{ fontSize: '14px', fontFamily: 'monospace' }}>
                            {managedUser.pinHash ? 'hashed (v1)' : (managedUser.pin ? 'legacy plaintext' : 'unset')}
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
                                ? `${managedUserHouse === 'MESQUITE' ? 'Mesquite House' : (managedUserHouse === 'LONE_MOUNTAIN' ? 'Lone Mountain' : '--')}`
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
        <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', color: 'var(--text-primary)' }}>
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
                  border: isOverdue(t) ? '2px solid #B75E54' : '1px solid rgba(17,47,82,0.14)',
                  backgroundColor: 'rgba(17,47,82,0.05)',
                  position: 'relative'
                }}
              >
                {isOverdue(t) && (
                  <div style={{
                    position: 'absolute',
                    top: '-8px',
                    right: '12px',
                    backgroundColor: '#B75E54',
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
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Date</div>
                    <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{formatDate(t.departedAt)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Driver</div>
                    <div style={{ fontSize: '14px' }}>{t.createdByName}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Client(s)</div>
                    <div style={{ fontSize: '14px' }}>{t.clients?.join(', ') || 'None'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Status</div>
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
