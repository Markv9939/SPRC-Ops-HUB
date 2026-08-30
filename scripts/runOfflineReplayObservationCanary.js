/* global process */
import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PROJECT_ID = 'sprc-tx-l'
const EXPECTED_PROFILE_ID = 'test_bht_shift_1'
const REGION = 'us-central1'

function argument(name) {
  const prefix = `--${name}=`
  const value = process.argv.find(item => item.startsWith(prefix))
  return value ? value.slice(prefix.length) : ''
}

function readFirebaseApiKey() {
  const contents = readFileSync(resolve('.env.local'), 'utf8')
  const line = contents.split(/\r?\n/).find(item => item.startsWith('VITE_FIREBASE_API_KEY='))
  const value = String(line || '').slice('VITE_FIREBASE_API_KEY='.length).trim()
  if (!value) throw new Error('The local Firebase API key is unavailable.')
  return value
}

async function callable(name, data, idToken = '') {
  const response = await fetch(`https://${REGION}-${PROJECT_ID}.cloudfunctions.net/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(idToken ? { authorization: `Bearer ${idToken}` } : {})
    },
    body: JSON.stringify({ data })
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.error) {
    const code = String(body.error?.status || body.error?.message || response.status)
    throw new Error(`${name} failed (${code}).`)
  }
  return body.result
}

async function exchangeCustomToken(customToken, apiKey) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true })
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || !body.idToken) {
    throw new Error(`The synthetic canary token exchange failed (${String(body.error?.message || response.status)}).`)
  }
  const payload = JSON.parse(Buffer.from(String(body.idToken).split('.')[1], 'base64url').toString('utf8'))
  const authUid = String(payload.user_id || payload.sub || '').trim()
  if (!authUid) throw new Error('The synthetic canary Firebase identity was not present in the exchanged token.')
  return { idToken: body.idToken, authUid }
}

async function main() {
  if (argument('project') !== PROJECT_ID) throw new Error(`Use --project=${PROJECT_ID}.`)
  const pin = String(process.env.SPRC_CANARY_PIN || '').trim()
  if (!/^\d{6}$/.test(pin)) throw new Error('Set SPRC_CANARY_PIN to the approved synthetic BHT PIN for this command only.')
  const nonce = randomUUID().replaceAll('-', '_')
  const login = await callable('beginStaffPinSessionV2', {
    pin,
    deviceId: `appcheck_observation_device_${nonce}`,
    operationId: `appcheck_observation_login_${nonce}`
  })
  if (login?.profile?.id !== EXPECTED_PROFILE_ID) throw new Error('The PIN did not map to the expected synthetic BHT profile.')
  const token = await exchangeCustomToken(login.customToken, readFirebaseApiKey())
  const replay = await callable('authorizeOfflineReplayV5', {
    operationId: `appcheck_observation_replay_${nonce}`,
    actionId: `app-feedback:appcheck-observation-${nonce}`,
    actionType: 'appFeedback',
    ownerProfileId: EXPECTED_PROFILE_ID,
    ownerAuthUid: token.authUid,
    locationId: 'test_house',
    expectedVersion: 0,
    queuedSecurityVersion: Number(login.session.securityVersion || 0),
    queuedSessionId: login.session.id
  }, token.idToken)
  if (replay?.profileId !== EXPECTED_PROFILE_ID || replay?.sessionId !== login.session.id) {
    throw new Error('The offline replay authorization did not bind to the expected synthetic session.')
  }
  await callable('manageStaffSecurityV4', {
    action: 'close_device_session',
    targetProfileId: EXPECTED_PROFILE_ID,
    sessionId: login.session.id,
    operationId: `appcheck_observation_logout_${nonce}`
  }, token.idToken)
  console.log(JSON.stringify({
    projectId: PROJECT_ID,
    profileId: EXPECTED_PROFILE_ID,
    offlineReplayObserved: true,
    syntheticDeviceSessionClosed: true,
    appCheckEnforcementChanged: false
  }, null, 2))
}

main().catch((error) => {
  console.error(error?.message || error)
  process.exitCode = 1
})
