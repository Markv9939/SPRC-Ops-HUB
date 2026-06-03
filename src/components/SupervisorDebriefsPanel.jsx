import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, orderBy, query, Timestamp, where } from 'firebase/firestore'
import { db } from '../firebase'
import DebriefGroupedReadView from './DebriefGroupedReadView'
import {
  CONFIRMATION_ITEMS,
  DEBRIEFS_COLLECTION
} from '../services/shiftDebriefService'
import { getShiftLabel } from '../data/eocConstants'

function dateKey(date) {
  return date.toISOString().slice(0, 10)
}

function toDate(value) {
  if (!value) return null
  if (value.toDate) return value.toDate()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDateTime(value) {
  const date = toDate(value)
  if (!date) return '--'
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

function locationLabel(locationId) {
  if (locationId === 'mesquite') return 'Mesquite House'
  if (locationId === 'lone_mountain') return 'Lone Mountain'
  return locationId || '--'
}

function DebriefDetail({ debrief }) {
  const items = Array.isArray(debrief.items) ? debrief.items : []
  const extraNotes = Array.isArray(debrief.extraNotes) ? debrief.extraNotes : []
  const confirmation = debrief.confirmation || {}

  return (
    <div style={styles.detail}>
      <div style={styles.sectionTitle}>Handoff Notes</div>
      {items.length === 0 ? (
        <div style={styles.emptyText}>No handoff notes.</div>
      ) : (
        <DebriefGroupedReadView items={items} emptyText="No handoff notes." />
      )}

      <div style={styles.sectionTitle}>Extra Notes / Corrections</div>
      {extraNotes.length === 0 ? (
        <div style={styles.emptyText}>No extra notes.</div>
      ) : (
        <div style={styles.stack}>
          {extraNotes.map(note => (
            <div key={note.id} style={styles.noteCard}>
              <div style={styles.noteHeader}>
                <strong>{note.createdByName || 'BHT'}</strong>
                <span>{formatDateTime(note.createdAtIso)}</span>
              </div>
              <div style={styles.noteText}>{note.note}</div>
            </div>
          ))}
        </div>
      )}

      <div style={styles.sectionTitle}>Incoming Staff Confirmation</div>
      <div style={styles.checkGrid}>
        {CONFIRMATION_ITEMS.map(item => (
          <div key={item.id} style={{
            ...styles.checkItem,
            ...(confirmation[item.id] === true ? styles.checkItemDone : {})
          }}>
            {confirmation[item.id] === true ? 'Yes' : 'No'} - {item.label}
          </div>
        ))}
      </div>
      <div style={styles.confirmLine}>
        Initials: {confirmation.incomingStaffInitials || '--'}
        {debrief.confirmed ? ` | Confirmed by ${confirmation.confirmedByName || 'incoming staff'} on ${formatDateTime(confirmation.confirmedAt)}` : ''}
      </div>
    </div>
  )
}

export default function SupervisorDebriefsPanel({ inEocScope, focusedDebriefId = null }) {
  const now = useMemo(() => new Date(), [])
  const [startDate, setStartDate] = useState(() => dateKey(new Date(now.getFullYear(), now.getMonth(), 1)))
  const [endDate, setEndDate] = useState(() => dateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0)))
  const [houseFilter, setHouseFilter] = useState('all')
  const [shiftFilter, setShiftFilter] = useState('all')
  const [confirmationFilter, setConfirmationFilter] = useState('all')
  const [debriefs, setDebriefs] = useState([])
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => {
    if (!startDate || !endDate) return undefined
    const start = Timestamp.fromDate(new Date(`${startDate}T00:00:00`))
    const end = Timestamp.fromDate(new Date(`${endDate}T23:59:59`))
    const q = query(
      collection(db, DEBRIEFS_COLLECTION),
      where('submittedAt', '>=', start),
      where('submittedAt', '<=', end),
      orderBy('submittedAt', 'desc')
    )

    const unsubscribe = onSnapshot(q, (snap) => {
      const rows = snap.docs
        .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
        .filter(row => inEocScope(row.locationId))
      setDebriefs(rows)
    })
    return () => unsubscribe()
  }, [endDate, inEocScope, startDate])

  const filtered = debriefs.filter(debrief => {
    if (houseFilter !== 'all' && debrief.locationId !== houseFilter) return false
    if (shiftFilter !== 'all' && debrief.shiftId !== shiftFilter) return false
    if (confirmationFilter === 'confirmed' && debrief.confirmed !== true) return false
    if (confirmationFilter === 'pending' && debrief.confirmed === true) return false
    return true
  })

  const shiftOptions = [...new Set(debriefs.map(row => row.shiftId).filter(Boolean))]
    .sort()
  const currentExpandedId = expandedId || focusedDebriefId

  return (
    <div>
      <div style={styles.filters}>
        <div style={styles.filterHeader}>
          <h3 style={styles.title}>Debrief Filters</h3>
          <button
            type="button"
            onClick={() => {
              setHouseFilter('all')
              setShiftFilter('all')
              setConfirmationFilter('all')
            }}
            style={styles.clearButton}
          >
            Clear Filters
          </button>
        </div>

        <div style={styles.filterGrid}>
          <label style={styles.filterLabel}>
            Start Date
            <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label style={styles.filterLabel}>
            End Date
            <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
          <label style={styles.filterLabel}>
            House
            <select className="input" value={houseFilter} onChange={(e) => setHouseFilter(e.target.value)}>
              <option value="all">All Houses</option>
              <option value="mesquite">Mesquite House</option>
              <option value="lone_mountain">Lone Mountain</option>
            </select>
          </label>
          <label style={styles.filterLabel}>
            Shift
            <select className="input" value={shiftFilter} onChange={(e) => setShiftFilter(e.target.value)}>
              <option value="all">All Shifts</option>
              {shiftOptions.map(shiftId => (
                <option key={shiftId} value={shiftId}>{getShiftLabel(shiftId)}</option>
              ))}
            </select>
          </label>
          <label style={styles.filterLabel}>
            Confirmation
            <select className="input" value={confirmationFilter} onChange={(e) => setConfirmationFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="pending">Pending confirmation</option>
              <option value="confirmed">Confirmed</option>
            </select>
          </label>
        </div>
      </div>

      <div style={styles.results}>
        <h3 style={styles.title}>Debriefs ({filtered.length})</h3>
        {filtered.length === 0 ? (
          <div style={styles.emptyState}>No debriefs found.</div>
        ) : (
          <div style={styles.stack}>
            {filtered.map(debrief => (
              <div key={debrief.id} style={{
                ...styles.card,
                ...(focusedDebriefId === debrief.id ? styles.focusedCard : {})
              }}>
                <button
                  type="button"
                  onClick={() => setExpandedId(prev => (prev === debrief.id ? null : debrief.id))}
                  style={styles.cardButton}
                >
                  <div>
                    <div style={styles.cardTitle}>
                      {locationLabel(debrief.locationId)} - {getShiftLabel(debrief.shiftId)}
                    </div>
                    <div style={styles.cardMeta}>
                      Submitted {formatDateTime(debrief.submittedAt)} by {debrief.submittedByName || debrief.draftByName || 'BHT'}
                    </div>
                  </div>
                  <div style={styles.badges}>
                    <span style={styles.badge}>{debrief.itemCount || 0} notes</span>
                    <span style={{
                      ...styles.badge,
                      ...(debrief.confirmed ? styles.confirmedBadge : styles.pendingBadge)
                    }}>
                      {debrief.confirmed ? 'Confirmed' : 'Pending'}
                    </span>
                  </div>
                </button>
                {currentExpandedId === debrief.id && <DebriefDetail debrief={debrief} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const styles = {
  filters: {
    backgroundColor: 'rgba(17,47,82,0.08)',
    borderRadius: '8px',
    padding: '18px',
    marginBottom: '20px',
    border: '1px solid rgba(17,47,82,0.14)'
  },
  filterHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '14px'
  },
  filterGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '12px'
  },
  filterLabel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
    fontSize: '12px',
    color: 'var(--text-secondary)'
  },
  title: {
    margin: 0,
    fontSize: '16px',
    color: 'var(--text-primary)'
  },
  clearButton: {
    padding: '8px 14px',
    backgroundColor: 'rgba(17,47,82,0.12)',
    color: 'var(--text-primary)',
    border: '1px solid rgba(17,47,82,0.22)',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer'
  },
  results: {
    backgroundColor: 'rgba(17,47,82,0.08)',
    borderRadius: '8px',
    padding: '18px',
    border: '1px solid rgba(17,47,82,0.14)'
  },
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    marginTop: '14px'
  },
  card: {
    border: '1px solid rgba(17,47,82,0.14)',
    borderRadius: '8px',
    backgroundColor: 'rgba(255,255,255,0.72)',
    overflow: 'hidden'
  },
  focusedCard: {
    border: '2px solid #CD4E42'
  },
  cardButton: {
    width: '100%',
    border: 'none',
    background: 'transparent',
    padding: '14px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    cursor: 'pointer',
    textAlign: 'left'
  },
  cardTitle: {
    fontSize: '14px',
    fontWeight: 800,
    color: 'var(--text-primary)'
  },
  cardMeta: {
    marginTop: '4px',
    fontSize: '12px',
    color: 'var(--text-secondary)'
  },
  badges: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
    justifyContent: 'flex-end'
  },
  badge: {
    fontSize: '11px',
    fontWeight: 800,
    borderRadius: '999px',
    padding: '4px 8px',
    backgroundColor: 'rgba(17,47,82,0.10)',
    color: '#112F52',
    whiteSpace: 'nowrap'
  },
  confirmedBadge: {
    backgroundColor: 'rgba(47,125,87,0.14)',
    color: '#2F7D57'
  },
  pendingBadge: {
    backgroundColor: 'rgba(176,122,40,0.16)',
    color: '#8A5C16'
  },
  detail: {
    borderTop: '1px solid rgba(17,47,82,0.14)',
    padding: '14px'
  },
  sectionTitle: {
    marginTop: '12px',
    marginBottom: '8px',
    fontSize: '13px',
    fontWeight: 800,
    color: 'var(--text-primary)'
  },
  noteCard: {
    border: '1px solid rgba(17,47,82,0.12)',
    borderRadius: '8px',
    padding: '12px',
    backgroundColor: 'rgba(17,47,82,0.04)'
  },
  noteHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '10px',
    fontSize: '12px',
    color: 'var(--text-secondary)',
    marginBottom: '6px'
  },
  noteText: {
    fontSize: '14px',
    color: 'var(--text-primary)',
    lineHeight: 1.45,
    whiteSpace: 'pre-wrap'
  },
  checkGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '8px'
  },
  checkItem: {
    borderRadius: '8px',
    padding: '9px 10px',
    backgroundColor: 'rgba(176,122,40,0.12)',
    color: '#8A5C16',
    fontSize: '12px',
    fontWeight: 700
  },
  checkItemDone: {
    backgroundColor: 'rgba(47,125,87,0.12)',
    color: '#2F7D57'
  },
  confirmLine: {
    marginTop: '10px',
    fontSize: '12px',
    color: 'var(--text-secondary)'
  },
  emptyState: {
    textAlign: 'center',
    padding: '40px',
    color: '#556677'
  },
  emptyText: {
    fontSize: '13px',
    color: 'var(--text-secondary)'
  }
}
