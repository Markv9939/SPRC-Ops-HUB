import { expect, test } from '@playwright/test'

async function login(page, pin) {
  await page.goto('/')
  await page.getByPlaceholder('Enter 6-digit PIN').fill(pin)
  await expect(page).not.toHaveURL(/\/$/)
}

async function assertNoOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1)
}

async function assertEocResponsiveLayout(page) {
  await assertNoOverflow(page)
  const layout = await page.evaluate(() => {
    const rail = document.querySelector('.eoc-area-rail')?.getBoundingClientRect()
    const nav = document.querySelector('.eoc-area-panel-nav')?.getBoundingClientRect()
    const panel = document.querySelector('.eoc-area-panel')?.getBoundingClientRect()
    const topbar = document.querySelector('.app-topbar')?.getBoundingClientRect()
    return {
      width: window.innerWidth,
      topbarBottom: topbar?.bottom || 0,
      railTop: rail?.top || 0,
      railBottom: rail?.bottom || 0,
      railRight: rail?.right || 0,
      navTop: nav?.top || 0,
      panelLeft: panel?.left || 0
    }
  })

  expect(layout.railTop).toBeGreaterThanOrEqual(layout.topbarBottom - 2)
  if (layout.width < 900) {
    expect(layout.navTop).toBeGreaterThanOrEqual(layout.railBottom - 2)
  } else {
    expect(layout.navTop).toBeGreaterThanOrEqual(layout.topbarBottom - 2)
    expect(layout.panelLeft).toBeGreaterThanOrEqual(layout.railRight)
  }
}

async function addSyntheticPhoto(page, buffer, source = 'device') {
  await page.getByRole('button', { name: /Add photo/ }).click()
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: source === 'camera' ? 'Take photo' : 'Choose from device' }).click()
  const chooser = await chooserPromise
  expect(chooser.isMultiple()).toBe(source !== 'camera')
  await chooser.setFiles({
    name: `synthetic-${source}-problem.png`,
    mimeType: 'image/png',
    buffer
  })
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sprc_ops_onboarding_done', 'true'))
})

