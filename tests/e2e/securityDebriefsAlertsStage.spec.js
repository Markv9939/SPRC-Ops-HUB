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

test('secure outgoing BHT can add a pre-signoff correction', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'The outgoing journey runs once at phone size.')
  await signIn(page, '111111', /\/home$/)
  const result = await page.evaluate(async () => {
    const {
      appendExtraDebriefNote,
      createExtraNote,
      getCurrentSubmittedDebrief
    } = await import('/src/services/shiftDebriefService.js')
    const user = { id: 'phase3_browser_mobile', name: 'Phase 3 Mobile BHT' }
    const correction = createExtraNote({
      note: 'Synthetic correction before incoming signoff.', user, source: 'editor'
    })
    correction.id = 'security_stage6_correction'
    correction.createdAtIso = '2026-08-29T12:15:00.000Z'
    await appendExtraDebriefNote('security_stage6_handoff', correction)
    const after = await getCurrentSubmittedDebrief({ id: 'security_stage6_handoff' })
    return { version: after.version, correctionIds: after.extraNotes.map(note => note.id) }
  })
  expect(result.version).toBe(2)
  expect(result.correctionIds).toContain('security_stage6_correction')
})

test('secure same-house BHT who is neither sender nor receiver cannot change the handoff', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'tablet', 'The negative ownership journey runs once at tablet size.')
  await signIn(page, '555555', /\/home$/)
  const denied = await page.evaluate(async () => {
    const { appendExtraDebriefNote, createExtraNote } = await import('/src/services/shiftDebriefService.js')
    try {
      const correction = createExtraNote({
        note: 'This must not be accepted.',
        user: { id: 'phase3_browser_tablet', name: 'Phase 3 Tablet BHT' },
        source: 'editor'
      })
      correction.id = 'security_stage6_wrong_owner'
      await appendExtraDebriefNote('security_stage6_handoff', correction)
      return ''
    } catch (error) {
      return String(error?.code || error?.message || error)
    }
  })
  expect(denied).toMatch(/only the outgoing staff member|permission-denied|permission/i)
})

test('secure assigned receiver can sign off and mark only their alert read', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The receiving journey runs once at desktop size.')
  await signIn(page, '444444', /\/home$/)
  const result = await page.evaluate(async () => {
    const { alertReadStates } = await import('/tests/e2e/support/securityDebriefProbe.js')
    const { getCurrentSubmittedDebrief, saveDebriefConfirmation } = await import('/src/services/shiftDebriefService.js')
    const confirmation = {
      keysAccountedFor: true,
      sharpsRestrictedVerified: true,
      clientRoundCompleted: true,
      controlledMedicationLogReviewed: true,
      questionsClarificationsAddressed: true,
      incomingStaffInitials: 'PB',
      reviewedIssues: []
    }
    await saveDebriefConfirmation(
      'security_stage6_handoff',
      confirmation,
      { id: 'phase3_browser_desktop', name: 'Phase 3 Desktop BHT' },
      { expectedCorrectionCount: 1 }
    )
    const debrief = await getCurrentSubmittedDebrief({ id: 'security_stage6_handoff' })
    const alertStates = await alertReadStates([
      'security_stage6_receiver_alert',
      'security_stage6_reassignment_receiver_alert'
    ])
    return {
      debrief,
      signedOffAlertRead: alertStates.security_stage6_receiver_alert,
      unrelatedAlertRead: alertStates.security_stage6_reassignment_receiver_alert
    }
  })
  expect(result.debrief.confirmed).toBe(true)
  expect(result.debrief.confirmation.acknowledgments.phase3_browser_desktop.confirmed).toBe(true)
  expect(result.signedOffAlertRead).toBe(true)
  expect(result.unrelatedAlertRead).toBe(false)
  await expect(page.getByRole('button', { name: '1 unread notifications' })).toBeVisible({ timeout: 12_000 })
})

