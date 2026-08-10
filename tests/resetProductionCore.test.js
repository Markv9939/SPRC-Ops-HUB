import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DELETED_COLLECTIONS,
  PRESERVED_COLLECTIONS,
  buildInventory,
  classifyCollection
} from '../scripts/resetProductionCore.js'

test('core catalogs are preserved and user or activity collections are deleted', () => {
  for (const collectionId of [
    'appSettings',
    'eocChecklistTemplate',
    'eocTemplateAssignments',
    'eocTemplateLibrary',
    'eocProperties',
    'eocVehicles',
    'fleetMaintenanceTemplates'
  ]) {
    assert.equal(classifyCollection(collectionId), 'preserve', collectionId)
  }

  for (const collectionId of [
    'users',
    'clients',
    'destinations',
    'transports',
    'shiftDebriefs',
    'eocIssues',
    'bhtAssignments',
    'supervisorAlerts'
  ]) {
    assert.equal(classifyCollection(collectionId), 'delete', collectionId)
  }
})

test('unknown collections stay blocked until explicitly classified', () => {
  assert.equal(classifyCollection('unexpectedLegacyData'), 'unclassified')
})

test('preserve and delete sets never overlap', () => {
  const overlap = [...PRESERVED_COLLECTIONS]
    .filter(collectionId => DELETED_COLLECTIONS.has(collectionId))
  assert.deepEqual(overlap, [])
})

test('inventory counts direct and nested documents by classification', () => {
  const inventory = buildInventory([
    {
      id: 'users',
      directDocumentCount: 3,
      documentCount: 3,
      subcollectionCount: 0
    },
    {
      id: 'eocIssues',
      directDocumentCount: 2,
      documentCount: 5,
      subcollectionCount: 2
    },
    {
      id: 'eocChecklistTemplate',
      directDocumentCount: 8,
      documentCount: 8,
      subcollectionCount: 0
    },
    {
      id: 'unknownCollection',
      directDocumentCount: 1,
      documentCount: 1,
      subcollectionCount: 0
    }
  ], [{ uid: 'one' }, { uid: 'two' }])

  assert.equal(inventory.authUserCount, 2)
  assert.equal(inventory.deleteDocumentCount, 8)
  assert.equal(inventory.preservedDocumentCount, 8)
  assert.equal(inventory.totalFirestoreDocuments, 17)
  assert.deepEqual(inventory.unclassifiedCollections, ['unknownCollection'])
  assert.equal(inventory.collections.find(row => row.collection === 'eocIssues').descendantDocuments, 3)
})
