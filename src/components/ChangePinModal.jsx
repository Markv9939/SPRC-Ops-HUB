import { useEffect, useState } from 'react'
import { PIN_LENGTH, normalizePin } from '../utils/pinPolicy'

function PINInput({ value, onChange, placeholder, autoFocus = false }) {
  return (
    <input
      type="password"
      maxLength={PIN_LENGTH}
      value={value}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(event) => onChange(normalizePin(event.target.value))}
      style={{
        width: '100%',
        padding: '10px 12px',
        borderRadius: '8px',
        border: '1px solid rgba(17,47,82,0.26)',
        backgroundColor: 'rgba(17,47,82,0.10)',
        color: 'var(--text-primary)',
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
          border: '1px solid rgba(17,47,82,0.22)',
          backgroundColor: '#122231',
          boxShadow: '0 18px 40px rgba(0,0,0,0.45)',
          padding: '18px'
        }}
      >
        <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
          Change PIN
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '14px' }}>
          Enter your current PIN, then set a new {PIN_LENGTH}-digit PIN.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <PINInput value={currentPin} onChange={setCurrentPin} placeholder="Current PIN" autoFocus />
          <PINInput value={newPin} onChange={setNewPin} placeholder="New PIN" />
          <PINInput value={confirmPin} onChange={setConfirmPin} placeholder="Confirm New PIN" />
        </div>

        {error && (
          <div style={{ color: '#CD4E42', fontSize: '12px', marginTop: '10px' }}>
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


