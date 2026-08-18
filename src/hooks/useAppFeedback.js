import { useEffect, useState } from 'react'
import { subscribeAdminAppFeedback, subscribeMyAppFeedback } from '../services/appFeedbackService'

export function useMyAppFeedback(userId, enabled = true) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(Boolean(enabled && userId))

  useEffect(() => {
    if (!enabled || !userId) {
      return undefined
    }
    return subscribeMyAppFeedback(userId, nextRows => {
      setRows(nextRows)
      setLoading(false)
    }, error => {
      console.warn('Own app feedback load failed:', error)
      setRows([])
      setLoading(false)
    })
  }, [enabled, userId])

  return { rows: enabled ? rows : [], loading: enabled ? loading : false }
}

export function useAdminAppFeedback(enabled = true) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(Boolean(enabled))

  useEffect(() => {
    if (!enabled) {
      return undefined
    }
    return subscribeAdminAppFeedback(nextRows => {
      setRows(nextRows)
      setLoading(false)
    }, error => {
      console.warn('Admin app feedback load failed:', error)
      setRows([])
      setLoading(false)
    })
  }, [enabled])

  return { rows: enabled ? rows : [], loading: enabled ? loading : false }
}
