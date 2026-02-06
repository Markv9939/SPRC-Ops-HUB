import { initializeApp } from 'firebase/app'
import { getFirestore, collection, doc, setDoc } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: "AIzaSyDw_3tVRohA3aTLwJGy_SfcevtMlEbjkUg",
  authDomain: "sprc-tx-log.firebaseapp.com",
  projectId: "sprc-tx-log",
  storageBucket: "sprc-tx-log.firebasestorage.app",
  messagingSenderId: "402300007688",
  appId: "1:402300007688:web:f7c15801a17f99da7b68bd",
  measurementId: "G-PBVRE3J5GN"
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

async function seedUsers() {
  console.log('Seeding users to Firestore...')

  try {
    for (const user of users) {
      await setDoc(doc(db, 'users', user.id), user)
      console.log(`✓ Created user: ${user.name} (PIN: ${user.pin}, Role: ${user.role}, Site: ${user.site})`)
    }

    console.log('\n✓ All users created successfully!')
    console.log('\nTest logins:')
    console.log('- Tech (PHP): PIN 1234 (John Smith)')
    console.log('- Tech (RTC): PIN 5678 (Sarah Johnson)')
    console.log('- Supervisor (PHP): PIN 9999 (Mike Wilson)')

    process.exit(0)
  } catch (error) {
    console.error('Error seeding users:', error)
    process.exit(1)
  }
}

seedUsers()
