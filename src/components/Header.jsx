function Header({ userName, onLogout }) {
    return (
      <div style={{
        backgroundColor: '#C94A3F',
        padding: '14px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        color: 'white'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img
            src="/sprc-logo.png"
            alt="SPRC"
            style={{ width: '32px', height: '32px' }}
          />
          <span style={{ fontSize: '18px', fontWeight: 'bold' }}>
            SPRC TX Log
          </span>
        </div>
  
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '14px' }}>
            {userName}
          </span>
          <button
            onClick={onLogout}
            style={{
              backgroundColor: 'rgba(255,255,255,0.2)',
              color: 'white',
              border: '1px solid rgba(255,255,255,0.4)',
              borderRadius: '6px',
              padding: '6px 12px',
              fontSize: '13px',
              cursor: 'pointer'
            }}
          >
            Lock
          </button>
        </div>
      </div>
    )
  }
  
  export default Header