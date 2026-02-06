import { useState } from 'react'

function DCCheckModal({ onComplete, onCancel }) {
  const [selectedOption, setSelectedOption] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const dcOptions = [
    'All signed',
    'Missing signature',
    'Incomplete',
    'Other'
  ]

  const handleSubmit = () => {
    if (!selectedOption) {
      setError('Please select an option')
      return
    }

    if (selectedOption === 'Other' && !note.trim()) {
      setError('Please provide a note for "Other"')
      return
    }

    onComplete({
      completed: true,
      option: selectedOption,
      note: note.trim() || null
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
          DC Paperwork Check
        </h2>

        <div style={{ marginBottom: '20px' }}>
          <label style={{
            fontSize: '13px',
            color: '#888',
            display: 'block',
            marginBottom: '10px'
          }}>
            Status *
          </label>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            {dcOptions.map((option) => (
              <button
                key={option}
                onClick={() => {
                  setSelectedOption(option)
                  setError('')
                }}
                style={{
                  padding: '12px 16px',
                  borderRadius: '8px',
                  fontSize: '14px',
                  cursor: 'pointer',
                  border: selectedOption === option
                    ? '2px solid #C94A3F'
                    : '2px solid #ddd',
                  backgroundColor: selectedOption === option
                    ? '#FDE8E7'
                    : 'white',
                  color: selectedOption === option
                    ? '#C94A3F'
                    : '#333',
                  fontWeight: selectedOption === option ? 'bold' : 'normal',
                  textAlign: 'left'
                }}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        {selectedOption === 'Other' && (
          <div style={{ marginBottom: '20px' }}>
            <label style={{
              fontSize: '13px',
              color: '#888',
              display: 'block',
              marginBottom: '6px'
            }}>
              Note (required for Other) *
            </label>
            <textarea
              value={note}
              onChange={(e) => {
                setNote(e.target.value)
                setError('')
              }}
              placeholder="Explain the issue..."
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

        {error && (
          <p style={{
            color: '#C94A3F',
            fontSize: '13px',
            marginBottom: '16px',
            textAlign: 'center'
          }}>
            {error}
          </p>
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
            onClick={handleSubmit}
            style={{
              flex: 1,
              padding: '14px',
              backgroundColor: '#C94A3F',
              color: 'white',
              border: 'none',
              borderRadius: '10px',
              fontSize: '16px',
              fontWeight: 'bold',
              cursor: 'pointer'
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

export default DCCheckModal
