# Autocomplete System - Setup Guide

## Quick Start

### 1. Install Firebase Admin SDK (for cleanup scripts)

```bash
npm install firebase-admin
```

### 2. Deploy Firestore Indexes

```bash
firebase deploy --only firestore:indexes
```

This deploys the composite indexes needed for the autocomplete queries:
- `clients` where `active == true` ordered by `normalizedLabel`
- `clients` where `active == true` ordered by `lastUsedAt`

### 3. Run Migration Script (One-time)

If you have existing clients in your database, migrate them to add the new fields:

```bash
npm run migrate-clients
```

This adds:
- `active: true` to all existing clients
- `lastUsedAt: <createdAt or current timestamp>` to all existing clients

### 4. Test the Autocomplete

1. Start the dev server: `npm run dev`
2. Create a new transport
3. Try adding a client name - autocomplete should work
4. Try adding a destination - autocomplete should work
5. Verify dropdowns appear BELOW inputs with proper styling

### 5. Set Up Periodic Cleanup (Optional)

#### Option A: Local Cron Job

Add to your crontab:
```bash
# Run cleanup daily at 2 AM
0 2 * * * cd /path/to/sprc-tx-log && npm run cleanup-clients >> logs/cleanup.log 2>&1
```

#### Option B: Firebase Cloud Functions (Recommended for Production)

1. **Initialize Firebase Functions**
   ```bash
   firebase init functions
   ```

2. **Install dependencies**
   ```bash
   cd functions
   npm install firebase-admin
   cd ..
   ```

3. **Add function to `functions/index.js`**
   ```js
   const functions = require('firebase-functions')
   const admin = require('firebase-admin')
   admin.initializeApp()

   const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000

   exports.deactivateStaleClients = functions.pubsub
     .schedule('0 2 * * *') // Daily at 2 AM
     .timeZone('America/New_York')
     .onRun(async (context) => {
       const db = admin.firestore()
       const now = admin.firestore.Timestamp.now().toMillis()

       const snapshot = await db.collection('clients')
         .where('active', '==', true)
         .get()

       const batch = db.batch()
       let count = 0

       snapshot.forEach(doc => {
         const data = doc.data()
         const lastUsed = data.lastUsedAt?.toMillis() || data.createdAt?.toMillis()

         if (lastUsed && (now - lastUsed > NINETY_DAYS_MS)) {
           batch.update(doc.ref, { active: false })
           count++
         }
       })

       if (count > 0) {
         await batch.commit()
         console.log(`Deactivated ${count} stale clients`)
       }

       return null
     })
   ```

4. **Deploy the function**
   ```bash
   firebase deploy --only functions:deactivateStaleClients
   ```

5. **Verify deployment**
   - Go to Firebase Console > Functions
   - Check that `deactivateStaleClients` is listed
   - Check logs after first scheduled run

## Testing the 90-Day Cleanup

### Manual Test

1. **Create a test client with old timestamp**
   ```js
   // In browser console or test script
   import { doc, setDoc, Timestamp } from 'firebase/firestore'
   import { db } from './firebase'

   const ninetyOneDaysAgo = new Date()
   ninetyOneDaysAgo.setDate(ninetyOneDaysAgo.getDate() - 91)

   await setDoc(doc(db, 'clients', 'test_old_client'), {
     label: 'Test Old Client',
     normalizedLabel: 'test old client',
     active: true,
     lastUsedAt: Timestamp.fromDate(ninetyOneDaysAgo),
     createdAt: Timestamp.fromDate(ninetyOneDaysAgo)
   })
   ```

2. **Run cleanup script**
   ```bash
   npm run cleanup-clients
   ```

3. **Verify results**
   - Script should show "Deactivating 'Test Old Client'"
   - Client should have `active: false` in Firestore
   - Client should NOT appear in autocomplete

4. **Test reactivation**
   - Type "Test Old Client" in autocomplete input
   - Click "+ Add" to add the client
   - Check Firestore - should now have `active: true` and updated `lastUsedAt`
   - Client should appear in autocomplete again

## Firestore Security Rules

