export const PIN_LENGTH = 6

const OBVIOUS_PINS = new Set([
  '012345',
  '123456',
  '654321',
  '987654'
])

export function normalizePin(value) {
  return String(value || '').replace(/\D/g, '').slice(0, PIN_LENGTH)
}

export function isValidPin(value) {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(String(value || '').trim())
}

export function isObviousPin(value) {
  const normalized = String(value || '').trim()
  if (!isValidPin(normalized)) return false
  return /^(\d)\1+$/.test(normalized) || OBVIOUS_PINS.has(normalized)
}

export function generateSecurePin() {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Secure PIN generation is unavailable in this browser.')
  }

  const range = 900000
  const maxAccepted = Math.floor(0x100000000 / range) * range
  const random = new Uint32Array(1)

  while (true) {
    globalThis.crypto.getRandomValues(random)
    if (random[0] >= maxAccepted) continue
    const candidate = String(100000 + (random[0] % range))
    if (!isObviousPin(candidate)) return candidate
  }
}
