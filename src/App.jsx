import { useState, useEffect } from 'react'
import { db } from './firebase'
import { collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp } from 'firebase/firestore'
import PinLogin from './components/PinLogin'
import Header from './components/Header'
import TransportList from './components/TransportList'
import TransportCard from './components/TransportCard'
import CloseChecklist from './components/CloseChecklist'

function App() {
  const [user, setUser] = useState(null)
  const [page, setPage] = useState('home')
  const [transports, setTransports] = useState([])
  const [currentTransportId, setCurrentTransportId] = useState(null)

  function handleLogin(user) {
    setUser(user)
    setPage('home')
  }

  function handleLogout() {
    setUser(null)
    setPage('home')
    setTransports([])
    setCurrentTransportId(null)
  }

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

  if (user === null) {
    return (
      <PinLogin onLogin={handleLogin} />
    )
  }

  if (page === 'transport') {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#f5f5f5'
      }}>
        <Header userName={user.name} onLogout={handleLogout} />
        <TransportCard
          transportId={currentTransportId}
          onReturn={handleReturn}
          onClose={handleCloseTransportCard}
        />
      </div>
    )
  }

  if (page === 'closeChecklist') {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#f5f5f5'
      }}>
        <Header userName={user.name} onLogout={handleLogout} />
        <CloseChecklist
          transportId={currentTransportId}
          onClose={handleCloseChecklistBack}
          onComplete={handleCloseChecklistComplete}
        />
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f5f5f5'
    }}>
      <Header userName={user.name} onLogout={handleLogout} />
      <TransportList
        transports={transports}
        onNewTransport={handleNewTransport}
      />
    </div>
  )
}

export default App