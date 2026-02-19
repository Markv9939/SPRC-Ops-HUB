function Header({ userName, onLogout, onChangePin, canChangeOwnPin = false, alertCount = 0, isOffline = false }) {
  return (
    <div className="header">
      <div className="header-brand">
        <img src="/branding/sprc-mark-white.png" alt="SPRC" />
        <span>SPRC Ops Hub</span>
      </div>

      <div className="header-right">
        {alertCount > 0 && (
          <span className="alert-dot">{alertCount}</span>
        )}
        {isOffline && (
          <span style={{
            fontSize: '11px',
            color: '#B07A28',
            border: '1px solid rgba(255,152,0,0.4)',
            borderRadius: '999px',
            padding: '2px 8px',
            backgroundColor: 'rgba(255,152,0,0.14)'
          }}>
            Offline: read-only
          </span>
        )}
        <span className="header-user">{userName}</span>
        {canChangeOwnPin && (
          <button className="btn-secondary-action" onClick={onChangePin}>
            Change PIN
          </button>
        )}
        <button className="btn-lock" onClick={onLogout}>
          Lock
        </button>
      </div>
    </div>
  )
}

export default Header

