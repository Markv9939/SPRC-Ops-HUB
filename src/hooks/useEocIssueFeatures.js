import { useEffect, useMemo, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'
import { normalizeEocIssueFeatureFlags } from '../utils/featureFlags'

export default function useEocIssueFeatures() {
  const [settings, setSettings] = useState({ flags: normalizeEocIssueFeatureFlags(), enabledLocationIds: [] })

  useEffect(() => onSnapshot(
    doc(db, 'appSettings', 'eocIssueFeatures'),
    (snap) => {
      const data = snap.exists() ? snap.data() : {}
      setSettings({
        flags: normalizeEocIssueFeatureFlags(data?.flags),
        enabledLocationIds: Array.isArray(data?.enabledLocationIds) ? data.enabledLocationIds : []
      })
    },
    () => setSettings({ flags: normalizeEocIssueFeatureFlags(), enabledLocationIds: [] })
  ), [])

  return useMemo(() => ({
    ...settings,
    enabledForLocation: (feature, locationId) => settings.flags[feature] === true
      && (settings.enabledLocationIds.length === 0 || settings.enabledLocationIds.includes(locationId))
  }), [settings])
}
