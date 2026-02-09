import { useState } from 'react'

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
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '20px'
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '16px',
        padding: '24px',
        maxWidth: '400px',
        width: '100%',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)'
      }}>
        <h2 style={{
          margin: '0 0 20px 0',
          fontSize: '20px',
          color: '#333',
          textAlign: 'center'
        }}>
          DC paperwork status
        </h2>

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
                    ? '2px solid #C94A3F'
                    : '2px solid #ddd',
                  backgroundColor: selected === opt.value
                    ? '#FDE8E7'
                    : 'white',
                  color: selected === opt.value
                    ? '#C94A3F'
                    : '#333',
                  fontWeight: selected === opt.value ? 'bold' : 'normal',
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
              color: '#888',
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
                border: '2px solid #ddd',
                borderRadius: '8px',
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box',
                resize: 'vertical',
                fontFamily: 'inherit'
              }}
            />
          </div>
        )}

        <div style={{
          display: 'flex',
          gap: '10px'
        }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: '14px',
              backgroundColor: '#e8e8e8',
              color: '#666',
              border: 'none',
              borderRadius: '10px',
              fontSize: '16px',
              fontWeight: 'bold',
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleContinue}
            disabled={!isValid}
            style={{
              flex: 1,
              padding: '14px',
              backgroundColor: isValid ? '#C94A3F' : '#e8e8e8',
              color: isValid ? 'white' : '#999',
              border: 'none',
              borderRadius: '10px',
              fontSize: '16px',
              fontWeight: 'bold',
              cursor: isValid ? 'pointer' : 'not-allowed',
              opacity: isValid ? 1 : 0.6
            }}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}

export default DCPaperworkModal
