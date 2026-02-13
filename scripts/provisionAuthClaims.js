/* global process */
import admin from 'firebase-admin'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PROJECT_ID = 'sprc-tx-l'

function normalizeRole(role) {
  const normalized = String(role || '').trim().toLowerCase()
  if (normalized === 'tech') return 'bht'
  return normalized
}

function normalizeLocation(value) {
  const normalized = String(value || '').trim().toUpperCase()
  if (!normalized) return ''
  if (normalized === 'OTC' || normalized === 'PHP' || normalized === 'RTC' || normalized === 'MESQUITE' || normalized === 'LONE_MOUNTAIN') {
    return 'OTC'
  }
  if (normalized === 'RES') return 'RES'
  if (normalized === 'GLOBAL') return 'GLOBAL'
  return normalized
}

function parseArgs(argv) {
  const flags = new Set(argv)
  const userFlagIndex = argv.findIndex(arg => arg === '--user')
  const selectedUserId = userFlagIndex >= 0 ? argv[userFlagIndex + 1] : null

  return {
    dryRun: flags.has('--dry-run'),
    selectedUserId: selectedUserId || null
  }
}

function normalizeLocations(userData, role) {
  const normalizedRole = normalizeRole(role)
  if (normalizedRole === 'admin') return ['OTC', 'RES']

  const values = [
    ...(userData?.site ? [userData.site] : []),
    ...(Array.isArray(userData?.authorizedLocations) ? userData.authorizedLocations : [])
  ]

  return [...new Set(
    values
      .map(v => normalizeLocation(v))
      .filter(Boolean)
  )]
}

function getDesiredAuthIdentity(userId, userData) {
  const emailBase = String(userData?.authEmail || `${userId}@sprc.local`).trim().toLowerCase()
  const uid = String(userData?.authUid || userId).trim()
  return {
    uid,
    email: emailBase
  }
}

function initAdmin() {
  try {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: PROJECT_ID
    })
    return
  } catch {
    const serviceAccount = JSON.parse(
      readFileSync(join(__dirname, '../serviceAccountKey.json'), 'utf8')
    )
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: PROJECT_ID
    })
  }
}

async function resolveOrCreateAuthUser(auth, identity, profile, dryRun) {
  try {
    const found = await auth.getUser(identity.uid)
    return { userRecord: found, created: false }
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error
  }

  try {
    const byEmail = await auth.getUserByEmail(identity.email)
    return { userRecord: byEmail, created: false }
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error
  }

  if (dryRun) {
    return {
      userRecord: {
        uid: identity.uid,
        email: identity.email,
        displayName: profile.displayName,
        disabled: profile.disabled
      },
      created: true,
      dryCreated: true
    }
  }

  const created = await auth.createUser({
    uid: identity.uid,
    email: identity.email,
    displayName: profile.displayName,
    disabled: profile.disabled
  })

  return { userRecord: created, created: true }
}

async function provisionClaims({ dryRun, selectedUserId }) {
  initAdmin()

  const db = admin.firestore()
  const auth = admin.auth()

  const usersSnapshot = selectedUserId
    ? await db.collection('users').where(admin.firestore.FieldPath.documentId(), '==', selectedUserId).get()
    : await db.collection('users').where('active', '==', true).get()

  if (usersSnapshot.empty) {
    console.log('No matching users found.')
    return
  }

  let total = 0
  let createdAuthUsers = 0
  let updatedClaims = 0
  let updatedProfiles = 0

  console.log(`Provisioning auth claims for ${usersSnapshot.size} user(s)...`)
  console.log(`Mode: ${dryRun ? 'DRY RUN (no writes)' : 'LIVE'}`)

  for (const userDoc of usersSnapshot.docs) {
    const userId = userDoc.id
    const userData = userDoc.data() || {}
    const role = normalizeRole(userData.role)

    if (!role) {
      console.log(`- ${userId}: skipped (missing role)`)
      continue
    }

    const locations = normalizeLocations(userData, role)
    const identity = getDesiredAuthIdentity(userId, userData)

    const desiredClaims = {
      role,
      locations
    }

    const desiredProfile = {
      displayName: String(userData.name || userId),
      disabled: userData.active === false
    }

    const { userRecord, created } = await resolveOrCreateAuthUser(auth, identity, desiredProfile, dryRun)
    if (created) createdAuthUsers += 1

    const profileNeedsUpdate = String(userRecord.displayName || '') !== desiredProfile.displayName
      || String(userRecord.email || '').toLowerCase() !== identity.email
      || Boolean(userRecord.disabled) !== desiredProfile.disabled

    if (!dryRun && profileNeedsUpdate) {
      await auth.updateUser(userRecord.uid, {
        displayName: desiredProfile.displayName,
        email: identity.email,
        disabled: desiredProfile.disabled
      })
      updatedProfiles += 1
    } else if (dryRun && profileNeedsUpdate) {
      updatedProfiles += 1
    }

    if (!dryRun) {
      await auth.setCustomUserClaims(userRecord.uid, desiredClaims)
      updatedClaims += 1

      await db.collection('users').doc(userId).set({
        authUid: userRecord.uid,
        authEmail: identity.email,
        authClaimsReady: true,
        authClaimRole: role,
        authClaimLocations: locations,
        claimsProvisionedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true })
    } else {
      updatedClaims += 1
    }

    total += 1
    console.log(`- ${userId}: uid=${userRecord.uid} role=${role} locations=[${locations.join(', ')}]${created ? ' (auth user created)' : ''}`)
  }

  console.log('')
  console.log('Provision summary')
  console.log(`- Processed users: ${total}`)
  console.log(`- Auth users created: ${createdAuthUsers}`)
  console.log(`- Profiles updated: ${updatedProfiles}`)
  console.log(`- Claims set: ${updatedClaims}`)
}

function printUsage() {
  console.log('Usage:')
  console.log('  npm run claims:provision')
  console.log('  npm run claims:provision -- --dry-run')
  console.log('  npm run claims:provision -- --user <userId>')
}

const options = parseArgs(process.argv.slice(2))

provisionClaims(options).catch((error) => {
  console.error('Failed to provision auth claims:', error)
  console.error('Credential setup required: configure ADC (GOOGLE_APPLICATION_CREDENTIALS) or place serviceAccountKey.json in project root.')
  printUsage()
  process.exit(1)
})