test('secure supervisor can reassign an unsigned handoff only to an eligible incoming BHT', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The reassignment journey runs once at desktop size.')
  await signIn(page, '395172', /\/dashboard\/dashboard$/)
  const result = await page.evaluate(async () => {
    const { reassignShiftDebriefReceivers, getCurrentSubmittedDebrief } = await import('/src/services/shiftDebriefService.js')
    await reassignShiftDebriefReceivers({
      debriefId: 'security_stage6_reassignment',
      receivingUserIds: ['phase3_browser_tablet'],
      reason: 'Correct synthetic incoming shift assignment.',
      actorUser: { id: 'phase4_supervisor', name: 'Phase 4 Supervisor', role: 'supervisor' }
    })
    const after = await getCurrentSubmittedDebrief({ id: 'security_stage6_reassignment' })
    return {
      receivingUserIds: after.receivingUserIds,
      receivingUserNames: after.receivingUserNames,
      confirmed: after.confirmed,
      acknowledgments: after.confirmation?.acknowledgments,
      reassignedByUserId: after.reassignedByUserId,
      reassignmentReason: after.reassignmentReason,
      version: after.version
    }
  })
  expect(result.receivingUserIds).toEqual(['phase3_browser_tablet'])
  expect(result.receivingUserNames.phase3_browser_tablet).toBe('Phase 3 Tablet BHT')
  expect(result.confirmed).toBe(false)
  expect(result.acknowledgments).toEqual({})
  expect(result.reassignedByUserId).toBe('phase4_supervisor')
  expect(result.reassignmentReason).toBe('Correct synthetic incoming shift assignment.')
  expect(result.version).toBe(2)
})

test('secure receiver stale offline signoff is held for review after a server correction', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The stale offline replay journey runs once at desktop size.')
  await signIn(page, '444444', /\/home$/)
  const result = await page.evaluate(async () => {
    const { restoreSecurityClientSession } = await import('/src/services/securityClientRuntime.js')
    const { queueShiftDebriefConfirmation, syncOfflineOutbox } = await import('/src/services/offlineSyncService.js')
    const { listAllOfflineActions } = await import('/src/services/offlineStore.js')
    const restored = await restoreSecurityClientSession()
    if (restored.status !== 'authenticated') throw new Error(`Secure session restore failed: ${restored.status}`)
    const user = restored.user
    await queueShiftDebriefConfirmation({
      debriefId: 'security_stage6_offline_conflict',
      confirmation: {
        keysAccountedFor: true,
        sharpsRestrictedVerified: true,
        clientRoundCompleted: true,
        controlledMedicationLogReviewed: true,
        questionsClarificationsAddressed: true,
        incomingStaffInitials: 'PB',
        reviewedIssues: []
      },
      expectedCorrectionCount: 0,
      locationId: 'test_house',
      expectedVersion: 1,
      user
    })
    const sync = await syncOfflineOutbox(user)
    const action = (await listAllOfflineActions(user.id))
      .find(item => item.id === 'debrief-confirmation-v2:security_stage6_offline_conflict:phase3_browser_desktop')
    return { sync, actionStatus: action?.status, lastError: action?.lastError || '' }
  })
  expect(result.sync).toEqual({ synced: 0, failed: 0, needsReview: 1 })
  expect(result.actionStatus).toBe('needsReview')
  expect(result.lastError).toMatch(/changed since you reviewed|review/i)
})

test('secure supervisor sees the late handoff state and scoped late alert', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The late-alert journey runs once at desktop size.')
  await signIn(page, '395172', /\/dashboard\/dashboard$/)
  await page.goto('/dashboard/debriefs')
  const lateCard = page.getByRole('button', { name: /Test House.*Phase 3 Mobile BHT.*Late/ }).first()
  await expect(lateCard).toBeVisible({ timeout: 12_000 })
  await page.getByRole('button', { name: /unread notifications/ }).click()
  await expect(page.getByText('Synthetic Test House handoff acknowledgment is late.')).toBeVisible()
})

test('secure OTC supervisor listeners and queries remain location-scoped', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The supervisor journey runs once at desktop size.')
  const listenerErrors = []
  page.on('console', message => {
    if (/listener failed|permission-denied/i.test(message.text())) listenerErrors.push(message.text())
  })
  await signIn(page, '395172', /\/dashboard\/dashboard$/)
  await page.goto('/dashboard/debriefs')
  const handoffCard = page.getByRole('button', { name: /Test House.*Phase 3 Mobile BHT.*Acknowledged/ })
  await expect(handoffCard).toBeVisible()
  await handoffCard.click()
  await expect(page.getByText('Complete the synthetic handoff check.')).toBeVisible()
  await expect(page.getByRole('button', { name: '2 unread notifications' })).toBeVisible()
  await expect(page.getByText('Synthetic RES debrief submitted.')).toHaveCount(0)
  expect(listenerErrors).toEqual([])
})
