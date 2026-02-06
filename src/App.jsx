import { useState } from 'react'
import PinLogin from './components/PinLogin'
import Header from './components/Header'
import TransportList from './components/TransportList'
import TransportCard from './components/TransportCard'

function App() {
  const [user, setUser] = useState(null)
  const [page, setPage] = useState('home')
  const [transports, setTransports] = useState([])
  const [startTimeHolder, setStartTimeHolder] = useState('')

  function handleLogin(user) {
    setUser(user)
    setPage('home')
  }

  function handleLogout() {
    setUser(null)
    setPage('home')
  }

  function handleNewTransport() {
    var time = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    })
    setStartTimeHolder(time)
    setPage('transport')
  }

  function handleSave(transport) {
    var updated = [transport].concat(transports)
    setTransports(updated)
    setPage('home')
  }

  function handleClose() {
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
          startTime={startTimeHolder}
          onSave={handleSave}
          onClose={handleClose}
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