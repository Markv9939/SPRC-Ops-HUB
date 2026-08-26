import { initializeApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'
import { connectFirestoreEmulator, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectStorageEmulator, getStorage } from 'firebase/storage'
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions'
import { appCheckMonitoringDecision, parseBooleanFlag } from './services/appCheckMonitoringModel.js'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
}

const app = initializeApp(firebaseConfig)
const useFirebaseEmulators = parseBooleanFlag(import.meta.env.VITE_USE_FIREBASE_EMULATORS)
const appCheckDecision = appCheckMonitoringDecision({
  compileEnabled: parseBooleanFlag(import.meta.env.VITE_ENABLE_APP_CHECK_MONITORING),
  version: import.meta.env.VITE_APP_CHECK_MONITORING_VERSION,
  siteKey: import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY,
  useEmulators: useFirebaseEmulators,
  enforcementEnabled: parseBooleanFlag(import.meta.env.VITE_ENFORCE_APP_CHECK)
})
if (appCheckDecision.initialize) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY),
    isTokenAutoRefreshEnabled: true
  })
}
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
})
const auth = getAuth(app)
const storage = getStorage(app)
const functions = getFunctions(app, 'us-central1')

if (useFirebaseEmulators && !globalThis.__SPRC_FIREBASE_EMULATORS_CONNECTED__) {
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectStorageEmulator(storage, '127.0.0.1', 9199)
  connectFunctionsEmulator(functions, '127.0.0.1', 5001)
  globalThis.__SPRC_FIREBASE_EMULATORS_CONNECTED__ = true
}

export { db, auth, storage, functions }
