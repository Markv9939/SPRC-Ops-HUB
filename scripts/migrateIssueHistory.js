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

function latestActivityFor(issue) {
  const status = String(issue.status || 'open').toLowerCase()
  const eventType = status === 'resolved' || status === 'voided' ? status : 'reported'
  return {
    id: eventType === 'reported' ? 'v1_reported' : `legacy_${eventType}`,
    eventType,
    label: eventType === 'reported' ? 'Reported' : eventType === 'voided' ? 'Voided' : 'Resolved',
    note: issue.resolvedNotes || issue.voidReason || issue.description || 'Legacy issue activity created by migration.',
    actorUserId: issue.reportedByUserId || null,
    actorName: issue.reportedByName || 'Legacy record',
    createdAt: issue.updatedAt || issue.createdAt || now
  }
}

async function main() {
  const snap = await db.collection('eocIssues').get()
  let scanned = 0
  let wouldUpdate = 0
  let updated = 0

  for (const docSnap of snap.docs) {
    scanned += 1
    const issue = docSnap.data()
    const needsLatest = !issue.latestActivity
    const status = String(issue.status || 'open').toLowerCase()
    const needsClosedAt = ['resolved', 'voided'].includes(status) && !issue.closedAt
    const activityRef = docSnap.ref.collection('activity').doc(needsLatest ? latestActivityFor(issue).id : 'v1_reported')
    const activitySnap = await activityRef.get()
    const needsActivity = !activitySnap.exists

    if (!needsLatest && !needsClosedAt && !needsActivity) continue
    wouldUpdate += 1

    if (!confirm) continue

    const batch = db.batch()
    const latestActivity = latestActivityFor(issue)
    batch.set(docSnap.ref, {
      ...(needsLatest ? { latestActivity } : {}),
      ...(needsClosedAt ? { closedAt: issue.resolvedAt || issue.voidedAt || issue.updatedAt || now } : {}),
      updatedAt: now
    }, { merge: true })
    if (needsActivity) {
      batch.set(activityRef, {
        issueId: docSnap.id,
        ...latestActivity,
        locationId: issue.locationId || null,
        issueVersion: issue.version || 1,
        version: 1,
        immutable: true,
        createdAt: latestActivity.createdAt || now
      }, { merge: true })
    }
    await batch.commit()
    updated += 1
  }

  console.log(JSON.stringify({
    mode: confirm ? 'write' : 'dry-run',
    scanned,
    wouldUpdate,
    updated
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