Add these rules to `firestore.rules`:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Clients collection - readable by authenticated users
    match /clients/{clientId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }

    // Destinations collection - readable by authenticated users
    match /destinations/{destId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }

    // Transports collection - existing rules remain
    match /transports/{transportId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update: if request.auth != null;
    }
  }
}
```

Deploy rules:
```bash
firebase deploy --only firestore:rules
```

## Troubleshooting

### Autocomplete not showing suggestions

**Check 1: Firestore indexes deployed?**
```bash
firebase deploy --only firestore:indexes
```

**Check 2: Clients have `active: true`?**
```bash
npm run migrate-clients
```

**Check 3: Browser console errors?**
- Open DevTools > Console
- Look for Firestore query errors
- Check network tab for failed requests

**Check 4: Query structure correct?**
The hook uses:
```js
where('normalizedLabel', '>=', term)
where('normalizedLabel', '<=', term + '\uf8ff')
where('active', '==', true)
```

### Cleanup script failing

**Error: "Cannot find module 'firebase-admin'"**
```bash
npm install firebase-admin
```

**Error: "Failed to load service account key"**
1. Go to Firebase Console > Project Settings > Service Accounts
2. Click "Generate new private key"
3. Save as `serviceAccountKey.json` in project root
4. Add to `.gitignore`: `serviceAccountKey.json`

**Error: "Missing credentials"**
For production, use:
```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json
npm run cleanup-clients
```

### Dropdown positioning issues

**Dropdown appearing above input instead of below:**
- Check `position: relative` on parent container
- Check `top: 100%` on dropdown
- Check z-index hierarchy

**Dropdown cut off by container:**
- Check parent containers for `overflow: hidden`
- Increase z-index to 1000+
- Use `position: fixed` for dropdowns in modals

### Mobile keyboard issues

**Input zooms on focus (iOS):**
- Verify font-size is 16px or larger
- Check viewport meta tag: `<meta name="viewport" content="width=device-width, initial-scale=1.0">`

**Tap targets too small:**
- Verify min-height: 44px on buttons and input
- Check padding meets iOS guidelines

## Monitoring

### Check cleanup script logs

**Local cron:**
```bash
tail -f logs/cleanup.log
```

**Cloud Functions:**
```bash
firebase functions:log --only deactivateStaleClients
```

### Monitor client usage

**Query in Firestore console:**
```
clients
  .where('active', '==', false)
  .orderBy('lastUsedAt', 'desc')
```

### Analytics queries

**Count active vs inactive clients:**
```js
const activeCount = await getDocs(query(collection(db, 'clients'), where('active', '==', true)))
const inactiveCount = await getDocs(query(collection(db, 'clients'), where('active', '==', false)))

console.log(`Active: ${activeCount.size}, Inactive: ${inactiveCount.size}`)
```

**Find clients nearing 90 days:**
```js
const eightyDaysAgo = new Date()
eightyDaysAgo.setDate(eightyDaysAgo.getDate() - 80)

const snapshot = await getDocs(
  query(
    collection(db, 'clients'),
    where('active', '==', true),
    where('lastUsedAt', '<', Timestamp.fromDate(eightyDaysAgo))
  )
)

console.log(`${snapshot.size} clients will be deactivated in ~10 days`)
```

## Files Overview

### New Components
- `src/hooks/useAutocomplete.js` - Autocomplete hook
- `src/components/AutocompleteDropdown.jsx` - Reusable dropdown UI
- `src/components/ClientAutocomplete.jsx` - Client autocomplete
- `src/components/DestinationAutocomplete.jsx` - Destination autocomplete

### Updated Components
- `src/components/TransportCard.jsx` - Uses new autocomplete components
- `src/index.css` - Added `.autocomplete-dropdown` styles

### Scripts
- `scripts/migrateExistingClients.js` - One-time migration
- `scripts/deactivateStaleClients.js` - Periodic cleanup

### Configuration
- `firestore.indexes.json` - Composite indexes
- `package.json` - New npm scripts
- `AUTOCOMPLETE_README.md` - Full documentation
- `SETUP_AUTOCOMPLETE.md` - This setup guide

## Next Steps

1. ✅ Install firebase-admin
2. ✅ Deploy Firestore indexes
3. ✅ Run migration script
4. ✅ Test autocomplete in dev
5. ⬜ Set up Cloud Function for cleanup (or cron)
6. ⬜ Deploy to production
7. ⬜ Monitor cleanup logs

## Support

For issues or questions:
1. Check `AUTOCOMPLETE_README.md` for detailed docs
2. Review Firestore console for data issues
3. Check browser console for errors
4. Review Cloud Function logs
