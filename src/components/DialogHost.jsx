import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getDialogEventName, resolveDialogRequest } from '../utils/dialogs'
import {
  MODAL_CANCEL_BUTTON_STYLE,
  MODAL_CARD_BASE_STYLE,
  MODAL_OVERLAY_STYLE,
  getModalToneStyle
} from './modalStyles'

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
    () => getModalToneStyle(activeDialog?.tone || 'danger'),
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
    <div style={MODAL_OVERLAY_STYLE} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        style={{
          ...MODAL_CARD_BASE_STYLE,
          border: tones.border
        }}
      >
        {activeDialog.title && (
          <h2 style={{
            margin: '0 0 14px 0',
            textAlign: 'center',
            fontSize: '24px',
            lineHeight: 1.2,
            fontWeight: 700,
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
          color: '#465367'
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
            <button type="button" onClick={handleCancel} style={MODAL_CANCEL_BUTTON_STYLE}>
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


