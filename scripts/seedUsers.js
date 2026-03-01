/* global process */
import { initializeApp } from 'firebase/app'
import {
  getFirestore,
  collection,
  getDocs,
  writeBatch,
  doc,
  setDoc,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore'
import { createHash } from 'crypto'

const firebaseConfig = {
  apiKey: 'AIzaSyDkeTilCGBAxaR9Vz4uiIHsxLENvvRsy7U',
  authDomain: 'sprc-tx-l.firebaseapp.com',
  projectId: 'sprc-tx-l',
  storageBucket: 'sprc-tx-l.firebasestorage.app',
  messagingSenderId: '699564668509',
  appId: '1:699564668509:web:dc48902d5458fc5383fb4',
  measurementId: 'G-YQJZPLW7P6'
}

const BASE_COLLECTIONS_TO_CLEAR = [
  'users',
  'shiftAssignments',
  'eocTasks',
  'eocSubmissions',
  'eocIssues',
  'alerts',
  'eocTemplateDrafts',
  'eocTemplateVersions',
  'accessGrants',
  'transports',
  'eocAssignments',
  'complianceEmployees',
  'complianceItems',
  'cintasServices'
]

const OPTIONAL_COLLECTIONS_TO_CLEAR = ['clients', 'destinations']

const app = initializeApp(firebaseConfig)
const db = getFirestore(app)

function hashPin(pin) {
  return createHash('sha256')
    .update(`sprc-pin-v1:${String(pin || '').trim()}`)
    .digest('hex')
}

function toPhoenixDateStr(dayOffset = 0) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Phoenix',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })

  const parts = formatter.formatToParts(new Date())
  const year = Number(parts.find(p => p.type === 'year')?.value)
  const month = Number(parts.find(p => p.type === 'month')?.value)
  const day = Number(parts.find(p => p.type === 'day')?.value)

  const base = new Date(Date.UTC(year, month - 1, day))
  base.setUTCDate(base.getUTCDate() + dayOffset)
  const y = base.getUTCFullYear()
  const m = String(base.getUTCMonth() + 1).padStart(2, '0')
  const d = String(base.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function startOfDay(dateStr) {
  return new Date(`${String(dateStr)}T00:00:00.000`)
}

function endOfDay(dateStr) {
  return new Date(`${String(dateStr)}T23:59:59.999`)
}

function buildTaskDocId({ locationId, shiftId, taskType, dueDate, vanId }) {
  if (taskType === 'house') {
    return `task_${locationId}_${shiftId}_house_${dueDate}`
  }
  return `task_${locationId}_${shiftId}_van_${vanId}_${dueDate}`
}

const SHIFT_META = Object.freeze({
  shift_1: { label: '1st Shift', templateScope: 'otc_shared' },
  shift_2: { label: '2nd Shift', templateScope: 'otc_shared' },
  res_shift_1_day: { label: '1st Shift - Day', templateScope: 'res_day' },
  res_shift_1_night: { label: '1st Shift - Night', templateScope: 'res_night' },
  res_shift_2_day: { label: '2nd Shift - Day', templateScope: 'res_day' },
  res_shift_2_night: { label: '2nd Shift - Night', templateScope: 'res_night' }
})

function shiftLabelForId(shiftId) {
  return SHIFT_META[shiftId]?.label || shiftId
}

function templateScopeForShift(shiftId) {
  return SHIFT_META[shiftId]?.templateScope || 'otc_shared'
}

async function clearCollection(name) {
  let deleted = 0

  while (true) {
    const snapshot = await getDocs(collection(db, name))
    if (snapshot.empty) break

    const docsToDelete = snapshot.docs.slice(0, 400)
    const batch = writeBatch(db)
    docsToDelete.forEach(docSnap => batch.delete(docSnap.ref))
    await batch.commit()

    deleted += docsToDelete.length
    if (snapshot.size <= 400) break
  }

  return deleted
}

async function seedUsers() {
  const users = [
    {
      id: 'admin_owner',
      name: 'Admin Owner',
      pin: '1111',
      role: 'admin',
      site: 'GLOBAL',
      location: 'GLOBAL',
      active: true,
      authorizedLocations: ['OTC', 'RES']
    },
    {
      id: 'supervisor_php',
      name: 'Supervisor OTC',
      pin: '2222',
      role: 'supervisor',
      site: 'OTC',
      location: 'OTC',
      active: true,
      authorizedLocations: ['OTC']
    },
    {
      id: 'tech_mesquite_a',
      name: 'BHT Mesquite A',
      pin: '3333',
      role: 'bht',
      site: 'OTC',
      location: 'OTC',
      house: 'MESQUITE',
      locationId: 'mesquite',
      shiftId: 'shift_1',
      vanId: 'van_1',
      active: true,
      authorizedLocations: ['OTC', 'MESQUITE']
    },
    {
      id: 'tech_mesquite_b',
      name: 'BHT Mesquite B',
      pin: '4444',
      role: 'bht',
      site: 'OTC',
      location: 'OTC',
      house: 'MESQUITE',
      locationId: 'mesquite',
      shiftId: 'shift_1',
      vanId: 'van_2',
      active: true,
      authorizedLocations: ['OTC', 'MESQUITE']
    },
    {
      id: 'tech_lm_multi',
      name: 'BHT Lone Mountain',
      pin: '5555',
      role: 'bht',
      site: 'OTC',
      location: 'OTC',
      house: 'LONE_MOUNTAIN',
      locationId: 'lone_mountain',
      shiftId: 'shift_2',
      vanId: 'van_4',
      active: true,
      authorizedLocations: ['OTC', 'LONE_MOUNTAIN']
    },
    {
      id: 'tech_unassigned',
      name: 'BHT RES Day',
      pin: '6666',
      role: 'bht',
      site: 'RES',
      location: 'RES',
      house: null,
      locationId: 'res',
      shiftId: 'res_shift_1_day',
      vanId: 'van_3',
      active: true,
      authorizedLocations: ['RES']
    },
    {
      id: 'tech_res_night',
      name: 'BHT RES Night',
      pin: '7777',
      role: 'bht',
      site: 'RES',
      location: 'RES',
      house: null,
      locationId: 'res',
      shiftId: 'res_shift_2_night',
      vanId: 'van_3',
      active: true,
      authorizedLocations: ['RES']
    }
  ]

  let seededCount = 0
  for (const user of users) {
    const { pin, ...rest } = user
    await setDoc(doc(db, 'users', user.id), {
      ...rest,
      pinHash: hashPin(pin),
      pinVersion: 'v1_sha256',
      version: 1,
      pinUpdatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    })
    seededCount += 1
  }

  return { users, seededCount }
}

async function seedAssignments() {
  const assignments = [
    {
      id: 'asg_tech_mesquite_a',
      bhtUserId: 'tech_mesquite_a',
      bhtUserName: 'BHT Mesquite A',
      locationId: 'mesquite',
      shiftId: 'shift_1',
      vanIds: ['van_1'],
      source: 'user_profile',
      active: true
    },
    {
      id: 'asg_tech_mesquite_b',
      bhtUserId: 'tech_mesquite_b',
      bhtUserName: 'BHT Mesquite B',
      locationId: 'mesquite',
      shiftId: 'shift_1',
      vanIds: ['van_2'],
      source: 'user_profile',
      active: true
    },
    {
      id: 'asg_tech_lm_multi',
      bhtUserId: 'tech_lm_multi',
      bhtUserName: 'BHT Lone Mountain',
      locationId: 'lone_mountain',
      shiftId: 'shift_2',
      vanIds: ['van_4'],
      source: 'user_profile',
      active: true
    },
    {
      id: 'asg_tech_unassigned',
      bhtUserId: 'tech_unassigned',
      bhtUserName: 'BHT RES Day',
      locationId: 'res',
      shiftId: 'res_shift_1_day',
      vanIds: ['van_3'],
      source: 'user_profile',
      active: true
    },
    {
      id: 'asg_tech_res_night',
      bhtUserId: 'tech_res_night',
      bhtUserName: 'BHT RES Night',
      locationId: 'res',
      shiftId: 'res_shift_2_night',
      vanIds: ['van_3'],
      source: 'user_profile',
      active: true
    }
  ]

  let seededCount = 0
  let skippedForPermissions = 0

  for (const assignment of assignments) {
    try {
      await setDoc(doc(db, 'shiftAssignments', assignment.id), {
        ...assignment,
        version: 1,
        effectiveFrom: serverTimestamp(),
        effectiveTo: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
      seededCount += 1
    } catch (error) {
      if (error?.code === 'permission-denied') {
        skippedForPermissions += 1
        continue
      }
      throw error
    }
  }

  return { assignments, seededCount, skippedForPermissions }
}

async function seedAccessGrants() {
  const grants = [
    {
      id: 'grant_supervisor_php_rtc_active',
      userId: 'supervisor_php',
      userName: 'Supervisor OTC',
      locationId: 'RES',
      startsOn: toPhoenixDateStr(-1),
      expiresOn: toPhoenixDateStr(2),
      reason: 'Seeded temporary backup coverage'
    },
    {
      id: 'grant_tech_lm_otc_upcoming',
      userId: 'tech_lm_multi',
      userName: 'BHT Lone Mountain',
      locationId: 'OTC',
      startsOn: toPhoenixDateStr(1),
      expiresOn: toPhoenixDateStr(5),
      reason: 'Seeded upcoming backup assignment'
    }
  ]

  let seededCount = 0
  let skippedForPermissions = 0

  for (const grant of grants) {
    try {
      await setDoc(doc(db, 'accessGrants', grant.id), {
        userId: grant.userId,
        userName: grant.userName,
        locationId: grant.locationId,
        startsAt: Timestamp.fromDate(startOfDay(grant.startsOn)),
        expiresAt: Timestamp.fromDate(endOfDay(grant.expiresOn)),
        reason: grant.reason,
        revoked: false,
        revokedAt: null,
        revokedReason: null,
        createdByUserId: 'admin_owner',
        createdByName: 'Admin Owner',
        version: 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
      seededCount += 1
    } catch (error) {
      if (error?.code === 'permission-denied') {
        skippedForPermissions += 1
        continue
      }
      throw error
    }
  }

  return { grants, seededCount, skippedForPermissions }
}

async function seedEocTasks() {
  const today = toPhoenixDateStr(0)
  const yesterday = toPhoenixDateStr(-1)

  const tasks = [
    {
      taskType: 'house',
      locationId: 'mesquite',
      shiftId: 'shift_1',
      eligibleUserIds: ['tech_mesquite_a', 'tech_mesquite_b'],
      eligibleUserNames: ['BHT Mesquite A', 'BHT Mesquite B'],
      assigneeUserId: 'tech_mesquite_a',
      assigneeUserName: 'BHT Mesquite A',
      dueDate: today,
      status: 'pending',
      active: true
    },
    {
      taskType: 'van',
      locationId: 'mesquite',
      shiftId: 'shift_1',
      vanId: 'van_1',
      eligibleUserIds: ['tech_mesquite_a', 'tech_mesquite_b'],
      eligibleUserNames: ['BHT Mesquite A', 'BHT Mesquite B'],
      assigneeUserId: 'tech_mesquite_a',
      assigneeUserName: 'BHT Mesquite A',
      dueDate: today,
      status: 'pending',
      active: true
    },
    {
      taskType: 'van',
      locationId: 'mesquite',
      shiftId: 'shift_1',
      vanId: 'van_2',
      eligibleUserIds: ['tech_mesquite_a', 'tech_mesquite_b'],
      eligibleUserNames: ['BHT Mesquite A', 'BHT Mesquite B'],
      assigneeUserId: 'tech_mesquite_b',
      assigneeUserName: 'BHT Mesquite B',
      dueDate: today,
      status: 'pending',
      active: true
    },
    {
      taskType: 'house',
      locationId: 'lone_mountain',
      shiftId: 'shift_2',
      eligibleUserIds: ['tech_lm_multi'],
      eligibleUserNames: ['BHT Lone Mountain'],
      assigneeUserId: 'tech_lm_multi',
      assigneeUserName: 'BHT Lone Mountain',
      dueDate: yesterday,
      status: 'overdue',
      active: true
    },
    {
      taskType: 'van',
      locationId: 'res',
      shiftId: 'res_shift_1_day',
      vanId: 'van_3',
      eligibleUserIds: ['tech_unassigned'],
      eligibleUserNames: ['BHT RES Day'],
      assigneeUserId: 'tech_unassigned',
      assigneeUserName: 'BHT RES Day',
      dueDate: today,
      status: 'pending',
      active: true
    },
    {
      taskType: 'house',
      locationId: 'res',
      shiftId: 'res_shift_2_night',
      eligibleUserIds: ['tech_res_night'],
      eligibleUserNames: ['BHT RES Night'],
      assigneeUserId: 'tech_res_night',
      assigneeUserName: 'BHT RES Night',
      dueDate: yesterday,
      status: 'overdue',
      active: true
    },
    {
      taskType: 'van',
      locationId: 'res',
      shiftId: 'res_shift_2_night',
      vanId: 'van_3',
      eligibleUserIds: ['tech_res_night'],
      eligibleUserNames: ['BHT RES Night'],
      assigneeUserId: 'tech_res_night',
      assigneeUserName: 'BHT RES Night',
      dueDate: today,
      status: 'pending',
      active: true
    }
  ]

  let seededCount = 0
  let skippedForPermissions = 0

  for (const task of tasks) {
    const cycleKey = buildTaskDocId({
      locationId: task.locationId,
      shiftId: task.shiftId,
      taskType: task.taskType,
      dueDate: task.dueDate,
      vanId: task.vanId || null
    })

    try {
      await setDoc(doc(db, 'eocTasks', cycleKey), {
        ...task,
        shiftLabel: shiftLabelForId(task.shiftId),
        templateScope: templateScopeForShift(task.shiftId),
        cycleKey,
        version: 1,
        generatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
      seededCount += 1
    } catch (error) {
      if (error?.code === 'permission-denied') {
        skippedForPermissions += 1
        continue
      }
      throw error
    }
  }

  return { tasks, seededCount, skippedForPermissions }
}

async function seedIssueAndAlert() {
  const issueId = 'seed_issue_mesquite_1'
  const alertId = 'seed_alert_mesquite_1'

  let seededCount = 0
  let skippedForPermissions = 0

  try {
    await setDoc(doc(db, 'eocIssues', issueId), {
      taskId: buildTaskDocId({
        locationId: 'mesquite',
        shiftId: 'shift_1',
        taskType: 'house',
        dueDate: toPhoenixDateStr(0)
      }),
      locationId: 'mesquite',
      shiftId: 'shift_1',
      eocType: 'house',
      checklistItemId: 'seed_item_lock',
      label: 'Front door lock issue (seeded)',
      issueType: 'repair',
      note: 'Seeded for supervisor queue UAT',
      status: 'open',
      version: 1,
      reportedByUserId: 'tech_mesquite_a',
      reportedByName: 'BHT Mesquite A',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    })
    seededCount += 1
  } catch (error) {
    if (error?.code === 'permission-denied') {
      skippedForPermissions += 1
    } else {
      throw error
    }
  }

  try {
    await setDoc(doc(db, 'alerts', alertId), {
      type: 'eoc_issue',
      module: 'eoc',
      locationId: 'mesquite',
      issueId,
      message: 'Seeded issue requires supervisor review',
      read: false,
      version: 1,
      createdAt: serverTimestamp(),
      createdByUserId: 'tech_mesquite_a',
      createdByName: 'BHT Mesquite A'
    })
    seededCount += 1
  } catch (error) {
    if (error?.code === 'permission-denied') {
      skippedForPermissions += 1
    } else {
      throw error
    }
  }

  return { seededCount, skippedForPermissions }
}

function printUsage() {
  console.log('Usage:')
  console.log('  npm run seed -- --confirm')
  console.log('Optional:')
  console.log('  npm run seed -- --confirm --clear-autocomplete')
  console.log('')
  console.log('This command is destructive. It clears operational collections before seeding clean UAT data.')
}

async function main() {
  const confirmed = process.argv.includes('--confirm')
  const clearAutocomplete = process.argv.includes('--clear-autocomplete')

  if (!confirmed) {
    printUsage()
    process.exit(1)
  }

  const collectionsToClear = [
    ...BASE_COLLECTIONS_TO_CLEAR,
    ...(clearAutocomplete ? OPTIONAL_COLLECTIONS_TO_CLEAR : [])
  ]

  console.log('Starting UAT reset...')
  console.log(`Project: ${firebaseConfig.projectId}`)
  console.log(`Collections to clear: ${collectionsToClear.join(', ')}`)
  console.log('')

  const deleteSummary = []
  for (const name of collectionsToClear) {
    try {
      const deleted = await clearCollection(name)
      deleteSummary.push({ name, deleted })
      console.log(`Cleared ${name}: ${deleted} deleted`)
    } catch (error) {
      if (error?.code === 'permission-denied') {
        console.log(`Skipped ${name}: permission denied by Firestore rules`)
        continue
      }
      throw error
    }
  }

  console.log('')
  const userResult = await seedUsers()
  console.log(`Seeded users: ${userResult.seededCount}`)

  const assignmentResult = await seedAssignments()
  console.log(`Seeded assignments: ${assignmentResult.seededCount}`)
  if (assignmentResult.skippedForPermissions > 0) {
    console.log(`Skipped assignments (permission denied): ${assignmentResult.skippedForPermissions}`)
  }

  const accessGrantResult = await seedAccessGrants()
  console.log(`Seeded accessGrants: ${accessGrantResult.seededCount}`)
  if (accessGrantResult.skippedForPermissions > 0) {
    console.log(`Skipped accessGrants (permission denied): ${accessGrantResult.skippedForPermissions}`)
  }

  const taskResult = await seedEocTasks()
  console.log(`Seeded eocTasks: ${taskResult.seededCount}`)
  if (taskResult.skippedForPermissions > 0) {
    console.log(`Skipped eocTasks (permission denied): ${taskResult.skippedForPermissions}`)
  }

  const issueAlertResult = await seedIssueAndAlert()
  console.log(`Seeded issue/alert docs: ${issueAlertResult.seededCount}`)
  if (issueAlertResult.skippedForPermissions > 0) {
    console.log(`Skipped issue/alert docs (permission denied): ${issueAlertResult.skippedForPermissions}`)
  }

  console.log('')
  console.log('UAT reset complete.')
  console.log('Test logins:')
  console.log('- Admin: PIN 1111')
  console.log('- Supervisor (OTC scope): PIN 2222')
  console.log('- BHT Mesquite A: PIN 3333')
  console.log('- BHT Mesquite B: PIN 4444')
  console.log('- BHT Lone Mountain (multi-van): PIN 5555')
  console.log('- BHT RES Day: PIN 6666')
  console.log('- BHT RES Night: PIN 7777')

  process.exit(0)
}

main().catch((error) => {
  console.error('UAT reset failed:', error)
  process.exit(1)
})

