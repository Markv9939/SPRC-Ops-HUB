/**
 * Migration script: Add active and lastUsedAt fields to existing clients
 *
 * This one-time script updates all existing client documents to include:
 * - active: true (default for existing clients)
 * - lastUsedAt: createdAt timestamp (if exists) or current timestamp
 *
 * Run once: npm run migrate-clients
 */

import admin from 'firebase-admin'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Initialize Firebase Admin
try {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: 'sprc-tx-l'
  })
} catch (error) {
  console.log('Using service account key for authentication')
  try {
    const serviceAccount = JSON.parse(
      readFileSync(join(__dirname, '../serviceAccountKey.json'), 'utf8')
    )
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: 'sprc-tx-l'
    })
  } catch (keyError) {
    console.error('❌ Failed to load service account key:', keyError.message)
    console.log('\nTo run locally, create serviceAccountKey.json:')
    console.log('1. Go to Firebase Console > Project Settings > Service Accounts')
    console.log('2. Click "Generate new private key"')
    console.log('3. Save as serviceAccountKey.json in project root\n')
    process.exit(1)
  }
}

const db = admin.firestore()

async function migrateClients() {
  console.log('🔄 Starting client migration...\n')

  try {
    // Get all clients
    const clientsSnapshot = await db.collection('clients').get()

    if (clientsSnapshot.empty) {
      console.log('✅ No clients found to migrate')
      return
    }

    console.log(`📊 Found ${clientsSnapshot.size} client(s) to migrate\n`)

    const batch = db.batch()
    let updatedCount = 0
    let skippedCount = 0

    for (const doc of clientsSnapshot.docs) {
      const data = doc.data()
      const updates = {}

      // Check if migration needed
      const needsActive = data.active === undefined
      const needsLastUsedAt = data.lastUsedAt === undefined

      if (!needsActive && !needsLastUsedAt) {
        console.log(`⏭️  Skipping "${data.label}" (already migrated)`)
        skippedCount++
        continue
      }

      // Set active to true for all existing clients
      if (needsActive) {
        updates.active = true
      }

      // Set lastUsedAt to createdAt or current timestamp
      if (needsLastUsedAt) {
        if (data.createdAt) {
          updates.lastUsedAt = data.createdAt
        } else {
          updates.lastUsedAt = admin.firestore.FieldValue.serverTimestamp()
        }
      }

      console.log(`✏️  Migrating "${data.label || doc.id}"`)
      batch.update(doc.ref, updates)
      updatedCount++
    }

    // Commit batch update
    if (updatedCount > 0) {
      await batch.commit()
      console.log(`\n✅ Successfully migrated ${updatedCount} client(s)`)
    }

    console.log(`📊 Summary: ${updatedCount} updated, ${skippedCount} skipped`)

  } catch (error) {
    console.error('❌ Error during migration:', error)
    process.exit(1)
  }
}

// Run the migration
migrateClients()
  .then(() => {
    console.log('\n✨ Migration completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Migration failed:', error)
    process.exit(1)
  })
