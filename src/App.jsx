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

const AUTO_LOCK_TIMEOUT = 60 * 60 * 1000 // 60 minutes in milliseconds

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
  const [currentAssignmentId, setCurrentAssignmentId] = useState(null)
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
    setCurrentAssignmentId(null)
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

    if (user.role === 'supervisor') {
      // Supervisor sees all transports
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
      const transportData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }))
      setTransports(transportData)
    })

    return () => unsubscribe()
  }, [user])

  // Supervisor alert count listener
  useEffect(() => {
    if (!user || user.role !== 'supervisor') return

    const q = query(
      collection(db, 'supervisorAlerts'),
      where('read', '==', false)
    )

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setAlertCount(snapshot.size)
    })

    return () => unsubscribe()
  }, [user])

  function handleStartEoc(assignmentId) {
    setCurrentAssignmentId(assignmentId)
    setPage('eocForm')
  }

  function handleEocComplete() {
    setCurrentAssignmentId(null)
    setPage('home')
  }

  function handleEocBack() {
    setCurrentAssignmentId(null)
    setPage('home')
  }

  async function handleNewTransport() {
    try {
      const newTransport = {
        site: user.site,
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
          assignmentId={currentAssignmentId}
          user={user}
          onComplete={handleEocComplete}
          onBack={handleEocBack}
        />
      </div>
    )
  }

  // Show supervisor dashboard for supervisor role
  if (user.role === 'supervisor') {
    return (
      <div className="app-bg">
        <Header userName={user.name} onLogout={handleLogout} alertCount={alertCount} />
        <SupervisorDashboard
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
      backgroundColor: '#f5f5f5'
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