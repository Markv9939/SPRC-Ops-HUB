import { useCallback, useEffect, useState } from 'react'
import { listOfflineAttachments, requestPersistentPhotoStorage } from '../services/offlineStore'
import { retryOfflinePhotoUploads } from '../services/offlineSyncService'

export default function useOfflinePhotoQueue(user) {
  const [summary, setSummary] = useState({ waiting: 0, uploading: 0, failed: 0, total: 0 })
  const [retrying, setRetrying] = useState(false)

  const refresh = useCallback(async () => {
    if (!user?.id) {
      setSummary({ waiting: 0, uploading: 0, failed: 0, total: 0 })
      return
    }
    const records = await listOfflineAttachments({ ownerProfileId: user.id, states: ['waiting', 'uploading', 'failed'] })
    const next = { waiting: 0, uploading: 0, failed: 0, total: records.length }
    records.forEach(record => { if (record.state in next) next[record.state] += 1 })
    setSummary(next)
  }, [user?.id])

  useEffect(() => {
    const timer = window.setTimeout(refresh, 0)
    const handleChange = () => refresh()
    const handleVisible = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('offline-attachments-changed', handleChange)
    window.addEventListener('online', handleChange)
    document.addEventListener('visibilitychange', handleVisible)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('offline-attachments-changed', handleChange)
      window.removeEventListener('online', handleChange)
      document.removeEventListener('visibilitychange', handleVisible)
    }
  }, [refresh])

  useEffect(() => {
    if (!summary.total) return undefined
    requestPersistentPhotoStorage().catch(() => false)
    const warn = event => {
      event.preventDefault()
      event.returnValue = 'Photos are still waiting to upload. Do not clear browser data.'
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [summary.total])

  const retry = useCallback(async () => {
    if (!user?.id || retrying || navigator.onLine === false) return
    setRetrying(true)
    try {
      await retryOfflinePhotoUploads({ ownerProfileId: user.id, uploader: user })
      await refresh()
    } finally {
      setRetrying(false)
    }
  }, [refresh, retrying, user])

  return { ...summary, retry, retrying, refresh }
}
