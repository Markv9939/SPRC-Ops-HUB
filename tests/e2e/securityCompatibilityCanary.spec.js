import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  page.on('dialog', dialog => dialog.accept())
  await page.addInitScript(() => localStorage.setItem('sprc_ops_onboarding_done', 'true'))
})

test('a valid non-enrolled profile keeps the compatibility login through reload without secure artifacts', async ({ page }) => {
  await page.goto('/')
  await page.getByPlaceholder('Enter 6-digit PIN').fill('851472')
  await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 })

  const initialState = await page.evaluate(async () => {
    const { auth } = await import('/src/firebase.js')
    const claims = auth.currentUser ? (await auth.currentUser.getIdTokenResult()).claims : {}
    return {
      legacyUser: JSON.parse(sessionStorage.getItem('bhtUser')),
      secureSession: localStorage.getItem('sprc_staff_session_v3'),
      stableProfileClaim: claims.profileId || null,
      stableSessionClaim: claims.sessionId || null
    }
  })
  expect(initialState.legacyUser.id).toBe('phase4_out_of_scope_res_bht')
  expect(initialState.secureSession).toBeNull()
  expect(initialState.stableProfileClaim).toBeNull()
  expect(initialState.stableSessionClaim).toBeNull()

  await page.reload()
  await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 })
  await expect(page.getByPlaceholder('Enter 6-digit PIN')).toHaveCount(0)

  const restoredState = await page.evaluate(() => ({
    legacyUser: JSON.parse(sessionStorage.getItem('bhtUser')),
    secureSession: localStorage.getItem('sprc_staff_session_v3')
  }))
  expect(restoredState.legacyUser.id).toBe('phase4_out_of_scope_res_bht')
  expect(restoredState.legacyUser.securityCompatibilityVersion).toBe(1)
  expect(restoredState.secureSession).toBeNull()
})
