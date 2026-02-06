import { useState } from 'react'

function PinLogin({ onLogin }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = () => {
    if (pin.length !== 4) {
      setError('PIN must be 4 digits')
      return
    }
    onLogin(pin)
  }

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      backgroundColor: '#f5f5f5'
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '16px',
        padding: '40px',
        textAlign: 'center',
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        width: '300px'
      }}>
        <img
          src="/sprc-logo.png"
          alt="SPRC Logo"
          style={{
            width: '90px',
            height: '90px',
            margin: '0 auto 20px',
            display: 'block'
          }}
        />

        <h1 style={{
          fontSize: '22px',
          color: '#333',
          marginBottom: '5px'
        }}>
          SPRC TX Log
        </h1>

        <p style={{
          color: '#888',
          marginBottom: '25px',
          fontSize: '14px'
        }}>
          Enter PIN to access
        </p>

        <input
          type="password"
          maxLength={4}
          value={pin}
          onChange={(e) => {
            const val = e.target.value.replace(/\D/g, '')
            setPin(val)
            setError('')
          }}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="• • • •"
          style={{
            width: '100%',
            padding: '14px',
            fontSize: '24px',
            textAlign: 'center',
            border: '2px solid #ddd',
            borderRadius: '10px',
            outline: 'none',
            letterSpacing: '8px',
            boxSizing: 'border-box',
            marginBottom: '10px'
          }}
        />

        {error && (
          <p style={{ color: '#C94A3F', fontSize: '13px', marginBottom: '10px' }}>
            {error}
          </p>
        )}

        <button
          onClick={handleSubmit}
          style={{
            width: '100%',
            padding: '14px',
            backgroundColor: '#C94A3F',
            color: 'white',
            border: 'none',
            borderRadius: '10px',
            fontSize: '18px',
            fontWeight: 'bold',
            cursor: 'pointer',
            marginTop: '5px'
          }}
        >
          Enter
        </button>
      </div>
    </div>
  )
}

export default PinLogin