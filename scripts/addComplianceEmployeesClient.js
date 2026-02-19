/* global process */
import { initializeApp } from 'firebase/app'
import {
  getFirestore,
  collection,
  getDocs,
  writeBatch,
  doc,
  serverTimestamp
} from 'firebase/firestore'

const firebaseConfig = {
  apiKey: 'AIzaSyDkeTilCGBAxaR9Vz4uiIHsxLENvvRsy7U',
  authDomain: 'sprc-tx-l.firebaseapp.com',
  projectId: 'sprc-tx-l',
  storageBucket: 'sprc-tx-l.firebasestorage.app',
  messagingSenderId: '699564668509',
  appId: '1:699564668509:web:dc48902d5458fc5383fb4',
  measurementId: 'G-YQJZPLW7P6'
}

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

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

async function run() {
  const app = initializeApp(firebaseConfig)
  const db = getFirestore(app)

  const existingSnapshot = await getDocs(collection(db, 'complianceEmployees'))
  const existingByNameSite = new Set()
  existingSnapshot.docs.forEach((docSnap) => {
    const data = docSnap.data() || {}
    const key = `${normalizeName(data.name)}::${String(data.site || '').trim().toUpperCase()}`
    existingByNameSite.add(key)
  })

  let batch = writeBatch(db)
  let pendingWrites = 0
  const created = []
  const skipped = []

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

      const employeeRef = doc(collection(db, 'complianceEmployees'))
      batch.set(employeeRef, {
        name,
        site: normalizedSite,
        active: true,
        linkedUserId: null,
        createdAt: serverTimestamp()
      })

      created.push(`${name} (${normalizedSite})`)
      existingByNameSite.add(key)
      pendingWrites += 1

      if (pendingWrites >= 400) {
        await batch.commit()
        batch = writeBatch(db)
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
  console.error('Failed to add compliance employees (client SDK):', err?.message || err)
  process.exitCode = 1
})
