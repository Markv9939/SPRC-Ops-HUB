import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getDialogEventName, resolveDialogRequest } from '../utils/dialogs'

const OVERLAY_STYLE = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.58)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 2400,
  padding: '20px'
}

const DIALOG_STYLE = {
  width: '100%',
  maxWidth: '430px',
  backgroundColor: '#1a2332',
  borderRadius: '16px',
  border: '1px solid rgba(229,57,53,0.35)',
  boxShadow: '0 14px 36px rgba(0,0,0,0.55)',
  padding: '22px',
  color: '#e8e8e8'
}

const CANCEL_BUTTON_STYLE = {
  flex: 1,
  padding: '12px 14px',
  backgroundColor: 'rgba(255,255,255,0.07)',
  color: '#8899aa',
  border: 'none',
  borderRadius: '10px',
  fontSize: '15px',
  fontWeight: 700,
  cursor: 'pointer'
}

function toneStyle(tone) {
  if (tone === 'warning') {
    return {
      border: '1px solid rgba(255,152,0,0.45)',
      heading: '#FFB74D',
      buttonBg: '#FF9800',
      buttonText: '#1f2933'
    }
  }
  if (tone === 'success') {
    return {
      border: '1px solid rgba(76,175,80,0.45)',
      heading: '#81C784',
      buttonBg: '#4CAF50',
      buttonText: '#ffffff'
    }
  }
  if (tone === 'info') {
    return {
      border: '1px solid rgba(33,150,243,0.45)',
      heading: '#90CAF9',
      buttonBg: '#2196F3',
      buttonText: '#ffffff'
    }
  }
  return {
    border: '1px solid rgba(229,57,53,0.45)',
    heading: '#E53935',
    buttonBg: '#E53935',
    buttonText: '#ffffff'
  }
}

function DialogHost() {
  const [queue, setQueue] = useState([])
  const inputRef = useRef(null)

  useEffect(() => {
    const eventName = getDialogEventName()
    const onDialog = (event) => {
      const detail = event?.detail || {}
      if (!detail.id || !detail.type) return
      setQueue(prev => [
        ...prev,
        {
          ...detail,
          promptValue: String(detail.defaultValue || '')
        }
      ])
    }

    window.addEventListener(eventName, onDialog)
    return () => {
      window.removeEventListener(eventName, onDialog)
    }
  }, [])

  const activeDialog = queue[0] || null
  const tones = useMemo(
    () => toneStyle(activeDialog?.tone || 'danger'),
    [activeDialog?.tone]
  )

  useEffect(() => {
    if (!activeDialog || activeDialog.type !== 'prompt') return
    const timerId = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(timerId)
  }, [activeDialog])

  const closeDialog = useCallback((value) => {
    if (!activeDialog) return
    resolveDialogRequest(activeDialog.id, value)
    setQueue(prev => prev.slice(1))
  }, [activeDialog])

  const handleConfirm = useCallback(() => {
    if (!activeDialog) return
    if (activeDialog.type === 'confirm') {
      closeDialog(true)
      return
    }
    if (activeDialog.type === 'prompt') {
      closeDialog(String(activeDialog.promptValue || ''))
      return
    }
    closeDialog(undefined)
  }, [activeDialog, closeDialog])

  const handleCancel = useCallback(() => {
    if (!activeDialog) return
    if (activeDialog.type === 'confirm') {
      closeDialog(false)
      return
    }
    if (activeDialog.type === 'prompt') {
      closeDialog(null)
      return
    }
    closeDialog(undefined)
  }, [activeDialog, closeDialog])

  useEffect(() => {
    if (!activeDialog) return

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        handleCancel()
        return
      }
      if (event.key === 'Enter') {
        if (activeDialog.type === 'prompt') {
          event.preventDefault()
          handleConfirm()
        } else if (activeDialog.type === 'alert' || activeDialog.type === 'confirm') {
          event.preventDefault()
          handleConfirm()
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeDialog, handleCancel, handleConfirm])

  if (!activeDialog) return null

  return (
    <div style={OVERLAY_STYLE} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        style={{
          ...DIALOG_STYLE,
          border: tones.border
        }}
      >
        {activeDialog.title && (
          <h2 style={{
            margin: '0 0 14px 0',
            textAlign: 'center',
            fontSize: '24px',
            letterSpacing: '0.3px',
            color: tones.heading
          }}>
            {activeDialog.title}
          </h2>
        )}

        <div style={{
          marginBottom: activeDialog.type === 'prompt' ? '14px' : '18px',
          whiteSpace: 'pre-wrap',
          lineHeight: 1.4,
          fontSize: '15px',
          color: '#e8e8e8'
        }}>
          {activeDialog.message || ''}
        </div>

        {activeDialog.type === 'prompt' && (
          <input
            ref={inputRef}
            className="input"
            value={String(activeDialog.promptValue || '')}
            onChange={(event) => {
              const nextValue = event.target.value
              setQueue(prev => {
                if (prev.length === 0) return prev
                const next = [...prev]
                next[0] = { ...next[0], promptValue: nextValue }
                return next
              })
            }}
            placeholder={activeDialog.placeholder || ''}
            style={{ marginBottom: '16px' }}
          />
        )}

        <div style={{ display: 'flex', gap: '10px' }}>
          {activeDialog.type !== 'alert' && (
            <button type="button" onClick={handleCancel} style={CANCEL_BUTTON_STYLE}>
              {activeDialog.cancelText || 'Cancel'}
            </button>
          )}
          <button
            type="button"
            onClick={handleConfirm}
            style={{
              flex: 1,
              padding: '12px 14px',
              backgroundColor: tones.buttonBg,
              color: tones.buttonText,
              border: 'none',
              borderRadius: '10px',
              fontSize: '15px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            {activeDialog.confirmText || 'OK'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default DialogHost
