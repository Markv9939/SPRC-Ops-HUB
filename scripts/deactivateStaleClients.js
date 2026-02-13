/* global process */
/**
 * Deactivate stale clients script
 *
 * This script marks clients as inactive if they haven't been used in 90+ days.
 * Inactive clients won't appear in autocomplete but historical transports remain intact.
 *
 * Run this script periodically (e.g., via cron job or Cloud Scheduler):
 * npm run cleanup-clients
 *
 * Requirements:
 * - firebase-admin package: npm install firebase-admin
 * - Service account key in project root (for local testing)
 */

import admin from 'firebase-admin'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Initialize Firebase Admin
// For production: Use Application Default Credentials
// For local: Use service account key
try {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: 'sprc-tx-l'
  })
} catch {
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

// 90 days in milliseconds
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000

async function deactivateStaleClients() {
  console.log('🔍 Starting stale client deactivation process...')
  console.log(`📅 Checking for clients not used in the last 90 days\n`)

  try {
    // Get all active clients
    const clientsSnapshot = await db.collection('clients')
      .where('active', '==', true)
      .get()

    if (clientsSnapshot.empty) {
      console.log('✅ No active clients found')
      return
    }

    console.log(`📊 Found ${clientsSnapshot.size} active clients`)

    const now = admin.firestore.Timestamp.now().toMillis()
    const batch = db.batch()
    let deactivatedCount = 0
    let skippedCount = 0

    for (const doc of clientsSnapshot.docs) {
      const data = doc.data()
      const clientName = data.label || doc.id

      // Check if lastUsedAt exists
      if (!data.lastUsedAt) {
        // If no lastUsedAt, use createdAt as fallback
        if (data.createdAt) {
          const createdAtMs = data.createdAt.toMillis()
          const daysSinceCreation = Math.floor((now - createdAtMs) / (24 * 60 * 60 * 1000))

          if (now - createdAtMs > NINETY_DAYS_MS) {
            console.log(`⚠️  Deactivating "${clientName}" (created ${daysSinceCreation} days ago, never used)`)
            batch.update(doc.ref, { active: false })
            deactivatedCount++
          } else {
            skippedCount++
          }
        } else {
          // No timestamps at all - keep active but log warning
          console.log(`⚠️  Client "${clientName}" has no timestamp data - skipping`)
          skippedCount++
        }
        continue
      }

      // Calculate days since last use
      const lastUsedMs = data.lastUsedAt.toMillis()
      const daysSinceUse = Math.floor((now - lastUsedMs) / (24 * 60 * 60 * 1000))

      if (now - lastUsedMs > NINETY_DAYS_MS) {
        console.log(`🗑️  Deactivating "${clientName}" (last used ${daysSinceUse} days ago)`)
        batch.update(doc.ref, { active: false })
        deactivatedCount++
      } else {
        skippedCount++
      }
    }

    // Commit batch update
    if (deactivatedCount > 0) {
      await batch.commit()
      console.log(`\n✅ Successfully deactivated ${deactivatedCount} stale client(s)`)
    } else {
      console.log('\n✅ No clients needed deactivation')
    }

    console.log(`📊 Summary: ${deactivatedCount} deactivated, ${skippedCount} still active`)

  } catch (error) {
    console.error('❌ Error during deactivation:', error)
    process.exit(1)
  }
}

// Run the script
deactivateStaleClients()
  .then(() => {
    console.log('\n✨ Script completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error)
    process.exit(1)
  })
