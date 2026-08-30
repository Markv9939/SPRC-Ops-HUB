import { expect, test } from '@playwright/test'

async function signIn(page) {
  await page.goto('/')
  await page.getByPlaceholder('Enter 6-digit PIN').fill('111111')
  await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 })
}

async function ensureOfflineShellIsControlled(page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Service worker did not take control.')), 10_000)
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          clearTimeout(timeout)
          resolve()
        }, { once: true })
      })
    }

    // Vite's development HTML references /src modules instead of the bundled
    // /assets files used in production. Re-fetch the already-loaded same-origin
    // module graph once under SW control so the offline reload exercises the
    // production cache behavior without an online reload that could sync the
    // intentionally queued records.
    const urls = new Set(performance.getEntriesByType('resource')
      .map(entry => entry.name)
      .filter(value => new URL(value).origin === window.location.origin))
    urls.add(new URL('/src/services/offlineStore.js', window.location.origin).href)
    urls.add(new URL('/src/services/offlineActionCatalog.js', window.location.origin).href)
    urls.add(new URL('/src/services/offlineSecurityModel.js', window.location.origin).href)
    const cache = await caches.open('sprc-ops-shell-v11')
    await Promise.all([...urls].map(async url => {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Unable to cache ${url}: ${response.status}`)
      await cache.put(url, response.clone())
    }))
  })
}

test.beforeEach(async ({ page }) => {
  page.on('dialog', dialog => dialog.accept())
  await page.addInitScript(() => localStorage.setItem('sprc_ops_onboarding_done', 'true'))
})

test('all secure offline workflow actions survive browser reload with owner and access safeguards', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'The complete offline persistence matrix runs once at phone size.')
  await signIn(page)

  const queued = await page.evaluate(async () => {
    const { restoreSecurityClientSession } = await import('/src/services/securityClientRuntime.js')
    const { queueOfflineAction } = await import('/src/services/offlineStore.js')
    const { evaluateOfflineActionForCurrentUser } = await import('/src/services/offlineSecurityModel.js')
    const {
      OFFLINE_ACTION_TYPES,
      SUPPORTED_SECURE_OFFLINE_ACTION_TYPES
    } = await import('/src/services/offlineActionCatalog.js')
    const restored = await restoreSecurityClientSession()
    if (restored.status !== 'authenticated') throw new Error(`Secure session restore failed: ${restored.status}`)
    const user = restored.user

    function payloadFor(actionType) {
      const base = { user, expectedVersion: 2 }
      if (actionType === OFFLINE_ACTION_TYPES.EOC_SUBMISSION) {
        return { ...base, task: { locationId: 'test_house', version: 2 } }
      }
      if (actionType.startsWith('shiftDebrief')) {
        return { ...base, context: { locationId: 'test_house', version: 2 } }
      }
      if (actionType.startsWith('transport')) {
        return { ...base, snapshot: { locationId: 'test_house' } }
      }
      return { ...base, locationId: 'test_house' }
    }

    const actions = []
    for (const actionType of SUPPORTED_SECURE_OFFLINE_ACTION_TYPES) {
      actions.push(await queueOfflineAction({
        id: `security_offline_matrix_${actionType}`,
        type: actionType,
        payload: payloadFor(actionType)
      }))
    }
    localStorage.setItem('security_offline_matrix_user', JSON.stringify(user))
    localStorage.setItem('security_offline_matrix_types', JSON.stringify(SUPPORTED_SECURE_OFFLINE_ACTION_TYPES))
    return {
      count: SUPPORTED_SECURE_OFFLINE_ACTION_TYPES.length,
      profileId: user.id,
      expectedTypes: [...SUPPORTED_SECURE_OFFLINE_ACTION_TYPES].sort(),
      current: actions.map(action => evaluateOfflineActionForCurrentUser(action, user)),
      newDevice: actions.map(action => evaluateOfflineActionForCurrentUser(action, {
        ...user, securitySessionId: 'different_device_session'
      })),
      wrongOwner: actions.map(action => evaluateOfflineActionForCurrentUser(action, {
        ...user, id: 'different_profile'
      })),
      removedScope: actions.map(action => evaluateOfflineActionForCurrentUser(action, {
        ...user,
        site: 'RES', location: 'RES', house: 'RES', locationId: 'res',
        authorizedLocations: ['RES'], issueLocationIds: ['res']
      }))
    }
  })
  expect(queued.count).toBe(11)

  await ensureOfflineShellIsControlled(page)

  await page.context().setOffline(true)
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false)
  await page.reload({ waitUntil: 'domcontentloaded' })

  const evidence = await page.evaluate(async () => {
    const user = JSON.parse(localStorage.getItem('security_offline_matrix_user'))
    const expectedTypes = JSON.parse(localStorage.getItem('security_offline_matrix_types'))
    const expectedIds = new Set(expectedTypes.map(type => `security_offline_matrix_${type}`))
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('sprc_ops_offline_v1', 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const actions = await new Promise((resolve, reject) => {
      const request = db.transaction('outbox', 'readonly').objectStore('outbox').getAll()
      request.onsuccess = () => resolve(request.result.filter(action => expectedIds.has(action.id)))
      request.onerror = () => reject(request.error)
    })
    const result = {
      types: actions.map(action => action.type).sort(),
      bindingsValid: actions.every(action => (
        action.ownerProfileId === user.id
        && action.securityBinding?.ownerProfileId === user.id
        && action.securityBinding?.ownerAuthUid === user.authUid
        && action.securityBinding?.queuedSessionId === user.securitySessionId
        && action.securityBinding?.queuedSecurityVersion === user.securityVersion
        && action.securityBinding?.locationId === 'test_house'
      ))
    }
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('outbox', 'readwrite')
      const store = transaction.objectStore('outbox')
      actions.forEach(action => store.delete(action.id))
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    db.close()
    localStorage.removeItem('security_offline_matrix_user')
    localStorage.removeItem('security_offline_matrix_types')
    return result
  })

  await page.context().setOffline(false)

  expect(evidence.types).toEqual(queued.expectedTypes)
  expect(evidence.bindingsValid).toBe(true)
  expect(queued.current.every(item => item.disposition === 'allow')).toBe(true)
  expect(queued.newDevice.every(item => item.disposition === 'reauthorize')).toBe(true)
  expect(queued.wrongOwner.every(item => item.disposition === 'hold_for_owner')).toBe(true)
  expect(queued.removedScope.every(item => item.disposition === 'needs_review')).toBe(true)
  await page.close()
})
