import { useEffect, useRef, useState } from 'react'
import { getToastEventName } from '../utils/toast'

function ToastHost() {
  const [toasts, setToasts] = useState([])
  const timersRef = useRef(new Map())

  useEffect(() => {
    const eventName = getToastEventName()
    const timerMap = timersRef.current

    const dismissToast = (toastId) => {
      setToasts(prev => prev.filter(t => t.id !== toastId))
      const timerId = timerMap.get(toastId)
      if (timerId) {
        clearTimeout(timerId)
        timerMap.delete(toastId)
      }
    }

    const onToast = (event) => {
      const detail = event?.detail || {}
      const toast = {
        id: detail.id || `${Date.now()}-${Math.random()}`,
        message: String(detail.message || '').trim(),
        type: detail.type || 'info',
        duration: Math.max(1200, Number(detail.duration) || 2600)
      }
      if (!toast.message) return

      setToasts(prev => [...prev.slice(-3), toast])
      const timerId = setTimeout(() => dismissToast(toast.id), toast.duration)
      timerMap.set(toast.id, timerId)
    }

    window.addEventListener(eventName, onToast)
    return () => {
      window.removeEventListener(eventName, onToast)
      timerMap.forEach(timerId => clearTimeout(timerId))
      timerMap.clear()
    }
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="toast-host" aria-live="polite" aria-atomic="false">
      {toasts.map(toast => (
        <div key={toast.id} className={`toast toast-${toast.type}`}>
          {toast.message}
        </div>
      ))}
    </div>
  )
}

export default ToastHost
