import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'

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

export { db }