import { useState, useEffect } from 'react'
import { db, auth } from '../firebase'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { signInAnonymously } from 'firebase/auth'
import { hashPin } from '../utils/pinHash'
import { isActiveNonDeletedUser } from '../services/pinConflictService'
import { getScopedSessionUser } from '../services/accessGrantService'
import { getAuthPolicy } from '../services/authPolicyService'
import { isOfflineMode } from '../utils/networkGuard'
import { PIN_LENGTH, isValidPin, normalizePin } from '../utils/pinPolicy'
import {
  GLOBAL_SCOPE,
  isAdminRole,
  normalizeMainLocation,
  normalizeRole,
  normalizeScopeValues
} from '../utils/orgModel'

const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 5 * 60 * 1000 // 5 minutes
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

  const expectedUserScopes = (userData) => normalizeScopeValues([
    ...(userData?.site ? [userData.site] : []),
    ...(Array.isArray(userData?.authorizedLocations) ? userData.authorizedLocations : [])
  ])

  const claimsMatchPinUser = (authSession, userData) => {
    if (!authSession?.authClaimsReady) return true

    const expectedRole = normalizeRole(userData?.role)
    const expectedScopes = expectedUserScopes(userData)
    const actualRole = normalizeRole(authSession.authClaimRole)
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
      console.warn('Anonymous auth bootstrap failed:', authError)
      return {
        authUid: null,
        authClaimsReady: false,
        authClaimRole: null,
        authClaimLocations: []
      }
    }
  }

  const handleSubmit = async (pinOverride) => {
    const currentPin = typeof pinOverride === 'string' ? pinOverride : pin
    if (isLoading) return

    if (lockoutUntil && Date.now() < lockoutUntil) {
      const remainingMinutes = Math.ceil((lockoutUntil - Date.now()) / 60000)
      setError(`Account locked. Try again in ${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}`)
      return
    }

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

      const pinHash = await hashPin(currentPin)
      const usersRef = collection(db, 'users')
      const hashQuery = query(usersRef, where('pinHash', '==', pinHash), where('active', '==', true))
      const querySnapshot = await withTimeout(
        getDocs(hashQuery),
        LOGIN_STEP_TIMEOUT_MS,
        'Login timed out while verifying PIN. Please check connection and try again.'
      )

      const activePinUsers = querySnapshot.docs
        .map(docSnap => ({
          id: docSnap.id,
          ...docSnap.data()
        }))
        .filter(isActiveNonDeletedUser)

      if (activePinUsers.length === 0) {
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
        if (activePinUsers.length > 1) {
          setError('PIN conflict found. Contact admin.')
          setPin('')
          return
        }

        const pinUser = activePinUsers[0]
        const userData = pinUser

        localStorage.removeItem('failedAttempts')
        localStorage.removeItem('lockoutUntil')
        setFailedAttempts(0)

        const policy = await withTimeout(
          getAuthPolicy(),
          LOGIN_STEP_TIMEOUT_MS,
          'Login timed out while loading access policy. Please try again.'
        )
        const authScopeEnforced = policy?.authScopeEnforced === true
        const authSession = await withTimeout(
          ensureAuthSession(),
          LOGIN_STEP_TIMEOUT_MS,
          'Login timed out while starting the secure file session. Please try again.'
        )
        const normalizedRole = normalizeRole(userData.role)

        // When claim enforcement is on, prevent stale claim sessions from constraining PIN identity.
        if (authScopeEnforced && !claimsMatchPinUser(authSession, userData)) {
          setError('Access blocked: auth claims do not match this PIN account. Use the matching claim-enabled account.')
          setPin('')
          return
        }

        if (authScopeEnforced && !authSession.authClaimsReady) {
          setError('Access blocked: auth claims are required for this environment. Contact admin.')
          setPin('')
          return
        }

        let scopedSessionUser
        try {
          scopedSessionUser = await withTimeout(
            getScopedSessionUser(pinUser.id, userData),
            LOGIN_STEP_TIMEOUT_MS,
            'Login timed out while loading access scope. Please try again.'
          )
        } catch (scopeError) {
          console.warn('Access-grant scope lookup failed. Falling back to base scope:', scopeError)
          const baseScopes = [...new Set([
            ...(userData.site ? [userData.site] : []),
            ...(Array.isArray(userData.authorizedLocations) ? userData.authorizedLocations : [])
          ])]
          const normalizedSite = isAdminRole(normalizedRole)
            ? GLOBAL_SCOPE
            : (normalizeMainLocation(userData.site) || normalizeMainLocation(baseScopes[0]) || '')
          scopedSessionUser = {
            id: pinUser.id,
            name: userData.name,
            role: normalizedRole,
            site: normalizedSite,
            locationId: userData.locationId || null,
            shiftId: userData.shiftId || null,
            vanId: userData.vanId || null,
            vanIds: Array.isArray(userData.vanIds)
              ? userData.vanIds.map(v => String(v || '').trim().toLowerCase()).filter(Boolean)
              : (userData.vanId ? [String(userData.vanId).trim().toLowerCase()] : []),
            authorizedLocations: normalizeScopeValues(baseScopes),
            primaryScopes: normalizeScopeValues(baseScopes),
            activeBackupGrants: [],
            scopeRefreshedAt: new Date().toISOString(),
            authScopeEnforced,
            ...authSession
          }
        }

        onLogin({
          ...scopedSessionUser,
          authScopeEnforced,
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
          disabled={isLoading || (lockoutUntil && Date.now() < lockoutUntil)}
          style={{
            width: '100%',
            padding: '14px',
            background: 'linear-gradient(135deg, #5FAEE3 0%, #3D86C6 100%)',
            color: '#F8F5F1',
            border: 'none',
            borderRadius: '10px',
            fontSize: '18px',
            fontWeight: 'bold',
            cursor: (isLoading || (lockoutUntil && Date.now() < lockoutUntil)) ? 'not-allowed' : 'pointer',
            marginTop: '5px',
            opacity: (isLoading || (lockoutUntil && Date.now() < lockoutUntil)) ? 0.6 : 1,
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
