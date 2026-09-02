import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'

export async function emergencyPrivacyRemove({ issueId, attachmentId, adminProfileId, pin, reason }) {
  const call = httpsCallable(functions, 'emergencyPrivacyRemove')
  const result = await call({ issueId, attachmentId, adminProfileId, currentPin: pin, reason })
  return result.data
}
