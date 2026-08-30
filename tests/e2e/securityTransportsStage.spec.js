import { expect, test } from '@playwright/test'

async function preparePage(page) {
  await page.addInitScript(() => localStorage.setItem('sprc_ops_onboarding_done', 'true'))
  page.on('dialog', dialog => dialog.accept())
}

async function signIn(page, pin, expectedPath) {
  await page.goto('/')
  expect(await page.evaluate(async () => {
    const runtime = await import('/src/services/securityClientRuntime.js')
    return runtime.SECURITY_CLIENT_BOOTSTRAP_COMPILED
  })).toBe(true)
  await page.getByPlaceholder('Enter 6-digit PIN').fill(pin)
  await expect(page).toHaveURL(expectedPath, { timeout: 30_000 })
}

test.beforeEach(async ({ page }) => preparePage(page))

test('same staff member on two devices gets one active transport and one safe conflict', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'The two-device conflict journey runs once at phone size.')
  const firstContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const firstPage = await firstContext.newPage()
  const secondPage = await secondContext.newPage()
  await Promise.all([preparePage(firstPage), preparePage(secondPage)])
  await Promise.all([
    signIn(firstPage, '111111', /\/home$/),
    signIn(secondPage, '111111', /\/home$/)
  ])

  const create = page => page.evaluate(async () => {
    const { createProtectedTransport } = await import('/src/services/protectedTransportService.js')
    try {
      const result = await createProtectedTransport('OTC')
      return { ok: true, transportId: result.transportId }
    } catch (error) {
      return { ok: false, error: String(error?.code || error?.message || error) }
    }
  })
  const results = await Promise.all([create(firstPage), create(secondPage)])
  expect(results.filter(result => result.ok)).toHaveLength(1)
  expect(results.filter(result => !result.ok)).toHaveLength(1)
  expect(results.find(result => !result.ok).error).toMatch(/failed-precondition|active transport already exists/i)
  await Promise.all([firstContext.close(), secondContext.close()])
})

test('secure BHT cannot create a transport for the other main location', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'The wrong-site journey runs once at phone size.')
  await signIn(page, '111111', /\/home$/)
  const denied = await page.evaluate(async () => {
    const { createProtectedTransport } = await import('/src/services/protectedTransportService.js')
    try {
      await createProtectedTransport('RES')
      return ''
    } catch (error) {
      return String(error?.code || error?.message || error)
    }
  })
  expect(denied).toMatch(/permission-denied|permission/i)
})

test('secure OTC supervisor transport listener is backend-scoped to OTC', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The supervisor transport journey runs once at desktop size.')
  const listenerErrors = []
  page.on('console', message => {
    if (/transport live update failed|permission-denied/i.test(message.text())) listenerErrors.push(message.text())
  })
  await signIn(page, '395172', /\/dashboard\/dashboard$/)
  await page.goto('/dashboard/transports')
  await expect(page.getByText('Stage 8 OTC Client')).toBeVisible()
  await expect(page.getByText('Stage 8 RES Client')).toHaveCount(0)
  expect(listenerErrors).toEqual([])
})

test('secure admin retains the approved all-site transport view', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The admin transport journey runs once at desktop size.')
  await signIn(page, '737373', /\/dashboard\/dashboard$/)
  await page.goto('/dashboard/transports')
  await expect(page.getByText('Stage 8 OTC Client')).toBeVisible()
  await expect(page.getByText('Stage 8 RES Client')).toBeVisible()
})
