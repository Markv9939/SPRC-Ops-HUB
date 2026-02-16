import { useEffect, useState } from 'react'

function PINInput({ value, onChange, placeholder, autoFocus = false }) {
  return (
    <input
      type="password"
      maxLength={4}
      value={value}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value.replace(/\D/g, ''))}
      style={{
        width: '100%',
        padding: '10px 12px',
        borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.15)',
        backgroundColor: 'rgba(255,255,255,0.06)',
        color: '#e8e8e8',
        fontSize: '14px',
        letterSpacing: '2px',
        boxSizing: 'border-box'
      }}
    />
  )
}

function ChangePinModal({ isOpen, onClose, onSubmit }) {
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (isOpen) return
    setCurrentPin('')
    setNewPin('')
    setConfirmPin('')
    setError('')
    setIsSubmitting(false)
  }, [isOpen])

  if (!isOpen) return null

  const handleSubmit = async () => {
    setError('')
    setIsSubmitting(true)
    try {
      await onSubmit({ currentPin, newPin, confirmPin })
      onClose()
    } catch (submitError) {
      setError(String(submitError?.message || 'PIN change failed. Please try again.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      role="presentation"
      onClick={() => !isSubmitting && onClose()}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(8, 14, 20, 0.75)',
        zIndex: 1300,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Change PIN"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '420px',
          borderRadius: '12px',
          border: '1px solid rgba(255,255,255,0.12)',
          backgroundColor: '#122231',
          boxShadow: '0 18px 40px rgba(0,0,0,0.45)',
          padding: '18px'
        }}
      >
        <div style={{ fontSize: '18px', fontWeight: 700, color: '#e8e8e8', marginBottom: '4px' }}>
          Change PIN
        </div>
        <div style={{ fontSize: '13px', color: '#8899aa', marginBottom: '14px' }}>
          Enter your current PIN, then set a new 4-digit PIN.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <PINInput value={currentPin} onChange={setCurrentPin} placeholder="Current PIN" autoFocus />
          <PINInput value={newPin} onChange={setNewPin} placeholder="New PIN" />
          <PINInput value={confirmPin} onChange={setConfirmPin} placeholder="Confirm New PIN" />
        </div>

        {error && (
          <div style={{ color: '#E53935', fontSize: '12px', marginTop: '10px' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' }}>
          <button className="btn-lock" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Update PIN'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ChangePinModal
