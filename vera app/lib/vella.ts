export type Coordinate = {
  lat: number
  lng: number
  alt: number
}

export type CoordinateObject = {
  lat: number
  lon?: number
  lng?: number
  alt?: number
}

export type CoordinateTuple = [number, number, number?]

export type RawCoordinate =
  | CoordinateTuple
  | CoordinateObject
  | null
  | undefined

export type MapPoint = {
  lat: number
  lng: number
  label: string
  address?: string
}

export type VellaTelemetry = {
  timestamp?: string
  latitude?: number | null
  longitude?: number | null
  altitude_m?: number | null
  groundspeed_ms?: number | null
  vertical_speed_ms?: number | null
  heading_deg?: number | null
  battery_pct?: number | null
  battery_low?: boolean | number
  battery_voltage_v?: number | null
  flight_mode?: string | null
  armed?: boolean | number | null
  gps_fix_type?: number | null
  satellites_visible?: number | null
}

export type VellaDrone = {
  drone_id: string
  drone_name?: string
  base_url: string
  status: 'available' | 'busy' | 'offline' | 'landed' | 'returning' | 'error' | string
  connected: boolean
  current_mission_id?: string | null
  home_position?: [number, number, number] | CoordinateObject | null
  metadata?: { drone_name?: string } | null
  telemetry?: VellaTelemetry | null
  last_seen_at?: string | null
  updated_at?: string | null
}

export type VellaMission = {
  mission_id: string
  pickup: [number, number, number] | CoordinateObject
  dropoff: [number, number, number] | CoordinateObject
  payload_weight_kg: number
  status: string
  drone_id?: string | null
  assignment_state: string
  delivery_confirmed: boolean
  created_at?: string
  telemetry?: VellaTelemetry | null
}

export type FleetSnapshot = {
  drones: VellaDrone[]
  missions: VellaMission[]
}

export const MISSION_MIN_BATTERY_PCT = 40
export const HOME_LOW_BATTERY_PCT = 30
const HOME_PREVIEW_RADIUS_M = 10

type VellaError = Error & { status?: number }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/vella${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...init?.headers,
    },
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const error = new Error(body?.detail || `Vella request failed (${response.status})`) as VellaError
    error.status = response.status
    throw error
  }

  if (response.status === 204) {
    return undefined as unknown as T
  }

  return response.json() as Promise<T>
}

/**
 * Normalizes coordinate input from either array [lat, lon, alt] or object {lat, lon/lng, alt}
 * to a standard tuple [lat, lng, alt]. Returns null if coordinate is invalid or missing.
 */
export function parseCoordinate(coordinate: RawCoordinate): [number, number, number] | null {
  if (!coordinate) return null
  if (Array.isArray(coordinate)) {
    if (coordinate.length < 2) return null
    const [lat, lng, alt = 0] = coordinate
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null
    }
    return [lat, lng, typeof alt === 'number' && Number.isFinite(alt) ? alt : 0]
  }
  if (typeof coordinate === 'object') {
    const lat = coordinate.lat
    const lng = coordinate.lon !== undefined ? coordinate.lon : coordinate.lng
    const alt = coordinate.alt !== undefined ? coordinate.alt : 0
    if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
      return [lat, lng, typeof alt === 'number' && Number.isFinite(alt) ? alt : 0]
    }
  }
  return null
}

/**
 * Normalizes coordinate to {lat, lng, alt} object format.
 */
export function parseCoordinateObject(coordinate: RawCoordinate): Coordinate | null {
  const parsed = parseCoordinate(coordinate)
  if (!parsed) return null
  return { lat: parsed[0], lng: parsed[1], alt: parsed[2] }
}

export function droneDisplayName(drone: Partial<VellaDrone> | null | undefined): string {
  if (!drone) return 'Unknown'
  return (drone as any).drone_name || drone.metadata?.drone_name || drone.drone_id || 'Unknown'
}

export const TELEMETRY_STALE_TIMEOUT_MS = 10_000

/**
 * Determines whether a drone's telemetry is stale or inactive.
 */
export function isDroneTelemetryStale(drone: VellaDrone): boolean {
  if (!drone.connected || drone.status === 'offline') return true
  const serverSeen = drone.last_seen_at || drone.updated_at
  if (serverSeen) {
    const ts = Date.parse(serverSeen)
    if (!Number.isNaN(ts)) {
      return Date.now() - ts > TELEMETRY_STALE_TIMEOUT_MS
    }
  }
  const telemTs = drone.telemetry?.timestamp
  if (telemTs) {
    const ts = Date.parse(telemTs)
    if (!Number.isNaN(ts)) {
      return Date.now() - ts > TELEMETRY_STALE_TIMEOUT_MS
    }
  }
  return false
}

export async function getFleetSnapshot(): Promise<FleetSnapshot> {
  const [drones, missions] = await Promise.all([
    request<VellaDrone[]>('/drones'),
    request<VellaMission[]>('/missions'),
  ])

  const normalizedDrones = deduplicateDrones(drones).map((drone) => ({
    ...drone,
    home_position: parseCoordinate(drone.home_position) || drone.home_position,
  }))

  const normalizedMissions = missions.map((mission) => ({
    ...mission,
    pickup: parseCoordinate(mission.pickup) || mission.pickup,
    dropoff: parseCoordinate(mission.dropoff) || mission.dropoff,
  }))

  return { drones: normalizedDrones, missions: normalizedMissions }
}

