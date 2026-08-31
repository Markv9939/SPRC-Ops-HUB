import { expect, test } from '@playwright/test'

async function waitForOfflineShell(page) {
  await page.evaluate(async () => {
    try {
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Service worker readiness timed out.')), 25_000)
        })
      ])
    } catch (error) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      const states = registrations.map(registration => ({
        scope: registration.scope,
        installing: registration.installing?.state || null,
        waiting: registration.waiting?.state || null,
        active: registration.active?.state || null
      }))
      const cacheNames = await caches.keys()
      throw new Error(`${error.message} registrations=${JSON.stringify(states)} caches=${JSON.stringify(cacheNames)}`)
    }
    if (navigator.serviceWorker.controller) return
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Service worker did not take control.')), 15_000)
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        clearTimeout(timeout)
        resolve()
      }, { once: true })
    })
  })
}

test('fresh production service worker opens the app shell after a cold offline restart', async ({ context, page }) => {
  await page.goto('/')
  await waitForOfflineShell(page)

  const cacheEvidence = await page.evaluate(async () => {
    const cache = await caches.open('sprc-ops-shell-v13')
    const keys = await cache.keys()
    const paths = keys.map(request => new URL(request.url).pathname)
    const byteLength = async pattern => {
      const path = paths.find(value => pattern.test(value))
      const response = path ? await cache.match(path) : null
      return response ? (await response.arrayBuffer()).byteLength : 0
    }
    return {
      hasManifest: paths.includes('/asset-manifest.json'),
      entryBytes: await byteLength(/^\/assets\/index-[^/]+\.js$/),
      appChunkBytes: await byteLength(/^\/assets\/App-[^/]+\.js$/),
      styleBytes: await byteLength(/^\/assets\/index-[^/]+\.css$/)
    }
  })
  expect(cacheEvidence.hasManifest).toBe(true)
  expect(cacheEvidence.entryBytes).toBeGreaterThan(1000)
  expect(cacheEvidence.appChunkBytes).toBeGreaterThan(1000)
  expect(cacheEvidence.styleBytes).toBeGreaterThan(1000)

  await context.setOffline(true)
  await page.close()
  const offlinePage = await context.newPage()
  const browserErrors = []
  offlinePage.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') browserErrors.push(`console:${message.type()}:${message.text()}`)
  })
  offlinePage.on('pageerror', error => browserErrors.push(`pageerror:${error.message}`))
  await offlinePage.goto('/home', { waitUntil: 'domcontentloaded' })

  await offlinePage.waitForTimeout(2_000)
  const offlineDiagnostics = await offlinePage.evaluate(() => ({
    rootHtml: document.querySelector('#root')?.innerHTML || '',
    bodyText: document.body?.innerText || '',
    scripts: [...document.scripts].map(script => script.src),
    resources: performance.getEntriesByType('resource').map(entry => entry.name)
  }))
  if (!offlineDiagnostics.rootHtml) {
    console.log(JSON.stringify({ browserErrors, offlineDiagnostics }, null, 2))
  }

  try {
    await expect(offlinePage.getByPlaceholder('Enter 6-digit PIN')).toBeVisible()
    await expect(offlinePage.locator('#root')).not.toBeEmpty()
    await expect(offlinePage.locator('body')).not.toContainText('Unable to complete the app reset')
  } finally {
    await context.setOffline(false)
  }
})
