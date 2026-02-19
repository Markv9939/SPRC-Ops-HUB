/* global process */
import admin from 'firebase-admin'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ID = 'sprc-tx-l'

const EMPLOYEES_BY_SITE = Object.freeze({
  RES: [
    'Stevie M.',
    'Tyler W.',
    'Joshua W.',
    'Gabby O.',
    'Danny C.',
    'Brandon K.',
    'Audra H.',
    'Andrew P.',
    'Anissa G.'
  ],
  OTC: [
    'Alex P.',
    'Amber Y.',
    'Caitlin D.',
    'Ciara S.',
    'Cynthia L.',
    'Denise A.',
    'Elisa S.',
    'Freddy S.',
    'Jackie P.',
    'Jacey',
    'Jacey R.',
    'Jillian T.',
    'Kassie T.',
    'Kyle M.',
    'Lauren Y.',
    'Lionel E.',
    'Logan B.',
    'Logan T.',
    'Mark V.',
    'Maya E.',
    'Michael M.',
    'Michelle S.',
    'Paul',
    'Paul G.',
    'Peter',
    'Peter G.',
    'Sabrina N.',
    'Sadie H.',
    'Sara M.',
    'Sarah A.',
    'Shannon S.',
    'Todd B.',
    'Tyler K.'
  ]
})

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

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

async function run() {
  initAdmin()
  const db = admin.firestore()

  const existingSnapshot = await db.collection('complianceEmployees').get()
  const existingByNameSite = new Set()
  existingSnapshot.docs.forEach((docSnap) => {
    const data = docSnap.data() || {}
    const key = `${normalizeName(data.name)}::${String(data.site || '').trim().toUpperCase()}`
    existingByNameSite.add(key)
  })

  const created = []
  const skipped = []
  let batch = db.batch()
  let pendingWrites = 0

  for (const [site, names] of Object.entries(EMPLOYEES_BY_SITE)) {
    const normalizedSite = String(site || '').trim().toUpperCase()

    for (const rawName of names) {
      const name = String(rawName || '').trim()
      if (!name) continue

      const key = `${normalizeName(name)}::${normalizedSite}`
      if (existingByNameSite.has(key)) {
        skipped.push(`${name} (${normalizedSite})`)
        continue
      }

      const ref = db.collection('complianceEmployees').doc()
      batch.set(ref, {
        name,
        site: normalizedSite,
        active: true,
        linkedUserId: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      })

      created.push(`${name} (${normalizedSite})`)
      existingByNameSite.add(key)
      pendingWrites += 1

      if (pendingWrites >= 400) {
        await batch.commit()
        batch = db.batch()
        pendingWrites = 0
      }
    }
  }

  if (pendingWrites > 0) {
    await batch.commit()
  }

  console.log(`Created employees: ${created.length}`)
  created.forEach((line) => console.log(`+ ${line}`))

  console.log(`Skipped existing: ${skipped.length}`)
  skipped.forEach((line) => console.log(`= ${line}`))

  console.log('Done.')
}

run().catch((err) => {
  console.error('Failed to add compliance employees:', err?.message || err)
  process.exitCode = 1
})
