export const MODAL_OVERLAY_STYLE = {
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

export const MODAL_CARD_BASE_STYLE = {
  width: '100%',
  maxWidth: '430px',
  backgroundColor: '#FFFFFF',
  borderRadius: '16px',
  border: '1px solid #D8D1C6',
  boxShadow: '0 14px 30px rgba(17,47,82,0.16)',
  padding: '22px',
  color: '#1F2C3A'
}

export const MODAL_CANCEL_BUTTON_STYLE = {
  flex: 1,
  padding: '12px 14px',
  backgroundColor: '#F1EFEA',
  color: '#465367',
  border: '1px solid #D8D1C6',
  borderRadius: '10px',
  fontSize: '15px',
  fontWeight: 700,
  cursor: 'pointer'
}

export function getModalToneStyle(tone) {
  if (tone === 'warning') {
    return {
      border: '1px solid rgba(176,122,40,0.40)',
      heading: '#8E611D',
      buttonBg: '#B07A28',
      buttonText: '#FFFFFF'
    }
  }
  if (tone === 'success') {
    return {
      border: '1px solid rgba(47,125,87,0.42)',
      heading: '#2F7D57',
      buttonBg: '#2F7D57',
      buttonText: '#FFFFFF'
    }
  }
  if (tone === 'info') {
    return {
      border: '1px solid rgba(70,83,103,0.32)',
      heading: '#1F3A52',
      buttonBg: '#1F3A52',
      buttonText: '#FFFFFF'
    }
  }
  return {
    border: '1px solid rgba(205,78,66,0.42)',
    heading: '#CD4E42',
    buttonBg: '#CD4E42',
    buttonText: '#FFFFFF'
  }
}

