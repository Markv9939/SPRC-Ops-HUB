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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sprc_ops_onboarding_done', 'true'))
})

test('BHT issue, protected photo, EOC, offline retry, and supervisor tools', async ({ page }, testInfo) => {
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
  await page.getByRole('button', { name: /Add photos/ }).click()
  await expect(page.getByRole('heading', { name: 'Protect client privacy' })).toBeVisible()
  await expect(page.getByText('Only photograph the problem.')).toBeVisible()
  await page.getByRole('button', { name: 'Continue to Camera' }).click()
  const syntheticImage = await page.screenshot()
  await page.locator('.location-report-modal input[type=file]').setInputFiles({
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
  await page.getByRole('button', { name: /Add photos/ }).click()
  await page.getByRole('button', { name: 'Continue to Camera' }).click()
  await page.locator('.location-report-modal input[type=file]').setInputFiles({ name: 'synthetic-retry.png', mimeType: 'image/png', buffer: syntheticImage })
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
  const guidedItem = page.locator('.eoc-guided-item')
  await page.getByRole('button', { name: /Kitchen 0\/1/ }).click()
  await expect(page.getByRole('heading', { name: 'Is the kitchen sink working without leaks?' })).toBeVisible()
  await guidedItem.getByRole('button', { name: /Needs attention/ }).click()
  await page.getByLabel('Describe the issue').fill(`Sink leak observed during ${testInfo.project.name} test.`)
  await page.getByLabel('Unable to safely take a photo').check()
  await page.getByPlaceholder('Explain why a photo cannot be taken safely.').fill('Synthetic test verifies the required safety exception.')
  await page.getByRole('button', { name: /Safety 0\/1/ }).click()
  await guidedItem.getByRole('button', { name: /Looks good/ }).click()
  await expect(page.getByLabel(/2 of 2 checklist items complete/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Is the kitchen sink working without leaks?' })).toBeVisible()
  await page.getByRole('button', { name: /^Review/ }).click()
  await expect(page.getByRole('heading', { name: 'Review EOC' })).toBeVisible()
  await page.getByRole('button', { name: 'Submit EOC' }).click()
  await expect(page).toHaveURL(/\/home$/)

  await page.goto('/issues?offline-test=1')
  await page.getByRole('button', { name: /Report$/ }).click()
  await page.locator('.location-report-modal select').first().selectOption('other')
  const offlineDescription = `${testInfo.project.name} queued offline issue`
  await page.locator('.location-report-modal textarea').fill(offlineDescription)
  await page.getByRole('button', { name: /Add photos/ }).click()
  await page.getByRole('button', { name: 'Continue to Camera' }).click()
  await page.locator('.location-report-modal input[type=file]').setInputFiles({
    name: 'synthetic-offline-problem.png',
    mimeType: 'image/png',
    buffer: syntheticImage
  })
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
