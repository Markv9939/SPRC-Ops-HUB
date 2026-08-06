import { useState, useEffect, useCallback, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { db, auth } from './firebase'
import { collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, getDocs, doc } from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import PinLogin from './components/PinLogin'
import Header from './components/Header'
import BhtHub from './components/BhtHub'
import LocationIssuesBoard from './components/LocationIssuesBoard'
import IssueDetail from './components/IssueDetail'
import TransportCard from './components/TransportCard'
import EocChecklist from './components/EocChecklist'
import ShiftDebriefPage from './components/ShiftDebriefPage'
import SupervisorDashboard from './components/SupervisorDashboard'
import ChangePinModal from './components/ChangePinModal'
import ToastHost from './components/ToastHost'
import DialogHost from './components/DialogHost'
import { syncEocTasksForUserScope } from './services/eocTaskEngine'
import { syncFleetTasksForUserScope } from './services/fleetTaskEngine'
import { refreshScopedSessionUser } from './services/accessGrantService'
import { changeOwnPin } from './services/userPinService'
import { getOfflineDraft, listAllOfflineActions, saveOfflineDraft } from './services/offlineStore'
import {
  OFFLINE_ACTION_TYPES,
  getDebriefQuickDraftId,
  getTransportDraftId,
  isLocalTransportId,
  makeLocalTransportId,
  queueBhtIssueReport,
  queueTransportCreate,
  syncOfflineOutbox
} from './services/offlineSyncService'
import { submitBhtIssueReportOnline } from './services/bhtIssueReportService'
import { requireOnline } from './utils/networkGuard'
import { notifySuccess } from './utils/toast'
import Onboarding from './components/Onboarding'
import { installAlertDialogBridge, showPromptDialog } from './utils/dialogs'
import NotificationCenter from './components/NotificationCenter'
import useUserScope from './hooks/useUserScope'
import useScopedAlerts from './hooks/useScopedAlerts'
import { shouldShowOnboarding } from './utils/onboarding'
import { LOCATIONS, VANS, getShiftLabel } from './data/eocConstants'
import { DEBRIEF_DRAFTS_COLLECTION, DEBRIEFS_COLLECTION, getBhtDebriefContext } from './services/shiftDebriefService'
import {
  MAIN_LOCATIONS,
  getAvailableMainLocationsForUser,
  isAdminRole,
  isBhtRole,
  isSupervisorRole,
  normalizeTransportSite
} from './utils/orgModel'

const AUTO_LOCK_TIMEOUT = 60 * 60 * 1000 // 60 minutes in milliseconds
const TRANSPORT_SITES = new Set(MAIN_LOCATIONS)
const ACTIVE_TRANSPORT_STATUSES = new Set(['open', 'arrived'])
const DASHBOARD_TABS = new Set([
  'dashboard',
  'transports',
  'debriefs',
  'users',
  'eoc',
  'compliance',
  'properties',
  'fleet',
  'cintas',
  'audit'
])

function parseAppRoute(pathname, search = '') {
  const parts = String(pathname || '/').split('/').filter(Boolean).map(decodeURIComponent)
  if (parts[0] === 'transport' && parts[1]) {
    return { page: 'transport', currentTransportId: parts[1] }
  }
  if (parts[0] === 'eoc' && parts[1]) {
    return { page: 'eocForm', currentTaskId: parts[1] }
  }
  if (parts[0] === 'debrief') {
    const mode = parts[1] === 'quick' ? 'quick' : 'full'
    return { page: 'debrief', currentDebriefMode: mode, currentDebriefId: parts[2] || null }
  }
  if (parts[0] === 'issues') {
    return { page: parts[1] ? 'issueDetail' : 'issues', currentIssueId: parts[1] || null }
  }
  if (parts[0] === 'dashboard') {
    const dashboardTab = DASHBOARD_TABS.has(parts[1]) ? parts[1] : 'dashboard'
    if (dashboardTab === 'transports') {
      const nestedTransportId = parts[2] || ''
      const queryTransportId = new URLSearchParams(search).get('transport') || ''
      return {
        page: 'home',
        dashboardTab,
        managementTransportId: nestedTransportId || queryTransportId || null,
        managementTransportMode: nestedTransportId ? 'full' : queryTransportId ? 'panel' : 'list'
      }
    }
    return { page: 'home', dashboardTab }
  }
  return { page: 'home' }
}

function getDefaultRoute(user) {
  return isSupervisorRole(user?.role) || isAdminRole(user?.role)
    ? '/dashboard/dashboard'
    : '/home'
}

function normalizeTransportStatus(status) {
  return String(status || '').trim().toLowerCase()
}

function isActiveTransportStatus(status) {
  return ACTIVE_TRANSPORT_STATUSES.has(normalizeTransportStatus(status))
}

function getLastTransportSiteKey(userId) {
  return `lastTransportSite:${userId || 'unknown'}`
}

function getScopedTransportSites(user) {
  if (!user) return []
  if (isAdminRole(user.role)) return Array.from(TRANSPORT_SITES)
  return getAvailableMainLocationsForUser(user).filter(v => TRANSPORT_SITES.has(v))
}

function toTransportDate(value) {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate()
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function transportSortTime(transport) {
  return (
    toTransportDate(transport?.departedAt)
    || toTransportDate(transport?.createdAt)
    || toTransportDate(transport?.updatedAt)
    || new Date(0)
  ).getTime()
}

function mergeTransportLists(onlineTransports, localTransports) {
  const byId = new Map()
  for (const transport of Array.isArray(onlineTransports) ? onlineTransports : []) {
    if (transport?.id) byId.set(transport.id, transport)
  }
  for (const transport of Array.isArray(localTransports) ? localTransports : []) {
    if (transport?.id) byId.set(transport.id, transport)
  }
  return Array.from(byId.values()).sort((a, b) => transportSortTime(b) - transportSortTime(a))
}

function getPendingLocalTransports(actions, sessionUser) {
  const allowedStatuses = new Set(['pending', 'failed', 'syncing', 'needsReview'])
  return (Array.isArray(actions) ? actions : [])
    .filter(action => action.type === OFFLINE_ACTION_TYPES.TRANSPORT_CREATE && allowedStatuses.has(action.status))
    .map(action => {
      const snapshot = action.payload?.snapshot || action.payload?.transport || null
      const localTransportId = action.payload?.localTransportId || ''
      if (!snapshot || !localTransportId) return null
      if (String(snapshot.createdByUserId || action.payload?.user?.id || '') !== String(sessionUser?.id || '')) return null
      return {
        id: localTransportId,
        ...snapshot,
        localOnly: true,
        pendingSync: true
      }
    })
    .filter(Boolean)
}

function getSyncedTransportIdForLocal(actions, localTransportId) {
  if (!localTransportId) return ''
  const match = (Array.isArray(actions) ? actions : []).find(action => (
    action.type === OFFLINE_ACTION_TYPES.TRANSPORT_CREATE
    && action.status === 'synced'
    && action.payload?.localTransportId === localTransportId
    && action.syncedDocumentId
  ))
  return match?.syncedDocumentId || ''
}

async function promptForTransportSite(sites, defaultSite) {
  const suggestion = defaultSite && sites.includes(defaultSite) ? defaultSite : sites[0]
  const promptText = [
    'Select transport location:',
    sites.map(site => `- ${site}`).join('\n'),
    '',
    'Type location code exactly (e.g. OTC).'
  ].join('\n')

  const input = await showPromptDialog(promptText, {
    title: 'New Transport',
    tone: 'info',
    confirmText: 'Continue',
    cancelText: 'Cancel',
    placeholder: 'Location code (example: OTC)',
    defaultValue: suggestion
  })
  if (input === null) return null
  const normalized = String(input || '').trim().toUpperCase()
  if (!sites.includes(normalized)) {
    alert(`Invalid location. Allowed: ${sites.join(', ')}`)
    return null
  }
  return normalized
}

function normalizeList(values) {
  if (!Array.isArray(values)) return []
  return [...new Set(values.map(v => String(v || '').trim().toUpperCase()).filter(Boolean))].sort()
}

function toScopeSignature(sessionUser) {
  return JSON.stringify({
    id: sessionUser?.id || '',
    role: sessionUser?.role || '',
    site: sessionUser?.site || '',
    authorizedLocations: normalizeList(sessionUser?.authorizedLocations),
    primaryScopes: normalizeList(sessionUser?.primaryScopes),
    authScopeEnforced: sessionUser?.authScopeEnforced === true,
    activeBackupGrants: Array.isArray(sessionUser?.activeBackupGrants)
      ? sessionUser.activeBackupGrants
        .map(grant => ({
          id: grant.id,
          locationId: String(grant.locationId || '').toUpperCase(),
          startsAtIso: grant.startsAtIso || null,
          expiresAtIso: grant.expiresAtIso || null,
          state: grant.state || ''
        }))
        .sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')))
      : []
  })
}

function buildBhtHeaderSubtitle(sessionUser) {
  if (!sessionUser || !isBhtRole(sessionUser.role)) return ''

  const locationLabel = LOCATIONS.find((location) => location.id === sessionUser.locationId)?.label
    || (sessionUser.locationId ? String(sessionUser.locationId) : '')
    || (sessionUser.site ? String(sessionUser.site) : '')
  const shiftLabel = sessionUser.shiftId ? getShiftLabel(sessionUser.shiftId) : ''
  const rawVanIds = Array.isArray(sessionUser.vanIds) && sessionUser.vanIds.length > 0
    ? sessionUser.vanIds
    : (sessionUser.vanId ? [sessionUser.vanId] : [])
  const vanLabel = rawVanIds
    .map((vanId) => {
      const normalizedVanId = String(vanId || '').trim().toLowerCase()
      return VANS.find((van) => van.id === normalizedVanId)?.label || String(vanId || '').trim()
    })
    .filter(Boolean)
    .join(', ')

  return [locationLabel, shiftLabel, vanLabel].filter(Boolean).join(' - ')
}

function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const activeRoute = useMemo(
    () => parseAppRoute(location.pathname, location.search),
    [location.pathname, location.search]
  )
  const [user, setUser] = useState(() => {
    const saved = sessionStorage.getItem('bhtUser')
    if (!saved) return null
    const lastActivityTime = parseInt(localStorage.getItem('lastActivity') || '0')
    if (Date.now() - lastActivityTime > AUTO_LOCK_TIMEOUT) {
      sessionStorage.removeItem('bhtUser')
      localStorage.removeItem('lastActivity')
      return null
    }
    try {
      return JSON.parse(saved)
    } catch {
      sessionStorage.removeItem('bhtUser')
      return null
    }
  })
  const [transports, setTransports] = useState([])
  const page = activeRoute.page
  const currentTransportId = activeRoute.currentTransportId || null
  const currentTaskId = activeRoute.currentTaskId || null
  const currentDebriefId = activeRoute.currentDebriefId || null
  const currentDebriefMode = activeRoute.currentDebriefMode || 'full'
  const currentIssueId = activeRoute.currentIssueId || null
  const managementTransportId = activeRoute.managementTransportId || null
  const managementTransportMode = activeRoute.managementTransportMode || 'list'
  const [bhtDebriefAssignment, setBhtDebriefAssignment] = useState(null)
  const [bhtDebriefSummary, setBhtDebriefSummary] = useState({ available: false, status: 'none', itemCount: 0, pendingQuickItemCount: 0 })
  // Alert count and issue updates from shared hooks
  const { inEocScope, inComplianceScope, exactIssueLocationIds, inIssueScope } = useUserScope(user)
  const { eocAlerts, fleetAlerts, debriefAlerts, unreadCount: alertCount, issueUpdates } = useScopedAlerts({
    user,
    inEocScope,
    inComplianceScope,
    enabled: !!user
  })
  const [isOffline, setIsOffline] = useState(() => (
    (typeof navigator !== 'undefined' && navigator.onLine === false)
    || (import.meta.env.DEV && new URLSearchParams(window.location.search).has('offline-test'))
  ))
  const [offlineOutboxSummary, setOfflineOutboxSummary] = useState({ pending: 0, syncing: 0, failed: 0, needsReview: 0 })
  const [isChangePinOpen, setIsChangePinOpen] = useState(false)
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false)
  const [dashboardNavigationTarget, setDashboardNavigationTarget] = useState(null)
  const dashboardTab = activeRoute.dashboardTab || 'dashboard'
  const [focusedIssueUpdateId, setFocusedIssueUpdateId] = useState(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const bhtHeaderSubtitle = buildBhtHeaderSubtitle(user)
  const pendingSyncCount = offlineOutboxSummary.pending + offlineOutboxSummary.syncing + offlineOutboxSummary.failed
  const bhtDebriefContext = useMemo(
    () => (user && isBhtRole(user.role) ? getBhtDebriefContext(user, new Date(), bhtDebriefAssignment) : null),
    [bhtDebriefAssignment, user]
  )
  const effectiveBhtDebriefSummary = bhtDebriefContext
    ? {
        available: true,
        status: 'none',
        itemCount: 0,
        pendingQuickItemCount: 0,
        debriefId: bhtDebriefContext.id,
        ...(bhtDebriefSummary.debriefId === bhtDebriefContext.id ? bhtDebriefSummary : {})
      }
    : { available: false, status: 'none', itemCount: 0, pendingQuickItemCount: 0 }

  useEffect(() => {
    const restoreAlerts = installAlertDialogBridge()
    return () => restoreAlerts()
  }, [])

  useEffect(() => {
    if (!user) return
    const isManagement = isSupervisorRole(user.role) || isAdminRole(user.role)
    const onManagementRoute = location.pathname.startsWith('/dashboard/')
    if (location.pathname === '/') {
      navigate(getDefaultRoute(user), { replace: true })
      return
    }
    if (isManagement && !onManagementRoute) {
      navigate(getDefaultRoute(user), { replace: true })
      return
    }
    if (!isManagement && onManagementRoute) {
      navigate('/home', { replace: true })
    }
  }, [location.pathname, navigate, user])

  const navigateHome = useCallback((options = {}) => {
    navigate(getDefaultRoute(user), options)
  }, [navigate, user])

  const navigateBack = useCallback(() => {
    const historyIndex = Number(window.history.state?.idx || 0)
    if (historyIndex > 0) {
      navigate(-1)
      return
    }
    navigateHome({ replace: true })
  }, [navigate, navigateHome])

  const navigateDashboardTab = useCallback((tab) => {
    const safeTab = DASHBOARD_TABS.has(tab) ? tab : 'dashboard'
    navigate(`/dashboard/${safeTab}`)
  }, [navigate])

  const openManagementTransportPanel = useCallback((transportId, options = {}) => {
    if (!transportId) return
    navigate(`/dashboard/transports?transport=${encodeURIComponent(transportId)}`, options)
  }, [navigate])

  const openManagementTransportRecord = useCallback((transportId, options = {}) => {
    if (!transportId) return
    navigate(`/dashboard/transports/${encodeURIComponent(transportId)}`, options)
  }, [navigate])

  const closeManagementTransportDetails = useCallback(() => {
    navigate('/dashboard/transports', { replace: true })
  }, [navigate])

  const returnToManagementTransportLog = useCallback(() => {
    navigate('/dashboard/transports')
  }, [navigate])

  const getActiveTransport = useCallback(() => {
    if (!user || !isBhtRole(user.role)) return null
    return transports.find(t => isActiveTransportStatus(t.status)) || null
  }, [transports, user])

  const resumeActiveTransport = useCallback((transport) => {
    if (!transport?.id) return
    navigate(`/transport/${encodeURIComponent(transport.id)}`)
  }, [navigate])

  function handleLogin(userData) {
    sessionStorage.setItem('bhtUser', JSON.stringify(userData))
    setUser(userData)
    localStorage.setItem('lastActivity', Date.now().toString())
    const route = parseAppRoute(location.pathname)
    const isManagement = isSupervisorRole(userData?.role) || isAdminRole(userData?.role)
    const routeMatchesRole = isManagement
      ? location.pathname.startsWith('/dashboard/')
      : ['home', 'transport', 'eocForm', 'debrief', 'issues', 'issueDetail'].includes(route.page)
    if (location.pathname === '/' || !routeMatchesRole) {
      navigate(getDefaultRoute(userData), { replace: true })
    }
    if (isBhtRole(userData?.role) && shouldShowOnboarding()) {
      setShowOnboarding(true)
    }
  }

  async function handleChangeOwnPin({ currentPin, newPin, confirmPin }) {
    if (!requireOnline('changing PIN')) {
      throw new Error('Offline mode: changing PIN is unavailable. Reconnect and retry.')
    }
    await changeOwnPin({
      sessionUser: user,
      currentPin,
      newPin,
      confirmPin
    })
    notifySuccess('PIN updated')
  }

  const handleLogout = useCallback(async () => {
    try {
      await signOut(auth)
    } catch (err) {
      console.warn('Firebase signOut failed:', err)
    }
    sessionStorage.removeItem('bhtUser')
    setUser(null)
    setTransports([])
    setBhtDebriefAssignment(null)
    localStorage.removeItem('lastActivity')
    navigate('/', { replace: true })
  }, [navigate])

  useEffect(() => {
    const handleOnline = () => setIsOffline(false)
    const handleOffline = () => setIsOffline(true)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const refreshOfflineOutboxSummary = useCallback(async () => {
    try {
      const actions = await listAllOfflineActions()
      const next = { pending: 0, syncing: 0, failed: 0, needsReview: 0 }
      for (const action of Array.isArray(actions) ? actions : []) {
        if (action.status === 'pending') next.pending += 1
        if (action.status === 'syncing') next.syncing += 1
        if (action.status === 'failed') next.failed += 1
        if (action.status === 'needsReview') next.needsReview += 1
      }
      setOfflineOutboxSummary(next)
    } catch (err) {
      console.warn('Offline outbox summary unavailable:', err)
    }
  }, [])

  const loadPendingLocalTransports = useCallback(async () => {
    if (!user || !isBhtRole(user.role)) return []
    const actions = await listAllOfflineActions()
    return getPendingLocalTransports(actions, user)
  }, [user])

  const refreshPendingLocalTransports = useCallback(async () => {
    if (!user || !isBhtRole(user.role)) return
    try {
      const actions = await listAllOfflineActions()
      const localTransports = getPendingLocalTransports(actions, user)
      const syncedTransportId = getSyncedTransportIdForLocal(actions, currentTransportId)
      if (syncedTransportId) {
        navigate(`/transport/${encodeURIComponent(syncedTransportId)}`, { replace: true })
      }
      setTransports(prev => mergeTransportLists(
        prev.filter(transport => !transport?.localOnly && !isLocalTransportId(transport?.id)),
        localTransports
      ))
    } catch (err) {
      console.warn('Pending offline transports unavailable:', err)
    }
  }, [currentTransportId, navigate, user])

  useEffect(() => {
    if (!user) return undefined
    const refreshTimer = window.setTimeout(() => refreshOfflineOutboxSummary(), 0)
    const handleOutboxChange = () => refreshOfflineOutboxSummary()
    window.addEventListener('offline-outbox-changed', handleOutboxChange)
    return () => {
      window.clearTimeout(refreshTimer)
      window.removeEventListener('offline-outbox-changed', handleOutboxChange)
    }
  }, [refreshOfflineOutboxSummary, user])

  useEffect(() => {
    if (!user || !isBhtRole(user.role)) return undefined
    const refreshTimer = window.setTimeout(() => refreshPendingLocalTransports(), 0)
    const handleOutboxChange = () => refreshPendingLocalTransports()
    window.addEventListener('offline-outbox-changed', handleOutboxChange)
    return () => {
      window.clearTimeout(refreshTimer)
      window.removeEventListener('offline-outbox-changed', handleOutboxChange)
    }
  }, [refreshPendingLocalTransports, user])

  useEffect(() => {
    if (!user || isOffline) return undefined
    let cancelled = false
    ;(async () => {
      const result = await syncOfflineOutbox()
      if (cancelled) return
      await refreshOfflineOutboxSummary()
      if (result.synced > 0) {
        notifySuccess(`${result.synced} offline item${result.synced === 1 ? '' : 's'} synced`)
      }
      if (result.needsReview > 0) {
        alert(`${result.needsReview} offline item${result.needsReview === 1 ? '' : 's'} need supervisor review before they can be accepted.`)
      }
    })().catch(err => {
      console.warn('Offline sync failed:', err)
    })
    return () => { cancelled = true }
  }, [isOffline, refreshOfflineOutboxSummary, user])

  // Track user activity for auto-lock
  useEffect(() => {
    if (!user) return

    const updateActivity = () => {
      localStorage.setItem('lastActivity', Date.now().toString())
    }

    // Update activity on user interaction
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart']
    events.forEach(event => {
      document.addEventListener(event, updateActivity)
    })

    // Check for inactivity every minute
    const inactivityCheck = setInterval(() => {
      const lastActivityTime = parseInt(localStorage.getItem('lastActivity') || Date.now().toString())
      const timeSinceActivity = Date.now() - lastActivityTime

      if (timeSinceActivity > AUTO_LOCK_TIMEOUT) {
        alert('Session expired due to inactivity. Please log in again.')
        handleLogout()
      }
    }, 60000) // Check every minute

    return () => {
      events.forEach(event => {
        document.removeEventListener(event, updateActivity)
      })
      clearInterval(inactivityCheck)
    }
  }, [handleLogout, user])

  // Keep session scope aligned with live `accessGrants` lifecycle and account deactivation.
  useEffect(() => {
    if (!user?.id || isOffline) return

    let cancelled = false
    const refreshSessionScope = async () => {
      try {
        const refreshedUser = await refreshScopedSessionUser(user.id)
        if (cancelled) return

        if (!refreshedUser) {
          alert('Your account is no longer active. Please log in again.')
          sessionStorage.removeItem('bhtUser')
          localStorage.removeItem('lastActivity')
          setUser(null)
          setTransports([])
          setBhtDebriefAssignment(null)
          navigate('/', { replace: true })
          return
        }

        setUser(prev => {
          if (!prev || prev.id !== refreshedUser.id) return prev
          const mergedUser = {
            ...refreshedUser,
            authUid: prev.authUid || null,
            authEmail: prev.authEmail || prev.email || null,
            authProvider: 'google',
            authScopeEnforced: true
          }

          if (toScopeSignature(prev) === toScopeSignature(mergedUser)) return prev
          sessionStorage.setItem('bhtUser', JSON.stringify(mergedUser))
          return mergedUser
        })
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to refresh session scope:', err)
        }
      }
    }

    refreshSessionScope()
    const intervalId = setInterval(refreshSessionScope, 60000)

    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  }, [user?.id, isOffline, navigate])

  // Load transports from Firestore — BHT only.
  // Supervisor/Admin manage their own transport state inside SupervisorDashboard,
  // so we skip this listener for those roles to avoid duplicate subscriptions.
  useEffect(() => {
    if (!user) return
    if (isSupervisorRole(user.role) || isAdminRole(user.role)) return

    const transportsRef = collection(db, 'transports')
    const q = query(
      transportsRef,
      where('createdByUserId', '==', user.id),
      orderBy('departedAt', 'desc')
    )

    let cancelled = false
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const transportData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
        ;(async () => {
          const localTransports = await loadPendingLocalTransports()
          if (!cancelled) {
            setTransports(mergeTransportLists(transportData, localTransports))
          }
        })().catch(err => {
          console.warn('Pending offline transports unavailable:', err)
          if (!cancelled) setTransports(transportData)
        })
      },
      (err) => {
        console.error('BHT transport listener failed:', err)
        if (!cancelled) setTransports([])
      }
    )

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [loadPendingLocalTransports, user])

  useEffect(() => {
    if (!bhtDebriefContext?.id) {
      const resetTimer = window.setTimeout(() => {
        setBhtDebriefSummary({ available: false, status: 'none', itemCount: 0, pendingQuickItemCount: 0 })
      }, 0)
      return () => window.clearTimeout(resetTimer)
    }

    const initialTimer = window.setTimeout(() => {
      setBhtDebriefSummary({ available: true, status: 'none', itemCount: 0, pendingQuickItemCount: 0, debriefId: bhtDebriefContext.id })
    }, 0)
    let latestDraft = null
    let latestSubmitted = null
    let pendingQuickItemCount = 0
    const updateSummary = () => {
      if (latestSubmitted) {
        setBhtDebriefSummary({
          available: true,
          status: 'submitted',
          itemCount: Array.isArray(latestSubmitted.items) ? latestSubmitted.items.length : 0,
          pendingQuickItemCount,
          debriefId: latestSubmitted.id
        })
        return
      }
      if (latestDraft) {
        setBhtDebriefSummary({
          available: true,
          status: 'draft',
          itemCount: (Array.isArray(latestDraft.items) ? latestDraft.items.length : 0) + pendingQuickItemCount,
          pendingQuickItemCount,
          debriefId: latestDraft.id
        })
        return
      }
      setBhtDebriefSummary({
        available: true,
        status: pendingQuickItemCount > 0 ? 'draft' : 'none',
        itemCount: pendingQuickItemCount,
        pendingQuickItemCount,
        debriefId: bhtDebriefContext.id
      })
    }

    const refreshPendingQuickSummary = async () => {
      const localDraft = await getOfflineDraft(getDebriefQuickDraftId(bhtDebriefContext.id)).catch(() => null)
      pendingQuickItemCount = Array.isArray(localDraft?.payload?.items) ? localDraft.payload.items.length : 0
      updateSummary()
    }
    refreshPendingQuickSummary()
    window.addEventListener('offline-outbox-changed', refreshPendingQuickSummary)

    const unsubDraft = onSnapshot(
      doc(db, DEBRIEF_DRAFTS_COLLECTION, bhtDebriefContext.id),
      (snap) => {
        latestDraft = snap.exists() ? { id: snap.id, ...snap.data() } : null
        updateSummary()
      },
      (err) => {
        console.error('BHT debrief draft summary listener failed:', err)
        latestDraft = null
        updateSummary()
      }
    )
    const unsubSubmitted = onSnapshot(
      doc(db, DEBRIEFS_COLLECTION, bhtDebriefContext.id),
      (snap) => {
        latestSubmitted = snap.exists() ? { id: snap.id, ...snap.data() } : null
        updateSummary()
      },
      (err) => {
        console.error('BHT submitted debrief summary listener failed:', err)
        latestSubmitted = null
        updateSummary()
      }
    )

    return () => {
      window.clearTimeout(initialTimer)
      window.removeEventListener('offline-outbox-changed', refreshPendingQuickSummary)
      unsubDraft()
      unsubSubmitted()
    }
  }, [bhtDebriefContext])

  // Sync EOC task generation + overdue status on session start and while online.
  useEffect(() => {
    if (!user || isOffline) return
    if (isBhtRole(user.role)) return

    let cancelled = false
    const runEocSync = async () => {
      try {
        const result = await syncEocTasksForUserScope(user)
        if (!cancelled && (result.created > 0 || result.updated > 0)) {
          console.info('EOC task engine sync complete:', result)
        }
      } catch (err) {
        if (!cancelled) {
          console.error('EOC task engine sync failed:', err)
        }
      }
    }

    runEocSync()
    const intervalId = setInterval(runEocSync, 5 * 60 * 1000)

    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  }, [user, isOffline])

  // Sync fleet task generation on supervisor/admin session start and periodic refresh.
  useEffect(() => {
    if (!user || isOffline) return
    if (!isSupervisorRole(user.role) && !isAdminRole(user.role)) return

    let cancelled = false
    const runFleetSync = async () => {
      try {
        const result = await syncFleetTasksForUserScope(user)
        if (!cancelled && (result.created > 0 || result.updated > 0)) {
          console.info('Fleet task engine sync complete:', result)
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Fleet task engine sync failed:', err)
        }
      }
    }

    runFleetSync()
    const intervalId = setInterval(runFleetSync, 5 * 60 * 1000)

    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  }, [user, isOffline])

  // Alert count and issue updates are now provided by useScopedAlerts hook above

  function handleStartEoc(taskId) {
    navigate(`/eoc/${encodeURIComponent(taskId)}`)
  }

  async function handleReportIssue(report) {
    const payload = {
      user,
      assignment: report?.assignment || bhtDebriefAssignment,
      issueType: report?.issueType || '',
      description: report?.description || '',
      vanId: report?.vanId || ''
    }

    if (isOffline) {
      await queueBhtIssueReport(payload)
      notifySuccess('Issue saved on this device')
      return
    }

    await submitBhtIssueReportOnline(payload)
    notifySuccess('Issue reported')
  }

  function handleEocComplete() {
    navigateHome()
  }

  function handleEocBack() {
    navigateBack()
  }

  async function handleNewTransport() {
    try {
      const activeTransport = getActiveTransport()
      if (activeTransport) {
        alert('You already have an active transport. Continue/close it before starting a new one.')
        resumeActiveTransport(activeTransport)
        return
      }

      const scopedSites = getScopedTransportSites(user)
      const allowedSites = scopedSites.filter(site => TRANSPORT_SITES.has(site))
      if (allowedSites.length === 0) {
        alert('No valid transport location is configured for your account.')
        return
      }

      const lastSiteKey = getLastTransportSiteKey(user?.id)
      const lastUsedSite = String(localStorage.getItem(lastSiteKey) || '').trim().toUpperCase()
      const profileSite = normalizeTransportSite(user?.site)

      let transportSite = ''
      if (allowedSites.length === 1) {
        transportSite = allowedSites[0]
      } else {
        const preferredSite = [lastUsedSite, profileSite].find(site => allowedSites.includes(site)) || allowedSites[0]
        transportSite = (await promptForTransportSite(allowedSites, preferredSite)) || ''
      }

      if (!TRANSPORT_SITES.has(transportSite)) return

      if (isOffline) {
        const localTransportId = makeLocalTransportId()
        const now = new Date()
        const newTransport = {
          id: localTransportId,
          site: transportSite,
          locationId: user.locationId || '',
          createdByUserId: user.id,
          createdByName: user.name,
          status: 'open',
          version: 1,
          departedAt: now,
          clients: [],
          reasons: [],
          stops: [],
          destinations: [],
          notes: '',
          createdAt: now,
          updatedAt: now,
          localOnly: true,
          pendingSync: true
        }

        await saveOfflineDraft(getTransportDraftId(localTransportId), 'transport', {
          snapshot: newTransport,
          expectedVersion: 1,
          localOnly: true
        })
        await queueTransportCreate({
          localTransportId,
          snapshot: newTransport,
          user
        })
        localStorage.setItem(lastSiteKey, transportSite)
        setTransports(prev => mergeTransportLists(prev, [newTransport]))
        navigate(`/transport/${encodeURIComponent(localTransportId)}`)
        notifySuccess('Transport saved on this device')
        return
      }

      // Write-layer guard (client-enforced in free-tier v1): prevent duplicate active transport creation.
      const userTransportSnapshot = await getDocs(
        query(
          collection(db, 'transports'),
          where('createdByUserId', '==', user.id)
        )
      )
      const existing = userTransportSnapshot.docs.find((docSnap) => {
        return isActiveTransportStatus(docSnap.data()?.status)
      })
      if (existing) {
        alert('Active transport already exists. Redirecting to continue it.')
        resumeActiveTransport({ id: existing.id, ...existing.data() })
        return
      }

      const newTransport = {
        site: transportSite,
        locationId: user.locationId || '',
        createdByUserId: user.id,
        createdByName: user.name,
        status: 'open',
        version: 1,
        departedAt: serverTimestamp(),
        clients: [],
        reasons: [],
        stops: [],
        destinations: [],
        notes: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }

      const docRef = await addDoc(collection(db, 'transports'), newTransport)
      localStorage.setItem(lastSiteKey, transportSite)
      navigate(`/transport/${encodeURIComponent(docRef.id)}`)
      notifySuccess('Transport created')
    } catch (error) {
      console.error('Error creating transport:', error)
      if (error?.code === 'permission-denied' || /insufficient permissions/i.test(String(error?.message || ''))) {
        alert('Your account is missing transport access for this location. Please contact a supervisor or admin.')
      } else {
        alert(error?.message || 'Failed to create transport. Please try again.')
      }
    }
  }

  function handleCloseTransportCard() {
    navigateBack()
  }

  function handleTransportClosed(closedTransport) {
    if (closedTransport?.id) {
      setTransports(prev => {
        const existingIndex = prev.findIndex(transport => transport.id === closedTransport.id)
        if (existingIndex === -1) return [closedTransport, ...prev]
        return prev.map(transport => (
          transport.id === closedTransport.id
            ? { ...transport, ...closedTransport }
            : transport
        ))
      })
    }
    navigateHome()
  }

  function handleTransportCancelled(transportId) {
    if (transportId) {
      setTransports(prev => prev.filter(transport => transport.id !== transportId))
    }
    navigateHome()
  }

  function handleContinueTransport(transportId) {
    navigate(`/transport/${encodeURIComponent(transportId)}`)
  }

  function handleAddDebriefNote() {
    navigate('/debrief/quick')
  }

  function handleEditDebrief() {
    navigate('/debrief/full')
  }

  function handleDebriefBack() {
    navigateBack()
  }

  function handleNavigateToIssue(alert) {
    if (isSupervisorRole(user?.role) || isAdminRole(user?.role)) {
      setDashboardNavigationTarget({
        type: 'issue',
        issueId: alert?.issueId || null,
        createdAt: Date.now()
      })
      navigateDashboardTab('eoc')
      return
    }

    setFocusedIssueUpdateId(alert?.id || null)
    if (alert?.issueId) {
      navigate(`/issues/${encodeURIComponent(alert.issueId)}`)
      return
    }
    navigateHome()
  }

  function handleNavigateToFleet() {
    if (isSupervisorRole(user?.role) || isAdminRole(user?.role)) {
      setDashboardNavigationTarget({
        type: 'fleet',
        createdAt: Date.now()
      })
      navigateDashboardTab('fleet')
    }
  }

  function handleNavigateToDebrief(alert) {
    if (isSupervisorRole(user?.role) || isAdminRole(user?.role)) {
      setDashboardNavigationTarget({
        type: 'debrief',
        debriefId: alert?.debriefId || null,
        createdAt: Date.now()
      })
      navigateDashboardTab('debriefs')
      return
    }

    const debriefId = alert?.debriefId ? `/${encodeURIComponent(alert.debriefId)}` : ''
    navigate(`/debrief/full${debriefId}`)
  }

  if (user === null) {
    return (
      <>
        <PinLogin onLogin={handleLogin} />
        <DialogHost />
        <ToastHost />
      </>
    )
  }

  const isManagementUser = isSupervisorRole(user.role) || isAdminRole(user.role)
  const canChangeOwnPin = isBhtRole(user.role) || isSupervisorRole(user.role) || isAdminRole(user.role)
  const commonHeaderProps = {
    userName: user.name,
    userSubtitle: bhtHeaderSubtitle,
    isManagement: isManagementUser,
    isAdmin: isAdminRole(user.role),
    activeSection: isManagementUser ? dashboardTab : 'home',
    onNavigateHome: () => navigateHome(),
    onNavigateSection: navigateDashboardTab,
    onLogout: handleLogout,
    onChangePin: () => setIsChangePinOpen(true),
    canChangeOwnPin,
    alertCount,
    isOffline,
    pendingSyncCount,
    needsReviewCount: offlineOutboxSummary.needsReview,
    onNotificationsOpen: () => setIsNotificationsOpen(true)
  }

  const sharedOverlays = (
    <>
      <ChangePinModal
        isOpen={isChangePinOpen}
        onClose={() => setIsChangePinOpen(false)}
        onSubmit={handleChangeOwnPin}
      />
      <NotificationCenter
        isOpen={isNotificationsOpen}
        onClose={() => setIsNotificationsOpen(false)}
        eocAlerts={eocAlerts}
        fleetAlerts={fleetAlerts}
        debriefAlerts={debriefAlerts}
        issueUpdates={issueUpdates}
        onNavigateToIssue={handleNavigateToIssue}
        onNavigateToFleet={handleNavigateToFleet}
        onNavigateToDebrief={handleNavigateToDebrief}
      />
      <DialogHost />
      <ToastHost />
    </>
  )

  const renderShell = (content, { title, showBack = false, onBack = navigateBack } = {}) => (
    <div className={`app-shell app-bg ${isManagementUser ? 'management-shell' : 'field-shell'}`}>
      <Header
        {...commonHeaderProps}
        pageTitle={title || 'Home'}
        showBack={showBack}
        onBack={onBack}
      />
      <main className="app-shell-content">{content}</main>
      {sharedOverlays}
    </div>
  )

  if (page === 'transport') {
    return renderShell(
      <TransportCard
        transportId={currentTransportId}
        user={user}
        isOffline={isOffline}
        onClose={handleCloseTransportCard}
        onTransportClosed={handleTransportClosed}
        onTransportCancelled={handleTransportCancelled}
      />,
      { title: 'Transport', showBack: true, onBack: handleCloseTransportCard }
    )
  }

  if (page === 'eocForm') {
    return renderShell(
      <EocChecklist
        taskId={currentTaskId}
        user={user}
        isOffline={isOffline}
        onComplete={handleEocComplete}
        onBack={handleEocBack}
      />,
      { title: 'End of Shift Checklist', showBack: true, onBack: handleEocBack }
    )
  }

  if (page === 'debrief') {
    return renderShell(
      <ShiftDebriefPage
        user={user}
        assignment={bhtDebriefAssignment}
        mode={currentDebriefMode}
        debriefId={currentDebriefId}
        isOffline={isOffline}
        onBack={handleDebriefBack}
        onQuickNoteSaved={navigateHome}
      />,
      {
        title: currentDebriefMode === 'quick' ? 'Add Debrief Note' : 'Shift Debrief',
        showBack: true,
        onBack: handleDebriefBack
      }
    )
  }

  if (page === 'issues') {
    return renderShell(
      <LocationIssuesBoard
        user={user}
        locationIds={exactIssueLocationIds}
        inIssueScope={inIssueScope}
        isOffline={isOffline}
        onBack={() => navigateHome()}
        onOpenIssue={(issueId) => navigate(`/issues/${encodeURIComponent(issueId)}`)}
        onReportIssue={handleReportIssue}
        assignment={bhtDebriefAssignment}
      />,
      { title: 'Location Issues', showBack: true, onBack: () => navigateHome() }
    )
  }

  if (page === 'issueDetail') {
    return renderShell(
      <IssueDetail
        user={user}
        issueId={currentIssueId}
        inIssueScope={inIssueScope}
        onBack={() => navigate('/issues')}
      />,
      { title: 'Location Issues', showBack: true, onBack: () => navigate('/issues') }
    )
  }

  if (isManagementUser) {
    const sectionTitle = dashboardTab.charAt(0).toUpperCase() + dashboardTab.slice(1)
    return renderShell(
      <>
        <SupervisorDashboard
          user={user}
          isOffline={isOffline}
          onNewTransport={handleNewTransport}
          onLogout={handleLogout}
          userName={user.name}
          eocAlerts={eocAlerts}
          fleetAlerts={fleetAlerts}
          debriefAlerts={debriefAlerts}
          activeTab={dashboardTab}
          onActiveTabChange={navigateDashboardTab}
          navigationTarget={dashboardNavigationTarget}
          onNavigationHandled={() => setDashboardNavigationTarget(null)}
          transportRecordId={managementTransportId}
          transportRecordMode={managementTransportMode}
          onOpenTransportPanel={openManagementTransportPanel}
          onOpenTransportRecord={openManagementTransportRecord}
          onCloseTransportDetails={closeManagementTransportDetails}
          onBackToTransportLog={returnToManagementTransportLog}
        />
      </>,
      { title: sectionTitle }
    )
  }

  return renderShell(
    <>
      <BhtHub
        user={user}
        transports={transports}
        isOffline={isOffline}
        issueUpdates={issueUpdates}
        focusedIssueUpdateId={focusedIssueUpdateId}
        onNewTransport={handleNewTransport}
        onContinueTransport={handleContinueTransport}
        onStartEoc={handleStartEoc}
        onReportIssue={handleReportIssue}
        onAddDebriefNote={handleAddDebriefNote}
        onEditDebrief={handleEditDebrief}
        onDebriefAssignmentChange={setBhtDebriefAssignment}
        debriefSummary={effectiveBhtDebriefSummary}
        debriefAlerts={debriefAlerts}
        onNavigateToDebrief={handleNavigateToDebrief}
        onNavigateToIssues={() => navigate('/issues')}
      />
      {showOnboarding && (
        <Onboarding onComplete={() => setShowOnboarding(false)} />
      )}
    </>,
    { title: 'Home' }
  )
}

export default App

