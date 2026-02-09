import { initializeApp } from 'firebase/app'
import { getFirestore, collection, doc, setDoc, getDocs, deleteDoc } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: "AIzaSyDkeTilCGBAxaR9Vz4uiIHsxLENvvRsy7U",
  authDomain: "sprc-tx-l.firebaseapp.com",
  projectId: "sprc-tx-l",
  storageBucket: "sprc-tx-l.firebasestorage.app",
  messagingSenderId: "699564668509",
  appId: "1:699564668509:web:dc48902d5458fc5383fb4",
  measurementId: "G-YQJZPLW7P6"
}

const app = initializeApp(firebaseConfig)
const db = getFirestore(app)

const users = [
  {
    id: 'tech1',
    name: 'John Smith',
    pin: '1234',
    role: 'tech',
    site: 'PHP',
    active: true
  },
  {
    id: 'tech2',
    name: 'Sarah Johnson',
    pin: '5678',
    role: 'tech',
    site: 'RTC',
    active: true
  },
  {
    id: 'supervisor1',
    name: 'Mike Wilson',
    pin: '9999',
    role: 'supervisor',
    site: 'PHP',
    active: true
  }
]

async function clearUsers() {
  console.log('Clearing existing users...')
  const querySnapshot = await getDocs(collection(db, 'users'))

  for (const docSnapshot of querySnapshot.docs) {
    await deleteDoc(doc(db, 'users', docSnapshot.id))
    console.log(`✓ Deleted user: ${docSnapshot.id}`)
  }
}

async function seedUsers() {
  console.log('Starting fresh Firebase setup...\n')

  try {
    // Clear existing users
    await clearUsers()
    console.log('')

    // Create new users
    console.log('Creating new users...')
    for (const user of users) {
      await setDoc(doc(db, 'users', user.id), user)
      console.log(`✓ Created user: ${user.name} (PIN: ${user.pin}, Role: ${user.role}, Site: ${user.site})`)
    }

    console.log('\n✅ Firebase reset complete!')
    console.log('\nTest logins:')
    console.log('- Tech (PHP): PIN 1234 (John Smith)')
    console.log('- Tech (RTC): PIN 5678 (Sarah Johnson)')
    console.log('- Supervisor (PHP): PIN 9999 (Mike Wilson)')

    process.exit(0)
  } catch (error) {
    console.error('❌ Error seeding users:', error)
    process.exit(1)
  }
}

seedUsers()
