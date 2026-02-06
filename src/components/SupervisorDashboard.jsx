import { useState, useEffect } from 'react'
import { db } from '../firebase'
import { collection, query, where, orderBy, onSnapshot, Timestamp } from 'firebase/firestore'
import * as XLSX from 'xlsx'

function SupervisorDashboard({ onNewTransport, onLogout, userName }) {
  const [transports, setTransports] = useState([])
  const [filteredTransports, setFilteredTransports] = useState([])

  // Filters
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [selectedDriver, setSelectedDriver] = useState('')
  const [overdueFilter, setOverdueFilter] = useState('all')
  const [clientSearch, setClientSearch] = useState('')

  const [drivers, setDrivers] = useState([])

  useEffect(() => {
    // Set default to current month
    const now = new Date()
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0)

    setStartDate(firstDay.toISOString().split('T')[0])
    setEndDate(lastDay.toISOString().split('T')[0])
  }, [])

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
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }))
      setTransports(data)

      // Extract unique drivers
      const uniqueDrivers = [...new Set(data.map(t => t.createdByName))].filter(Boolean)
      setDrivers(uniqueDrivers)
    })

    return () => unsubscribe()
  }, [startDate, endDate])

  useEffect(() => {
    let filtered = [...transports]

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
  }, [transports, selectedDriver, overdueFilter, clientSearch])

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

  const exportToExcel = () => {
    const data = filteredTransports.map(t => ({
      'Date': formatDate(t.departedAt),
      'Departed': formatTime(t.departedAt),
      'Returned': formatTime(t.returnedAt),
      'Driver': t.createdByName || '',
      'Site': t.site || '',
      'Clients': t.clients?.join(', ') || '',
      'Reasons': t.reasons?.join(', ') || '',
      'Stops': t.stops?.map((s, i) => `${i + 1}. ${s.destinationAddress}`).join(' | ') || '',
      'Status': t.status || '',
      'Overdue': isOverdue(t) ? 'YES' : 'NO',
      'Notes': t.notes || ''
    }))

    const worksheet = XLSX.utils.json_to_sheet(data)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Transports')

    const filename = `transports_${startDate}_to_${endDate}.xlsx`
    XLSX.writeFile(workbook, filename)
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px'
      }}>
        <h2 style={{ margin: 0, color: '#333' }}>Supervisor Dashboard</h2>
      </div>

      {/* Filters */}
      <div style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        padding: '20px',
        marginBottom: '20px',
        border: '1px solid #eee'
      }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', color: '#333' }}>Filters</h3>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '12px',
          marginBottom: '12px'
        }}>
          <div>
            <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>
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
            <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>
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
            <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>
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
            <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>
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
          <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>
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
            backgroundColor: filteredTransports.length > 0 ? '#4CAF50' : '#e8e8e8',
            color: filteredTransports.length > 0 ? 'white' : '#999',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 'bold',
            cursor: filteredTransports.length > 0 ? 'pointer' : 'not-allowed'
          }}
        >
          📊 Export to Excel ({filteredTransports.length})
        </button>
      </div>

      {/* Results */}
      <div style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        padding: '20px',
        border: '1px solid #eee'
      }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', color: '#333' }}>
          Transports ({filteredTransports.length})
        </h3>

        {filteredTransports.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#aaa' }}>
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
                  border: isOverdue(t) ? '2px solid #FF5722' : '1px solid #eee',
                  backgroundColor: '#fafafa',
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
                    <div style={{ fontSize: '11px', color: '#888' }}>Date</div>
                    <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{formatDate(t.departedAt)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: '#888' }}>Driver</div>
                    <div style={{ fontSize: '14px' }}>{t.createdByName}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: '#888' }}>Client(s)</div>
                    <div style={{ fontSize: '14px' }}>{t.clients?.join(', ') || 'None'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: '#888' }}>Stops</div>
                    <div style={{ fontSize: '14px' }}>{t.stops?.length || 0}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: '#888' }}>Status</div>
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
  )
}

export default SupervisorDashboard
