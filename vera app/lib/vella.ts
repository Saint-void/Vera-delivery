export type Coordinate = {
  lat: number
  lng: number
  alt: number
}

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
  base_url: string
  status: 'available' | 'busy' | 'offline' | 'landed' | 'returning' | 'error' | string
  connected: boolean
  current_mission_id?: string | null
  home_position?: [number, number, number] | null
  metadata?: { drone_name?: string } | null
  telemetry?: VellaTelemetry | null
  last_seen_at?: string | null
  updated_at?: string | null
}

export type VellaMission = {
  mission_id: string
  pickup: [number, number, number]
  dropoff: [number, number, number]
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

  return response.json() as Promise<T>
}

export async function getFleetSnapshot(): Promise<FleetSnapshot> {
  const [drones, missions] = await Promise.all([
    request<VellaDrone[]>('/drones'),
    request<VellaMission[]>('/missions'),
  ])
  return { drones: deduplicateDrones(drones), missions }
}

function registeredAt(drone: VellaDrone) {
  return Date.parse(drone.last_seen_at || drone.updated_at || '') || 0
}

/** One Vera HTTP endpoint represents one physical aircraft. */
export function deduplicateDrones(drones: VellaDrone[]) {
  const unique = new Map<string, VellaDrone>()
  for (const drone of drones) {
    const endpoint = drone.base_url?.replace(/\/$/, '').toLowerCase() || `id:${drone.drone_id}`
    const current = unique.get(endpoint)
    const currentHasName = Boolean(current?.metadata?.drone_name)
    const candidateHasName = Boolean(drone.metadata?.drone_name)
    const preferCandidate = !current || (candidateHasName && !currentHasName) || (candidateHasName === currentHasName && registeredAt(drone) > registeredAt(current))
    if (preferCandidate) unique.set(endpoint, drone)
  }
  return [...unique.values()]
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

export function asMapPoint(coordinate: [number, number, number] | null | undefined, fallback = 'Unknown location'): MapPoint | null {
  if (!coordinate || coordinate.length < 2) return null
  const [lat, lng] = coordinate
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng, label: fallback }
}

export function formatCoordinate(point: Pick<MapPoint, 'lat' | 'lng'> | null | undefined) {
  return point ? `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : 'No location'
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
  const home = drone.home_position
  const latitude = drone.telemetry?.latitude
  const longitude = drone.telemetry?.longitude
  if (!home || typeof latitude !== 'number' || typeof longitude !== 'number') return false
  return distanceBetweenMeters([latitude, longitude], [home[0], home[1]]) <= HOME_PREVIEW_RADIUS_M
}

export function hasHomeLowBatteryAlert(drone: VellaDrone) {
  const battery = batteryPercent(drone)
  return battery !== null && battery < HOME_LOW_BATTERY_PCT && isAtHome(drone)
}
