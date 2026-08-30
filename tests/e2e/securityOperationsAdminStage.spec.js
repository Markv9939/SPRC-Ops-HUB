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

test('secure OTC supervisor operations pages are backend-scoped and writes reject RES', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The supervisor operations journey runs once at desktop size.')
  const listenerErrors = []
  page.on('console', message => {
    if (/permission-denied|missing or insufficient permissions/i.test(message.text())) listenerErrors.push(message.text())
  })
  await signIn(page, '395172', /\/dashboard\/dashboard$/)
  for (const [route, visible, hidden] of [
    ['/dashboard/properties', 'Stage 9 OTC Property', 'Stage 9 RES Property'],
    ['/dashboard/fleet', 'Stage 9 OTC Vehicle', 'Stage 9 RES Vehicle'],
    ['/dashboard/compliance', 'Stage 9 OTC Employee', 'Stage 9 RES Employee'],
    ['/dashboard/cintas', 'Stage 9 OTC Address', 'Stage 9 RES Address']
  ]) {
    await page.goto(route)
    await expect(page.getByText(visible, { exact: false }).first()).toBeVisible()
    await expect(page.getByText(hidden, { exact: false })).toHaveCount(0)
  }
  const writeResult = await page.evaluate(async () => {
    const { createPropertyProbe } = await import('/tests/e2e/support/securityOperationsProbe.js')
    return {
      otc: await createPropertyProbe('security_stage9_browser_otc_property', 'OTC', 'test_house'),
      res: await createPropertyProbe('security_stage9_browser_res_property', 'RES', 'res')
    }
  })
  expect(writeResult.otc).toBe('allowed')
  expect(writeResult.res).toMatch(/permission-denied|permission/i)
  expect(listenerErrors).toEqual([])
})

test('secure BHT cannot open supervisor operations collections', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'The BHT negative journey runs once at phone size.')
  await signIn(page, '111111', /\/home$/)
  const denial = await page.evaluate(async () => {
    const { broadPropertyReadProbe } = await import('/tests/e2e/support/securityOperationsProbe.js')
    return broadPropertyReadProbe()
  })
  expect(denial).toMatch(/permission-denied|permission/i)
})

test('secure admin retains approved all-location operations views', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The admin operations journey runs once at desktop size.')
  await signIn(page, '737373', /\/dashboard\/dashboard$/)
  for (const [route, otc, res] of [
    ['/dashboard/properties', 'Stage 9 OTC Property', 'Stage 9 RES Property'],
    ['/dashboard/fleet', 'Stage 9 OTC Vehicle', 'Stage 9 RES Vehicle'],
    ['/dashboard/compliance', 'Stage 9 OTC Employee', 'Stage 9 RES Employee'],
    ['/dashboard/cintas', 'Stage 9 OTC Address', 'Stage 9 RES Address']
  ]) {
    await page.goto(route)
    await expect(page.getByText(otc, { exact: false }).first()).toBeVisible()
    await expect(page.getByText(res, { exact: false }).first()).toBeVisible()
  }
})
