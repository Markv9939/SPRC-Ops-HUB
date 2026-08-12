import { useState } from 'react'
import AppModal from './AppModal'
import { MODAL_CANCEL_BUTTON_STYLE } from './modalStyles'
import {
  TRANSPORT_TIME_FUTURE_TOLERANCE_MS,
  formatTransportDateTimeInputValue,
  parseTransportDateTimeInputValue,
  toTransportRecordDate
} from '../utils/transportRecord'

function getFinishTimeError(finishAt, departedAt, latestAllowedAt) {
  if (!finishAt) return 'Enter a finish time.'
  if (latestAllowedAt && finishAt.getTime() > latestAllowedAt.getTime()) {
    return 'Finish time cannot be in the future.'
  }
  if (departedAt && finishAt.getTime() < departedAt.getTime()) {
    return 'Finish time cannot be before the start time.'
  }
  return ''
}

function DCPaperworkModal({ onComplete, onCancel, departedAt }) {
  const [selected, setSelected] = useState('')
  const [otherNote, setOtherNote] = useState('')
  const [showFinishTimeEditor, setShowFinishTimeEditor] = useState(false)
  const [finishTimeValue, setFinishTimeValue] = useState(() => formatTransportDateTimeInputValue(new Date()))
  const [finishTimeChanged, setFinishTimeChanged] = useState(false)
  const [latestAllowedFinishAt] = useState(() => new Date(Date.now() + TRANSPORT_TIME_FUTURE_TOLERANCE_MS))

  const options = [
    { value: 'collected', label: 'Collected' },
    { value: 'na', label: 'N/A' },
    { value: 'other', label: 'Other' }
  ]

  const finishAt = parseTransportDateTimeInputValue(finishTimeValue)
  const departedDate = toTransportRecordDate(departedAt)
  const finishTimeError = getFinishTimeError(finishAt, departedDate, latestAllowedFinishAt)
  const isValid = selected && (selected !== 'other' || otherNote.trim()) && !finishTimeError

  const handleContinue = () => {
    if (!isValid) return
    onComplete({
      status: selected,
      otherNote: selected === 'other' ? otherNote.trim() : '',
      returnedAt: finishTimeChanged ? finishAt : new Date(),
      finishTimeChanged
    })
  }

  return (
    <AppModal
      isOpen
      title="DC paperwork status"
      tone="info"
      maxWidth="430px"
      footer={(
        <>
          <button onClick={onCancel} style={MODAL_CANCEL_BUTTON_STYLE}>
            Cancel
          </button>
          <button
            onClick={handleContinue}
            disabled={!isValid}
            style={{
              flex: 1,
              padding: '12px 14px',
              backgroundColor: isValid ? '#2F7D57' : '#E6E9ED',
              color: isValid ? '#FFFFFF' : '#7A8795',
              border: 'none',
              borderRadius: '10px',
              fontSize: '15px',
              fontWeight: 700,
              cursor: isValid ? 'pointer' : 'not-allowed',
              opacity: isValid ? 1 : 0.9
            }}
          >
            Continue
          </button>
        </>
      )}
    >
      <div style={{ marginBottom: '20px' }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSelected(opt.value)}
              style={{
                padding: '12px 16px',
                borderRadius: '8px',
                fontSize: '14px',
                cursor: 'pointer',
                border: selected === opt.value
                  ? '2px solid #CD4E42'
                  : '1px solid #D8D1C6',
                backgroundColor: selected === opt.value
                  ? 'rgba(205,78,66,0.12)'
                  : '#F8F5F1',
                color: selected === opt.value
                  ? '#9B3D34'
                  : '#1F2C3A',
                fontWeight: selected === opt.value ? 700 : 600,
                textAlign: 'left'
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {selected === 'other' && (
        <div style={{ marginBottom: '20px' }}>
          <label style={{
            fontSize: '13px',
            color: '#465367',
            display: 'block',
            marginBottom: '6px'
          }}>
            Note (required) *
          </label>
          <textarea
            value={otherNote}
            onChange={(e) => setOtherNote(e.target.value)}
            placeholder="Add the specific concern or reason..."
            rows={3}
            style={{
              width: '100%',
              padding: '12px',
              border: '1px solid #C9D3DD',
              borderRadius: '8px',
              fontSize: '14px',
              outline: 'none',
              boxSizing: 'border-box',
              resize: 'vertical',
              fontFamily: 'inherit',
              backgroundColor: '#FFFFFF',
              color: '#1F2C3A'
            }}
          />
        </div>
      )}

      <div style={{
        borderTop: '1px solid #E1E6EA',
        paddingTop: '16px',
        marginTop: selected === 'other' ? '0' : '4px'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          marginBottom: showFinishTimeEditor ? '10px' : '0'
        }}>
          <div>
            <div style={{ fontSize: '13px', color: '#5C6878', fontWeight: 700 }}>Finish time</div>
            <div style={{ fontSize: '15px', color: '#1F2C3A', fontWeight: 700 }}>
              {finishAt ? finishAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '--:--'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowFinishTimeEditor(value => !value)}
            style={{
              padding: '8px 10px',
              borderRadius: '8px',
              border: '1px solid #C9D3DD',
              background: '#FFFFFF',
              color: '#1F2C3A',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            {showFinishTimeEditor ? 'Hide' : 'Change'}
          </button>
        </div>
        {showFinishTimeEditor && (
          <input
            type="datetime-local"
            value={finishTimeValue}
            max={formatTransportDateTimeInputValue(latestAllowedFinishAt)}
            onChange={(event) => {
              setFinishTimeValue(event.target.value)
              setFinishTimeChanged(true)
            }}
            style={{
              width: '100%',
              padding: '12px',
              border: finishTimeError ? '1px solid #C94A3F' : '1px solid #C9D3DD',
              borderRadius: '8px',
              fontSize: '15px',
              outline: 'none',
              boxSizing: 'border-box',
              backgroundColor: '#FFFFFF',
              color: '#1F2C3A'
            }}
          />
        )}
        {finishTimeError && (
          <div style={{ color: '#9D362E', fontSize: '12px', fontWeight: 700, marginTop: '6px' }}>
            {finishTimeError}
          </div>
        )}
      </div>
    </AppModal>
  )
}

export default DCPaperworkModal


