import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import TransportRecordContent from './TransportRecordContent'

function TransportRecordPage({
  transport,
  loadState = 'ready',
  errorMessage = '',
  onRetry,
  onBackToLog,
  onPrevious,
  onNext,
  canPrevious = false,
  canNext = false,
  positionLabel = ''
}) {
  return (
    <div className="transport-record-page">
      <button type="button" className="transport-record-back-btn" onClick={onBackToLog}>
        <ArrowLeft size={18} /> Back to transport log
      </button>

      {loadState === 'ready' && transport ? (
        <TransportRecordContent transport={transport} />
      ) : (
        <div className="transport-record-state transport-record-page-state">
          {loadState === 'loading' && 'Loading transport...'}
          {loadState === 'not-found' && 'Transport not found.'}
          {loadState === 'access-denied' && 'You do not have access to this transport.'}
          {loadState === 'error' && (
            <>
              <p>{errorMessage || 'The transport could not be loaded.'}</p>
              <button type="button" className="transport-record-secondary-btn" onClick={onRetry}>Try again</button>
            </>
          )}
        </div>
      )}

      {loadState === 'ready' && transport && (
        <div className="transport-record-page-navigation">
          <button type="button" onClick={onPrevious} disabled={!canPrevious}>
            <ChevronLeft size={20} /> Previous transport
          </button>
          {positionLabel && <span>{positionLabel}</span>}
          <button type="button" onClick={onNext} disabled={!canNext}>
            Next transport <ChevronRight size={20} />
          </button>
        </div>
      )}
    </div>
  )
}

export default TransportRecordPage
