import { readFileSync } from 'node:fs'
import { applicationDefault, deleteApp as deleteAdminApp, initializeApp as initializeAdminApp } from 'firebase-admin/app'
import { getStorage as getAdminStorage } from 'firebase-admin/storage'
import { deleteApp, initializeApp } from 'firebase/app'
import { deleteUser, getAuth, signInAnonymously } from 'firebase/auth'
import { deleteObject, getBytes, getStorage, ref, uploadBytes } from 'firebase/storage'

function readEnvFile(path) {
  return Object.fromEntries(readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => {
      const separator = line.indexOf('=')
      return [line.slice(0, separator), line.slice(separator + 1)]
    }))
}

const env = readEnvFile('.env.local')
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  appId: env.VITE_FIREBASE_APP_ID
}

if (!config.apiKey || !config.projectId || !config.storageBucket) {
  throw new Error('Production Firebase configuration is incomplete.')
}

const smokeId = `storage_smoke_${Date.now()}`
const storagePath = `issueAttachments/test_house/${smokeId}/smoke.jpg`
const clientApp = initializeApp(config, `storage-smoke-client-${smokeId}`)
const adminApp = initializeAdminApp({
  credential: applicationDefault(),
  projectId: config.projectId,
  storageBucket: config.storageBucket
}, `storage-smoke-admin-${smokeId}`)
const auth = getAuth(clientApp)
const objectRef = ref(getStorage(clientApp), storagePath)
let accountRemoved = false
let objectRemoved = false

try {
  const credential = await signInAnonymously(auth)
  await uploadBytes(objectRef, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
    contentType: 'image/jpeg',
    customMetadata: {
      locationId: 'test_house',
      issueId: smokeId,
      attachmentId: 'smoke',
      kind: 'report'
    }
  })
  const bytes = await getBytes(objectRef)
  let clientDeletionDenied = false
  try {
    await deleteObject(objectRef)
  } catch (error) {
    clientDeletionDenied = error?.code === 'storage/unauthorized'
  }
  if (!clientDeletionDenied) throw new Error('Storage rules did not deny direct client deletion.')
  await getAdminStorage(adminApp).bucket().file(storagePath).delete({ ignoreNotFound: true })
  objectRemoved = true
  await deleteUser(credential.user)
  accountRemoved = true
  console.log(JSON.stringify({
    anonymousAuth: true,
    upload: true,
    authenticatedReadBytes: bytes.byteLength,
    clientDeletionDenied,
    adminCleanup: objectRemoved,
    temporaryAccountRemoved: accountRemoved
  }, null, 2))
} finally {
  if (!objectRemoved) {
    await getAdminStorage(adminApp).bucket().file(storagePath).delete({ ignoreNotFound: true }).catch(() => {})
  }
  if (!accountRemoved && auth.currentUser) await deleteUser(auth.currentUser).catch(() => {})
  await Promise.all([deleteApp(clientApp), deleteAdminApp(adminApp)])
}
