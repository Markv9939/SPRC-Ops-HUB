import { chromium } from 'playwright'

const launchOptions = {
  channel: 'chrome',
  headless: true,
  viewport: { width: 390, height: 844 },
  serviceWorkers: 'allow'
}

export async function runSecurityOfflineProcessRestart({ baseURL, profilePath }) {
  let context
  let readyBeforeClose = false
  let cacheName = null

  try {
    context = await chromium.launchPersistentContext(profilePath, launchOptions)
    let page = context.pages()[0] || await context.newPage()
    await page.goto(baseURL)
    await page.waitForFunction(
      () => document.documentElement.dataset.offlineShellReady === 'true',
      null,
      { timeout: 30_000 }
    )
    const prepared = await page.evaluate(async () => ({
      controlled: Boolean(navigator.serviceWorker.controller),
      cacheNames: await caches.keys()
    }))
    readyBeforeClose = prepared.controlled
    cacheName = prepared.cacheNames.find(name => name === 'sprc-ops-shell-v13') || null
    await context.close()
    context = null

    context = await chromium.launchPersistentContext(profilePath, launchOptions)
    await context.setOffline(true)
    page = context.pages()[0] || await context.newPage()
    await page.goto(`${baseURL}/home`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.locator('input[placeholder="Enter 6-digit PIN"]').waitFor({
      state: 'visible',
      timeout: 30_000
    })
    const offlineRootWasNonblank = await page.locator('#root').evaluate(root => (
      root.textContent.trim().length > 0
    ))

    return {
      cacheName,
      readyBeforeClose,
      offlineRootWasNonblank,
      offlinePinWasVisible: true
    }
  } finally {
    if (context) {
      await context.setOffline(false).catch(() => {})
      await context.close().catch(() => {})
    }
  }
}
