/* global process */
import admin from 'firebase-admin'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PROJECT_ID = 'sprc-tx-l'

function parseArgs(argv) {
  const flags = new Set(argv)
  const userFlagIndex = argv.findIndex(arg => arg === '--user')
  const selectedUserId = userFlagIndex >= 0 ? argv[userFlagIndex + 1] : null

  return {
    selectedUserId: selectedUserId || null,
    includeInactive: flags.has('--all')
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

function normalizeLocations(userData) {
  const values = [
    ...(userData?.site ? [userData.site] : []),
    ...(Array.isArray(userData?.authorizedLocations) ? userData.authorizedLocations : [])
  ]

  return [...new Set(
    values
      .map(v => String(v || '').trim().toUpperCase())
      .filter(Boolean)
  )].sort()
}

function normalizeClaimLocations(claims) {
  if (!Array.isArray(claims?.locations)) return []
  return [...new Set(
    claims.locations
      .map(v => String(v || '').trim().toUpperCase())
      .filter(Boolean)
  )].sort()
}

function toIdentity(userId, userData) {
  return {
    uid: String(userData?.authUid || userId).trim(),
    email: String(userData?.authEmail || `${userId}@sprc.local`).trim().toLowerCase()
  }
}

function arraysEqual(left, right) {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false
  }
  return true
}

async function getAuthUser(auth, identity) {
  try {
    return await auth.getUser(identity.uid)
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error
  }

  try {
    return await auth.getUserByEmail(identity.email)
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error
  }

  return null
}

async function verifyClaims({ selectedUserId, includeInactive }) {
  initAdmin()

  const db = admin.firestore()
  const auth = admin.auth()

  let usersSnapshot
  if (selectedUserId) {
    usersSnapshot = await db.collection('users').where(admin.firestore.FieldPath.documentId(), '==', selectedUserId).get()
  } else if (includeInactive) {
    usersSnapshot = await db.collection('users').get()
  } else {
    usersSnapshot = await db.collection('users').where('active', '==', true).get()
  }

  if (usersSnapshot.empty) {
    console.log('No matching users found.')
    return
  }

  console.log(`Verifying auth claims for ${usersSnapshot.size} user(s)...`)

  const failures = []
  let verifiedCount = 0

  for (const userDoc of usersSnapshot.docs) {
    const userId = userDoc.id
    const userData = userDoc.data() || {}
    const expectedRole = String(userData.role || '').trim()
    const expectedLocations = normalizeLocations(userData)
    const identity = toIdentity(userId, userData)

    const authUser = await getAuthUser(auth, identity)
    if (!authUser) {
      failures.push({ userId, reason: 'auth-user-missing', detail: `No auth user for uid=${identity.uid} or email=${identity.email}` })
      continue
    }

    const claims = authUser.customClaims || {}
    const actualRole = String(claims.role || '').trim()
    const actualLocations = normalizeClaimLocations(claims)

    const roleMatch = expectedRole === actualRole
    const locationsMatch = arraysEqual(expectedLocations, actualLocations)

    if (!roleMatch || !locationsMatch) {
      failures.push({
        userId,
        reason: 'claims-mismatch',
        detail: `expected role=${expectedRole}, locations=[${expectedLocations.join(', ')}]; actual role=${actualRole || '(none)'}, locations=[${actualLocations.join(', ')}]`
      })
      continue
    }

    verifiedCount += 1
    console.log(`- ${userId}: ok (uid=${authUser.uid})`)
  }

  console.log('')
  console.log('Verification summary')
  console.log(`- Verified: ${verifiedCount}`)
  console.log(`- Failures: ${failures.length}`)

  if (failures.length > 0) {
    for (const failure of failures) {
      console.log(`- ${failure.userId}: ${failure.reason} :: ${failure.detail}`)
    }
    process.exit(1)
  }
}

function printUsage() {
  console.log('Usage:')
  console.log('  npm run claims:verify')
  console.log('  npm run claims:verify -- --all')
  console.log('  npm run claims:verify -- --user <userId>')
}

const options = parseArgs(process.argv.slice(2))

verifyClaims(options).catch((error) => {
  console.error('Failed to verify auth claims:', error)
  console.error('Credential setup required: configure ADC (GOOGLE_APPLICATION_CREDENTIALS) or place serviceAccountKey.json in project root.')
  printUsage()
  process.exit(1)
})
