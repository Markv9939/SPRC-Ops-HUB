import { collection, doc, getDocs, setDoc } from 'firebase/firestore'
import { db } from '../../../src/firebase'

export async function createPropertyProbe(id, mainLocation, locationId) {
  try {
    await setDoc(doc(db, 'eocProperties', id), {
      name: `Stage 9 Browser ${mainLocation} Property`, mainLocation, locationId,
      active: true, version: 1, createdAt: new Date(), updatedAt: new Date()
    })
    return 'allowed'
  } catch (error) {
    return String(error?.code || error?.message || error)
  }
}

export async function broadPropertyReadProbe() {
  try {
    await getDocs(collection(db, 'eocProperties'))
    return ''
  } catch (error) {
    return String(error?.code || error?.message || error)
  }
}

export async function readOperationalSettingProbe() {
  try {
    const snapshot = await getDocs(collection(db, 'appSettings'))
    return snapshot.docs.map(item => ({ id: item.id, ...item.data() }))
  } catch (error) {
    return String(error?.code || error?.message || error)
  }
}

export async function writeOperationalSettingProbe(id, payload) {
  try {
    await setDoc(doc(db, 'appSettings', id), payload, { merge: true })
    return 'allowed'
  } catch (error) {
    return String(error?.code || error?.message || error)
  }
}
