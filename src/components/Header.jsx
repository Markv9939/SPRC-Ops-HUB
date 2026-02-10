function Header({ userName, onLogout, alertCount = 0 }) {
  return (
    <div className="header">
      <div className="header-brand">
        <img src="/sprc-logo.png" alt="SPRC" />
        <span>BHT Hub</span>
      </div>

      <div className="header-right">
        {alertCount > 0 && (
          <span className="alert-dot">{alertCount}</span>
        )}
        <span className="header-user">{userName}</span>
        <button className="btn-lock" onClick={onLogout}>
          Lock
        </button>
      </div>
    </div>
  )
}

export default Header
