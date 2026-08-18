import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'

export async function establishPinSession({ profileId, pin }) {
  const call = httpsCallable(functions, 'establishPinSession')
  const response = await call({ profileId: String(profileId || '').trim(), pin: String(pin || '').trim() })
  return response.data
}
