/* global process */
import { expect, test } from '@playwright/test'

const projectId = process.env.GCLOUD_PROJECT || 'demo-sprc-security-phase3-e2e'

async function revokeDesktopProfile() {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'
  const url = new URL(`http://${host}/v1/projects/${projectId}/databases/(default)/documents/users/phase3_browser_desktop`)
  for (const field of ['securityVersion', 'authorizedLocations', 'issueLocationIds']) {
    url.searchParams.append('updateMask.fieldPaths', field)
  }
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fields: {
        securityVersion: { integerValue: '2' },
        authorizedLocations: { arrayValue: { values: [{ stringValue: 'OTC' }] } },
        issueLocationIds: { arrayValue: { values: [] } }
      }
    })
  })
  if (!response.ok) throw new Error(`Emulator profile update failed: ${response.status}`)
}

async function signIn(page, pin) {
  await page.goto('/')
  await page.getByPlaceholder('Enter 6-digit PIN').fill(pin)
  await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 })
  await expect(page.getByRole('button', { name: /unread notifications/i })).toBeVisible()
}

async function signOutFromUi(page) {
  const desktopSignOut = page.getByRole('button', { name: 'Sign Out' })
  if (await desktopSignOut.isVisible()) {
    await desktopSignOut.click()
  } else {
    await page.getByRole('button', { name: 'Open menu' }).click()
    await page.getByRole('button', { name: 'Sign Out' }).click()
  }
  await expect(page.getByPlaceholder('Enter 6-digit PIN')).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  page.on('dialog', dialog => dialog.accept())
  await page.addInitScript(() => localStorage.setItem('sprc_ops_onboarding_done', 'true'))
})

test('enabled emulator-only bootstrap preserves the PIN screen and restores across reload and a second tab', async ({ page }, testInfo) => {
  const pin = testInfo.project.metadata.pin
  await page.goto('/')
  await expect(page.getByText('Enter PIN to access')).toBeVisible()
  const compiled = await page.evaluate(async () => {
    const module = await import('/src/services/securityClientRuntime.js')
    return module.SECURITY_CLIENT_BOOTSTRAP_COMPILED
  })
  expect(compiled).toBe(true)

  await page.getByPlaceholder('Enter 6-digit PIN').fill(pin)
  await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 })
  const stored = await page.evaluate(() => ({
    secure: JSON.parse(localStorage.getItem('sprc_staff_session_v3')),
    legacy: sessionStorage.getItem('bhtUser')
  }))
  expect(stored.legacy).toBeNull()
  expect(stored.secure.schemaVersion).toBe(3)
  expect(stored.secure.expiresAtMs - stored.secure.issuedAtMs).toBe(84 * 60 * 60 * 1000)
  expect(JSON.stringify(stored.secure).toLowerCase()).not.toContain('pin')
  expect(JSON.stringify(stored.secure).toLowerCase()).not.toContain('customtoken')
  if (testInfo.project.name === 'mobile') {
    expect(stored.secure.scopeExpiresAtMs).toBeGreaterThan(stored.secure.issuedAtMs)
    const claims = await page.evaluate(async () => {
      const { auth } = await import('/src/firebase.js')
      return (await auth.currentUser.getIdTokenResult()).claims
    })
    expect(claims.authorizedLocations).toContain('RES')
    expect(claims.issueLocationIds).toContain('res')
  }

  await page.reload()
  await expect(page).toHaveURL(/\/home$/)
  await expect(page.getByText(/^Hi, Phase/)).toBeVisible({ timeout: 30_000 })

  await page.context().setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  const offlineHome = page.getByText(/^Hi, Phase/)
  const offlinePin = page.getByPlaceholder('Enter 6-digit PIN')
  await expect.poll(async () => (await offlineHome.isVisible()) || (await offlinePin.isVisible())).toBe(true)
  if (await offlinePin.isVisible()) {
    expect(await page.evaluate(() => localStorage.getItem('sprc_staff_session_v3'))).not.toBeNull()
  }
  await page.context().setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page).toHaveURL(/\/home$/)
  await expect(page.getByText(/^Hi, Phase/)).toBeVisible({ timeout: 30_000 })

  const secondTab = await page.context().newPage()
  secondTab.on('dialog', dialog => dialog.accept())
  await secondTab.goto('/')
  await expect(secondTab).toHaveURL(/\/home$/)
  const tabSessionId = await secondTab.evaluate(() => JSON.parse(localStorage.getItem('sprc_staff_session_v3')).sessionId)
  expect(tabSessionId).toBe(stored.secure.sessionId)
  await secondTab.close()

  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1)
})

test('invalid server PIN fails without legacy downgrade', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'One viewport is sufficient for the server failure contract.')
  await page.goto('/')
  await page.getByPlaceholder('Enter 6-digit PIN').fill('000000')
  await expect(page.getByText('PIN verification failed.')).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
  expect(await page.evaluate(() => sessionStorage.getItem('bhtUser'))).toBeNull()
})

test('same user on two browser devices keeps independent sessions and logout affects one device', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'One viewport is sufficient for the independent-device contract.')
  await signIn(page, '111111')
  const firstSession = await page.evaluate(() => JSON.parse(localStorage.getItem('sprc_staff_session_v3')).sessionId)

  const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const secondDevice = await secondContext.newPage()
  secondDevice.on('dialog', dialog => dialog.accept())
  await secondDevice.addInitScript(() => localStorage.setItem('sprc_ops_onboarding_done', 'true'))
  await signIn(secondDevice, '111111')
  const secondSession = await secondDevice.evaluate(() => JSON.parse(localStorage.getItem('sprc_staff_session_v3')).sessionId)
  expect(secondSession).not.toBe(firstSession)

  await signOutFromUi(page)
  await expect(secondDevice).toHaveURL(/\/home$/)
  await expect(secondDevice.getByRole('button', { name: /unread notifications/i })).toBeVisible()
  await secondContext.close()
})

test('live all-device revocation returns the staff member to the PIN screen', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One viewport is sufficient for the live revocation listener.')
  await signIn(page, '444444')
  await revokeDesktopProfile()
  await expect(page.getByPlaceholder('Enter 6-digit PIN')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('sprc_staff_session_v3'))).toBeNull()
})
