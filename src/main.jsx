import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    let reloadingForUpdate = false
    const hadControllerAtLoad = Boolean(navigator.serviceWorker.controller)

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadControllerAtLoad || reloadingForUpdate) return
      reloadingForUpdate = true
      window.alert('SPRC Ops Hub has been updated. The app will reload to finish the update.')
      window.location.reload()
    })

    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        registration.update().catch((err) => {
          console.warn('Service worker update check failed:', err)
        })

        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState !== 'visible') return
          registration.update().catch((err) => {
            console.warn('Service worker update check failed:', err)
          })
        })
      })
      .catch((err) => {
        console.warn('Service worker registration failed:', err)
      })
  })
}
