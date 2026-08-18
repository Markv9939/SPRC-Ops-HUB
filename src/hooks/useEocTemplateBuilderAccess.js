import { useEffect, useMemo, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'

const DEFAULT_SETTINGS = Object.freeze({ supervisorEnabled: false, enabledLocationIds: [] })

export default function useEocTemplateBuilderAccess() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)

  useEffect(() => onSnapshot(
    doc(db, 'appSettings', 'eocTemplateBuilder'),
    (snapshot) => {
      const data = snapshot.exists() ? snapshot.data() : {}
      setSettings({
        supervisorEnabled: data?.supervisorEnabled === true,
        enabledLocationIds: Array.isArray(data?.enabledLocationIds)
          ? data.enabledLocationIds.map(value => String(value || '').trim().toLowerCase()).filter(Boolean)
          : []
      })
    },
    () => setSettings(DEFAULT_SETTINGS)
  ), [])

  return useMemo(() => settings, [settings])
}
