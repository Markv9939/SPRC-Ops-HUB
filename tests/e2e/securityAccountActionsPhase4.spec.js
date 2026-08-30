import { expect, test } from '@playwright/test'

async function signIn(page, pin, expectedPath = /\/(home|dashboard\/dashboard)$/) {
  await page.goto('/')
  await page.getByPlaceholder('Enter 6-digit PIN').fill(pin)
  await expect(page).toHaveURL(expectedPath, { timeout: 30_000 })
}

async function openChangePin(page) {
  const direct = page.getByRole('button', { name: 'Change PIN' })
  if (await direct.isVisible()) {
    await direct.click()
    return
  }
  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('button', { name: 'Change PIN' }).click()
}

test.beforeEach(async ({ page }) => {
  page.on('dialog', dialog => dialog.accept())
  await page.addInitScript(() => localStorage.setItem('sprc_ops_onboarding_done', 'true'))
})

test('the familiar self-service PIN modal uses the protected server action and requires sign-in again', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'One phone viewport is sufficient for the self-PIN action.')
  await signIn(page, '284619', /\/home$/)
  await openChangePin(page)
  await page.getByPlaceholder('Current PIN').fill('284619')
  await page.getByPlaceholder('New PIN', { exact: true }).fill('736194')
  await page.getByPlaceholder('Confirm New PIN', { exact: true }).fill('736194')
  await page.getByRole('button', { name: 'Update PIN' }).click()
  await expect(page.getByPlaceholder('Enter 6-digit PIN')).toBeVisible({ timeout: 30_000 })

  await page.getByPlaceholder('Enter 6-digit PIN').fill('284619')
  await expect(page.getByText('PIN verification failed.')).toBeVisible()
  await page.getByPlaceholder('Enter 6-digit PIN').fill('736194')
  await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 })
})

test('supervisor end-all-sessions signs the in-location BHT out on two devices', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One desktop management viewport is sufficient for coordinated revocation.')
  const firstContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const secondContext = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const firstBht = await firstContext.newPage()
  const secondBht = await secondContext.newPage()
  for (const bhtPage of [firstBht, secondBht]) {
    bhtPage.on('dialog', dialog => dialog.accept())
    await bhtPage.addInitScript(() => localStorage.setItem('sprc_ops_onboarding_done', 'true'))
    await signIn(bhtPage, '472619', /\/home$/)
  }

  await signIn(page, '395172', /\/dashboard\/dashboard$/)
  await page.goto('/dashboard/users')
  const targetId = page.getByText('Internal ID: phase4_end_sessions_bht')
  await expect(targetId).toBeVisible()
  const targetCard = targetId.locator('xpath=../../../..')
  await targetCard.getByRole('button', { name: 'End Sessions' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'End Sessions' }).click()
  await expect(page.getByText('All active sessions ended')).toBeVisible()
  await expect(firstBht.getByPlaceholder('Enter 6-digit PIN')).toBeVisible({ timeout: 30_000 })
  await expect(secondBht.getByPlaceholder('Enter 6-digit PIN')).toBeVisible({ timeout: 30_000 })
  await firstContext.close()
  await secondContext.close()
})

test('supervisor keeps the existing edit screen while a protected PIN reset revokes the target session', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'tablet', 'One tablet management viewport is sufficient for the reset screen.')
  const targetContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const targetPage = await targetContext.newPage()
  targetPage.on('dialog', dialog => dialog.accept())
  await targetPage.addInitScript(() => localStorage.setItem('sprc_ops_onboarding_done', 'true'))
  await signIn(targetPage, '619274', /\/home$/)

  await signIn(page, '395172', /\/dashboard\/dashboard$/)
  await page.goto('/dashboard/users')
  const targetId = page.getByText('Internal ID: phase4_target_bht')
  await expect(targetId).toBeVisible()
  const targetCard = targetId.locator('xpath=../../../..')
  await targetCard.getByRole('button', { name: 'Edit' }).click()
  await targetCard.getByPlaceholder('6 digits').fill('862741')
  await targetCard.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(targetPage.getByPlaceholder('Enter 6-digit PIN')).toBeVisible({ timeout: 30_000 })
  await targetContext.close()
})

