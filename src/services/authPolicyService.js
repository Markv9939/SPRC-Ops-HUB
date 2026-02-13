function parseBooleanEnv(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

export async function getAuthPolicy() {
  return {
    authScopeEnforced: parseBooleanEnv(import.meta.env?.VITE_REQUIRE_AUTH_CLAIMS)
  }
}
