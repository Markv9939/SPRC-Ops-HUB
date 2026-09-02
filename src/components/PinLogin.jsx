import { useState } from 'react'
import {
  beginSecurityClientPinLogin
} from '../services/securityClientRuntime'
import { isOfflineMode } from '../utils/networkGuard'
import { PIN_LENGTH, isValidPin, normalizePin } from '../utils/pinPolicy'
const LOGIN_STEP_TIMEOUT_MS = 15000

function withTimeout(promise, timeoutMs, timeoutMessage) {
  let timeoutId
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId))
}

function PinLogin({ onLogin }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (pinOverride) => {
    const currentPin = typeof pinOverride === 'string' ? pinOverride : pin
    if (isLoading) return

    if (!isValidPin(currentPin)) {
      setError(`PIN must be ${PIN_LENGTH} digits`)
      return
    }

    setIsLoading(true)
    setError('')

    try {
      if (isOfflineMode()) {
        setError('Offline mode detected. Reconnect to sign in.')
        setIsLoading(false)
        return
      }

      try {
        const securityResult = await withTimeout(
          beginSecurityClientPinLogin(currentPin),
          LOGIN_STEP_TIMEOUT_MS,
          'Secure login timed out. Please check connection and try again.'
        )
        if (securityResult.status !== 'authenticated') {
          throw new Error('Secure login is not enabled for this app version. Contact an administrator.')
        }
        onLogin(securityResult.user)
      } catch (securityError) {
        setError(securityError?.message || 'Secure login failed. Please try again.')
        setPin('')
      }
    } catch (err) {
      console.error('Login error:', err)
      setError('Login failed. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-panel">
        <h1 style={{
          fontSize: '22px',
          color: '#FFFFFF',
          marginBottom: '6px',
          textShadow: '0 1px 0 #000, 1px 0 0 #000, 0 -1px 0 #000, -1px 0 0 #000, 0 2px 8px rgba(10,24,38,0.45)'
        }}>
          SPRC Ops Hub
        </h1>

        <p style={{
          color: 'rgba(255,255,255,0.92)',
          marginBottom: '20px',
          fontSize: '14px',
          textShadow: '0 1px 0 rgba(0,0,0,0.9), 1px 0 0 rgba(0,0,0,0.9), 0 -1px 0 rgba(0,0,0,0.9), -1px 0 0 rgba(0,0,0,0.9), 0 2px 6px rgba(10,24,38,0.40)'
        }}>
          Enter PIN to access
        </p>

        {/* PIN dots display */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '14px',
          marginBottom: '16px'
        }}>
          {Array.from({ length: PIN_LENGTH }, (_, i) => i).map((i) => (
            <div
              key={i}
              style={{
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                background: i < pin.length ? '#F8F5F1' : 'transparent',
                border: '2px solid rgba(248,245,241,0.5)',
                transition: 'all 0.15s'
              }}
            />
          ))}
        </div>

        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          maxLength={PIN_LENGTH}
          value={pin}
          autoFocus
          onChange={(e) => {
            const val = normalizePin(e.target.value)
            setPin(val)
            setError('')
            // Submit as soon as the complete PIN is entered.
            if (val.length === PIN_LENGTH) {
              handleSubmit(val)
            }
          }}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder={`Enter ${PIN_LENGTH}-digit PIN`}
          style={{
            width: '100%',
            padding: '16px',
            fontSize: '20px',
            textAlign: 'center',
            border: '2px solid rgba(248,245,241,0.45)',
            borderRadius: '12px',
            outline: 'none',
            letterSpacing: '6px',
            boxSizing: 'border-box',
            marginBottom: '12px',
            backgroundColor: 'rgba(248,245,241,0.20)',
            color: '#F8F5F1',
            minHeight: '54px'
          }}
        />

        {error && (
          <p style={{ color: '#FFD6CF', fontSize: '13px', marginBottom: '10px' }}>
            {error}
          </p>
        )}

        <button
          onClick={handleSubmit}
          disabled={isLoading}
          style={{
            width: '100%',
            padding: '14px',
            background: 'linear-gradient(135deg, #5FAEE3 0%, #3D86C6 100%)',
            color: '#F8F5F1',
            border: 'none',
            borderRadius: '10px',
            fontSize: '18px',
            fontWeight: 'bold',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            marginTop: '5px',
            opacity: isLoading ? 0.6 : 1,
            boxShadow: '0 8px 20px rgba(21,62,102,0.40)'
          }}
        >
          {isLoading ? 'Checking...' : 'Enter'}
        </button>
      </div>
    </div>
  )
}

export default PinLogin