test('supervisor can create an in-location BHT but cannot see or assign another location', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One desktop management viewport is sufficient for scoped account creation.')
  await signIn(page, '395172', /\/dashboard\/dashboard$/)
  await page.goto('/dashboard/users')

  await expect(page.getByText('Internal ID: phase4_target_bht')).toBeVisible()
  await expect(page.getByText('Internal ID: phase4_out_of_scope_res_bht')).toHaveCount(0)
  await page.getByRole('button', { name: '+ Add New User' }).click()

  await expect(page.getByLabel('Staff role')).toHaveValue('bht')
  await expect(page.getByLabel('Staff location')).toHaveValue('OTC')
  await expect(page.getByLabel('Staff role').locator('option')).toHaveCount(2)
  await expect(page.getByLabel('Staff role').locator('option[value="supervisor"]')).toHaveCount(0)
  await expect(page.getByLabel('Staff role').locator('option[value="admin"]')).toHaveCount(0)
  await expect(page.getByLabel('Staff location').locator('option')).toHaveCount(2)
  await page.getByLabel('Staff name').fill('Supervisor Created Browser BHT')
  await page.getByRole('button', { name: 'Generate secure PIN' }).click()
  await expect(page.getByLabel('Staff PIN')).toHaveValue(/^\d{6}$/)
  await page.getByLabel('BHT home house').selectOption('TEST_HOUSE')
  await page.getByRole('button', { name: 'Test Van' }).click()
  await page.getByLabel('BHT shift').selectOption('shift_1')
  await page.getByRole('button', { name: 'Save', exact: true }).first().click()

  await expect(page.getByText('Internal ID: supervisor_created_browser_bht')).toBeVisible({ timeout: 30_000 })
})

test('secure admin can create one-home RES BHT and the new account receives only RES scope', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One desktop admin viewport is sufficient for the RES creation journey.')
  await signIn(page, '737373', /\/dashboard\/dashboard$/)
  await page.goto('/dashboard/users')
  await page.getByRole('button', { name: '+ Add New User' }).click()

  await page.getByLabel('Staff name').fill('RES Browser Canary BHT')
  await page.getByRole('button', { name: 'Generate secure PIN' }).click()
  const generatedPin = await page.getByLabel('Staff PIN').inputValue()
  expect(generatedPin).toMatch(/^\d{6}$/)
  await page.getByLabel('Staff role').selectOption('bht')
  await page.getByLabel('Staff location').selectOption('RES')
  await expect(page.getByLabel('BHT home house')).toHaveCount(0)
  await page.getByRole('button', { name: 'Van 3' }).click()
  await page.getByLabel('BHT shift').selectOption('res_shift_1_day')
  await page.getByRole('button', { name: 'Save', exact: true }).first().click()
  await expect(page.getByText('Internal ID: res_browser_canary_bht')).toBeVisible({ timeout: 30_000 })

  const bhtContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const bhtPage = await bhtContext.newPage()
  bhtPage.on('dialog', dialog => dialog.accept())
  await bhtPage.addInitScript(() => localStorage.setItem('sprc_ops_onboarding_done', 'true'))
  await signIn(bhtPage, generatedPin, /\/home$/)
  const evidence = await bhtPage.evaluate(async () => {
    const { auth } = await import('/src/firebase.js')
    const { restoreSecurityClientSession } = await import('/src/services/securityClientRuntime.js')
    const restored = await restoreSecurityClientSession()
    const claims = (await auth.currentUser.getIdTokenResult()).claims
    return {
      status: restored.status,
      profileId: restored.user?.id,
      locationId: restored.user?.locationId,
      authorizedLocations: restored.user?.authorizedLocations,
      issueLocationIds: restored.user?.issueLocationIds,
      claimRole: claims.role,
      claimLocationId: claims.locationId,
      claimAuthorizedLocations: claims.authorizedLocations,
      claimIssueLocationIds: claims.issueLocationIds,
      legacySession: sessionStorage.getItem('bhtUser')
    }
  })
  expect(evidence).toEqual({
    status: 'authenticated',
    profileId: 'res_browser_canary_bht',
    locationId: 'res',
    authorizedLocations: ['RES'],
    issueLocationIds: ['res'],
    claimRole: 'bht',
    claimLocationId: 'res',
    claimAuthorizedLocations: ['RES'],
    claimIssueLocationIds: ['res'],
    legacySession: null
  })
  await bhtContext.close()
})
