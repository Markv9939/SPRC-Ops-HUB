function Header({ userName, onLogout }) {
  return (
    <div className="header">
      <div className="header-brand">
        <img src="/sprc-logo.png" alt="SPRC" />
        <span>SPRC TX Log</span>
      </div>

      <div className="header-right">
        <span className="header-user">{userName}</span>
        <button className="btn-lock" onClick={onLogout}>
          Lock
        </button>
      </div>
    </div>
  )
}

export default Header
