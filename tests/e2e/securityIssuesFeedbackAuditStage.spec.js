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

test('secure BHT reports and submits an owned issue while wrong-location reporting fails closed', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'The BHT issue journey runs once at phone size.')
  await signIn(page, '111111', /\/home$/)
  const result = await page.evaluate(async () => {
    const { submitProtectedIssueMutation } = await import('/src/services/protectedOperationalMutationService.js')
    const reportPayload = {
      action: 'create_report',
      operationId: 'security_stage7_issue_report_0001',
      issue: {
        issueType: 'house_property', eocType: 'house', locationId: 'test_house',
        shiftId: 'shift_1', description: 'Synthetic Stage 7 door latch issue.'
      }
    }
    const reported = await submitProtectedIssueMutation(reportPayload)
    const replay = await submitProtectedIssueMutation(reportPayload)
    const submitted = await submitProtectedIssueMutation({
      action: 'submit_resolution',
      operationId: 'security_stage7_resolution_submit_0001',
      issueId: reported.issueId,
      expectedVersion: 1,
      note: 'Synthetic latch repair completed and checked.'
    })
    let wrongLocationDenied = ''
    try {
      await submitProtectedIssueMutation({
        action: 'create_report',
        operationId: 'security_stage7_wrong_location_0001',
        issue: {
          issueType: 'house_property', eocType: 'house', locationId: 'res',
          shiftId: 'res_shift_1_day', description: 'This must not be accepted.'
        }
      })
    } catch (error) {
      wrongLocationDenied = String(error?.code || error?.message || error)
    }
    return { reported, replay, submitted, wrongLocationDenied }
  })
  expect(result.replay.issueId).toBe(result.reported.issueId)
  expect(result.reported.issue.reportedByUserId).toBe('phase3_browser_mobile')
  expect(result.submitted.issue.status).toBe('pending_supervisor_review')
  expect(result.wrongLocationDenied).toMatch(/permission-denied|permission/i)
})

test('secure BHT submits app feedback under only their stable profile identity', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'The staff feedback journey runs once at phone size.')
  await signIn(page, '111111', /\/home$/)
  const result = await page.evaluate(async () => {
    const { listMyAppFeedback, submitAppFeedbackOnline } = await import('/src/services/appFeedbackService.js')
    const user = {
      id: 'phase3_browser_mobile', name: 'Phase 3 Mobile BHT', role: 'bht',
      locationId: 'test_house', shiftId: 'shift_1'
    }
    const submitted = await submitAppFeedbackOnline({
      user,
      assignment: { locationId: 'test_house', shiftId: 'shift_1' },
      description: 'Synthetic Stage 7 feedback from secure BHT.',
      context: { route: '/home', appVersion: 'security-stage7', userAgent: 'synthetic-browser' },
      localFeedbackId: 'security_stage7_bht_feedback'
    })
    const rows = await listMyAppFeedback(user.id)
    return { submitted, rows }
  })
  expect(result.rows.some(row => row.id === result.submitted.feedbackId)).toBe(true)
  expect(result.rows.every(row => row.submittedByUserId === 'phase3_browser_mobile')).toBe(true)
  expect(result.rows.some(row => row.id === 'security_stage7_res_feedback')).toBe(false)
})

test('secure OTC supervisor reviews only the in-scope pending resolution', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The supervisor review journey runs once at desktop size.')
  await signIn(page, '395172', /\/dashboard\/dashboard$/)
  const result = await page.evaluate(async () => {
    const { submitProtectedIssueMutation } = await import('/src/services/protectedOperationalMutationService.js')
    const approved = await submitProtectedIssueMutation({
      action: 'review_resolution',
      operationId: 'security_stage7_resolution_review_0001',
      issueId: 'security_stage7_pending_review',
      expectedVersion: 2,
      decision: 'approve',
      note: 'Synthetic supervisor approval.'
    })
    let wrongLocationDenied = ''
    try {
      await submitProtectedIssueMutation({
        action: 'review_resolution',
        operationId: 'security_stage7_res_review_denied_0001',
        issueId: 'security_stage7_res_out_of_scope',
        expectedVersion: 2,
        decision: 'approve',
        note: 'This must not be accepted.'
      })
    } catch (error) {
      wrongLocationDenied = String(error?.code || error?.message || error)
    }
    return { approved, wrongLocationDenied }
  })
  expect(result.approved.issue.status).toBe('resolved')
  expect(result.approved.issue.resolvedByUserId).toBe('phase4_supervisor')
  expect(result.wrongLocationDenied).toMatch(/permission-denied|permission/i)
})

test('secure admin can review generated audit evidence and staff feedback without secret fields', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The admin evidence journey runs once at desktop size.')
  const listenerErrors = []
  page.on('console', message => {
    if (/listener failed|permission-denied/i.test(message.text())) listenerErrors.push(message.text())
  })
  await signIn(page, '737373', /\/dashboard\/dashboard$/)
  await page.goto('/dashboard/audit')
  const auditEntry = page.getByText(/ISSUE_REVIEW_RESOLUTION.*security_stage7_pending_review/i)
  await expect(auditEntry).toBeVisible()
  await expect(page.getByText(/pinHash|pinVersion|STAFF_PIN_AUTH_SECRET/i)).toHaveCount(0)

  await page.goto('/dashboard/feedback')
  await expect(page.getByText('Synthetic Stage 7 feedback from secure BHT.')).toBeVisible()
  await expect(page.getByText('Synthetic RES feedback must not appear in a BHT personal list.')).toBeVisible()
  expect(listenerErrors).toEqual([])
})
