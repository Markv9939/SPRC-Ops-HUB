const ONBOARDING_KEY = 'sprc_ops_onboarding_done'

export function shouldShowOnboarding() {
  return !localStorage.getItem(ONBOARDING_KEY)
}
