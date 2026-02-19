import { useId } from 'react'
import { MODAL_CARD_BASE_STYLE, MODAL_OVERLAY_STYLE, getModalToneStyle } from './modalStyles'

function AppModal({
  isOpen,
  title = '',
  tone = 'danger',
  maxWidth = '430px',
  children,
  footer = null
}) {
  const titleId = useId()
  const tones = getModalToneStyle(tone)

  if (!isOpen) return null

  return (
    <div style={MODAL_OVERLAY_STYLE} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        style={{
          ...MODAL_CARD_BASE_STYLE,
          border: tones.border,
          maxWidth
        }}
      >
        {title && (
          <h2
            id={titleId}
            style={{
              margin: '0 0 18px 0',
              textAlign: 'center',
              fontSize: '24px',
              lineHeight: 1.2,
              fontWeight: 700,
              letterSpacing: '0.3px',
              color: tones.heading
            }}
          >
            {title}
          </h2>
        )}

        {children}

        {footer && (
          <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export default AppModal

