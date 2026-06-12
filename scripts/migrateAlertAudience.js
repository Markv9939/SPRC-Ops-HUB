/* global process */
import admin from 'firebase-admin'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PROJECT_ID = 'sprc-tx-l'

const confirm = process.argv.includes('--confirm')

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

if (!admin.apps.length) {
  initAdmin()
}

const db = admin.firestore()
const now = admin.firestore.FieldValue.serverTimestamp()

function inferAudience(alert) {
  if (alert.audience) return alert.audience
  if (alert.targetUserId) return 'bht'
  return 'supervisor'
}

async function main() {
  const snap = await db.collection('alerts').get()
  let scanned = 0
  let wouldUpdate = 0
  let updated = 0
  const unknownTypes = new Set()

  for (const docSnap of snap.docs) {
    scanned += 1
    const alert = docSnap.data()
    const audience = inferAudience(alert)
    const knownType = Boolean(alert.type)
    if (!knownType) unknownTypes.add(docSnap.id)
    const needsAudience = !alert.audience
    const needsVersion = !Number.isFinite(Number(alert.version))
    const needsReadMetadata = alert.read === true && !alert.readAt
    if (!needsAudience && !needsVersion && !needsReadMetadata) continue
    wouldUpdate += 1
    if (!confirm) continue

    await docSnap.ref.set({
      ...(needsAudience ? { audience } : {}),
      ...(needsVersion ? { version: 1 } : {}),
      ...(needsReadMetadata ? { readAt: alert.updatedAt || now } : {}),
      updatedAt: now
    }, { merge: true })
    updated += 1
  }

  console.log(JSON.stringify({
    mode: confirm ? 'write' : 'dry-run',
    scanned,
    wouldUpdate,
    updated,
    unknownTypeAlertIds: Array.from(unknownTypes)
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
