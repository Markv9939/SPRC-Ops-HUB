import { useState } from 'react'
import AppModal from './AppModal'
import { MODAL_CANCEL_BUTTON_STYLE } from './modalStyles'

function DCPaperworkModal({ onComplete, onCancel }) {
  const [selected, setSelected] = useState('')
  const [otherNote, setOtherNote] = useState('')

  const options = [
    { value: 'collected', label: 'Collected' },
    { value: 'na', label: 'N/A' },
    { value: 'other', label: 'Other' }
  ]

  const isValid = selected && (selected !== 'other' || otherNote.trim())

  const handleContinue = () => {
    if (!isValid) return
    onComplete({
      status: selected,
      otherNote: selected === 'other' ? otherNote.trim() : ''
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
            placeholder="Explain..."
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
    </AppModal>
  )
}

export default DCPaperworkModal


