import { initializeApp } from 'firebase/app'
import {
  getFirestore,
  collection,
  getDocs,
  writeBatch,
  doc,
  setDoc,
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

const BASE_COLLECTIONS_TO_CLEAR = [
  'users',
  'bhtAssignments',
  'eocTasks',
  'eocSubmissions',
  'eocIssues',
  'supervisorAlerts',
  'transports',
  'eocAssignments',
  'complianceEmployees',
  'complianceItems',
  'cintasServices'
]

const OPTIONAL_COLLECTIONS_TO_CLEAR = ['clients', 'destinations']

const app = initializeApp(firebaseConfig)
const db = getFirestore(app)

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

function buildTaskDocId({ locationId, shiftId, taskType, dueDate, vanId }) {
  if (taskType === 'house') {
    return `task_${locationId}_${shiftId}_house_${dueDate}`
  }
  return `task_${locationId}_${shiftId}_van_${vanId}_${dueDate}`
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
      site: 'PHP',
      active: true,
      authorizedLocations: ['PHP', 'RTC', 'OTC']
    },
    {
      id: 'supervisor_php',
      name: 'Supervisor PHP',
      pin: '2222',
      role: 'supervisor',
      site: 'PHP',
      active: true,
      authorizedLocations: ['PHP']
    },
    {
      id: 'tech_mesquite_a',
      name: 'Tech Mesquite A',
      pin: '3333',
      role: 'tech',
      site: 'PHP',
      active: true
    },
    {
      id: 'tech_mesquite_b',
      name: 'Tech Mesquite B',
      pin: '4444',
      role: 'tech',
      site: 'PHP',
      active: true
    },
    {
      id: 'tech_lm_multi',
      name: 'Tech Lone Mountain',
      pin: '5555',
      role: 'tech',
      site: 'RTC',
      active: true
    },
    {
      id: 'tech_unassigned',
      name: 'Tech Unassigned',
      pin: '6666',
      role: 'tech',
      site: 'PHP',
      active: true
    }
  ]

  let seededCount = 0
  for (const user of users) {
    await setDoc(doc(db, 'users', user.id), {
      ...user,
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
      id: 'asg_mesquite_shift1_a',
      bhtUserId: 'tech_mesquite_a',
      bhtUserName: 'Tech Mesquite A',
      locationId: 'mesquite',
      shiftId: 'shift_1',
      vanIds: ['van_1'],
      isHousePrimary: true,
      active: true
    },
    {
      id: 'asg_mesquite_shift1_b',
      bhtUserId: 'tech_mesquite_b',
      bhtUserName: 'Tech Mesquite B',
      locationId: 'mesquite',
      shiftId: 'shift_1',
      vanIds: ['van_2'],
      isHousePrimary: false,
      active: true
    },
    {
      id: 'asg_lm_shift2_multi',
      bhtUserId: 'tech_lm_multi',
      bhtUserName: 'Tech Lone Mountain',
      locationId: 'lone_mountain',
      shiftId: 'shift_2',
      vanIds: ['van_2', 'van_3'],
      isHousePrimary: true,
      active: true
    }
  ]

  let seededCount = 0
  let skippedForPermissions = 0

  for (const assignment of assignments) {
    try {
      await setDoc(doc(db, 'bhtAssignments', assignment.id), {
        ...assignment,
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

async function seedEocTasks() {
  const today = toPhoenixDateStr(0)
  const yesterday = toPhoenixDateStr(-1)

  const tasks = [
    {
      taskType: 'house',
      locationId: 'mesquite',
      shiftId: 'shift_1',
      assigneeUserId: 'tech_mesquite_a',
      assigneeUserName: 'Tech Mesquite A',
      dueDate: today,
      status: 'pending',
      active: true
    },
    {
      taskType: 'van',
      locationId: 'mesquite',
      shiftId: 'shift_1',
      vanId: 'van_1',
      assigneeUserId: 'tech_mesquite_a',
      assigneeUserName: 'Tech Mesquite A',
      dueDate: today,
      status: 'pending',
      active: true
    },
    {
      taskType: 'van',
      locationId: 'mesquite',
      shiftId: 'shift_1',
      vanId: 'van_2',
      assigneeUserId: 'tech_mesquite_b',
      assigneeUserName: 'Tech Mesquite B',
      dueDate: today,
      status: 'pending',
      active: true
    },
    {
      taskType: 'house',
      locationId: 'lone_mountain',
      shiftId: 'shift_2',
      assigneeUserId: 'tech_lm_multi',
      assigneeUserName: 'Tech Lone Mountain',
      dueDate: yesterday,
      status: 'overdue',
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
        shiftLabel: task.shiftId === 'shift_1' ? '1st Shift' : '2nd Shift',
        cycleKey,
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
      reportedByUserId: 'tech_mesquite_a',
      reportedByName: 'Tech Mesquite A',
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
    await setDoc(doc(db, 'supervisorAlerts', alertId), {
      type: 'eoc_issue',
      module: 'eoc',
      locationId: 'mesquite',
      issueId,
      message: 'Seeded issue requires supervisor review',
      read: false,
      createdAt: serverTimestamp(),
      createdByUserId: 'tech_mesquite_a',
      createdByName: 'Tech Mesquite A'
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
  console.log('- Supervisor (PHP scope): PIN 2222')
  console.log('- Tech Mesquite A: PIN 3333')
  console.log('- Tech Mesquite B: PIN 4444')
  console.log('- Tech Lone Mountain (multi-van): PIN 5555')
  console.log('- Tech Unassigned: PIN 6666')

  process.exit(0)
}

main().catch((error) => {
  console.error('UAT reset failed:', error)
  process.exit(1)
})
