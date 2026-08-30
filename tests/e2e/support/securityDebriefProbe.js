import { doc, getDoc } from 'firebase/firestore'
import { db } from '../../../src/firebase'

export async function alertReadStates(alertIds = []) {
  const entries = await Promise.all(alertIds.map(async alertId => {
    const snapshot = await getDoc(doc(db, 'alerts', alertId))
    return [alertId, snapshot.exists() ? snapshot.data()?.read === true : null]
  }))
  return Object.fromEntries(entries)
}