function registeredAt(drone: VellaDrone) {
  return Date.parse(drone.last_seen_at || drone.updated_at || '') || 0
}

/**
 * Deduplicate drones by physical aircraft ID (drone_id).
 * Resolves conflict by preferring connected over disconnected, then fresher last_seen_at timestamp.
 */
export function deduplicateDrones(drones: VellaDrone[]): VellaDrone[] {
  const unique = new Map<string, VellaDrone>()
  for (const drone of drones) {
    const droneId = drone.drone_id
    if (!droneId) continue
    const current = unique.get(droneId)
    if (!current) {
      unique.set(droneId, drone)
      continue
    }
    // Prefer connected over disconnected
    if (drone.connected && !current.connected) {
      unique.set(droneId, drone)
      continue
    }
    if (!drone.connected && current.connected) {
      continue
    }
    // Prefer the more recently updated entry
    const droneTime = registeredAt(drone)
    const currentTime = registeredAt(current)
    if (droneTime > currentTime) {
      unique.set(droneId, drone)
      continue
    }
    if (currentTime > droneTime) {
      continue
    }
    // If timestamps match, prefer the entry with a configured drone_name
    const currentHasName = Boolean((current as any)?.drone_name || current?.metadata?.drone_name)
    const candidateHasName = Boolean((drone as any)?.drone_name || drone.metadata?.drone_name)
    if (candidateHasName && !currentHasName) {
      unique.set(droneId, drone)
    }
  }
  return [...unique.values()]
}

export async function deleteDrone(droneId: string): Promise<void> {
  return request<void>(`/drones/${encodeURIComponent(droneId)}`, {
    method: 'DELETE',
  })
}

export async function createMission(input: {
  droneId?: string
  dropoff: Coordinate
  payloadWeightKg: number
}): Promise<VellaMission> {
  const missionId = `WEB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
  return request<VellaMission>('/missions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mission_id: missionId,
      ...(input.droneId ? { drone_id: input.droneId } : {}),
      dropoff: { lat: input.dropoff.lat, lon: input.dropoff.lng, alt: input.dropoff.alt },
      payload_weight_kg: input.payloadWeightKg,
    }),
  })
}

export async function sendDroneCommand(droneId: string, command: 'rtl' | 'cancel' | 'pause' | 'resume', missionId?: string) {
  return request<{ status: string }>(`/drones/${encodeURIComponent(droneId)}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, mission_id: missionId }),
  })
}

export function asMapPoint(
  coordinate: RawCoordinate,
  fallback = 'Unknown location'
): MapPoint | null {
  const parsed = parseCoordinate(coordinate)
  if (!parsed) return null
  return { lat: parsed[0], lng: parsed[1], label: fallback }
}

export function formatCoordinate(point: Pick<MapPoint, 'lat' | 'lng'> | RawCoordinate | null | undefined) {
  if (!point) return 'No location'
  if ('lat' in (point as object)) {
    const p = point as { lat: number; lng?: number; lon?: number }
    const lng = p.lng !== undefined ? p.lng : p.lon
    if (typeof p.lat === 'number' && typeof lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(lng)) {
      return `${p.lat.toFixed(5)}, ${lng.toFixed(5)}`
    }
  }
  const parsed = parseCoordinate(point as RawCoordinate)
  return parsed ? `${parsed[0].toFixed(5)}, ${parsed[1].toFixed(5)}` : 'No location'
}

export function formatMissionStatus(status: string) {
  return status.replaceAll('_', ' ')
}

export function batteryPercent(drone: VellaDrone) {
  const battery = drone.telemetry?.battery_pct
  return typeof battery === 'number' && Number.isFinite(battery) ? battery : null
}

export function needsCharging(drone: VellaDrone) {
  const battery = batteryPercent(drone)
  return battery !== null && battery < MISSION_MIN_BATTERY_PCT
}

function distanceBetweenMeters(first: [number, number], second: [number, number]) {
  const earthRadiusM = 6_371_000
  const toRadians = (degrees: number) => degrees * Math.PI / 180
  const latitudeDelta = toRadians(second[0] - first[0])
  const longitudeDelta = toRadians(second[1] - first[1])
  const latitude = toRadians(first[0])
  const otherLatitude = toRadians(second[0])
  const distance = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(latitude) * Math.cos(otherLatitude) * Math.sin(longitudeDelta / 2) ** 2
  return 2 * earthRadiusM * Math.asin(Math.sqrt(distance))
}

export function isAtHome(drone: VellaDrone) {
  const home = parseCoordinate(drone.home_position as any)
  const latitude = drone.telemetry?.latitude
  const longitude = drone.telemetry?.longitude
  if (!home || typeof latitude !== 'number' || typeof longitude !== 'number') return false
  return distanceBetweenMeters([latitude, longitude], [home[0], home[1]]) <= HOME_PREVIEW_RADIUS_M
}

export function hasHomeLowBatteryAlert(drone: VellaDrone) {
  const battery = batteryPercent(drone)
  return battery !== null && battery < HOME_LOW_BATTERY_PCT && isAtHome(drone)
}
