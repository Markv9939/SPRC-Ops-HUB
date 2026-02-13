import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getAuth } from 'firebase/auth'

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
const auth = getAuth(app)

export { db, auth }
