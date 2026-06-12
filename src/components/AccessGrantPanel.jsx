import { useEffect, useMemo, useState } from 'react'
import { db } from '../firebase'
import { collection, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore'
import { notifySuccess } from '../utils/toast'
import { showPromptDialog } from '../utils/dialogs'
import {
  ACCESS_GRANT_STATES,
  deriveAccessGrantState,
  grantBackupAccess,
  revokeBackupAccess
} from '../services/accessGrantService'
import { MAIN_LOCATIONS } from '../utils/orgModel'

const LOCATION_OPTIONS = MAIN_LOCATIONS

function toDate(value) {
  if (!value) return null
  if (typeof value.toDate === 'function') return value.toDate()
  if (value instanceof Date) return value
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function toDateInputValue(date) {
  if (!date) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function plusDays(days) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date
}

function formatDateTime(value) {
  const date = toDate(value)
  if (!date) return '--'
  return date.toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function badgeStyle(state) {
  if (state === ACCESS_GRANT_STATES.ACTIVE) return { color: '#2F7D57', borderColor: 'rgba(76,175,80,0.4)' }
  if (state === ACCESS_GRANT_STATES.UPCOMING) return { color: '#B07A28', borderColor: 'rgba(255,152,0,0.4)' }
  if (state === ACCESS_GRANT_STATES.EXPIRED) return { color: 'var(--text-secondary)', borderColor: 'rgba(136,153,170,0.4)' }
  return { color: '#CD4E42', borderColor: 'rgba(229,57,53,0.4)' }
}

function AccessGrantPanel({ currentUser, users, isOffline = false }) {
  const [grants, setGrants] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({
    userId: '',
    userSearch: '',
    locationId: LOCATION_OPTIONS[0],
    startsOn: toDateInputValue(new Date()),
    expiresOn: toDateInputValue(plusDays(7)),
    reason: ''
  })

  const selectableUsers = useMemo(() => (
    [...users]
      .filter(user => user.active && !user.deletedAt && user.deleted !== true)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
  ), [users])

  useEffect(() => {
    if (form.userId || selectableUsers.length === 0) return
    const firstUser = selectableUsers[0]
    setForm(prev => ({
      ...prev,
      userId: firstUser.id,
      userSearch: firstUser.email ? `${firstUser.name} (${firstUser.email})` : firstUser.name
    }))
  }, [form.userId, selectableUsers])

  function getUserSearchLabel(user) {
    if (!user) return ''
    return user.email ? `${user.name} (${user.email})` : user.name
  }

  function resolveTypedUser(value) {
    const normalized = String(value || '').trim().toLowerCase()
    if (!normalized) return null
    return selectableUsers.find(user => {
      const name = String(user.name || '').trim().toLowerCase()
      const email = String(user.email || '').trim().toLowerCase()
      const id = String(user.id || '').trim().toLowerCase()
      const combined = getUserSearchLabel(user).trim().toLowerCase()
      return normalized === name
        || normalized === email
        || normalized === id
        || normalized === combined
    }) || null
  }

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'accessGrants'),
      (snap) => {
        const rows = snap.docs.map(grantDoc => {
          const data = grantDoc.data()
          return {
            id: grantDoc.id,
            userId: data.userId || '',
            userName: data.userName || '',
            locationId: String(data.locationId || '').trim().toUpperCase(),
            startsAt: data.startsAt || null,
            expiresAt: data.expiresAt || null,
            revokedAt: data.revokedAt || null,
            revoked: data.revoked === true,
            reason: data.reason || '',
            revokedReason: data.revokedReason || '',
            createdAt: data.createdAt || null,
            state: deriveAccessGrantState(data)
          }
        })

        rows.sort((a, b) => {
          const aMs = toDate(a.createdAt || a.startsAt)?.getTime() || 0
          const bMs = toDate(b.createdAt || b.startsAt)?.getTime() || 0
          return bMs - aMs
        })

        setGrants(rows)
        setLoading(false)
      },
      (error) => {
        console.error('Failed to load access grants:', error)
        setGrants([])
        setLoading(false)
      }
    )

    return unsubscribe
  }, [])

  const counts = useMemo(() => {
    const summary = { active: 0, upcoming: 0, expired: 0, revoked: 0 }
    grants.forEach(grant => {
      summary[grant.state] = (summary[grant.state] || 0) + 1
    })
    return summary
  }, [grants])

  const writeAudit = async (action, grantId, reason, extra = {}) => {
    if (!currentUser?.id || !currentUser?.name) return
    await addDoc(collection(db, 'auditLogs'), {
      action,
      collectionPath: 'accessGrants',
      documentId: grantId,
      performedByUserId: currentUser.id,
      performedByName: currentUser.name,
      reason,
      createdAt: serverTimestamp(),
      ...extra
    })
  }

  const handleCreateGrant = async () => {
    if (isOffline) {
      alert('Offline mode: creating backup access grants is unavailable until connection is restored.')
      return
    }

    const selectedUser = selectableUsers.find(user => user.id === form.userId)
    if (!selectedUser) {
      alert('Select a valid user for backup access.')
      return
    }

    setSubmitting(true)
    try {
      const grantId = await grantBackupAccess({
        userId: selectedUser.id,
        userName: selectedUser.name,
        locationId: form.locationId,
        startsOn: form.startsOn,
        expiresOn: form.expiresOn,
        reason: form.reason,
        grantedByUserId: currentUser.id,
        grantedByName: currentUser.name
      })

      await writeAudit('access_grant_create', grantId, form.reason.trim(), {
        targetUserId: selectedUser.id,
        targetUserName: selectedUser.name,
        locationId: String(form.locationId || '').trim().toUpperCase(),
        startsOn: form.startsOn,
        expiresOn: form.expiresOn
      })

      setForm(prev => ({
        ...prev,
        reason: '',
        startsOn: toDateInputValue(new Date()),
        expiresOn: toDateInputValue(plusDays(7))
      }))
      notifySuccess('Backup access granted')
    } catch (error) {
      console.error('Failed to create access grant:', error)
      alert(error.message || 'Failed to create backup access grant.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRevokeGrant = async (grant) => {
    if (isOffline) {
      alert('Offline mode: revoking backup access grants is unavailable until connection is restored.')
      return
    }

    if (grant.state !== ACCESS_GRANT_STATES.ACTIVE && grant.state !== ACCESS_GRANT_STATES.UPCOMING) {
      alert('Only active or upcoming grants can be revoked.')
      return
    }

    const reason = await showPromptDialog(
      `Enter revoke reason for ${grant.userName} (${grant.locationId}):`,
      {
        title: 'Revoke Backup Access',
        tone: 'warning',
        confirmText: 'Revoke',
        cancelText: 'Cancel',
        placeholder: 'Reason required'
      }
    )
    if (reason === null) return
    if (!reason.trim()) {
      alert('Revoke reason is required.')
      return
    }

    try {
      await revokeBackupAccess({
        grantId: grant.id,
        reason,
        revokedByUserId: currentUser.id,
        revokedByName: currentUser.name
      })
      await writeAudit('access_grant_revoke', grant.id, reason.trim(), {
        targetUserId: grant.userId,
        targetUserName: grant.userName,
        locationId: grant.locationId
      })
      notifySuccess('Backup access revoked')
    } catch (error) {
      console.error('Failed to revoke access grant:', error)
      alert(error.message || 'Failed to revoke access grant.')
    }
  }

  return (
    <div style={{
      backgroundColor: 'rgba(17,47,82,0.06)',
      borderRadius: '12px',
      padding: '20px',
      border: '1px solid rgba(17,47,82,0.20)',
      marginTop: '20px'
    }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', color: 'var(--text-primary)' }}>
        Backup Access Grants ({grants.length})
      </h3>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
        <span style={{ fontSize: '12px', color: '#2F7D57' }}>Active: {counts.active || 0}</span>
        <span style={{ fontSize: '12px', color: '#B07A28' }}>Upcoming: {counts.upcoming || 0}</span>
        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Expired: {counts.expired || 0}</span>
        <span style={{ fontSize: '12px', color: '#CD4E42' }}>Revoked: {counts.revoked || 0}</span>
      </div>
      {isOffline && (
        <div style={{ fontSize: '12px', color: '#B07A28', marginBottom: '10px' }}>
          Offline mode is active. Grant and revoke actions are disabled.
        </div>
      )}

      <div style={{
        backgroundColor: 'rgba(17,47,82,0.05)',
        borderRadius: '10px',
        padding: '14px',
        marginBottom: '14px',
        border: '1px solid rgba(17,47,82,0.14)'
      }}>
        <div style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: '10px' }}>
          Grant Backup Access
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px' }}>
          <div>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>User</label>
            <input
              type="text"
              list="backup-access-users"
              value={form.userSearch}
              onChange={(event) => {
                const nextValue = event.target.value
                const matchedUser = resolveTypedUser(nextValue)
                setForm(prev => ({
                  ...prev,
                  userSearch: nextValue,
                  userId: matchedUser?.id || ''
                }))
              }}
              onBlur={() => {
                const matchedUser = resolveTypedUser(form.userSearch)
                if (!matchedUser) return
                setForm(prev => ({
                  ...prev,
                  userId: matchedUser.id,
                  userSearch: getUserSearchLabel(matchedUser)
                }))
              }}
              placeholder="Type a user name or approved email"
              style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '2px solid rgba(17,47,82,0.20)', backgroundColor: 'rgba(17,47,82,0.10)', color: 'var(--text-primary)' }}
            />
            <datalist id="backup-access-users">
              {selectableUsers.map(user => (
                <option key={user.id} value={getUserSearchLabel(user)} />
              ))}
            </datalist>
          </div>

          <div>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Location</label>
            <select
              value={form.locationId}
              onChange={(event) => setForm(prev => ({ ...prev, locationId: event.target.value }))}
              style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '2px solid rgba(17,47,82,0.20)', backgroundColor: 'rgba(17,47,82,0.10)', color: 'var(--text-primary)' }}
            >
              {LOCATION_OPTIONS.map(locationId => (
                <option key={locationId} value={locationId}>{locationId}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Start</label>
            <input
              type="date"
              value={form.startsOn}
              onChange={(event) => setForm(prev => ({ ...prev, startsOn: event.target.value }))}
              style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '2px solid rgba(17,47,82,0.20)', backgroundColor: 'rgba(17,47,82,0.10)', color: 'var(--text-primary)' }}
            />
          </div>

          <div>
            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Expires</label>
            <input
              type="date"
              value={form.expiresOn}
              onChange={(event) => setForm(prev => ({ ...prev, expiresOn: event.target.value }))}
              style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '2px solid rgba(17,47,82,0.20)', backgroundColor: 'rgba(17,47,82,0.10)', color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        <div style={{ marginTop: '10px' }}>
          <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Reason</label>
          <input
            type="text"
            value={form.reason}
            onChange={(event) => setForm(prev => ({ ...prev, reason: event.target.value }))}
            placeholder="Why this temporary backup access is needed"
            style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '2px solid rgba(17,47,82,0.20)', backgroundColor: 'rgba(17,47,82,0.10)', color: 'var(--text-primary)', boxSizing: 'border-box' }}
          />
        </div>

        <button
          onClick={handleCreateGrant}
          disabled={submitting || isOffline}
          style={{
            marginTop: '10px',
            padding: '10px 16px',
            backgroundColor: (submitting || isOffline) ? 'rgba(17,47,82,0.14)' : '#2F7D57',
            color: (submitting || isOffline) ? 'var(--text-secondary)' : 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 'bold',
            cursor: (submitting || isOffline) ? 'not-allowed' : 'pointer'
          }}
        >
          {submitting ? 'Saving...' : (isOffline ? 'Offline' : 'Grant Access')}
        </button>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Loading access grants...</div>
      ) : grants.length === 0 ? (
        <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>No backup grants created yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {grants.map(grant => (
            <div
              key={grant.id}
              style={{
                border: '1px solid rgba(17,47,82,0.14)',
                borderRadius: '8px',
                backgroundColor: 'rgba(17,47,82,0.04)',
                padding: '12px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 'bold', color: 'var(--text-primary)', fontSize: '13px' }}>
                  {grant.userName} ({grant.userId}) - {grant.locationId}
                </div>
                <span
                  style={{
                    fontSize: '11px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.4px',
                    border: '1px solid',
                    borderRadius: '999px',
                    padding: '3px 8px',
                    ...badgeStyle(grant.state)
                  }}
                >
                  {grant.state}
                </span>
              </div>

              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                Window: {formatDateTime(grant.startsAt)} - {formatDateTime(grant.expiresAt)}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Reason: {grant.reason || '(none)'}
              </div>
              {grant.revokedReason && (
                <div style={{ fontSize: '12px', color: '#CD4E42', marginTop: '2px' }}>
                  Revoked: {grant.revokedReason}
                </div>
              )}

              {(grant.state === ACCESS_GRANT_STATES.ACTIVE || grant.state === ACCESS_GRANT_STATES.UPCOMING) && (
                <button
                  onClick={() => handleRevokeGrant(grant)}
                  style={{
                    marginTop: '8px',
                    padding: '7px 12px',
                    backgroundColor: '#CD4E42',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default AccessGrantPanel


