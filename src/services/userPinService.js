import { normalizeRole } from '../utils/orgModel'
import { PIN_LENGTH, isObviousPin, isValidPin } from '../utils/pinPolicy'
import { performSecurityAccountAction } from './securityAccountActions'

function roleCanSelfRotate(role) {
  const normalizedRole = normalizeRole(role)
  return normalizedRole === 'bht' || normalizedRole === 'supervisor' || normalizedRole === 'admin'
}

function toError(message) {
  return new Error(String(message || 'PIN update failed.'))
}

export async function changeOwnPin({ sessionUser, currentPin, newPin, confirmPin }) {
  const userId = String(sessionUser?.id || '').trim()
  if (!userId) throw toError('Missing user session.')
  if (!roleCanSelfRotate(sessionUser?.role)) throw toError('You do not have permission to change PIN here.')
  if (!isValidPin(currentPin) || !isValidPin(newPin) || !isValidPin(confirmPin)) {
    throw toError(`PIN must be exactly ${PIN_LENGTH} digits.`)
  }
  if (String(newPin) !== String(confirmPin)) throw toError('New PIN and confirm PIN must match.')
  if (String(currentPin) === String(newPin)) throw toError('New PIN must be different from current PIN.')
  if (isObviousPin(newPin)) throw toError('Choose a less obvious PIN. Repeated or sequential digits are not allowed.')

  const result = await performSecurityAccountAction({
    action: 'self_change_pin',
    targetProfileId: userId,
    currentPin,
    newPin
  })
  if (result.status !== 'completed') throw toError('Protected PIN change is not enabled yet.')
  return { secure: true, requiresSignIn: true, ...result }
}
