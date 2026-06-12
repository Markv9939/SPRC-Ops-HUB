import { useEffect, useState } from 'react'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { auth } from '../firebase'
import { resolveCurrentAuthSession, signInWithApprovedGoogle } from '../services/authProfileService'
import { isOfflineMode } from '../utils/networkGuard'

function GoogleLogin({ onLogin }) {
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)

  useEffect(() => {
    let cancelled = false
    const unsubscribe = onAuthStateChanged(auth, async (authUser) => {
      if (!authUser) {
        if (!cancelled) setCheckingSession(false)
        return
      }
      try {
        const sessionUser = await resolveCurrentAuthSession()
        if (!cancelled && sessionUser) onLogin(sessionUser)
      } catch (err) {
        console.warn('Saved Google session could not be restored:', err)
        try {
          await signOut(auth)
        } catch (signOutError) {
          console.warn('Failed to clear unusable Google session:', signOutError)
        }
        if (!cancelled) {
          setError(err?.message || 'Sign in again with an approved Google account.')
          setCheckingSession(false)
        }
      }
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [onLogin])

  const handleGoogleSignIn = async () => {
    if (isLoading) return
    if (isOfflineMode()) {
      setError('Reconnect to the internet before signing in.')
      return
    }

    setIsLoading(true)
    setError('')
    try {
      const sessionUser = await signInWithApprovedGoogle()
      onLogin(sessionUser)
    } catch (err) {
      console.error('Google sign-in failed:', err)
      setError(err?.message || 'Google sign-in failed. Contact an admin if this email should have access.')
      try {
        await signOut(auth)
      } catch (signOutError) {
        console.warn('Failed to clear denied Google session:', signOutError)
      }
    } finally {
      setIsLoading(false)
      setCheckingSession(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-panel google-login-panel">
        <h1 className="google-login-title">SPRC Ops Hub</h1>
        <p className="google-login-copy">
          Sign in with an approved Google email.
        </p>

        {error && (
          <div className="google-login-error">
            {error}
          </div>
        )}

        <button
          className="google-login-button"
          onClick={handleGoogleSignIn}
          disabled={isLoading || checkingSession}
        >
          <span className="google-login-mark">G</span>
          <span>{checkingSession ? 'Checking session...' : isLoading ? 'Signing in...' : 'Continue with Google'}</span>
        </button>

        <p className="google-login-note">
          Company email is the normal path. External Google emails must be approved by an admin first.
        </p>
      </div>
    </div>
  )
}

export default GoogleLogin
