import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import { applyCoreResetCutover } from './utils/coreResetCutover'

const SERVICE_WORKER_READY_TIMEOUT_MS = 20_000

function withTimeout(promise, timeoutMs, message) {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  return Promise.race([promise, timeout])
    .finally(() => window.clearTimeout(timeoutId))
}

async function prepareOfflineShell() {
  if (!('serviceWorker' in navigator)) return

  let reloadingForUpdate = false
  const hadControllerAtLoad = Boolean(navigator.serviceWorker.controller)

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadControllerAtLoad || reloadingForUpdate) return
    reloadingForUpdate = true
    window.alert('SPRC Ops Hub has been updated. The app will reload to finish the update.')
    window.location.reload()
  })

  try {
    // Register immediately instead of waiting for the window load event. A
    // successful first online visit must finish installing the offline shell
    // before staff can close the browser and reasonably expect offline reopen.
    const registration = await navigator.serviceWorker.register('/sw.js')
    await withTimeout(
      navigator.serviceWorker.ready,
      SERVICE_WORKER_READY_TIMEOUT_MS,
      'Offline files did not finish saving in time.'
    )
    document.documentElement.dataset.offlineShellReady = 'true'

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || navigator.onLine === false) return
      registration.update().catch((error) => {
        console.warn('Service worker update check failed:', error)
      })
    })
  } catch (error) {
    // The online app remains usable if browser storage is temporarily
    // unavailable, but the static HTML fallback prevents a silent white screen
    // if a later offline launch cannot load the JavaScript bundle.
    console.warn('Offline shell preparation failed:', error)
  }
}

async function startApp() {
  const offlineShellPromise = prepareOfflineShell()
  await Promise.all([applyCoreResetCutover(), offlineShellPromise])
  const { default: App } = await import('./App.jsx')

  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  )
}

startApp().catch((error) => {
  console.error('Unable to complete the app reset:', error)
  const root = document.getElementById('root')
  if (!root) return
  root.textContent = error?.message || 'Unable to complete the app reset. Close other tabs and reload.'
})
