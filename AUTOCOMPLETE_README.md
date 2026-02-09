# SPRC Transport Log - Autocomplete System

## Overview

This document describes the app-wide autocomplete system and the 90-day client cleanup process.

## Autocomplete Architecture

### Components

1. **`useAutocomplete.js`** - Custom hook for autocomplete logic
   - Handles debounced search (150ms)
   - Queries Firestore with range queries
   - Filters for active items only
   - Returns max 5 suggestions

2. **`AutocompleteDropdown.jsx`** - Reusable dropdown UI
   - Positioned below input with z-index: 1000
   - Consistent styling across all autocompletes
   - Mobile-optimized (44px tap targets, 16px font)
   - Prevents blur issues with onMouseDown

3. **`ClientAutocomplete.jsx`** - Client name autocomplete
   - Input field + "+ Add" button layout
   - Filters out already-added clients
   - Auto-updates `lastUsedAt` on add
   - Creates new clients with `active: true`

4. **`DestinationAutocomplete.jsx`** - Destination autocomplete
   - Two-field input (name optional, address required)
   - Searches both name and address fields
   - Deduplicates by normalized address
   - Shows "DUPLICATE" badge for matching addresses

### Usage

```jsx
import ClientAutocomplete from './components/ClientAutocomplete'
import DestinationAutocomplete from './components/DestinationAutocomplete'

// Client autocomplete
<ClientAutocomplete
  onAddClient={(name) => handleAddClient(name)}
  existingClients={clients}
  transportId={transportId}
/>

// Destination autocomplete
<DestinationAutocomplete
  onAddDestination={({name, address}) => handleAddDestination(name, address)}
  existingDestinations={destinations}
/>
```

## Client Lifecycle Management

### Schema

**`clients/{normalizedLabel}`**
```js
{
  label: "John Doe",                    // Original name
  normalizedLabel: "john doe",          // Searchable (lowercase, no extra spaces)
  active: true,                         // Visible in autocomplete
  lastUsedAt: Timestamp,                // Last time client was added to transport
  createdAt: Timestamp                  // Initial creation
}
```

### Lifecycle

1. **Client Created** (via autocomplete)
   - `active: true`
   - `lastUsedAt: serverTimestamp()`
   - `createdAt: serverTimestamp()`

2. **Client Used** (added to transport)
   - Updates `lastUsedAt: serverTimestamp()`
   - Sets `active: true` (reactivates if was inactive)

3. **Client Deactivated** (90+ days unused)
   - Background script sets `active: false`
   - No longer appears in autocomplete
   - Historical transports remain unchanged

4. **Client Reactivated** (used again after deactivation)
   - When added to new transport, sets `active: true`
   - Updates `lastUsedAt`
   - Reappears in autocomplete

## 90-Day Cleanup Process

### Scripts

#### 1. Migration Script (One-time)
```bash
node scripts/migrateExistingClients.js
```

Adds `active` and `lastUsedAt` fields to existing clients.

#### 2. Deactivation Script (Periodic)
```bash
node scripts/deactivateStaleClients.js
```

Marks clients as inactive if not used in 90+ days.

**Recommended Schedule:**
- **Daily**: Via cron job or Cloud Scheduler
- **Example cron**: `0 2 * * *` (2 AM daily)

### Cloud Scheduler Setup (Firebase/GCP)

1. **Create Cloud Function**
   ```bash
   firebase init functions
   ```

2. **Add function to `functions/index.js`**
   ```js
   const functions = require('firebase-functions')
   const admin = require('firebase-admin')
   admin.initializeApp()

   exports.deactivateStaleClients = functions.pubsub
     .schedule('0 2 * * *') // Daily at 2 AM
     .timeZone('America/New_York')
     .onRun(async (context) => {
       const db = admin.firestore()
       const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000
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

3. **Deploy**
   ```bash
   firebase deploy --only functions:deactivateStaleClients
   ```

## Firestore Indexes

The following composite indexes are required (add to `firestore.indexes.json`):

```json
{
  "indexes": [
    {
      "collectionGroup": "clients",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "active", "order": "ASCENDING" },
        { "fieldPath": "normalizedLabel", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "clients",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "active", "order": "ASCENDING" },
        { "fieldPath": "lastUsedAt", "order": "ASCENDING" }
      ]
    }
  ]
}
```

Deploy indexes:
```bash
firebase deploy --only firestore:indexes
```

## Key Features

### Mobile Optimization
- **16px font size** - Prevents iOS zoom on input focus
- **44px+ tap targets** - Meets iOS Human Interface Guidelines
- **Keyboard-aware** - Works correctly with mobile keyboards open

### Performance
- **Debounced queries** - 150ms delay to reduce API calls
- **Limited results** - Max 5 suggestions per query
- **Range queries** - Efficient Firestore queries using `>=` and `<=`

### Data Integrity
- **Historical transports preserved** - Deactivation only affects autocomplete
- **Automatic reactivation** - Using an old client reactivates it
- **No data loss** - Client names stored in transport docs, not references

## Testing

### Manual Testing

1. **Add new client**
   - Should create with `active: true` and `lastUsedAt`
   - Should appear in autocomplete immediately

2. **Use existing client**
   - Should update `lastUsedAt` timestamp
   - Should set `active: true` if was inactive

3. **Search clients**
   - Should only show active clients
   - Should filter out already-added clients
   - Should debounce (wait 150ms before querying)

4. **Run deactivation script**
   ```bash
   node scripts/deactivateStaleClients.js
   ```
   - Should mark 90+ day old clients as inactive
   - Should not affect recent clients
   - Should not affect transport history

### Automated Testing

```js
// Test client lifecycle
const client = await addClient("Test Client")
assert(client.active === true)
assert(client.lastUsedAt !== null)

// Test deactivation
await setLastUsedAt(client, Date.now() - (91 * 24 * 60 * 60 * 1000))
await deactivateStaleClients()
const updated = await getClient(client.id)
assert(updated.active === false)

// Test reactivation
await addClientToTransport(transport, "Test Client")
const reactivated = await getClient(client.id)
assert(reactivated.active === true)
```

## Troubleshooting

### Clients not appearing in autocomplete
- Check `active` field is `true`
- Verify Firestore indexes are deployed
- Check browser console for query errors

### Queries timing out
- Deploy composite indexes
- Check query limits (should be 5)
- Verify debounce is working (150ms)

### Stale clients not deactivating
- Run migration script first
- Check `lastUsedAt` field exists
- Verify cleanup script runs successfully
- Check Cloud Function logs (if using GCP)

### Historical transports affected
- Client names are stored as strings in transport docs
- Deactivation only affects `clients` collection
- Transports should never be affected by cleanup

## Future Enhancements

- [ ] Add "Recently used" section at top of autocomplete
- [ ] Add client usage count badge
- [ ] Add "Show inactive clients" toggle for supervisors
- [ ] Add reactivation notification
- [ ] Add bulk cleanup tools in Supervisor Dashboard
- [ ] Add client merge functionality for duplicates