test('BHT issue, protected photo, EOC, offline retry, and supervisor tools', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'tablet', 'Tablet coverage is handled by the focused EOC area-rail test.')

  const consoleErrors = []
  page.on('console', message => {
    if (message.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|network-request-failed/i.test(message.text())) {
      consoleErrors.push(message.text())
    }
  })

  const pin = testInfo.project.metadata.pin
  const unique = `${testInfo.project.name} synthetic water leak`
  await login(page, pin)

  const largePhoto = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 4000
    canvas.height = 3000
    const context = canvas.getContext('2d')
    context.fillStyle = '#4b7f52'
    context.fillRect(0, 0, canvas.width, canvas.height)
    const source = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    const { processIssuePhoto } = await import('/src/services/photoProcessingService.js')
    const processed = await processIssuePhoto(new File([source], 'synthetic-12mp.png', { type: 'image/png' }))
    const { getPhotoStorageReadiness } = await import('/src/services/offlineStore.js')
    const quota = await getPhotoStorageReadiness(Number.MAX_SAFE_INTEGER)
    return { width: processed.width, height: processed.height, size: processed.size, type: processed.type, quotaEnough: quota.enoughSpace }
  })
  expect(largePhoto).toMatchObject({ width: 1600, height: 1200, type: 'image/jpeg', quotaEnough: false })
  expect(largePhoto.size).toBeLessThanOrEqual(2 * 1024 * 1024)

  await page.goto('/issues')
  await expect(page.getByRole('heading', { name: 'Issues', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^Resolved/ }).click()
  await expect(page.getByText('Latch was difficult to close.')).toBeVisible()
  await page.getByRole('button', { name: /^Active/ }).click()

  await page.getByRole('button', { name: /Report$/ }).click()
  await page.locator('.location-report-modal select').first().selectOption('safety_concern')
  await expect(page.getByRole('alert')).toContainText('If anyone is in immediate danger, follow emergency procedures and contact a supervisor before submitting this report.')
  await page.locator('.location-report-modal textarea').fill(unique)
  await page.getByRole('button', { name: /Add photo/ }).click()
  await expect(page.getByRole('heading', { name: 'Protect client privacy' })).toBeVisible()
  await expect(page.getByText('Only photograph the problem.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Take photo' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Choose from device' })).toBeVisible()
  await expect(page.locator('.location-report-modal input[type=file][capture=environment]')).toHaveAttribute('accept', 'image/*')
  const cameraChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Take photo' }).click()
  const cameraChooser = await cameraChooserPromise
  expect(cameraChooser.isMultiple()).toBe(false)
  const syntheticImage = await page.screenshot()
  await cameraChooser.setFiles({
    name: 'synthetic-problem.png',
    mimeType: 'image/png',
    buffer: syntheticImage
  })
  await expect(page.locator('.issue-photo-preview img')).toBeVisible()
  await page.getByRole('button', { name: 'Submit Issue' }).click()
  await expect(page.getByText(unique)).toBeVisible()
  await page.locator('.location-issue-card').filter({ hasText: unique }).click()
  await expect(page).toHaveURL(/\/issues\//)
  await expect(page.getByRole('heading', { name: 'Photos' })).toBeVisible()
  await expect(page.locator('.issue-photo-gallery img')).toBeVisible()

  const retryDescription = `${testInfo.project.name} synthetic failed photo retry`
  await page.goto('/issues')
  await page.evaluate(() => sessionStorage.setItem('sprc_e2e_fail_photo_upload', 'true'))
  expect(await page.evaluate(() => sessionStorage.getItem('sprc_e2e_fail_photo_upload'))).toBe('true')
  await page.getByRole('button', { name: /Report$/ }).click()
  await page.locator('.location-report-modal select').first().selectOption('other')
  await page.locator('.location-report-modal textarea').fill(retryDescription)
  await addSyntheticPhoto(page, syntheticImage)
  await expect(page.locator('.issue-photo-preview img')).toBeVisible()
  await page.getByRole('button', { name: 'Submit Issue' }).click()
  await expect.poll(() => page.evaluate(async () => {
    const { listOfflineAttachments } = await import('/src/services/offlineStore.js')
    const records = await listOfflineAttachments({ states: ['waiting', 'failed', 'uploading'] })
    return records.length
  })).toBeGreaterThan(0)
  await page.goto('/home')
  await expect(page.locator('.pending-photo-banner')).toContainText('photo pending')
  await page.evaluate(() => sessionStorage.removeItem('sprc_e2e_fail_photo_upload'))
  await page.locator('.pending-photo-banner').getByRole('button', { name: 'Retry' }).click()
  await expect(page.locator('.pending-photo-banner')).toHaveCount(0, { timeout: 20_000 })
  await page.goto('/issues')
  await page.locator('.location-issue-card').filter({ hasText: retryDescription }).click()
  await expect(page.locator('.issue-photo-gallery img')).toBeVisible()

  await page.goto('/home')
  await page.getByRole('button', { name: /House EOC/ }).first().click()
  await expect(page.getByRole('heading', { name: 'House EOC' })).toBeVisible()
  await expect(page.getByText('Draft ready')).toBeVisible()
  await page.getByRole('button', { name: /Kitchen, 0 of 1 complete/ }).click()
  await expect(page.getByRole('heading', { name: 'Is the kitchen sink working without leaks?' })).toBeVisible()
  const kitchenCard = page.locator('#eoc-card-phase3_kitchen_sink')
  await kitchenCard.getByRole('button', { name: /Needs attention/ }).click()
  await page.getByLabel('Describe the issue').fill(`Sink leak observed during ${testInfo.project.name} test.`)
  await page.getByLabel('Unable to safely take a photo').check()
  await page.getByPlaceholder('Explain why a photo cannot be taken safely.').fill('Synthetic test verifies the required safety exception.')
  await page.getByRole('button', { name: /Safety, 0 of 1 complete/ }).click()
  const safetyCard = page.locator('#eoc-card-phase3_smoke_detectors')
  await safetyCard.getByRole('button', { name: /Looks good/ }).click()
  await expect(page.getByLabel(/2 of 2 checklist items complete/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Safety', exact: true })).toBeVisible()
  await assertEocResponsiveLayout(page)
  await page.getByRole('button', { name: /^Review EOC/ }).click()
  await expect(page.getByRole('heading', { name: 'Review EOC' })).toBeVisible()
  await page.getByRole('button', { name: 'Edit Is the kitchen sink working without leaks?' }).click()
  await expect(page.getByRole('heading', { name: 'Kitchen', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^Review EOC/ }).click()
  await page.getByRole('button', { name: 'Submit EOC' }).click()
  await expect(page).toHaveURL(/\/home$/)

  await page.goto('/issues?offline-test=1')
  await page.getByRole('button', { name: /Report$/ }).click()
  await page.locator('.location-report-modal select').first().selectOption('other')
  const offlineDescription = `${testInfo.project.name} queued offline issue`
  await page.locator('.location-report-modal textarea').fill(offlineDescription)
  await addSyntheticPhoto(page, syntheticImage)
  await expect(page.locator('.issue-photo-preview img')).toBeVisible()
  await expect(page.getByText(/Offline: this report will send/)).toBeVisible()
  await page.getByRole('button', { name: 'Submit Issue' }).click()
  await page.goto('/home?offline-test=1')
  await expect(page.locator('.pending-photo-banner')).toContainText('photo pending')

  await page.evaluate(() => {
    sessionStorage.clear()
    localStorage.removeItem('lastActivity')
  })
  await page.goto('/?offline-test=1')
  await page.getByPlaceholder('Enter 6-digit PIN').fill('222222')
  await expect(page).toHaveURL(/\/dashboard\/dashboard/)
  await page.goto('/dashboard/eoc?offline-test=1')
  await page.getByRole('button', { name: /^Issues/ }).click()
  await expect(page.locator('.pending-photo-banner')).toHaveCount(0)

  await page.evaluate(() => {
    sessionStorage.clear()
    localStorage.removeItem('lastActivity')
  })
  await login(page, pin)
  await page.goto('/issues')
  await expect(page.locator('.location-issue-card').filter({ hasText: offlineDescription })).toBeVisible({ timeout: 20_000 })

  await page.evaluate(() => {
    sessionStorage.clear()
    localStorage.removeItem('lastActivity')
  })
  await login(page, '222222')
  await page.goto('/dashboard/eoc')
  await page.getByRole('button', { name: 'Status', exact: true }).click()
  await expect(page.getByText('Test House').first()).toBeVisible()
  await expect(page.getByText(/COMPLETED|PENDING|OVERDUE/).first()).toBeVisible()
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await expect(page.getByText(/Phase 3 Test House EOC/).first()).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Export current history/ }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('EOC Completion.xlsx')

  await assertNoOverflow(page)
  expect(consoleErrors).toEqual([])
})

test('House and Van EOC area rail works at the project viewport', async ({ page }, testInfo) => {
  const pin = testInfo.project.metadata.pin
  const projectName = testInfo.project.name
  const vanTaskId = projectName === 'desktop'
    ? 'phase3_van_task_shift2'
    : projectName === 'tablet'
      ? 'phase3_van_task_tablet'
      : 'phase3_van_task'

  await login(page, pin)

  if (projectName === 'tablet') {
    await page.goto('/eoc/phase3_house_task_tablet')
    await expect(page.getByRole('heading', { name: 'House EOC' })).toBeVisible()
    await page.getByRole('button', { name: /Safety, 0 of 1 complete/ }).click()
    await page.locator('#eoc-card-phase3_smoke_detectors').getByRole('button', { name: /Looks good/ }).click()
    await page.getByRole('button', { name: /Kitchen, 0 of 1 complete/ }).click()
    await page.locator('#eoc-card-phase3_kitchen_sink').getByRole('button', { name: /Looks good/ }).click()
    await assertEocResponsiveLayout(page)
    await page.getByRole('button', { name: /^Review EOC/ }).click()
    await expect(page.getByRole('button', { name: 'Submit EOC' })).toBeEnabled()
  }

  await page.goto(`/eoc/${vanTaskId}`)
  await expect(page.getByRole('heading', { name: 'Van EOC' })).toBeVisible()
  await expect(page.locator('.eoc-vehicle-strip')).toContainText('Phase 3 Test Van')
  await expect(page.locator('.eoc-vehicle-strip')).toContainText('TESTVIN0000000001')
  await expect(page.getByRole('button', { name: /Engine Off Cri, 0 of 1 complete/ })).toBeVisible()
  await page.locator('#eoc-card-phase3_van_tires').getByRole('button', { name: /Looks good/ }).click()

  if (projectName === 'desktop') {
    await page.locator('.eoc-area-panel').press('ArrowRight')
  } else {
    await page.locator('.eoc-area-panel').evaluate((panel) => {
      const start = new Event('touchstart', { bubbles: true })
      Object.defineProperty(start, 'touches', { value: [{ clientX: 310, clientY: 320 }] })
      panel.dispatchEvent(start)
      const end = new Event('touchend', { bubbles: true })
      Object.defineProperty(end, 'changedTouches', { value: [{ clientX: 120, clientY: 322 }] })
      panel.dispatchEvent(end)
    })
  }

  await expect(page.getByRole('heading', { name: 'Engine On Criteria', exact: true })).toBeVisible()
  await page.locator('#eoc-card-phase3_van_lights').getByRole('button', { name: /Looks good/ }).click()
  await assertEocResponsiveLayout(page)
  await page.getByRole('button', { name: /^Review EOC/ }).click()
  if (projectName === 'tablet') {
    await expect(page.getByRole('button', { name: 'Submit EOC' })).toBeEnabled()
    return
  }
  await page.getByRole('button', { name: 'Submit EOC' }).click()
  await expect(page.getByRole('alert')).toContainText('Enter the odometer reading before submitting.')
  await page.getByLabel('Odometer reading').fill('45231')
  await page.getByRole('button', { name: 'Submit EOC' }).click()
  await expect(page).toHaveURL(/\/home$/)
})
