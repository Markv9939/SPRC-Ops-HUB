import { useState, useEffect, useCallback } from 'react'
import { db, auth } from './firebase'
import { collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, getDocs } from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import PinLogin from './components/PinLogin'
import Header from './components/Header'
import BhtHub from './components/BhtHub'
import TransportCard from './components/TransportCard'
import CloseChecklist from './components/CloseChecklist'
import EocChecklist from './components/EocChecklist'
import SupervisorDashboard from './components/SupervisorDashboard'
import ToastHost from './components/ToastHost'
import DialogHost from './components/DialogHost'
import { syncEocTasksForUserScope } from './services/eocTaskEngine'
import { refreshScopedSessionUser } from './services/accessGrantService'
import { getAuthPolicy } from './services/authPolicyService'
import { requireOnline } from './utils/networkGuard'
import { notifySuccess } from './utils/toast'
import { installAlertDialogBridge, showPromptDialog } from './utils/dialogs'
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
const ACTIVE_TRANSPORT_STATUSES = new Set(['open', 'arrived', 'returned'])

function getLastTransportSiteKey(userId) {
  return `lastTransportSite:${userId || 'unknown'}`
}

function getScopedTransportSites(user) {
  if (!user) return []
  if (isAdminRole(user.role)) return Array.from(TRANSPORT_SITES)
  return getAvailableMainLocationsForUser(user).filter(v => TRANSPORT_SITES.has(v))
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

function App() {
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
  const [page, setPage] = useState('home')
  const [transports, setTransports] = useState([])
  const [currentTransportId, setCurrentTransportId] = useState(null)
  const [currentTaskId, setCurrentTaskId] = useState(null)
  const [alertCount, setAlertCount] = useState(0)
  const [issueUpdates, setIssueUpdates] = useState([])
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)

  useEffect(() => {
    const restoreAlerts = installAlertDialogBridge()
    return () => restoreAlerts()
  }, [])

  const getActiveTransport = useCallback(() => {
    if (!user || !isBhtRole(user.role)) return null
    return transports.find(t => ACTIVE_TRANSPORT_STATUSES.has(String(t.status || '').toLowerCase())) || null
  }, [transports, user])

  const resumeActiveTransport = useCallback((transport) => {
    if (!transport?.id) return
    setCurrentTransportId(transport.id)
    if (transport.status === 'returned') {
      setPage('closeChecklist')
      return
    }
    setPage('transport')
  }, [])

  function handleLogin(userData) {
    sessionStorage.setItem('bhtUser', JSON.stringify(userData))
    setUser(userData)
    if (!isBhtRole(userData?.role)) {
      setIssueUpdates([])
    }
    setPage('home')
    localStorage.setItem('lastActivity', Date.now().toString())
  }

  const handleLogout = useCallback(() => {
    const activeTransport = getActiveTransport()
    if (activeTransport) {
      alert('You cannot lock/logout while a transport is active. Close the transport first.')
      resumeActiveTransport(activeTransport)
      return
    }

    sessionStorage.removeItem('bhtUser')
    setUser(null)
    setPage('home')
    setTransports([])
    setCurrentTransportId(null)
    setCurrentTaskId(null)
    setIssueUpdates([])
    localStorage.removeItem('lastActivity')
    signOut(auth).catch((err) => {
      console.warn('Auth signOut skipped:', err)
    })
  }, [getActiveTransport, resumeActiveTransport])

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
        const activeTransport = getActiveTransport()
        if (activeTransport) {
          localStorage.setItem('lastActivity', Date.now().toString())
          resumeActiveTransport(activeTransport)
          return
        }
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
  }, [handleLogout, getActiveTransport, resumeActiveTransport, user])

  // Keep session scope aligned with live `accessGrants` lifecycle and account deactivation.
  useEffect(() => {
    if (!user?.id || isOffline) return

    let cancelled = false
    const refreshSessionScope = async () => {
      try {
        const refreshedUser = await refreshScopedSessionUser(user.id)
        if (cancelled) return

        const policy = await getAuthPolicy()
        const authScopeEnforced = policy?.authScopeEnforced === true

        if (!refreshedUser) {
          alert('Your account is no longer active. Please log in again.')
          sessionStorage.removeItem('bhtUser')
          localStorage.removeItem('lastActivity')
          setUser(null)
          setPage('home')
          setTransports([])
          setCurrentTransportId(null)
          setCurrentTaskId(null)
          return
        }

        setUser(prev => {
          if (!prev || prev.id !== refreshedUser.id) return prev
          const mergedUser = {
            ...refreshedUser,
            authUid: prev.authUid || null,
            authClaimsReady: prev.authClaimsReady || false,
            authClaimRole: prev.authClaimRole || null,
            authClaimLocations: Array.isArray(prev.authClaimLocations) ? prev.authClaimLocations : [],
            authScopeEnforced
          }

          if (mergedUser.authScopeEnforced && !mergedUser.authClaimsReady) {
            alert('Access policy changed: auth claims are now required. Please re-login with a claim-enabled account.')
            sessionStorage.removeItem('bhtUser')
            localStorage.removeItem('lastActivity')
            setPage('home')
            setTransports([])
            setCurrentTransportId(null)
            setCurrentTaskId(null)
            return null
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
  }, [user?.id, isOffline])

  // Load transports from Firestore based on user role
  useEffect(() => {
    if (!user) return

    const transportsRef = collection(db, 'transports')
    let q

    if (isSupervisorRole(user.role) || isAdminRole(user.role)) {
      // Supervisor and admin see all transports
      q = query(transportsRef, orderBy('departedAt', 'desc'))
    } else {
      // BHT sees only their own transports
      q = query(
        transportsRef,
        where('createdByUserId', '==', user.id),
        orderBy('departedAt', 'desc')
      )
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      let transportData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }))

      if (isSupervisorRole(user.role)) {
        const scopedSites = getScopedTransportSites(user)
        if (scopedSites.length > 0) {
          const siteSet = new Set(scopedSites)
          transportData = transportData.filter(t => siteSet.has(normalizeTransportSite(t.site)))
        }
      }

      setTransports(transportData)
    })

    return () => unsubscribe()
  }, [user])

  // Sync EOC task generation + overdue status on session start.
  useEffect(() => {
    if (!user || isOffline) return

    let cancelled = false
    ;(async () => {
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
    })()

    return () => { cancelled = true }
  }, [user, isOffline])

  // Supervisor/admin alert count listener
  useEffect(() => {
    if (!user || (!isSupervisorRole(user.role) && !isAdminRole(user.role))) return

    const q = query(
      collection(db, 'alerts'),
      where('read', '==', false)
    )

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const count = snapshot.docs.reduce((acc, alertDoc) => {
        return alertDoc.data()?.type === 'eoc_issue' ? acc + 1 : acc
      }, 0)
      setAlertCount(count)
    })

    return () => unsubscribe()
  }, [user])

  useEffect(() => {
    if (!user || !isBhtRole(user.role)) return

    const q = query(
      collection(db, 'alerts'),
      where('type', '==', 'eoc_issue_update')
    )

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const rows = snapshot.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
        .filter(item => item.targetUserId === user.id)
      rows.sort((a, b) => {
        const aMs = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0
        const bMs = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0
        return bMs - aMs
      })
      setIssueUpdates(rows.slice(0, 8))
    })

    return () => unsubscribe()
  }, [user])

  function handleStartEoc(taskId) {
    setCurrentTaskId(taskId)
    setPage('eocForm')
  }

  function handleEocComplete() {
    setCurrentTaskId(null)
    setPage('home')
  }

  function handleEocBack() {
    setCurrentTaskId(null)
    setPage('home')
  }

  async function handleNewTransport() {
    if (!requireOnline('starting a new transport')) return

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

      // Write-layer guard (client-enforced in free-tier v1): prevent duplicate active transport creation.
      const activeSnapshot = await getDocs(
        query(
          collection(db, 'transports'),
          where('createdByUserId', '==', user.id),
          where('status', 'in', ['open', 'arrived', 'returned'])
        )
      )
      if (!activeSnapshot.empty) {
        const existing = activeSnapshot.docs[0]
        alert('Active transport already exists. Redirecting to continue it.')
        resumeActiveTransport({ id: existing.id, ...existing.data() })
        return
      }

      const newTransport = {
        site: transportSite,
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
      setCurrentTransportId(docRef.id)
      setPage('transport')
      notifySuccess('Transport created')
    } catch (error) {
      console.error('Error creating transport:', error)
      alert('Failed to create transport. Please try again.')
    }
  }

  function handleReturn() {
    setPage('closeChecklist')
  }

  function handleCloseTransportCard() {
    setCurrentTransportId(null)
    setPage('home')
  }

  function handleCloseChecklistBack() {
    setPage('transport')
  }

  function handleCloseChecklistComplete() {
    setCurrentTransportId(null)
    setPage('home')
  }

  function handleContinueTransport(transportId) {
    setCurrentTransportId(transportId)
    setPage('transport')
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

  if (page === 'transport') {
    return (
      <div className="app-bg">
        <Header userName={user.name} onLogout={handleLogout} alertCount={alertCount} isOffline={isOffline} />
        <TransportCard
          transportId={currentTransportId}
          user={user}
          isOffline={isOffline}
          onReturn={handleReturn}
          onClose={handleCloseTransportCard}
        />
        <DialogHost />
        <ToastHost />
      </div>
    )
  }

  if (page === 'closeChecklist') {
    return (
      <div className="app-bg">
        <Header userName={user.name} onLogout={handleLogout} alertCount={alertCount} isOffline={isOffline} />
        <CloseChecklist
          transportId={currentTransportId}
          user={user}
          isOffline={isOffline}
          onClose={handleCloseChecklistBack}
          onComplete={handleCloseChecklistComplete}
        />
        <DialogHost />
        <ToastHost />
      </div>
    )
  }

  if (page === 'eocForm') {
    return (
      <div className="app-bg">
        <Header userName={user.name} onLogout={handleLogout} alertCount={alertCount} isOffline={isOffline} />
        <EocChecklist
          taskId={currentTaskId}
          user={user}
          isOffline={isOffline}
          onComplete={handleEocComplete}
          onBack={handleEocBack}
        />
        <DialogHost />
        <ToastHost />
      </div>
    )
  }

  // Show supervisor dashboard for supervisor or admin role
  if (isSupervisorRole(user.role) || isAdminRole(user.role)) {
    return (
      <div className="app-bg">
        <Header userName={user.name} onLogout={handleLogout} alertCount={alertCount} isOffline={isOffline} />
        <SupervisorDashboard
          user={user}
          isOffline={isOffline}
          onNewTransport={handleNewTransport}
          onLogout={handleLogout}
          userName={user.name}
        />
        <DialogHost />
        <ToastHost />
      </div>
    )
  }

  // Regular BHT view - BHT Hub
  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: 'var(--bg)'
    }}>
      <Header userName={user.name} onLogout={handleLogout} alertCount={alertCount} isOffline={isOffline} />
      <BhtHub
        user={user}
        transports={transports}
        issueUpdates={issueUpdates}
        onNewTransport={handleNewTransport}
        onContinueTransport={handleContinueTransport}
        onStartEoc={handleStartEoc}
      />
      <DialogHost />
      <ToastHost />
    </div>
  )
}

export default App

