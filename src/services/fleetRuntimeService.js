import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  where
} from 'firebase/firestore'
import { db } from '../firebase'
import { getVersionNumber } from './versioning'
import { parseMileageValue, normalizeMainLocationFromVehicle } from '../utils/fleetStatus'
import { locationIdToMainLocation } from '../utils/orgModel'

function inLocationScope(vehicle, locationId) {
  const normalizedLocation = String(locationId || '').trim().toLowerCase()
  if (!normalizedLocation) return true

  const vehicleLocationId = String(vehicle?.locationId || '').trim().toLowerCase()
  if (vehicleLocationId && vehicleLocationId === normalizedLocation) return true

  const requestedMainLocation = locationIdToMainLocation(locationId)
  const vehicleMainLocation = normalizeMainLocationFromVehicle(vehicle)
  if (!requestedMainLocation || !vehicleMainLocation) return true
  return requestedMainLocation === vehicleMainLocation
}

async function findVehicleByVanId(vanId, locationId) {
  const normalizedVanId = String(vanId || '').trim().toLowerCase()
  if (!normalizedVanId) return null

  const byVanSnap = await getDocs(query(
    collection(db, 'eocVehicles'),
    where('vanId', '==', normalizedVanId),
    where('active', '==', true),
    limit(6)
  ))

  if (byVanSnap.empty) return null

  const preferred = byVanSnap.docs.find(docSnap => inLocationScope(docSnap.data(), locationId)) || byVanSnap.docs[0]
  return preferred ? { id: preferred.id, ...preferred.data() } : null
}

export async function resolveFleetVehicleForEocContext({
  vehicleId,
  vanId,
  locationId
}) {
  const normalizedVehicleId = String(vehicleId || '').trim()
  if (normalizedVehicleId) {
    const vehicleSnap = await getDoc(doc(db, 'eocVehicles', normalizedVehicleId))
    if (vehicleSnap.exists()) {
      return {
        id: vehicleSnap.id,
        ...vehicleSnap.data()
      }
    }
  }

  return findVehicleByVanId(vanId, locationId)
}

export async function updateFleetRuntimeFromEocSubmission({
  submissionId,
  vehicleId,
  vanId,
  locationId,
  odometerReading
}) {
  const parsedMileage = parseMileageValue(odometerReading)
  if (parsedMileage === null) {
    return {
      updated: false,
      reason: 'invalid_odometer'
    }
  }

  const vehicle = await resolveFleetVehicleForEocContext({ vehicleId, vanId, locationId })
  if (!vehicle?.id) {
    return {
      updated: false,
      reason: 'vehicle_not_found'
    }
  }

  const runtimeRef = doc(db, 'fleetVehicleRuntime', vehicle.id)
  let effectiveMileage = parsedMileage

  await runTransaction(db, async (transaction) => {
    const runtimeSnap = await transaction.get(runtimeRef)
    const existing = runtimeSnap.exists() ? runtimeSnap.data() : null
    const previousMileage = parseMileageValue(existing?.lastKnownMileage)
    if (previousMileage !== null) {
      effectiveMileage = Math.max(previousMileage, parsedMileage)
    }

    const nextVersion = existing ? getVersionNumber(existing) + 1 : 1
    const payload = {
      vehicleId: vehicle.id,
      lastKnownMileage: effectiveMileage,
      lastKnownMileageAt: serverTimestamp(),
      lastKnownSubmissionId: String(submissionId || '').trim() || null,
      version: nextVersion,
      updatedAt: serverTimestamp()
    }

    if (!existing?.createdAt) {
      payload.createdAt = serverTimestamp()
    }

    transaction.set(runtimeRef, payload, { merge: true })
  })

  return {
    updated: true,
    vehicleId: vehicle.id,
    vehicle,
    inputMileage: parsedMileage,
    effectiveMileage
  }
}
