import { useState, useEffect } from 'react'
import { db } from './firebase'
import { collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp } from 'firebase/firestore'
import PinLogin from './components/PinLogin'
import Header from './components/Header'
import BhtHub from './components/BhtHub'
import TransportCard from './components/TransportCard'
import CloseChecklist from './components/CloseChecklist'
import EocChecklist from './components/EocChecklist'
import SupervisorDashboard from './components/SupervisorDashboard'
import { syncEocTasksForUserScope } from './services/eocTaskEngine'

const AUTO_LOCK_TIMEOUT = 60 * 60 * 1000 // 60 minutes in milliseconds
const TRANSPORT_SITES = new Set(['PHP', 'RTC'])

function getScopedTransportSites(user) {
  if (!user) return []
  if (user.role === 'admin') return []

  const raw = []
  if (user.site) raw.push(user.site)
  if (Array.isArray(user.authorizedLocations)) raw.push(...user.authorizedLocations)

  const normalized = [...new Set(raw.map(v => String(v || '').trim().toUpperCase()))]
  return normalized.filter(v => TRANSPORT_SITES.has(v))
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
    return JSON.parse(saved)
  })
  const [page, setPage] = useState('home')
  const [transports, setTransports] = useState([])
  const [currentTransportId, setCurrentTransportId] = useState(null)
  const [currentTaskId, setCurrentTaskId] = useState(null)
  const [lastActivity, setLastActivity] = useState(Date.now())
  const [alertCount, setAlertCount] = useState(0)

  function handleLogin(userData) {
    sessionStorage.setItem('bhtUser', JSON.stringify(userData))
    setUser(userData)
    setPage('home')
    setLastActivity(Date.now())
    localStorage.setItem('lastActivity', Date.now().toString())
  }

  function handleLogout() {
    sessionStorage.removeItem('bhtUser')
    setUser(null)
    setPage('home')
    setTransports([])
    setCurrentTransportId(null)
    setCurrentTaskId(null)
    localStorage.removeItem('lastActivity')
  }

  // Track user activity for auto-lock
  useEffect(() => {
    if (!user) return

    const updateActivity = () => {
      setLastActivity(Date.now())
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
  }, [user])

  // Load transports from Firestore based on user role
  useEffect(() => {
    if (!user) return

    const transportsRef = collection(db, 'transports')
    let q

    if (user.role === 'supervisor' || user.role === 'admin') {
      // Supervisor and admin see all transports
      q = query(transportsRef, orderBy('departedAt', 'desc'))
    } else {
      // Tech sees only their own transports
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

      if (user.role === 'supervisor') {
        const scopedSites = getScopedTransportSites(user)
        if (scopedSites.length > 0) {
          const siteSet = new Set(scopedSites)
          transportData = transportData.filter(t => siteSet.has(String(t.site || '').trim().toUpperCase()))
        }
      }

      setTransports(transportData)
    })

    return () => unsubscribe()
  }, [user])

  // Sync EOC task generation + overdue status on session start.
  useEffect(() => {
    if (!user) return

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
  }, [user])

  // Supervisor/admin alert count listener
  useEffect(() => {
    if (!user || (user.role !== 'supervisor' && user.role !== 'admin')) return

    const q = query(
      collection(db, 'supervisorAlerts'),
      where('read', '==', false)
    )

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setAlertCount(snapshot.size)
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
    try {
      const scopedSites = getScopedTransportSites(user)
      const transportSite =
        String(user?.site || '').trim().toUpperCase() ||
        scopedSites[0] ||
        ''

      if (!TRANSPORT_SITES.has(transportSite)) {
        alert('No valid transport site is configured for your account.')
        return
      }

      const newTransport = {
        site: transportSite,
        createdByUserId: user.id,
        createdByName: user.name,
        status: 'open',
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
      setCurrentTransportId(docRef.id)
      setPage('transport')
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
      <PinLogin onLogin={handleLogin} />
    )
  }

  if (page === 'transport') {
    return (
      <div className="app-bg">
        <Header userName={user.name} onLogout={handleLogout} alertCount={alertCount} />
        <TransportCard
          transportId={currentTransportId}
          user={user}
          onReturn={handleReturn}
          onClose={handleCloseTransportCard}
        />
      </div>
    )
  }

  if (page === 'closeChecklist') {
    return (
      <div className="app-bg">
        <Header userName={user.name} onLogout={handleLogout} alertCount={alertCount} />
        <CloseChecklist
          transportId={currentTransportId}
          onClose={handleCloseChecklistBack}
          onComplete={handleCloseChecklistComplete}
        />
      </div>
    )
  }

  if (page === 'eocForm') {
    return (
      <div className="app-bg">
        <Header userName={user.name} onLogout={handleLogout} alertCount={alertCount} />
        <EocChecklist
          taskId={currentTaskId}
          user={user}
          onComplete={handleEocComplete}
          onBack={handleEocBack}
        />
      </div>
    )
  }

  // Show supervisor dashboard for supervisor or admin role
  if (user.role === 'supervisor' || user.role === 'admin') {
    return (
      <div className="app-bg">
        <Header userName={user.name} onLogout={handleLogout} alertCount={alertCount} />
        <SupervisorDashboard
          user={user}
          onNewTransport={handleNewTransport}
          onLogout={handleLogout}
          userName={user.name}
        />
      </div>
    )
  }

  // Regular tech view — BHT Hub
  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: 'var(--bg)'
    }}>
      <Header userName={user.name} onLogout={handleLogout} alertCount={alertCount} />
      <BhtHub
        user={user}
        transports={transports}
        onNewTransport={handleNewTransport}
        onContinueTransport={handleContinueTransport}
        onStartEoc={handleStartEoc}
      />
    </div>
  )
}

export default App
