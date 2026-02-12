const PIN_HASH_PEPPER = 'sprc-pin-v1'

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function hashPin(pin) {
  const normalized = String(pin || '').trim()
  const data = new TextEncoder().encode(`${PIN_HASH_PEPPER}:${normalized}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return toHex(digest)
}

