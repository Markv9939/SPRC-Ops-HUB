import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import {
  DEFAULT_SHIFT_TIMING,
  PHOENIX_TIME_ZONE,
  formatPhoenixDateKey,
  getFallbackShiftTimingConfig,
  getNextShiftId,
  getPhoenixParts,
  getShiftTimingDetails,
  hasTimestampPassed,
  isOtcTimedShift,
  normalizeShiftTimingConfig,
  phoenixDateFromParts,
  toDate
} from './shiftTimingCore'

export {
  DEFAULT_SHIFT_TIMING,
  PHOENIX_TIME_ZONE,
  formatPhoenixDateKey,
  getFallbackShiftTimingConfig,
  getNextShiftId,
  getPhoenixParts,
  getShiftTimingDetails,
  hasTimestampPassed,
  isOtcTimedShift,
  normalizeShiftTimingConfig,
  phoenixDateFromParts,
  toDate
}

let cachedConfig = null

export async function getShiftTimingConfig({ forceRefresh = false } = {}) {
  if (cachedConfig && !forceRefresh) return cachedConfig
  try {
    const snap = await getDoc(doc(db, 'appSettings', 'shiftTiming'))
    cachedConfig = normalizeShiftTimingConfig(snap.exists() ? snap.data() : {})
  } catch (error) {
    console.warn('Shift timing config unavailable; using code fallback.', error)
    cachedConfig = normalizeShiftTimingConfig({})
  }
  return cachedConfig
}
