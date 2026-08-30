/* global process */
import { expect, test } from '@playwright/test'

const projectId = process.env.GCLOUD_PROJECT || 'sprc-ops-hub-phase3-e2e'

async function emulatorDocument(path) {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'
  const response = await fetch(`http://${host}/v1/projects/${projectId}/databases/(default)/documents/${path}`)
  if (!response.ok) throw new Error(`Unable to read emulator document ${path}: ${response.status}`)
  return response.json()
}

async function signIn(page, pin) {
  await page.goto('/')
  expect(await page.evaluate(async () => {
    const runtime = await import('/src/services/securityClientRuntime.js')
    return runtime.SECURITY_CLIENT_BOOTSTRAP_COMPILED
  })).toBe(true)
  await page.getByPlaceholder('Enter 6-digit PIN').fill(pin)
  await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 })
}

test.beforeEach(async ({ page }) => {
  page.on('dialog', dialog => dialog.accept())
  await page.addInitScript(() => localStorage.setItem('sprc_ops_onboarding_done', 'true'))
})

test('secure BHT receives owner-bound offline replay authorization and submits EOC idempotently', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'The cumulative EOC/offline journey runs once at phone size.')
  await signIn(page, '111111')

  const result = await page.evaluate(async () => {
    const { auth } = await import('/src/firebase.js')
    const { authorizeOfflineActionReplay } = await import('/src/services/offlineReplayAuthorization.js')
    const { submitProtectedEocMutation } = await import('/src/services/protectedOperationalMutationService.js')
    const claims = (await auth.currentUser.getIdTokenResult()).claims
    const binding = {
      ownerProfileId: 'phase3_browser_mobile',
      ownerAuthUid: auth.currentUser.uid,
      queuedSessionId: claims.sessionId,
      queuedSecurityVersion: 1,
      actionType: 'eocSubmission',
      locationId: 'test_house',
      expectedVersion: 3
    }
    const authorization = await authorizeOfflineActionReplay({
      id: 'security_stage5_offline_action',
      type: 'eocSubmission',
      ownerProfileId: 'phase3_browser_mobile',
      securityBinding: binding
    })

    let wrongOwnerDenied = ''
    try {
      await authorizeOfflineActionReplay({
        id: 'security_stage5_wrong_owner_action',
        type: 'eocSubmission',
        ownerProfileId: 'another_profile',
        securityBinding: { ...binding, ownerProfileId: 'another_profile' }
      })
    } catch (error) {
      wrongOwnerDenied = String(error?.code || error?.message || error)
    }

    const payload = {
      operationId: 'security_stage5_submit_operation_01',
      taskId: 'security_stage5_task',
      expectedTaskVersion: 3,
      eocType: 'house',
      offlineReplayAuthorization: authorization,
      answers: [{
        itemId: 'doors', trackingId: 'doors', label: 'Doors and locks are secure',
        category: 'Safety', status: 'pass', responsePhotoAttachmentIds: [], photoAttachmentIds: []
      }]
    }
    const first = await submitProtectedEocMutation(payload)
    const replay = await submitProtectedEocMutation(payload)
    return { authorization, wrongOwnerDenied, first, replay }
  })

  expect(result.authorization.profileId).toBe('phase3_browser_mobile')
  expect(result.authorization.locationId).toBe('test_house')
  expect(result.wrongOwnerDenied).toMatch(/permission-denied|permission/i)
  expect(result.first.submissionId).toBe('eoc_security_stage5_task_phase3_browser_mobile')
  expect(result.replay).toEqual(result.first)

  const task = await emulatorDocument('eocTasks/security_stage5_task')
  const submission = await emulatorDocument('eocSubmissions/eoc_security_stage5_task_phase3_browser_mobile')
  expect(task.fields.status.stringValue).toBe('completed')
  expect(submission.fields.submittedByUserId.stringValue).toBe('phase3_browser_mobile')
  expect(submission.fields.offlineReplayAuthorization.mapValue.fields.profileId.stringValue).toBe('phase3_browser_mobile')
})
