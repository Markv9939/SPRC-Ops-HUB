import { useState, useEffect, useMemo } from 'react'
import { db } from '../firebase'
import { collection, query, where, orderBy, onSnapshot, Timestamp, doc, setDoc, deleteDoc, getDocs, updateDoc, serverTimestamp, addDoc } from 'firebase/firestore'
import * as XLSX from 'xlsx'
import SupervisorEocPanel from './SupervisorEocPanel'
import CompliancePanel, { getStatus } from './CompliancePanel'
import { LOCATIONS, SHIFTS, VANS } from '../data/eocConstants'

const TAB_LABELS = {
  dashboard: '\u{1F4C8} Dashboard',
  transports: '\u{1F4CA} Transports',
  users: '\u{1F465} Users',
  assignments: '\u{1F4CB} Assignments',
  eoc: '\u{1F527} EOC',
  compliance: '\u{1F4CB} Compliance'
}
const TAB_KEYS = Object.keys(TAB_LABELS)

function SupervisorDashboard({ user, onNewTransport, onLogout, userName }) {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 600)
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

  // EOC Dashboard summary
  const [eocIssues, setEocIssues] = useState([])
  const [eocAssignments, setEocAssignments] = useState([])
  const [eocResolvingId, setEocResolvingId] = useState(null)
  const [eocResolveNotes, setEocResolveNotes] = useState('')

  // Compliance dashboard summary
  const [complianceItems, setComplianceItems] = useState([])

  // User Management
  const [users, setUsers] = useState([])
  const [editingUser, setEditingUser] = useState(null)
  const [userForm, setUserForm] = useState({ id: '', name: '', pin: '', role: 'tech', site: 'PHP', active: true })

  // Assignment Management
  const [bhtAssignments, setBhtAssignments] = useState([])
  const [editingAssignment, setEditingAssignment] = useState(null)
  const [assignmentForm, setAssignmentForm] = useState({
    bhtUserId: '', locationId: '', shiftId: '', vanIds: [], isHousePrimary: false, active: true
  })

  const isAdmin = user?.role === 'admin'

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 600px)')
    const handler = (e) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Real-time EOC issues + assignments for dashboard summary
  useEffect(() => {
    const unsubIssues = onSnapshot(
      query(collection(db, 'eocIssues'), where('status', '==', 'open'), orderBy('createdAt', 'desc')),
      (snap) => setEocIssues(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    const unsubAssignments = onSnapshot(
      query(collection(db, 'eocAssignments'), where('status', '==', 'missed'), orderBy('dueDate', 'desc')),
      (snap) => setEocAssignments(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    const unsubCompliance = onSnapshot(
      collection(db, 'complianceItems'),
      (snap) => setComplianceItems(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    return () => { unsubIssues(); unsubAssignments(); unsubCompliance() }
  }, [])

  // Load BHT Assignments
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'bhtAssignments'), orderBy('bhtUserName', 'asc')),
      (snap) => setBhtAssignments(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    return unsub
  }, [])

  const handleDashResolveIssue = async (issueId) => {
    try {
      await updateDoc(doc(db, 'eocIssues', issueId), {
        status: 'resolved',
        resolvedNotes: eocResolveNotes,
        resolvedAt: serverTimestamp()
      })
      setEocResolvingId(null)
      setEocResolveNotes('')
    } catch (err) {
      console.error('Error resolving issue:', err)
      alert('Failed to resolve issue')
    }
  }

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

  const techUsers = users.filter(u => u.role === 'tech' && u.active)

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
        authorizedLocations: userForm.authorizedLocations || null
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

  // Assignment handlers
  const handleAddAssignment = () => {
    setEditingAssignment('new')
    setAssignmentForm({ bhtUserId: '', locationId: '', shiftId: '', vanIds: [], isHousePrimary: false, active: true })
  }

  const handleEditAssignment = (a) => {
    setEditingAssignment(a.id)
    setAssignmentForm({
      bhtUserId: a.bhtUserId,
      locationId: a.locationId,
      shiftId: a.shiftId,
      vanIds: a.vanIds || [],
      isHousePrimary: a.isHousePrimary || false,
      active: a.active !== false
    })
  }

  const handleSaveAssignment = async () => {
    if (!assignmentForm.bhtUserId || !assignmentForm.locationId || !assignmentForm.shiftId) {
      alert('Please select a BHT, location, and shift')
      return
    }

    const selectedUser = users.find(u => u.id === assignmentForm.bhtUserId)
    if (!selectedUser) {
      alert('Selected user not found')
      return
    }

    // Validate: if isHousePrimary is true, check no other active assignment at same location+shift is also primary
    if (assignmentForm.isHousePrimary) {
      const conflicting = bhtAssignments.find(a =>
        a.active &&
        a.locationId === assignmentForm.locationId &&
        a.shiftId === assignmentForm.shiftId &&
        a.isHousePrimary &&
        a.id !== editingAssignment
      )
      if (conflicting) {
        alert(`${conflicting.bhtUserName} is already the House Primary for this location/shift. Remove their primary status first.`)
        return
      }
    }

    const payload = {
      bhtUserId: assignmentForm.bhtUserId,
      bhtUserName: selectedUser.name,
      locationId: assignmentForm.locationId,
      shiftId: assignmentForm.shiftId,
      vanIds: assignmentForm.vanIds,
      isHousePrimary: assignmentForm.isHousePrimary,
      active: assignmentForm.active
    }

    try {
      if (editingAssignment === 'new') {
        await addDoc(collection(db, 'bhtAssignments'), {
          ...payload,
          effectiveFrom: serverTimestamp(),
          effectiveTo: null,
          createdAt: serverTimestamp()
        })
      } else {
        await updateDoc(doc(db, 'bhtAssignments', editingAssignment), {
          ...payload,
          updatedAt: serverTimestamp()
        })
      }
      setEditingAssignment(null)
    } catch (err) {
      console.error('Error saving assignment:', err)
      alert('Failed to save assignment: ' + err.message)
    }
  }

  const handleDeleteAssignment = async (id) => {
    if (!confirm('Delete this assignment?')) return
    try {
      await deleteDoc(doc(db, 'bhtAssignments', id))
    } catch (err) {
      console.error('Error deleting assignment:', err)
      alert('Failed to delete assignment')
    }
  }

  const toggleVanId = (vanId) => {
    setAssignmentForm(prev => ({
      ...prev,
      vanIds: prev.vanIds.includes(vanId)
        ? prev.vanIds.filter(v => v !== vanId)
        : [...prev.vanIds, vanId]
    }))
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

  const complianceSummary = useMemo(() => {
    const summary = { overdue: 0, upcoming: 0, current: 0, none: 0, total: 0 }
    complianceItems.forEach(item => {
      const status = getStatus(item.dueDate)
      if (status === 'overdue') summary.overdue += 1
      else if (status === 'upcoming') summary.upcoming += 1
      else if (status === 'current') summary.current += 1
      else summary.none += 1
    })
    summary.total = complianceItems.length
    return summary
  }, [complianceItems])

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

  const selectStyle = {
    padding: '6px 10px',
    border: '2px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    fontSize: '13px',
    background: 'rgba(255,255,255,0.06)',
    color: '#e8e8e8'
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px'
      }}>
        <h2 style={{ margin: 0, color: '#e8e8e8' }}>
          {isAdmin ? 'Admin' : 'Supervisor'} Dashboard
        </h2>
      </div>

      {/* Tabs — dropdown on mobile, button strip on desktop */}
      {isMobile ? (
        <div style={{ marginBottom: '20px' }}>
          <select
            value={activeTab}
            onChange={(e) => setActiveTab(e.target.value)}
            style={{
              width: '100%',
              padding: '12px 16px',
              backgroundColor: 'rgba(229,57,53,0.15)',
              color: '#e8e8e8',
              border: '2px solid #E53935',
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
            {TAB_KEYS.map(tab => (
              <option key={tab} value={tab}>{TAB_LABELS[tab]}</option>
            ))}
          </select>
        </div>
      ) : (
        <div style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '20px',
          borderBottom: '2px solid rgba(255,255,255,0.08)',
          flexWrap: 'wrap'
        }}>
          {TAB_KEYS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '12px 24px',
                backgroundColor: activeTab === tab ? '#E53935' : 'transparent',
                color: activeTab === tab ? 'white' : '#8899aa',
                border: 'none',
                borderBottom: activeTab === tab ? '3px solid #E53935' : 'none',
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

      {/* EOC Tab */}
      {activeTab === 'eoc' && <SupervisorEocPanel />}

      {/* Compliance Tab */}
      {activeTab === 'compliance' && <CompliancePanel />}

      {/* Assignments Tab */}
      {activeTab === 'assignments' && (
        <div>
          <div style={{
            backgroundColor: 'rgba(255,255,255,0.05)',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '20px',
            border: '1px solid rgba(229,57,53,0.2)',
            backdropFilter: 'blur(12px)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', color: '#e8e8e8' }}>BHT Assignments ({bhtAssignments.length})</h3>
              <button
                onClick={handleAddAssignment}
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
                + New Assignment
              </button>
            </div>

            {editingAssignment && (
              <div style={{
                backgroundColor: 'rgba(255,255,255,0.03)',
                padding: '20px',
                borderRadius: '8px',
                marginBottom: '20px',
                border: '2px solid #E53935'
              }}>
                <h4 style={{ margin: '0 0 16px 0', color: '#e8e8e8' }}>
                  {editingAssignment === 'new' ? 'New Assignment' : 'Edit Assignment'}
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                  <div>
                    <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>BHT *</label>
                    <select
                      value={assignmentForm.bhtUserId}
                      onChange={(e) => setAssignmentForm({ ...assignmentForm, bhtUserId: e.target.value })}
                      disabled={editingAssignment !== 'new'}
                      style={selectStyle}
                    >
                      <option value="">Select BHT...</option>
                      {techUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>Location *</label>
                    <select
                      value={assignmentForm.locationId}
                      onChange={(e) => setAssignmentForm({ ...assignmentForm, locationId: e.target.value })}
                      style={selectStyle}
                    >
                      <option value="">Select Location...</option>
                      {LOCATIONS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>Shift *</label>
                    <select
                      value={assignmentForm.shiftId}
                      onChange={(e) => setAssignmentForm({ ...assignmentForm, shiftId: e.target.value })}
                      style={selectStyle}
                    >
                      <option value="">Select Shift...</option>
                      {SHIFTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>House Primary</label>
                    <select
                      value={assignmentForm.isHousePrimary ? 'true' : 'false'}
                      onChange={(e) => setAssignmentForm({ ...assignmentForm, isHousePrimary: e.target.value === 'true' })}
                      style={selectStyle}
                    >
                      <option value="false">No</option>
                      <option value="true">Yes</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>Active</label>
                    <select
                      value={assignmentForm.active ? 'true' : 'false'}
                      onChange={(e) => setAssignmentForm({ ...assignmentForm, active: e.target.value === 'true' })}
                      style={selectStyle}
                    >
                      <option value="true">Active</option>
                      <option value="false">Inactive</option>
                    </select>
                  </div>
                </div>

                <div style={{ marginTop: '12px' }}>
                  <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>Assigned Vans (multi-select)</label>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {VANS.map(v => (
                      <button
                        key={v.id}
                        className={`chip ${assignmentForm.vanIds.includes(v.id) ? 'chip-selected' : 'chip-unselected'}`}
                        onClick={() => toggleVanId(v.id)}
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                  <button
                    onClick={handleSaveAssignment}
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
                    Save
                  </button>
                  <button
                    onClick={() => setEditingAssignment(null)}
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
              {bhtAssignments.map(a => (
                <div
                  key={a.id}
                  style={{
                    padding: '16px',
                    borderRadius: '8px',
                    border: a.active ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(255,255,255,0.04)',
                    backgroundColor: a.active ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.01)',
                    opacity: a.active ? 1 : 0.6,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '4px' }}>
                      {a.bhtUserName}
                      {!a.active && <span style={{ color: '#999', fontSize: '11px', marginLeft: '8px' }}>INACTIVE</span>}
                    </div>
                    <div style={{ fontSize: '13px', color: '#8899aa' }}>
                      {LOCATIONS.find(l => l.id === a.locationId)?.label || a.locationId}
                      {' '}&bull;{' '}
                      {SHIFTS.find(s => s.id === a.shiftId)?.label || a.shiftId}
                      {a.vanIds?.length > 0 && (
                        <span> &bull; {a.vanIds.map(v => VANS.find(van => van.id === v)?.label || v).join(', ')}</span>
                      )}
                      {a.isHousePrimary && (
                        <span style={{ color: '#4CAF50', marginLeft: '8px' }}>House Primary</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => handleEditAssignment(a)}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: '#E53935',
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
                      onClick={() => handleDeleteAssignment(a.id)}
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
              {bhtAssignments.length === 0 && (
                <div style={{ textAlign: 'center', padding: '30px', color: '#556677' }}>
                  No assignments yet. Create one to assign a BHT to a location, shift, and van(s).
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* User Management Tab */}
      {activeTab === 'users' && (
        <div>
          <div style={{
            backgroundColor: 'rgba(255,255,255,0.05)',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '20px',
            border: '1px solid rgba(229,57,53,0.2)',
            backdropFilter: 'blur(12px)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', color: '#e8e8e8' }}>Users ({users.length})</h3>
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
                backgroundColor: 'rgba(255,255,255,0.03)',
                padding: '20px',
                borderRadius: '8px',
                marginBottom: '20px',
                border: '2px solid #E53935'
              }}>
                <h4 style={{ margin: '0 0 16px 0', color: '#e8e8e8' }}>
                  {editingUser === 'new' ? 'Add New User' : 'Edit User'}
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                  <div>
                    <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
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
                        border: '2px solid rgba(255,255,255,0.1)',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                        backgroundColor: editingUser !== 'new' ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.06)',
                        color: '#e8e8e8'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
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
                        border: '2px solid rgba(255,255,255,0.1)',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                        backgroundColor: 'rgba(255,255,255,0.06)',
                        color: '#e8e8e8'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
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
                        border: '2px solid rgba(255,255,255,0.1)',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                        backgroundColor: 'rgba(255,255,255,0.06)',
                        color: '#e8e8e8'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
                      Role
                    </label>
                    <select
                      value={userForm.role}
                      onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '8px',
                        border: '2px solid rgba(255,255,255,0.1)',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                        backgroundColor: 'rgba(255,255,255,0.06)',
                        color: '#e8e8e8'
                      }}
                    >
                      <option value="tech">Tech</option>
                      <option value="supervisor">Supervisor</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
                      Site
                    </label>
                    <select
                      value={userForm.site}
                      onChange={(e) => setUserForm({ ...userForm, site: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '8px',
                        border: '2px solid rgba(255,255,255,0.1)',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                        backgroundColor: 'rgba(255,255,255,0.06)',
                        color: '#e8e8e8'
                      }}
                    >
                      <option value="PHP">PHP</option>
                      <option value="RTC">RTC</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
                      Active
                    </label>
                    <select
                      value={userForm.active}
                      onChange={(e) => setUserForm({ ...userForm, active: e.target.value === 'true' })}
                      style={{
                        width: '100%',
                        padding: '8px',
                        border: '2px solid rgba(255,255,255,0.1)',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                        backgroundColor: 'rgba(255,255,255,0.06)',
                        color: '#e8e8e8'
                      }}
                    >
                      <option value="true">Active</option>
                      <option value="false">Inactive</option>
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
              {users.map(user => (
                <div
                  key={user.id}
                  style={{
                    padding: '16px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.08)',
                    backgroundColor: user.active ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.01)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px', flex: 1 }}>
                    <div>
                      <div style={{ fontSize: '11px', color: '#8899aa' }}>ID</div>
                      <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{user.id}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: '#8899aa' }}>Name</div>
                      <div style={{ fontSize: '14px' }}>{user.name}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: '#8899aa' }}>PIN</div>
                      <div style={{ fontSize: '14px', fontFamily: 'monospace' }}>{user.pin}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: '#8899aa' }}>Role</div>
                      <div style={{ fontSize: '14px', textTransform: 'capitalize' }}>{user.role}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: '#8899aa' }}>Site</div>
                      <div style={{ fontSize: '14px' }}>{user.site}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: '#8899aa' }}>Status</div>
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
                        backgroundColor: '#E53935',
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
          {/* EOC Summary */}
            {(eocIssues.length > 0 || eocAssignments.length > 0) && (
              <div style={{
                backgroundColor: 'rgba(255,255,255,0.05)',
              borderRadius: '12px',
              padding: '20px',
              marginBottom: '20px',
              border: '1px solid rgba(229,57,53,0.2)',
              backdropFilter: 'blur(12px)'
            }}>
              <h3 style={{ margin: '0 0 14px 0', fontSize: '16px', color: '#e8e8e8' }}>EOC Status</h3>

              {/* Count badges */}
              <div style={{ display: 'flex', gap: '12px', marginBottom: eocIssues.length > 0 ? '16px' : '0', flexWrap: 'wrap' }}>
                {eocIssues.length > 0 && (
                  <div style={{
                    padding: '10px 20px',
                    backgroundColor: 'rgba(255,87,34,0.15)',
                    borderRadius: '8px',
                    textAlign: 'center',
                    border: '1px solid rgba(255,87,34,0.3)'
                  }}>
                    <div style={{ fontSize: '12px', color: '#FF5722' }}>Open Issues</div>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#FF5722' }}>{eocIssues.length}</div>
                  </div>
                )}
                {eocAssignments.length > 0 && (
                  <div style={{
                    padding: '10px 20px',
                    backgroundColor: 'rgba(255,152,0,0.15)',
                    borderRadius: '8px',
                    textAlign: 'center',
                    border: '1px solid rgba(255,152,0,0.3)'
                  }}>
                    <div style={{ fontSize: '12px', color: '#FF9800' }}>Missed Assignments</div>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#FF9800' }}>{eocAssignments.length}</div>
                  </div>
                )}
              </div>

              {/* Inline open issues list with resolve */}
              {eocIssues.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {eocIssues.map(issue => (
                    <div key={issue.id} style={{
                      padding: '12px',
                      borderRadius: '8px',
                      border: issue.severity === 'high' ? '2px solid #FF5722' : '1px solid rgba(255,255,255,0.08)',
                      backgroundColor: 'rgba(255,255,255,0.04)'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontWeight: 700, fontSize: '14px' }}>{issue.label}</span>
                        <span className={`chip severity-${issue.severity}`} style={{ fontSize: '11px', textTransform: 'capitalize' }}>
                          {issue.severity}
                        </span>
                      </div>
                      <div style={{ fontSize: '13px', color: '#8899aa', marginBottom: '4px' }}>{issue.description}</div>
                      <div style={{ fontSize: '12px', color: '#556677', marginBottom: '8px' }}>
                        {LOCATIONS.find(l => l.id === issue.locationId)?.label || issue.locationId} &bull; {issue.reportedByName}
                        {issue.vanId ? ` \u00B7 ${VANS.find(v => v.id === issue.vanId)?.label || issue.vanId}` : ''}
                      </div>

                      {eocResolvingId === issue.id ? (
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <input
                            className="input"
                            placeholder="Resolution notes..."
                            value={eocResolveNotes}
                            onChange={e => setEocResolveNotes(e.target.value)}
                            style={{ flex: 1, padding: '6px 10px', fontSize: '13px' }}
                          />
                          <button
                            onClick={() => handleDashResolveIssue(issue.id)}
                            style={{
                              padding: '6px 14px', backgroundColor: '#4CAF50', color: 'white',
                              border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
                              cursor: 'pointer'
                            }}
                          >
                            Resolve
                          </button>
                          <button
                            onClick={() => { setEocResolvingId(null); setEocResolveNotes('') }}
                            style={{
                              padding: '6px 14px', backgroundColor: 'rgba(255,255,255,0.06)', color: '#8899aa',
                              border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer'
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setEocResolvingId(issue.id)}
                          style={{
                            padding: '6px 14px', backgroundColor: 'rgba(255,255,255,0.06)', color: '#e8e8e8',
                            border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
                            cursor: 'pointer'
                          }}
                        >
                          Mark Resolved
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                )}
              </div>
            )}

            {/* Compliance Summary */}
            {complianceSummary.total > 0 && (
              <div style={{
                backgroundColor: 'rgba(255,255,255,0.05)',
                borderRadius: '12px',
                padding: '20px',
                marginBottom: '20px',
                border: '1px solid rgba(229,57,53,0.2)',
                backdropFilter: 'blur(12px)'
              }}>
                <h3 style={{ margin: '0 0 14px 0', fontSize: '16px', color: '#e8e8e8' }}>Compliance Status</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                  <div style={{
                    padding: '10px 20px',
                    backgroundColor: 'rgba(244,67,54,0.15)',
                    borderRadius: '8px',
                    textAlign: 'center',
                    border: '1px solid rgba(244,67,54,0.3)'
                  }}>
                    <div style={{ fontSize: '12px', color: '#f44336' }}>Overdue</div>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#f44336' }}>{complianceSummary.overdue}</div>
                  </div>
                  <div style={{
                    padding: '10px 20px',
                    backgroundColor: 'rgba(255,152,0,0.15)',
                    borderRadius: '8px',
                    textAlign: 'center',
                    border: '1px solid rgba(255,152,0,0.3)'
                  }}>
                    <div style={{ fontSize: '12px', color: '#FF9800' }}>Due Soon</div>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#FF9800' }}>{complianceSummary.upcoming}</div>
                  </div>
                  <div style={{
                    padding: '10px 20px',
                    backgroundColor: 'rgba(76,175,80,0.15)',
                    borderRadius: '8px',
                    textAlign: 'center',
                    border: '1px solid rgba(76,175,80,0.3)'
                  }}>
                    <div style={{ fontSize: '12px', color: '#4CAF50' }}>Current</div>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#4CAF50' }}>{complianceSummary.current}</div>
                  </div>
                  {complianceSummary.none > 0 && (
                    <div style={{
                      padding: '10px 20px',
                      backgroundColor: 'rgba(255,255,255,0.04)',
                      borderRadius: '8px',
                      textAlign: 'center',
                      border: '1px solid rgba(255,255,255,0.1)'
                    }}>
                      <div style={{ fontSize: '12px', color: '#8899aa' }}>No Due Date</div>
                      <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#e8e8e8' }}>{complianceSummary.none}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Filter row */}
            <div style={{
              backgroundColor: 'rgba(255,255,255,0.05)',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '20px',
            border: '1px solid rgba(229,57,53,0.2)',
            backdropFilter: 'blur(12px)'
          }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '12px',
              alignItems: 'center'
            }}>
              <div>
                <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
                  Month
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    onClick={() => setDashMonth(new Date(dashMonth.getFullYear(), dashMonth.getMonth() - 1, 1))}
                    style={{
                      padding: '8px 12px',
                      backgroundColor: '#E53935',
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
                      backgroundColor: '#E53935',
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
                <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
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
            <div style={{ textAlign: 'center', padding: '60px', color: '#556677' }}>
              Loading stats...
            </div>
          ) : dashStats.total === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px', color: '#556677' }}>
              No transports in this period
            </div>
          ) : (
            <>
              {/* Total card */}
              <div className="glass-card" style={{
                backgroundColor: 'rgba(255,255,255,0.05)',
                borderRadius: '12px',
                padding: '20px',
                marginBottom: '20px',
                border: '1px solid #eee',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '12px', color: '#8899aa', marginBottom: '4px' }}>Total Transports</div>
                <div style={{ fontSize: '36px', fontWeight: 'bold', color: '#E53935' }}>{dashStats.total}</div>
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
                  backgroundColor: 'rgba(255,255,255,0.05)',
                  borderRadius: '12px',
                  padding: '20px',
                  border: '1px solid #eee'
                }}>
                  <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', color: '#e8e8e8' }}>By Reason</h3>
                  {dashStats.byReason.length === 0 ? (
                    <div style={{ color: '#556677', fontSize: '14px' }}>No reasons recorded</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {dashStats.byReason.map(([reason, count]) => (
                        <div key={reason} style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px 12px',
                          backgroundColor: 'rgba(255,255,255,0.04)',
                          borderRadius: '6px'
                        }}>
                          <span style={{ fontSize: '14px' }}>{reason}</span>
                          <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#E53935' }}>{count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* By Tech */}
                <div className="glass-card" style={{
                  backgroundColor: 'rgba(255,255,255,0.05)',
                  borderRadius: '12px',
                  padding: '20px',
                  border: '1px solid #eee'
                }}>
                  <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', color: '#e8e8e8' }}>By Tech</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {dashStats.byTech.map(([tech, count]) => (
                      <div key={tech} style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 12px',
                        backgroundColor: 'rgba(255,255,255,0.04)',
                        borderRadius: '6px'
                      }}>
                        <span style={{ fontSize: '14px' }}>{tech}</span>
                        <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#E53935' }}>{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* DC Paperwork */}
              <div className="glass-card" style={{
                backgroundColor: 'rgba(255,255,255,0.05)',
                borderRadius: '12px',
                padding: '20px',
                border: '1px solid rgba(229,57,53,0.2)',
                backdropFilter: 'blur(12px)'
              }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', color: '#e8e8e8' }}>DC Paperwork</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                  {dashStats.byPaperwork.map(([status, count]) => (
                    <div key={status} style={{
                      padding: '10px 20px',
                      backgroundColor:
                        status === 'collected' ? 'rgba(76,175,80,0.15)' :
                        status === 'N/A' ? 'rgba(255,255,255,0.04)' :
                        status === 'unknown' ? 'rgba(255,152,0,0.15)' :
                        'rgba(229,57,53,0.15)',
                      borderRadius: '8px',
                      textAlign: 'center'
                    }}>
                      <div style={{ fontSize: '12px', color: '#8899aa', textTransform: 'capitalize' }}>{status}</div>
                      <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#e8e8e8' }}>{count}</div>
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
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderRadius: '12px',
        padding: '20px',
        marginBottom: '20px',
        border: '1px solid #eee'
      }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', color: '#e8e8e8' }}>Filters</h3>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '12px',
          marginBottom: '12px'
        }}>
          <div>
            <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
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
            <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
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
            <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
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
            <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
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
          <label style={{ fontSize: '12px', color: '#8899aa', display: 'block', marginBottom: '4px' }}>
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
            backgroundColor: filteredTransports.length > 0 ? '#4CAF50' : 'rgba(255,255,255,0.06)',
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
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderRadius: '12px',
        padding: '20px',
        border: '1px solid #eee'
      }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', color: '#e8e8e8' }}>
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
                  border: isOverdue(t) ? '2px solid #FF5722' : '1px solid rgba(255,255,255,0.08)',
                  backgroundColor: 'rgba(255,255,255,0.03)',
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
                    <div style={{ fontSize: '11px', color: '#8899aa' }}>Date</div>
                    <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{formatDate(t.departedAt)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: '#8899aa' }}>Driver</div>
                    <div style={{ fontSize: '14px' }}>{t.createdByName}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: '#8899aa' }}>Client(s)</div>
                    <div style={{ fontSize: '14px' }}>{t.clients?.join(', ') || 'None'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: '#8899aa' }}>Stops</div>
                    <div style={{ fontSize: '14px' }}>{t.stops?.length || 0}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: '#8899aa' }}>Status</div>
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
