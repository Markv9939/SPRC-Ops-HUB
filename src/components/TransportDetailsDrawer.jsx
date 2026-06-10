import { useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import TransportRecordContent from './TransportRecordContent'

function TransportRecordState({ state, message, onRetry }) {
  if (state === 'loading') return <div className="transport-record-state">Loading transport...</div>
  if (state === 'not-found') return <div className="transport-record-state">Transport not found.</div>
  if (state === 'access-denied') return <div className="transport-record-state">You do not have access to this transport.</div>
  if (state === 'error') {
    return (
      <div className="transport-record-state">
        <p>{message || 'The transport could not be loaded.'}</p>
        <button type="button" className="transport-record-secondary-btn" onClick={onRetry}>Try again</button>
      </div>
    )
  }
  return null
}

function TransportDetailsDrawer({
  transport,
  loadState = 'ready',
  errorMessage = '',
  onRetry,
  onClose,
  onOpenFull,
  onPrevious,
  onNext,
  canPrevious = false,
  canNext = false,
  positionLabel = ''
}) {
  const dialogRef = useRef(null)
  const closeButtonRef = useRef(null)

  useEffect(() => {
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      if (previousFocus instanceof HTMLElement && document.contains(previousFocus)) {
        previousFocus.focus()
      }
    }
  }, [onClose])

  return (
    <div className="transport-details-overlay" role="presentation" onMouseDown={onClose}>
      <aside
        ref={dialogRef}
        className="transport-details-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Transport details"
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="transport-details-drawer-header">
          <span>Transport details</span>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close transport details">
            <X size={22} />
          </button>
        </div>

        <div className="transport-details-drawer-body">
          {loadState === 'ready' && transport
            ? <TransportRecordContent transport={transport} compact />
            : <TransportRecordState state={loadState} message={errorMessage} onRetry={onRetry} />}
        </div>

        <div className="transport-details-drawer-actions">
          <div className="transport-record-navigation">
            <button type="button" onClick={onPrevious} disabled={!canPrevious} aria-label="Previous transport">
              <ChevronLeft size={18} /> Previous
            </button>
            {positionLabel && <span>{positionLabel}</span>}
            <button type="button" onClick={onNext} disabled={!canNext} aria-label="Next transport">
              Next <ChevronRight size={18} />
            </button>
          </div>
          <button
            type="button"
            className="transport-record-primary-btn"
            onClick={onOpenFull}
            disabled={!transport || loadState !== 'ready'}
          >
            Open full record
          </button>
        </div>
      </aside>
    </div>
  )
}

export default TransportDetailsDrawer
