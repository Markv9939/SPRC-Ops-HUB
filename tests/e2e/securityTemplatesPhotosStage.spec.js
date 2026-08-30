import { expect, test } from '@playwright/test'

async function signIn(page, pin, expectedPath) {
  await page.goto('/')
  expect(await page.evaluate(async () => {
    const runtime = await import('/src/services/securityClientRuntime.js')
    return runtime.SECURITY_CLIENT_BOOTSTRAP_COMPILED
  })).toBe(true)
  await page.getByPlaceholder('Enter 6-digit PIN').fill(pin)
  await expect(page).toHaveURL(expectedPath, { timeout: 30_000 })
}

test.beforeEach(async ({ page }) => {
  page.on('dialog', dialog => dialog.accept())
  await page.addInitScript(() => localStorage.setItem('sprc_ops_onboarding_done', 'true'))
})

test('secure supervisor loads the shared template library without widening account scope', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The management journey runs once at desktop size.')
  await signIn(page, '395172', /\/dashboard\/dashboard$/)
  await page.goto('/dashboard/eoc')

  await expect(page.getByRole('button', { name: 'Library', exact: true })).toBeVisible()
  await expect(page.getByText('Security Stage 4 Shared House Template')).toBeVisible()
  await expect(page.getByText(/Unable to load template library/)).toHaveCount(0)
  await expect(page.getByText(/Unable to load assignments/)).toHaveCount(0)

  await page.goto('/dashboard/users')
  await expect(page.getByText('Internal ID: phase4_out_of_scope_res_bht')).toHaveCount(0)
})

test('secure BHT uploads an in-scope EOC response photo and wrong-location upload fails closed', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'The staff photo journey runs once at phone size.')
  await signIn(page, '111111', /\/home$/)

  const result = await page.evaluate(async () => {
    const { uploadEocResponseAttachment } = await import('/src/services/eocSubmissionAttachmentService.js')
    const photo = {
      id: 'security_stage4_photo',
      blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }),
      size: 4,
      type: 'image/jpeg',
      width: 1,
      height: 1
    }
    const uploader = { id: 'phase3_browser_mobile', name: 'Phase 3 Mobile BHT' }
    const allowed = await uploadEocResponseAttachment({
      submissionId: 'security_stage4_submission',
      locationId: 'test_house',
      itemId: 'doors',
      photo,
      uploader
    })

    let denied = ''
    try {
      await uploadEocResponseAttachment({
        submissionId: 'security_stage4_submission',
        locationId: 'mesquite',
        itemId: 'doors',
        photo: { ...photo, id: 'security_stage4_wrong_location' },
        uploader
      })
    } catch (error) {
      denied = String(error?.code || error?.message || error)
    }
    return { allowed, denied }
  })

  expect(result.allowed.state).toBe('uploaded')
  expect(result.denied).toMatch(/permission-denied|permission/i)
})
