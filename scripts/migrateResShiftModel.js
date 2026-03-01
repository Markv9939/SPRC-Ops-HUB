/* global process */
import { initializeApp } from 'firebase/app'
import {
  addDoc,
  collection,
  doc,
  getFirestore,
  getDocs,
  increment,
  query,
  serverTimestamp,
  updateDoc,
  where
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

const app = initializeApp(firebaseConfig)
const db = getFirestore(app)

const TEMPLATE_SCOPE_OTC_SHARED = 'otc_shared'
const TEMPLATE_SCOPE_RES_DAY = 'res_day'
const TEMPLATE_SCOPE_RES_NIGHT = 'res_night'

const LEGACY_RES_SHIFT_MAP = Object.freeze({
  shift_1: 'res_shift_1_day',
  shift_2: 'res_shift_2_day'
})

const SHIFT_META = Object.freeze({
  shift_1: { label: '1st Shift', templateScope: TEMPLATE_SCOPE_OTC_SHARED },
  shift_2: { label: '2nd Shift', templateScope: TEMPLATE_SCOPE_OTC_SHARED },
  res_shift_1_day: { label: '1st Shift - Day', templateScope: TEMPLATE_SCOPE_RES_DAY },
  res_shift_1_night: { label: '1st Shift - Night', templateScope: TEMPLATE_SCOPE_RES_NIGHT },
  res_shift_2_day: { label: '2nd Shift - Day', templateScope: TEMPLATE_SCOPE_RES_DAY },
  res_shift_2_night: { label: '2nd Shift - Night', templateScope: TEMPLATE_SCOPE_RES_NIGHT }
})

function normalizeRole(roleValue) {
  const normalized = String(roleValue || '').trim().toLowerCase()
  return normalized === 'tech' ? 'bht' : normalized
}

function isResLocation(userData) {
  const locationId = String(userData?.locationId || '').trim().toLowerCase()
  if (locationId === 'res') return true
  const mainLocation = String(userData?.location || userData?.site || '').trim().toUpperCase()
  return mainLocation === 'RES'
}

function mapLegacyResShiftId(shiftId) {
  return LEGACY_RES_SHIFT_MAP[String(shiftId || '').trim()] || ''
}

function getShiftTemplateScope(shiftId) {
  return SHIFT_META[String(shiftId || '').trim()]?.templateScope || TEMPLATE_SCOPE_OTC_SHARED
}

function getShiftLabel(shiftId) {
  return SHIFT_META[String(shiftId || '').trim()]?.label || String(shiftId || '').trim()
}

async function migrateActiveResUsers() {
  const usersSnap = await getDocs(collection(db, 'users'))
  let patched = 0

  for (const userDoc of usersSnap.docs) {
    const userData = userDoc.data()
    if (normalizeRole(userData?.role) !== 'bht') continue
    if (userData?.active !== true) continue
    if (!isResLocation(userData)) continue

    const mappedShift = mapLegacyResShiftId(userData?.shiftId)
    if (!mappedShift) continue

    await updateDoc(doc(db, 'users', userDoc.id), {
      shiftId: mappedShift,
      version: increment(1),
      updatedAt: serverTimestamp()
    })
    patched += 1
  }

  return patched
}

async function migrateActiveResAssignments() {
  const assignmentsSnap = await getDocs(query(
    collection(db, 'shiftAssignments'),
    where('active', '==', true)
  ))
  let patched = 0

  for (const assignmentDoc of assignmentsSnap.docs) {
    const assignmentData = assignmentDoc.data()
    if (String(assignmentData?.locationId || '').trim().toLowerCase() !== 'res') continue
    const mappedShift = mapLegacyResShiftId(assignmentData?.shiftId)
    if (!mappedShift) continue

    await updateDoc(assignmentDoc.ref, {
      shiftId: mappedShift,
      version: increment(1),
      updatedAt: serverTimestamp()
    })
    patched += 1
  }

  return patched
}

async function migrateActionableResTasks() {
  const actionableSnap = await getDocs(collection(db, 'eocTasks'))

  let ignoredLegacy = 0
  let patchedMetadata = 0

  for (const taskDoc of actionableSnap.docs) {
    const taskData = taskDoc.data()
    const locationId = String(taskData?.locationId || '').trim().toLowerCase()
    const status = String(taskData?.status || '').trim().toLowerCase()
    if (locationId !== 'res') continue
    if (status !== 'pending' && status !== 'overdue') continue
    const mappedShift = mapLegacyResShiftId(taskData?.shiftId)
    if (mappedShift) {
      await updateDoc(taskDoc.ref, {
        active: false,
        status: 'ignored',
        ignoreReason: 'RES shift model migration',
        version: increment(1),
        updatedAt: serverTimestamp()
      })
      ignoredLegacy += 1
      continue
    }

    const expectedScope = getShiftTemplateScope(taskData?.shiftId)
    const expectedShiftLabel = getShiftLabel(taskData?.shiftId)
    const currentScope = String(taskData?.templateScope || '').trim()
    const currentLabel = String(taskData?.shiftLabel || '').trim()
    if (currentScope === expectedScope && currentLabel === expectedShiftLabel) continue

    await updateDoc(taskDoc.ref, {
      templateScope: expectedScope,
      shiftLabel: expectedShiftLabel,
      version: increment(1),
      updatedAt: serverTimestamp()
    })
    patchedMetadata += 1
  }

  return { ignoredLegacy, patchedMetadata }
}

async function bootstrapTemplateScopeDefaults() {
  const targets = [
    { collectionName: 'eocChecklistTemplate', patchItems: false },
    { collectionName: 'eocTemplateDrafts', patchItems: false },
    { collectionName: 'eocTemplateVersions', patchItems: true }
  ]

  let patched = 0
  for (const target of targets) {
    const snap = await getDocs(collection(db, target.collectionName))
    for (const rowDoc of snap.docs) {
      const data = rowDoc.data()
      if (String(data?.templateScope || '').trim()) continue

      const nextPayload = {
        templateScope: TEMPLATE_SCOPE_OTC_SHARED,
        updatedAt: serverTimestamp()
      }
      if (target.patchItems && Array.isArray(data?.items)) {
        nextPayload.items = data.items.map((item) => ({
          ...item,
          templateScope: String(item?.templateScope || '').trim() || TEMPLATE_SCOPE_OTC_SHARED
        }))
      }
      if (typeof data?.version === 'number') {
        nextPayload.version = increment(1)
      }

      await updateDoc(rowDoc.ref, nextPayload)
      patched += 1
    }
  }

  return patched
}

async function cloneOtcTemplatesForResScopes() {
  const eocTypes = ['house', 'van']
  const targetScopes = [TEMPLATE_SCOPE_RES_DAY, TEMPLATE_SCOPE_RES_NIGHT]
  let cloned = 0

  for (const eocType of eocTypes) {
    const sourceSnap = await getDocs(query(
      collection(db, 'eocChecklistTemplate'),
      where('eocType', '==', eocType)
    ))

    const sourceDocs = sourceSnap.docs
      .map(sourceDoc => sourceDoc.data())
      .filter(row => String(row.templateScope || '').trim() === TEMPLATE_SCOPE_OTC_SHARED)
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))

    if (sourceDocs.length === 0) continue

    for (const targetScope of targetScopes) {
      const existingTargetSnap = await getDocs(query(
        collection(db, 'eocChecklistTemplate'),
        where('eocType', '==', eocType)
      ))
      const hasTargetDocs = existingTargetSnap.docs.some(
        rowDoc => String(rowDoc.data()?.templateScope || '').trim() === targetScope
      )
      if (hasTargetDocs) continue

      for (const sourceData of sourceDocs) {
        await addDoc(collection(db, 'eocChecklistTemplate'), {
          ...sourceData,
          templateScope: targetScope,
          clonedFromScope: TEMPLATE_SCOPE_OTC_SHARED,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        })
        cloned += 1
      }
    }
  }

  return cloned
}

async function migrate() {
  const usersPatched = await migrateActiveResUsers()
  const assignmentsPatched = await migrateActiveResAssignments()
  const taskResult = await migrateActionableResTasks()
  const templatesScoped = await bootstrapTemplateScopeDefaults()
  const templatesCloned = await cloneOtcTemplatesForResScopes()

  console.log('RES shift model migration complete.')
  console.log(`- Active RES users migrated: ${usersPatched}`)
  console.log(`- Active RES assignments migrated: ${assignmentsPatched}`)
  console.log(`- Legacy RES actionable tasks ignored: ${taskResult.ignoredLegacy}`)
  console.log(`- Existing RES actionable tasks metadata patched: ${taskResult.patchedMetadata}`)
  console.log(`- Existing template docs defaulted to otc_shared: ${templatesScoped}`)
  console.log(`- OTC templates cloned into RES day/night scopes: ${templatesCloned}`)
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('RES shift model migration failed:', err)
    process.exit(1)
  })
