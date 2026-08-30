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

test('secure BHT can read required runtime settings but cannot change them', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'The BHT settings contract runs once at phone size.')
  await signIn(page, '111111', /\/home$/)
  const result = await page.evaluate(async () => {
    const probe = await import('/tests/e2e/support/securityOperationsProbe.js')
    return {
      settings: await probe.readOperationalSettingProbe(),
      write: await probe.writeOperationalSettingProbe('security_stage10_operational', { enabled: false, version: 2 })
    }
  })
  expect(Array.isArray(result.settings)).toBe(true)
  expect(result.settings.some(item => item.id === 'security_stage10_operational')).toBe(true)
  expect(result.write).toMatch(/permission-denied|permission/i)
})

test('secure supervisor can read required runtime settings but cannot change them', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The supervisor settings contract runs once at desktop size.')
  await signIn(page, '395172', /\/dashboard\/dashboard$/)
  const result = await page.evaluate(async () => {
    const probe = await import('/tests/e2e/support/securityOperationsProbe.js')
    return {
      settings: await probe.readOperationalSettingProbe(),
      write: await probe.writeOperationalSettingProbe('security_stage10_operational', { enabled: false, version: 2 })
    }
  })
  expect(Array.isArray(result.settings)).toBe(true)
  expect(result.settings.some(item => item.id === 'security_stage10_operational')).toBe(true)
  expect(result.write).toMatch(/permission-denied|permission/i)
})

test('secure admin can change ordinary settings but not protected security boundaries', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The admin settings contract runs once at desktop size.')
  await signIn(page, '737373', /\/dashboard\/dashboard$/)
  const result = await page.evaluate(async () => {
    const probe = await import('/tests/e2e/support/securityOperationsProbe.js')
    return {
      ordinary: await probe.writeOperationalSettingProbe('security_stage10_operational', { enabled: false, version: 2 }),
      securityFoundation: await probe.writeOperationalSettingProbe('securityFoundation', { enabled: false }),
      securityWorkflows: await probe.writeOperationalSettingProbe('securityWorkflows', { enabled: false }),
      appCheck: await probe.writeOperationalSettingProbe('appCheckMonitoring', { enforcementEnabled: true })
    }
  })
  expect(result.ordinary).toBe('allowed')
  expect(result.securityFoundation).toMatch(/permission-denied|permission/i)
  expect(result.securityWorkflows).toMatch(/permission-denied|permission/i)
  expect(result.appCheck).toMatch(/permission-denied|permission/i)
})
