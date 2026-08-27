import { httpsCallable } from 'firebase/functions'
import { auth, functions } from '../firebase'
import { protectedWorkflowClaimEnabled } from './protectedOperationalMutationModel'

function operationId(prefix = 'operation') {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 18)}`
}

export async function shouldUseProtectedOperationalMutation(workflowId) {
  if (!auth.currentUser) return false
  const token = await auth.currentUser.getIdTokenResult()
  return protectedWorkflowClaimEnabled(token.claims, workflowId)
}

export async function submitProtectedEocMutation(payload) {
  const call = httpsCallable(functions, 'submitProtectedEocV9')
  const response = await call({ ...payload, operationId: payload.operationId || operationId('eoc') })
  return response.data
}

export async function submitProtectedIssueMutation(payload) {
  const call = httpsCallable(functions, 'mutateProtectedIssueV9')
  const response = await call({ ...payload, operationId: payload.operationId || operationId('issue') })
  return response.data
}
