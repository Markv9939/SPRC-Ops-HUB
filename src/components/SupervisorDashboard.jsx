import { useState, useEffect, useMemo } from 'react'
import { db } from '../firebase'
import { collection, query, where, orderBy, onSnapshot, Timestamp, doc, setDoc, deleteDoc, getDocs } from 'firebase/firestore'
import * as XLSX from 'xlsx'
import SupervisorEocPanel from './SupervisorEocPanel'
import { LOCATIONS, SHIFTS, VANS } from '../data/eocConstants'

function SupervisorDashboard({ onNewTransport, onLogout, userName }) {
  const [activeTab, setActiveTab] = useState('transports') // 'transports', 'users', 'dashboard', or 'eoc'
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
  const [selectedDriver, setSelectedDriver] = useState('')
  const [overdueFilter, setOverdueFilter] = useState('all')
  const [clientSearch, setClientSearch] = useState('')

  const [drivers, setDrivers] = useState([])

  // User Management
  const [users, setUsers] = useState([])
  const [editingUser, setEditingUser] = useState(null)
  const [userForm, setUserForm] = useState({ id: '', name: '', pin: '', role: 'tech', site: 'PHP', active: true, locationId: '', shiftId: '', vanId: '' })

  useEffect(() => {
    // Set default to current month
    const now = new Date()
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0)

    setStartDate(firstDay.toISOString().split('T')[0])
    setEndDate(lastDay.toISOString().split('T')[0])

    // Load users
    loadUsers()
  }, [])

  const loadUsers = async () => {
    const usersSnapshot = await getDocs(collection(db, 'users'))
    const usersData = usersSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }))
    setUsers(usersData)
  }

  const handleAddUser = () => {
    setEditingUser('new')
    setUserForm({ id: '', name: '', pin: '', role: 'tech', site: 'PHP', active: true })
  }

  const handleEditUser = (user) => {
    setEditingUser(user.id)
    setUserForm({ ...user })
  }

  const handleSaveUser = async () => {
    if (!userForm.id || !userForm.name || !userForm.pin) {
      alert('Please fill in all required fields (ID, Name, PIN)')
      return
    }

    if (userForm.pin.length !== 4 || !/^\d+$/.test(userForm.pin)) {
      alert('PIN must be exactly 4 digits')
      return
    }

    try {
      await setDoc(doc(db, 'users', userForm.id), {
        name: userForm.name,
        pin: userForm.pin,
        role: userForm.role,
        site: userForm.site,
        active: userForm.active,
        locationId: userForm.locationId || null,
        shiftId: userForm.shiftId || null,
        vanId: userForm.vanId || null
      })
      alert('User saved successfully!')
      setEditingUser(null)
      loadUsers()
    } catch (error) {
      console.error('Error saving user:', error)
      alert('Error saving user: ' + error.message)
    }
  }

  const handleDeleteUser = async (userId) => {
    if (!confirm(`Are you sure you want to delete user ${userId}?`)) return

    try {
      await deleteDoc(doc(db, 'users', userId))
      alert('User deleted successfully!')
      loadUsers()
    } catch (error) {
      console.error('Error deleting user:', error)
      alert('Error deleting user: ' + error.message)
    }
  }

  const handleCancelEdit = () => {
    setEditingUser(null)
    setUserForm({ id: '', name: '', pin: '', role: 'tech', site: 'PHP', active: true })
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
        let data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))

        // Client-side filters
        data = data.filter(t => t.status === 'returned' || t.status === 'closed')
        if (dashSite !== 'ALL') {
          data = data.filter(t => t.site === dashSite)
        }

        setDashTransports(data)
      } catch (error) {
        console.error('Error fetching dashboard data:', error)
        setDashTransports([])
      }
      setDashLoading(false)
    }

    fetchDashData()
  }, [activeTab, dashMonth, dashSite])

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
      // Tech
      const tech = t.createdByName || 'Unknown'
      techCounts[tech] = (techCounts[tech] || 0) + 1
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
    const data = filteredTransports.map(t => {
      // Format destinations as "Name (Address)" or just "Address"
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
        'Site': t.site || '',
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

      {/* Tabs */}
      <div style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '20px',
        borderBottom: '2px solid #eee'
      }}>
        <button
          onClick={() => setActiveTab('transports')}
          style={{
            padding: '12px 24px',
            backgroundColor: activeTab === 'transports' ? '#2196F3' : 'transparent',
            color: activeTab === 'transports' ? 'white' : '#666',
            border: 'none',
            borderBottom: activeTab === 'transports' ? '3px solid #2196F3' : 'none',
            borderRadius: '8px 8px 0 0',
            fontSize: '14px',
            fontWeight: 'bold',
            cursor: 'pointer',
            marginBottom: '-2px'
          }}
        >
          📊 Transports
        </button>
        <button
          onClick={() => setActiveTab('users')}
          style={{
            padding: '12px 24px',
            backgroundColor: activeTab === 'users' ? '#2196F3' : 'transparent',
            color: activeTab === 'users' ? 'white' : '#666',
            border: 'none',
            borderBottom: activeTab === 'users' ? '3px solid #2196F3' : 'none',
            borderRadius: '8px 8px 0 0',
            fontSize: '14px',
            fontWeight: 'bold',
            cursor: 'pointer',
            marginBottom: '-2px'
          }}
        >
          👥 Manage Users
        </button>
        <button
          onClick={() => setActiveTab('dashboard')}
          style={{
            padding: '12px 24px',
            backgroundColor: activeTab === 'dashboard' ? '#2196F3' : 'transparent',
            color: activeTab === 'dashboard' ? 'white' : '#666',
            border: 'none',
            borderBottom: activeTab === 'dashboard' ? '3px solid #2196F3' : 'none',
            borderRadius: '8px 8px 0 0',
            fontSize: '14px',
            fontWeight: 'bold',
            cursor: 'pointer',
            marginBottom: '-2px'
          }}
        >
          📈 Dashboard
        </button>
        <button
          onClick={() => setActiveTab('eoc')}
          style={{
            padding: '12px 24px',
            backgroundColor: activeTab === 'eoc' ? '#2196F3' : 'transparent',
            color: activeTab === 'eoc' ? 'white' : '#666',
            border: 'none',
            borderBottom: activeTab === 'eoc' ? '3px solid #2196F3' : 'none',
            borderRadius: '8px 8px 0 0',
            fontSize: '14px',
            fontWeight: 'bold',
            cursor: 'pointer',
            marginBottom: '-2px'
          }}
        >
          🔧 EOC
        </button>
      </div>

      {/* EOC Tab */}
      {activeTab === 'eoc' && <SupervisorEocPanel />}

      {/* User Management Tab */}
      {activeTab === 'users' && (
        <div>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '20px',
            border: '1px solid #eee'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', color: '#333' }}>Users ({users.length})</h3>
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

            {editingUser && (
              <div style={{
                backgroundColor: '#f5f5f5',
                padding: '20px',
                borderRadius: '8px',
                marginBottom: '20px',
                border: '2px solid #2196F3'
              }}>
                <h4 style={{ margin: '0 0 16px 0', color: '#333' }}>
                  {editingUser === 'new' ? 'Add New User' : 'Edit User'}
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                  <div>
                    <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>
                      User ID *
                    </label>
                    <input
                      type="text"
                      value={userForm.id}
                      onChange={(e) => setUserForm({ ...userForm, id: e.target.value })}
                      disabled={editingUser !== 'new'}
                      placeholder="e.g., tech3"
                      style={{
                        width: '100%',
                        padding: '8px',
                        border: '2px solid #eee',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                        backgroundColor: editingUser !== 'new' ? '#f0f0f0' : 'white'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>
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
                        border: '2px solid #eee',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>
                      PIN (4 digits) *
                    </label>
                    <input
                      type="text"
                      value={userForm.pin}
                      onChange={(e) => setUserForm({ ...userForm, pin: e.target.value })}
                      placeholder="1234"
                      maxLength="4"
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
                      Role
                    </label>
                    <select
                      value={userForm.role}
                      onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '8px',
                        border: '2px solid #eee',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box'
                      }}
                    >
                      <option value="tech">Tech</option>
                      <option value="supervisor">Supervisor</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>
                      Site
                    </label>
                    <select
                      value={userForm.site}
                      onChange={(e) => setUserForm({ ...userForm, site: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '8px',
                        border: '2px solid #eee',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box'
                      }}
                    >
                      <option value="PHP">PHP</option>
                      <option value="RTC">RTC</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>
                      Active
                    </label>
                    <select
                      value={userForm.active}
                      onChange={(e) => setUserForm({ ...userForm, active: e.target.value === 'true' })}
                      style={{
                        width: '100%',
                        padding: '8px',
                        border: '2px solid #eee',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box'
                      }}
                    >
                      <option value="true">Active</option>
                      <option value="false">Inactive</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>
                      EOC Location
                    </label>
                    <select
                      value={userForm.locationId || ''}
                      onChange={(e) => setUserForm({ ...userForm, locationId: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '8px',
                        border: '2px solid #eee',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box'
                      }}
                    >
                      <option value="">None</option>
                      {LOCATIONS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>
                      Shift
                    </label>
                    <select
                      value={userForm.shiftId || ''}
                      onChange={(e) => setUserForm({ ...userForm, shiftId: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '8px',
                        border: '2px solid #eee',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box'
                      }}
                    >
                      <option value="">None</option>
                      {SHIFTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>
                      Van
                    </label>
                    <select
                      value={userForm.vanId || ''}
                      onChange={(e) => setUserForm({ ...userForm, vanId: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '8px',
                        border: '2px solid #eee',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box'
                      }}
                    >
                      <option value="">None</option>
                      {VANS.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </select>
                  </div>
                </div>
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
                    💾 Save
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
              {users.map(user => (
                <div
                  key={user.id}
                  style={{
                    padding: '16px',
                    borderRadius: '8px',
                    border: '1px solid #eee',
                    backgroundColor: user.active ? '#fafafa' : '#f0f0f0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px', flex: 1 }}>
                    <div>
                      <div style={{ fontSize: '11px', color: '#888' }}>ID</div>
                      <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{user.id}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: '#888' }}>Name</div>
                      <div style={{ fontSize: '14px' }}>{user.name}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: '#888' }}>PIN</div>
                      <div style={{ fontSize: '14px', fontFamily: 'monospace' }}>{user.pin}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: '#888' }}>Role</div>
                      <div style={{ fontSize: '14px', textTransform: 'capitalize' }}>{user.role}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: '#888' }}>Site</div>
                      <div style={{ fontSize: '14px' }}>{user.site}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: '#888' }}>Status</div>
                      <div style={{
                        fontSize: '12px',
                        fontWeight: 'bold',
                        color: user.active ? '#4CAF50' : '#999'
                      }}>
                        {user.active ? 'ACTIVE' : 'INACTIVE'}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginLeft: '16px' }}>
                    <button
                      onClick={() => handleEditUser(user)}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: '#2196F3',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        cursor: 'pointer'
                      }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteUser(user.id)}
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
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Dashboard Tab */}
      {activeTab === 'dashboard' && (
        <div>
          {/* Filter row */}
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '20px',
            border: '1px solid #eee'
          }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '12px',
              alignItems: 'center'
            }}>
              <div>
                <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>
                  Month
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    onClick={() => setDashMonth(new Date(dashMonth.getFullYear(), dashMonth.getMonth() - 1, 1))}
                    style={{
                      padding: '8px 12px',
                      backgroundColor: '#2196F3',
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
                      backgroundColor: '#2196F3',
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
                <label style={{ fontSize: '12px', color: '#888', display: 'block', marginBottom: '4px' }}>
                  Site
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
                  <option value="ALL">All Sites</option>
                  <option value="PHP">PHP</option>
                  <option value="RTC">RTC</option>
                </select>
              </div>
            </div>
          </div>

          {dashLoading ? (
            <div style={{ textAlign: 'center', padding: '60px', color: '#aaa' }}>
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>⏳</div>
              Loading stats...
            </div>
          ) : dashStats.total === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px', color: '#aaa' }}>
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>📭</div>
              No transports in this period
            </div>
          ) : (
            <>
              {/* Total card */}
              <div className="glass-card" style={{
                backgroundColor: 'white',
                borderRadius: '12px',
                padding: '20px',
                marginBottom: '20px',
                border: '1px solid #eee',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>Total Transports</div>
                <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#2196F3' }}>{dashStats.total}</div>
              </div>

              {/* Two-column breakdown */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '20px',
                marginBottom: '20px'
              }}>
                {/* By Reason */}
                <div className="glass-card" style={{
                  backgroundColor: 'white',
                  borderRadius: '12px',
                  padding: '20px',
                  border: '1px solid #eee'
                }}>
                  <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', color: '#333' }}>By Reason</h3>
                  {dashStats.byReason.length === 0 ? (
                    <div style={{ color: '#aaa', fontSize: '14px' }}>No reasons recorded</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {dashStats.byReason.map(([reason, count]) => (
                        <div key={reason} style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px 12px',
                          backgroundColor: '#f5f5f5',
                          borderRadius: '6px'
                        }}>
                          <span style={{ fontSize: '14px' }}>{reason}</span>
                          <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#2196F3' }}>{count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* By Tech */}
                <div className="glass-card" style={{
                  backgroundColor: 'white',
                  borderRadius: '12px',
                  padding: '20px',
                  border: '1px solid #eee'
                }}>
                  <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', color: '#333' }}>By Tech</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {dashStats.byTech.map(([tech, count]) => (
                      <div key={tech} style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 12px',
                        backgroundColor: '#f5f5f5',
                        borderRadius: '6px'
                      }}>
                        <span style={{ fontSize: '14px' }}>{tech}</span>
                        <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#2196F3' }}>{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* DC Paperwork */}
              <div className="glass-card" style={{
                backgroundColor: 'white',
                borderRadius: '12px',
                padding: '20px',
                border: '1px solid #eee'
              }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', color: '#333' }}>DC Paperwork</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                  {dashStats.byPaperwork.map(([status, count]) => (
                    <div key={status} style={{
                      padding: '10px 20px',
                      backgroundColor:
                        status === 'collected' ? '#E8F5E9' :
                        status === 'N/A' ? '#F5F5F5' :
                        status === 'unknown' ? '#FFF3E0' :
                        '#E3F2FD',
                      borderRadius: '8px',
                      textAlign: 'center'
                    }}>
                      <div style={{ fontSize: '12px', color: '#666', textTransform: 'capitalize' }}>{status}</div>
                      <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#333' }}>{count}</div>
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
      )}
    </div>
  )
}

export default SupervisorDashboard
