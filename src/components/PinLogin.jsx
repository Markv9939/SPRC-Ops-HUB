import { useState, useEffect } from 'react'
import { db, auth } from '../firebase'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { signInAnonymously, signOut } from 'firebase/auth'
import { hashPin } from '../utils/pinHash'
import { getScopedSessionUser } from '../services/accessGrantService'
import { getAuthPolicy } from '../services/authPolicyService'
import { isOfflineMode } from '../utils/networkGuard'

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

  const normalizeScopeValues = (values) => {
    if (!Array.isArray(values)) return []
    return [...new Set(values.map(value => String(value || '').trim().toUpperCase()).filter(Boolean))]
  }

  const expectedUserScopes = (userData) => normalizeScopeValues([
    ...(userData?.site ? [userData.site] : []),
    ...(Array.isArray(userData?.authorizedLocations) ? userData.authorizedLocations : [])
  ])

  const claimsMatchPinUser = (authSession, userData) => {
    if (!authSession?.authClaimsReady) return true

    const expectedRole = String(userData?.role || '').trim()
    const expectedScopes = expectedUserScopes(userData)
    const actualRole = String(authSession.authClaimRole || '').trim()
    const actualScopes = normalizeScopeValues(authSession.authClaimLocations)

    const roleMatches = expectedRole === actualRole
    const scopesMatch = expectedScopes.every(scope => actualScopes.includes(scope))
    return roleMatches && scopesMatch
  }

  const ensureAuthSession = async ({ forceAnonymous = false } = {}) => {
    try {
      const credential = (!forceAnonymous && auth.currentUser)
        ? { user: auth.currentUser }
        : await signInAnonymously(auth)
      let authClaimsReady = false
      let authClaimRole = null
      let authClaimLocations = []

      try {
        const token = await credential.user.getIdTokenResult()
        authClaimRole = typeof token?.claims?.role === 'string' ? token.claims.role : null
        authClaimLocations = Array.isArray(token?.claims?.locations) ? token.claims.locations : []
        authClaimsReady = Boolean(authClaimRole)
      } catch (tokenError) {
        console.warn('Auth token claims lookup failed:', tokenError)
      }

      return {
        authUid: credential.user.uid,
        authClaimsReady,
        authClaimRole,
        authClaimLocations
      }
    } catch (authError) {
      console.warn('Anonymous auth bootstrap failed; continuing in legacy PIN mode:', authError)
      return {
        authUid: null,
        authClaimsReady: false,
        authClaimRole: null,
        authClaimLocations: []
      }
    }
  }

  const resetToAnonymousAuthSession = async () => {
    try {
      if (auth.currentUser) {
        await signOut(auth)
      }
    } catch (signOutError) {
      console.warn('Auth signOut before anonymous reset failed:', signOutError)
    }
    return ensureAuthSession({ forceAnonymous: true })
  }

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
      if (isOfflineMode()) {
        setError('Offline mode detected. Reconnect to sign in.')
        setIsLoading(false)
        return
      }

      const pinHash = await hashPin(pin)
      const usersRef = collection(db, 'users')
      const hashQuery = query(usersRef, where('pinHash', '==', pinHash), where('active', '==', true))
      const querySnapshot = await getDocs(hashQuery)

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

        const authPolicy = await getAuthPolicy()
        let authSession = await ensureAuthSession()

        // Prevent stale claim sessions (from prior logins) from constraining this PIN identity.
        if (!claimsMatchPinUser(authSession, userData)) {
          if (authPolicy.authScopeEnforced) {
            setError('Access blocked: auth claims do not match this PIN account. Use the matching claim-enabled account.')
            setPin('')
            return
          }
          authSession = await resetToAnonymousAuthSession()
        }

        if (authPolicy.authScopeEnforced && !authSession.authClaimsReady) {
          setError('Access blocked: auth claims are required for this environment. Contact admin.')
          setPin('')
          return
        }

        let scopedSessionUser
        try {
          scopedSessionUser = await getScopedSessionUser(userDoc.id, userData)
        } catch (scopeError) {
          console.warn('Access-grant scope lookup failed. Falling back to base scope:', scopeError)
          const baseScopes = [...new Set([
            ...(userData.site ? [userData.site] : []),
            ...(Array.isArray(userData.authorizedLocations) ? userData.authorizedLocations : [])
          ])]
          scopedSessionUser = {
            id: userDoc.id,
            name: userData.name,
            role: userData.role,
            site: userData.site,
            locationId: userData.locationId || null,
            shiftId: userData.shiftId || null,
            vanId: userData.vanId || null,
            authorizedLocations: baseScopes,
            primaryScopes: baseScopes,
            activeBackupGrants: [],
            scopeRefreshedAt: new Date().toISOString(),
            authScopeEnforced: authPolicy.authScopeEnforced,
            ...authSession
          }
        }

        onLogin({
          ...scopedSessionUser,
          authScopeEnforced: authPolicy.authScopeEnforced,
          ...authSession
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
      backgroundColor: '#0f1923'
    }}>
      <div style={{
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderRadius: '16px',
        padding: '40px',
        textAlign: 'center',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        border: '1px solid rgba(229,57,53,0.2)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        width: '300px'
      }}>
        <img
          src="/sprc-logo.png"
          alt="SPRC Logo"
          style={{
            width: '90px',
            height: '90px',
            margin: '0 auto 20px',
            display: 'block',
            filter: 'drop-shadow(0 0 12px rgba(229,57,53,0.3))'
          }}
        />

        <h1 style={{
          fontSize: '22px',
          color: '#e8e8e8',
          marginBottom: '5px'
        }}>
          SPRC Ops Hub
        </h1>

        <p style={{
          color: '#8899aa',
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
          placeholder="* * * *"
          style={{
            width: '100%',
            padding: '14px',
            fontSize: '24px',
            textAlign: 'center',
            border: '2px solid rgba(255,255,255,0.1)',
            borderRadius: '10px',
            outline: 'none',
            letterSpacing: '8px',
            boxSizing: 'border-box',
            marginBottom: '10px',
            backgroundColor: 'rgba(255,255,255,0.06)',
            color: '#e8e8e8'
          }}
        />

        {error && (
          <p style={{ color: '#E53935', fontSize: '13px', marginBottom: '10px' }}>
            {error}
          </p>
        )}

        <button
          onClick={handleSubmit}
          disabled={isLoading || (lockoutUntil && Date.now() < lockoutUntil)}
          style={{
            width: '100%',
            padding: '14px',
            background: 'linear-gradient(135deg, #E53935 0%, #C62828 100%)',
            color: 'white',
            border: 'none',
            borderRadius: '10px',
            fontSize: '18px',
            fontWeight: 'bold',
            cursor: (isLoading || (lockoutUntil && Date.now() < lockoutUntil)) ? 'not-allowed' : 'pointer',
            marginTop: '5px',
            opacity: (isLoading || (lockoutUntil && Date.now() < lockoutUntil)) ? 0.6 : 1,
            boxShadow: '0 4px 14px rgba(229,57,53,0.35), 0 0 20px rgba(229,57,53,0.3)'
          }}
        >
          {isLoading ? 'Checking...' : 'Enter'}
        </button>
      </div>
    </div>
  )
}

export default PinLogin
