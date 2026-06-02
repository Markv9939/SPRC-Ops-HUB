import { useState, useEffect, useRef } from 'react'

function Header({
  userName,
  userSubtitle = '',
  onLogout,
  onChangePin,
  canChangeOwnPin = false,
  alertCount = 0,
  isOffline = false,
  pendingSyncCount = 0,
  needsReviewCount = 0,
  onNotificationsOpen
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [menuOpen])

  const firstName = String(userName || '').split(' ')[0]

  return (
    <div className="header" ref={menuRef}>
      <div className="header-brand">
        <img src="/branding/sprc-mark-white.png" alt="SPRC" />
        <span>Ops Hub</span>
      </div>

      <div className="header-right">
        {isOffline && (
          <span style={{
            fontSize: '11px',
            color: '#B07A28',
            border: '1px solid rgba(255,152,0,0.4)',
            borderRadius: '999px',
            padding: '2px 8px',
            backgroundColor: 'rgba(255,152,0,0.14)'
          }}>
            Offline
          </span>
        )}
        {pendingSyncCount > 0 && (
          <span style={{
            fontSize: '11px',
            color: '#2F7D57',
            border: '1px solid rgba(47,125,87,0.34)',
            borderRadius: '999px',
            padding: '2px 8px',
            backgroundColor: 'rgba(47,125,87,0.12)'
          }}>
            Sync {pendingSyncCount}
          </span>
        )}
        {needsReviewCount > 0 && (
          <span style={{
            fontSize: '11px',
            color: '#9D362E',
            border: '1px solid rgba(205,78,66,0.34)',
            borderRadius: '999px',
            padding: '2px 8px',
            backgroundColor: 'rgba(205,78,66,0.12)'
          }}>
            Review {needsReviewCount}
          </span>
        )}
        {alertCount > 0 && (
          <button
            className="alert-badge-btn"
            onClick={() => onNotificationsOpen?.()}
            aria-label={`${alertCount} unread notifications`}
          >
            <span className="alert-dot">{alertCount}</span>
          </button>
        )}
        <span className="header-user">{firstName}</span>
        <button
          className="header-menu-btn"
          onClick={() => setMenuOpen(prev => !prev)}
          aria-label="Menu"
        >
          {menuOpen ? '✕' : '☰'}
        </button>
      </div>

      {menuOpen && (
        <div className="header-dropdown">
          {userSubtitle && (
            <div style={{
              padding: '12px 16px',
              fontSize: '12px',
              color: 'rgba(248,245,241,0.65)',
              borderBottom: '1px solid rgba(248,245,241,0.10)'
            }}>
              {userName}
              <br />
              <span style={{ opacity: 0.8 }}>{userSubtitle}</span>
            </div>
          )}
          {canChangeOwnPin && (
            <button
              className="header-dropdown-item"
              onClick={() => { setMenuOpen(false); onChangePin() }}
            >
              Change PIN
            </button>
          )}
          <button
            className="header-dropdown-item"
            onClick={() => { setMenuOpen(false); onLogout() }}
            style={{ color: '#CD4E42' }}
          >
            Lock / Sign Out
          </button>
        </div>
      )}
    </div>
  )
}

export default Header
