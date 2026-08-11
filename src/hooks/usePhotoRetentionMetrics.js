import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase'

export default function usePhotoRetentionMetrics(enabled) {
  const [metrics, setMetrics] = useState(null)
  useEffect(() => {
    if (!enabled) return undefined
    return onSnapshot(doc(db, 'appMetrics', 'photoRetention'), snap => setMetrics(snap.exists() ? snap.data() : null), () => setMetrics(null))
  }, [enabled])
  return enabled ? metrics : null
}
