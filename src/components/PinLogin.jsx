import { useState, useEffect } from 'react'
import { db } from '../firebase'
import { collection, query, where, getDocs } from 'firebase/firestore'

const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 5 * 60 * 1000 // 5 minutes

function PinLogin({ onLogin }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [failedAttempts, setFailedAttempts] = useState(0)
  const [lockoutUntil, setLockoutUntil] = useState(null)

  useEffect(() => {
    const storedAttempts = localStorage.getItem('failedAttempts')
    const storedLockout = localStorage.getItem('lockoutUntil')

    if (storedAttempts) {
      setFailedAttempts(parseInt(storedAttempts, 10))
    }

    if (storedLockout) {
      const lockoutTime = parseInt(storedLockout, 10)
      if (Date.now() < lockoutTime) {
        setLockoutUntil(lockoutTime)
      } else {
        localStorage.removeItem('lockoutUntil')
        localStorage.removeItem('failedAttempts')
      }
    }
  }, [])

  useEffect(() => {
    if (lockoutUntil && Date.now() < lockoutUntil) {
      const timer = setInterval(() => {
        if (Date.now() >= lockoutUntil) {
          setLockoutUntil(null)
          setFailedAttempts(0)
          setError('')
          localStorage.removeItem('lockoutUntil')
          localStorage.removeItem('failedAttempts')
          clearInterval(timer)
        }
      }, 1000)

      return () => clearInterval(timer)
    }
  }, [lockoutUntil])

  const handleSubmit = async () => {
    if (lockoutUntil && Date.now() < lockoutUntil) {
      const remainingMinutes = Math.ceil((lockoutUntil - Date.now()) / 60000)
      setError(`Account locked. Try again in ${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}`)
      return
    }

    if (pin.length !== 4) {
      setError('PIN must be 4 digits')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const usersRef = collection(db, 'users')
      const q = query(usersRef, where('pin', '==', pin), where('active', '==', true))
      const querySnapshot = await getDocs(q)

      if (querySnapshot.empty) {
        const newFailedAttempts = failedAttempts + 1
        setFailedAttempts(newFailedAttempts)
        localStorage.setItem('failedAttempts', newFailedAttempts.toString())

        if (newFailedAttempts >= MAX_FAILED_ATTEMPTS) {
          const lockUntil = Date.now() + LOCKOUT_DURATION_MS
          setLockoutUntil(lockUntil)
          localStorage.setItem('lockoutUntil', lockUntil.toString())
          setError('Too many failed attempts. Account locked for 5 minutes.')
        } else {
          setError(`Invalid PIN (${MAX_FAILED_ATTEMPTS - newFailedAttempts} attempts remaining)`)
        }

        setPin('')
      } else {
        const userDoc = querySnapshot.docs[0]
        const userData = userDoc.data()

        localStorage.removeItem('failedAttempts')
        localStorage.removeItem('lockoutUntil')
        setFailedAttempts(0)

        onLogin({
          id: userDoc.id,
          name: userData.name,
          role: userData.role,
          site: userData.site,
          locationId: userData.locationId || null,
          shiftId: userData.shiftId || null,
          vanId: userData.vanId || null
        })
      }
    } catch (err) {
      console.error('Login error:', err)
      setError('Login failed. Please try again.')
    } finally {
      setIsLoading(false)
    }
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
          BHT Hub
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
          disabled={isLoading || (lockoutUntil && Date.now() < lockoutUntil)}
          style={{
            width: '100%',
            padding: '14px',
            backgroundColor: '#C94A3F',
            color: 'white',
            border: 'none',
            borderRadius: '10px',
            fontSize: '18px',
            fontWeight: 'bold',
            cursor: (isLoading || (lockoutUntil && Date.now() < lockoutUntil)) ? 'not-allowed' : 'pointer',
            marginTop: '5px',
            opacity: (isLoading || (lockoutUntil && Date.now() < lockoutUntil)) ? 0.6 : 1
          }}
        >
          {isLoading ? 'Checking...' : 'Enter'}
        </button>
      </div>
    </div>
  )
}

export default PinLogin