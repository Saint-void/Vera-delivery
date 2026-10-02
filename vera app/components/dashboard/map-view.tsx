'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import {
  Battery,
  Compass,
  Crosshair,
  Gauge,
  Layers,
  Map as MapIcon,
  Maximize2,
  Minus,
  Navigation,
  Plane,
  Plus,
  Radio,
  Satellite,
  Shield,
  Target,
  Zap,
} from 'lucide-react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  formatMissionStatus,
  hasHomeLowBatteryAlert,
  needsCharging,
  parseCoordinate,
  type VellaDrone,
  type VellaMission,
} from '@/lib/vella'


// ─── BASEMAP CONFIGURATION ───────────────────────────────────────────────────

export type BasemapId = 'dark' | 'satellite' | 'streets'

interface BasemapDef {
  id: BasemapId
  name: string
  label: string
  url: string
  subdomains?: string
  attribution: string
  maxZoom: number
}

const BASEMAP_TILES: Record<BasemapId, BasemapDef> = {
  dark: {
    id: 'dark',
    name: 'Dark Tactical',
    label: 'Dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    subdomains: 'abcd',
    attribution:
      '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 20,
  },
  satellite: {
    id: 'satellite',
    name: 'Satellite Recon',
    label: 'Sat',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    subdomains: 'abc',
    attribution:
      'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP',
    maxZoom: 19,
  },
  streets: {
    id: 'streets',
    name: 'Clean Streets',
    label: 'Street',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
    subdomains: 'abcd',
    attribution:
      '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 20,
  },
}


// ─── GEOFENCE DEFINITION ─────────────────────────────────────────────────────

// Local operational delivery bounding box in Lagos operating sector
const DEFAULT_GEOFENCE_COORDS: [number, number][] = [
  [6.655, 3.305],
  [6.655, 3.338],
  [6.628, 3.338],
  [6.628, 3.305],
]

// ─── AVIATION VECTOR MARKERS ─────────────────────────────────────────────────

function getDroneStatusTheme(drone: VellaDrone) {
  const telemetry = drone.telemetry
  const mode = (telemetry?.flight_mode || '').toUpperCase()
  const batt = telemetry?.battery_pct ?? 100

  if (hasHomeLowBatteryAlert(drone) || batt < 20) {
    return {
      stroke: '#ff1744',
      rgb: '255, 23, 68',
      glow: '0 0 16px rgba(255, 23, 68, 0.85)',
      badgeBg: 'bg-red-500/20 text-red-300 border-red-500/50',
      label: 'CRITICAL',
    }
  }
  if (needsCharging(drone) || mode === 'RTL' || mode === 'LAND' || batt < 35) {
    return {
      stroke: '#ffab00',
      rgb: '255, 171, 0',
      glow: '0 0 16px rgba(255, 171, 0, 0.85)',
      badgeBg: 'bg-amber-500/20 text-amber-300 border-amber-500/50',
      label: mode || 'RETURNING',
    }
  }
  if (mode === 'AUTO' || mode === 'GUIDED' || (telemetry?.altitude_m && telemetry.altitude_m > 1.5)) {
    return {
      stroke: '#00e676',
      rgb: '0, 230, 118',
      glow: '0 0 16px rgba(0, 230, 118, 0.85)',
      badgeBg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50',
      label: 'IN-FLIGHT',
    }
  }
  return {
    stroke: '#00e5ff',
    rgb: '0, 229, 255',
    glow: '0 0 16px rgba(0, 229, 255, 0.85)',
    badgeBg: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50',
    label: mode || 'READY',
  }
}

function createTacticalDroneIcon(
  drone: VellaDrone,
  isSelected: boolean,
  showLabels: boolean
) {
  const telemetry = drone.telemetry
  const name = ((drone as any).drone_name || drone.metadata?.drone_name || drone.drone_id).replace(/[<>&"']/g, '')

  const heading =
    typeof telemetry?.heading_deg === 'number' && Number.isFinite(telemetry.heading_deg)
      ? Math.round(telemetry.heading_deg)
      : 0
  const theme = getDroneStatusTheme(drone)
  const altText =
    typeof telemetry?.altitude_m === 'number' && Number.isFinite(telemetry.altitude_m)
      ? `${telemetry.altitude_m.toFixed(1)}m`
      : '0.0m'
  const speedText =
    typeof telemetry?.groundspeed_ms === 'number' && Number.isFinite(telemetry.groundspeed_ms)
      ? `${(telemetry.groundspeed_ms * 3.6).toFixed(0)} km/h`
      : '0 km/h'
  const battText = telemetry?.battery_pct != null ? `${telemetry.battery_pct}%` : '—'
  const battColor =
    telemetry?.battery_pct != null
      ? telemetry.battery_pct > 40
        ? '#00e676'
        : telemetry.battery_pct > 20
          ? '#ffab00'
          : '#ff1744'
      : '#00e5ff'

  // Tactical target lock reticle if aircraft is currently selected
  const reticleHtml = isSelected
    ? `
      <div class="pointer-events-none absolute -inset-3.5 flex items-center justify-center" style="z-index: 60;">
        <!-- Pulsing target radar circle -->
        <div class="absolute inset-0 rounded-full border-2 animate-ping" style="border-color: ${theme.stroke}; box-shadow: 0 0 24px ${theme.stroke}; opacity: 0.65;"></div>
        <!-- Spinning compass azimuth ring -->
        <div class="absolute inset-0 rounded-full border border-dashed animate-spin" style="border-color: #ffffff; animation-duration: 9s; opacity: 0.85;"></div>
        <!-- 4 High-contrast tactical corner brackets -->
        <div class="absolute -top-1 -left-1 w-3 h-3 border-t-2 border-l-2" style="border-color: #ffffff; filter: drop-shadow(0 0 5px ${theme.stroke});"></div>
        <div class="absolute -top-1 -right-1 w-3 h-3 border-t-2 border-r-2" style="border-color: #ffffff; filter: drop-shadow(0 0 5px ${theme.stroke});"></div>
        <div class="absolute -bottom-1 -left-1 w-3 h-3 border-b-2 border-l-2" style="border-color: #ffffff; filter: drop-shadow(0 0 5px ${theme.stroke});"></div>
        <div class="absolute -bottom-1 -right-1 w-3 h-3 border-b-2 border-r-2" style="border-color: #ffffff; filter: drop-shadow(0 0 5px ${theme.stroke});"></div>
        <!-- Target Locked Badge -->
        <div class="absolute -top-7 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded text-[8px] font-mono font-black tracking-widest uppercase whitespace-nowrap"
             style="background: #080c10; color: ${theme.stroke}; border: 1px solid ${theme.stroke}; box-shadow: 0 0 10px rgba(0,0,0,0.9);">
          TARGET LOCKED
        </div>
      </div>
    `
    : ''

  // Callsign badge attached to marker
  const labelHtml = showLabels
    ? `
      <div class="pointer-events-none absolute left-[56px] top-1/2 -translate-y-1/2 flex items-center select-none" style="z-index: 1000;">
        <!-- Glowing leader line connecting marker to HUD badge -->
        <div style="width: 14px; height: 2px; background: linear-gradient(to right, ${theme.stroke}, rgba(${theme.rgb}, 0.6));"></div>
        <div style="width: 5px; height: 5px; border-radius: 50%; background: ${theme.stroke}; margin-right: 4px; box-shadow: 0 0 8px ${theme.stroke};"></div>
        
        <!-- Tactical Glassmorphic Telemetry Capsule -->
        <div class="flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-white shadow-2xl backdrop-blur-md"
             style="background: rgba(8, 12, 16, 0.94); border-color: rgba(${theme.rgb}, 0.55); box-shadow: 0 6px 24px rgba(0,0,0,0.85), 0 0 14px rgba(${theme.rgb}, 0.35);">
          <span class="inline-block size-2 rounded-full animate-pulse" style="background: ${theme.stroke}; box-shadow: 0 0 8px ${theme.stroke};"></span>
          <div class="flex flex-col font-mono text-[10px] leading-tight">
            <div class="flex items-center gap-1.5">
              <span class="font-extrabold tracking-wider text-xs" style="color: #ffffff; text-shadow: 0 1px 2px rgba(0,0,0,0.8);">${name}</span>
              <span class="px-1 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider" style="background: rgba(${theme.rgb}, 0.25); color: ${theme.stroke}; border: 1px solid rgba(${theme.rgb}, 0.5);">${theme.label}</span>
            </div>
            <div class="flex items-center gap-2 text-[10px] text-zinc-300 mt-0.5">
              <span class="font-semibold text-zinc-200">ALT ${altText}</span>
              <span class="text-zinc-500">·</span>
              <span class="font-semibold text-zinc-200">HDG ${heading}°</span>
              <span class="text-zinc-500">·</span>
              <span class="font-bold" style="color: ${battColor};">BAT ${battText}</span>
            </div>
          </div>
        </div>
      </div>
    `
    : ''

  return L.divIcon({
    className: 'tactical-drone-marker',
    html: `
      <div class="relative flex items-center justify-center cursor-pointer select-none" style="width: 60px; height: 60px;">
        ${reticleHtml}

        <!-- 1. Ambient Radar Pulse Wave (Continuous Locator Beacon) -->
        <div class="animate-radar pointer-events-none absolute"
             style="left: 50%; top: 50%; transform: translate(-50%, -50%); width: 56px; height: 56px; border-radius: 9999px; border: 2px solid ${theme.stroke}; box-shadow: 0 0 16px ${theme.stroke};"></div>

        <!-- 2. Concentric Tactical Range Disc -->
        <div class="pointer-events-none absolute"
             style="left: 50%; top: 50%; transform: translate(-50%, -50%); width: 48px; height: 48px; border-radius: 9999px; border: 1.5px dashed rgba(${theme.rgb}, 0.7); background: radial-gradient(circle, rgba(${theme.rgb}, 0.22) 0%, rgba(${theme.rgb}, 0.04) 65%, transparent 100%); box-shadow: ${theme.glow};"></div>

        <!-- 3. Rotating Fuselage, Vector & Heading Cone -->
        <div class="relative flex items-center justify-center"
             style="width: 60px; height: 60px; transform: rotate(${heading}deg); transition: transform 0.25s ease-out;">
          
          <!-- Forward Flight Vector Beam -->
          <div class="pointer-events-none absolute"
               style="bottom: 30px; left: 50%; transform: translateX(-50%); width: 3px; height: 32px; background: linear-gradient(to top, ${theme.stroke} 0%, rgba(${theme.rgb}, 0.8) 50%, transparent 100%); box-shadow: 0 0 10px ${theme.stroke};"></div>
          
          <!-- Forward Flight Arrowhead Chevron -->
          <div class="pointer-events-none absolute"
               style="top: -10px; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 9px solid ${theme.stroke}; filter: drop-shadow(0 0 6px ${theme.stroke});"></div>

          <!-- Quadcopter Airframe SVG (High-Contrast Tactical Spec) -->
          <svg viewBox="0 0 48 48" style="width: 44px; height: 44px; filter: drop-shadow(${theme.glow}) drop-shadow(0 2px 6px rgba(0,0,0,0.9));">
            <!-- Dark Composite Foundation Shield (Guarantees contrast on all map types) -->
            
            <!-- Heavy-Duty Structural Crossarms (Carbon Core + Titanium Trim) -->
            <line x1="9" y1="9" x2="39" y2="39" stroke="#000000" stroke-width="5" stroke-linecap="round" />
            <line x1="9" y1="9" x2="39" y2="39" stroke="#f1f5f9" stroke-width="2.6" stroke-linecap="round" />
            <line x1="39" y1="9" x2="9" y2="39" stroke="#000000" stroke-width="5" stroke-linecap="round" />
            <line x1="39" y1="9" x2="9" y2="39" stroke="#f1f5f9" stroke-width="2.6" stroke-linecap="round" />

            <!-- 4 Rotor Discs with active spinning visual appearance -->
            <!-- Front-Left Rotor -->
            <circle cx="9" cy="9" r="6.2" fill="rgba(${theme.rgb}, 0.35)" stroke="${theme.stroke}" stroke-width="1.8" />
            <line x1="5" y1="9" x2="13" y2="9" stroke="#ffffff" stroke-width="1.2" opacity="0.9" />
            <line x1="9" y1="5" x2="9" y2="13" stroke="#ffffff" stroke-width="1.2" opacity="0.9" />
            <circle cx="9" cy="9" r="2.2" fill="#ffffff" filter="drop-shadow(0 0 3px #ffffff)" />

            <!-- Front-Right Rotor -->
            <circle cx="39" cy="9" r="6.2" fill="rgba(${theme.rgb}, 0.35)" stroke="${theme.stroke}" stroke-width="1.8" />
            <line x1="35" y1="9" x2="43" y2="9" stroke="#ffffff" stroke-width="1.2" opacity="0.9" />
            <line x1="39" y1="5" x2="39" y2="13" stroke="#ffffff" stroke-width="1.2" opacity="0.9" />
            <circle cx="39" cy="9" r="2.2" fill="#ffffff" filter="drop-shadow(0 0 3px #ffffff)" />

            <!-- Rear-Left Rotor (FAA Red Aviation Position Marker) -->
            <circle cx="9" cy="39" r="6.2" fill="rgba(${theme.rgb}, 0.35)" stroke="${theme.stroke}" stroke-width="1.8" />
            <line x1="5" y1="39" x2="13" y2="39" stroke="rgba(255,255,255,0.7)" stroke-width="1.2" />
            <line x1="9" y1="35" x2="9" y2="43" stroke="rgba(255,255,255,0.7)" stroke-width="1.2" />
            <circle cx="9" cy="39" r="2.2" fill="#ff4d4f" filter="drop-shadow(0 0 3px #ff4d4f)" />

            <!-- Rear-Right Rotor (FAA Amber Aviation Position Marker) -->
            <circle cx="39" cy="39" r="6.2" fill="rgba(${theme.rgb}, 0.35)" stroke="${theme.stroke}" stroke-width="1.8" />
            <line x1="35" y1="39" x2="43" y2="39" stroke="rgba(255,255,255,0.7)" stroke-width="1.2" />
            <line x1="39" y1="35" x2="39" y2="43" stroke="rgba(255,255,255,0.7)" stroke-width="1.2" />
            <circle cx="39" cy="39" r="2.2" fill="#ffab00" filter="drop-shadow(0 0 3px #ffab00)" />

            <!-- Aerodynamic Fuselage Core (Directional Arrow Pod) -->
            <polygon points="24,11 31,23 27,31 21,31 17,23" fill="#0a0e14" stroke="${theme.stroke}" stroke-width="2" />
            <polygon points="24,14 28,23 24,26 20,23" fill="${theme.stroke}" />
            
            <!-- Central High-Intensity Anti-Collision White Strobe -->
            <circle cx="24" cy="22" r="2.6" fill="#ffffff" filter="drop-shadow(0 0 6px #ffffff)" />
          </svg>
        </div>

        ${labelHtml}
      </div>
    `,
    iconSize: [60, 60],
    iconAnchor: [30, 30],
  })
}

// Departure / Launch Pad Beacon
const launchDepotIcon = L.divIcon({
  className: '',
  html: `
    <div class="relative size-7 flex items-center justify-center cursor-pointer">
      <div class="absolute inset-0 rounded-full border border-emerald-400/80 animate-ping opacity-35"></div>
      <div class="size-6 rounded-full bg-black/90 border-2 border-emerald-400 flex items-center justify-center text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.7)]">
        <span class="font-mono text-[9px] font-black">DEP</span>
      </div>
    </div>
  `,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
})

// Delivery Dropoff Target Beacon
const dropoffTargetIcon = L.divIcon({
  className: '',
  html: `
    <div class="relative size-8 flex items-center justify-center cursor-pointer">
      <div class="absolute inset-0 rounded-full border border-rose-500/80 animate-ping opacity-35"></div>
      <div class="size-7 rounded-full bg-black/90 border-2 border-rose-400 flex items-center justify-center text-rose-300 shadow-[0_0_14px_rgba(244,63,94,0.8)]">
        <span class="font-mono text-[9px] font-black">ARR</span>
      </div>
      <div class="absolute -top-1 -right-1 size-2 rounded-full bg-rose-500"></div>
    </div>
  `,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
})

// Central Operating Depot / Base Station Icon
const homeBaseIcon = L.divIcon({
  className: '',
  html: `
    <div class="relative size-8 flex items-center justify-center cursor-pointer" title="Base Station & Launch Pad">
      <div class="absolute inset-0 rounded-full border border-amber-400/60 opacity-40"></div>
      <div class="size-6 rounded-full bg-[#12161a] border-2 border-amber-400 flex items-center justify-center text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.6)]">
        <span class="font-mono text-[10px] font-black">H</span>
      </div>
      <span class="absolute -bottom-4 whitespace-nowrap font-mono text-[9px] font-semibold tracking-wider text-amber-200 bg-black/80 px-1 rounded border border-amber-400/30">
        BASE
      </span>
    </div>
  `,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
})

// ─── LEAFLET CONTROLLER COMPONENTS ──────────────────────────────────────────

function MapCameraController({
  focusCoords,
  selectedMission,
  selectedDronePos,
  cameraMode,
}: {
  focusCoords?: [number, number] | null
  selectedMission: VellaMission | null
  selectedDronePos?: [number, number] | null
  cameraMode: 'free' | 'follow' | 'fit'
}) {
  const map = useMap()

  useEffect(() => {
    if (focusCoords) {
      map.flyTo(focusCoords, 16, { animate: true, duration: 0.8 })
      return
    }

    if (cameraMode === 'follow' && selectedDronePos) {
      map.panTo(selectedDronePos, { animate: true, duration: 0.35 })
      return
    }

    const p = parseCoordinate(selectedMission?.pickup as any)
    const d = parseCoordinate(selectedMission?.dropoff as any)
    if (p && d) {
      map.fitBounds(
        [
          [p[0], p[1]],
          [d[0], d[1]],
        ],
        { padding: [90, 90], maxZoom: 16, animate: true }
      )
    }
  }, [map, focusCoords, selectedMission?.mission_id, selectedDronePos, cameraMode])


  return null
}

function CursorCoordinateTracker({
  onMove,
}: {
  onMove: (lat: number, lng: number, zoom: number) => void
}) {
  const map = useMapEvents({
    mousemove(e) {
      onMove(e.latlng.lat, e.latlng.lng, map.getZoom())
    },
    zoomend() {
      const c = map.getCenter()
      onMove(c.lat, c.lng, map.getZoom())
    },
  })
  return null
}

function MapResizer() {
  const map = useMap()
  useEffect(() => {
    map.invalidateSize()
    const t1 = setTimeout(() => map.invalidateSize(), 150)
    const t2 = setTimeout(() => map.invalidateSize(), 600)
    const onResize = () => map.invalidateSize()
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      window.removeEventListener('resize', onResize)
    }
  }, [map])
  return null
}

const DEFAULT_MAP_CENTER: [number, number] = [6.6423, 3.3205]

function positionFrom(
  lat: number | null | undefined,
  lng: number | null | undefined
): [number, number] | null {
  return typeof lat === 'number' && Number.isFinite(lat) && typeof lng === 'number' && Number.isFinite(lng)
    ? [lat, lng]
    : null
}

// ─── MAIN MAPVIEW COMPONENT ──────────────────────────────────────────────────

export type MapViewProps = {
  drones: VellaDrone[]
  selectedDroneId: string | null
  selectedMission: VellaMission | null
  focusCoords?: [number, number] | null
  onSelectDrone?: (droneId: string) => void
}

export function MapView({
  drones,
  selectedDroneId,
  selectedMission,
  focusCoords,
  onSelectDrone,
}: MapViewProps) {
  // Basemap switcher state (defaults to Dark Tactical)
  const [activeBasemap, setActiveBasemap] = useState<BasemapId>('dark')

  // Layer visibility toggles
  const [showLabels, setShowLabels] = useState(true)
  const [showBreadcrumbs, setShowBreadcrumbs] = useState(true)
  const [showGeofence, setShowGeofence] = useState(true)
  const [showFlightCorridors, setShowFlightCorridors] = useState(true)
  const [cameraMode, setCameraMode] = useState<'free' | 'follow' | 'fit'>('free')

  // Live cursor telemetry readout
  const [cursorCoords, setCursorCoords] = useState<{ lat: number; lng: number; zoom: number }>({
    lat: 6.6423,
    lng: 3.3205,
    zoom: 13,
  })

  // Breadcrumb trajectory history (rolling buffer per drone)
  const breadcrumbsRef = useRef<Record<string, [number, number][]>>({})

  // Compute live visible drones with valid coordinates, falling back to home position if waiting on telemetry
  const visibleDrones = useMemo(() => {
    return drones.flatMap((drone) => {
      if (!drone.connected) return []
      const pos = positionFrom(drone.telemetry?.latitude, drone.telemetry?.longitude)
      const home = parseCoordinate(drone.home_position as any)
      const position = pos || (home ? ([home[0], home[1]] as [number, number]) : null)
      return position ? [{ drone, position }] : []
    })
  }, [drones])

  // Update breadcrumb trails
  useEffect(() => {
    visibleDrones.forEach(({ drone, position }) => {
      const id = drone.drone_id
      if (!breadcrumbsRef.current[id]) {
        breadcrumbsRef.current[id] = [position]
        return
      }
      const history = breadcrumbsRef.current[id]
      const last = history[history.length - 1]
      // Only append if moved > 0.00005 deg (~5 meters)
      const dist = Math.hypot(last[0] - position[0], last[1] - position[1])
      if (dist > 0.00004) {
        history.push(position)
        if (history.length > 50) history.shift()
      }
    })
  }, [visibleDrones])

  const allPositions = useMemo(() => visibleDrones.map((d) => d.position), [visibleDrones])

  const selectedDroneItem = visibleDrones.find((d) => d.drone.drone_id === selectedDroneId)
  const selectedDronePos = selectedDroneItem?.position

  const center: [number, number] = useMemo(() => {
    if (allPositions.length > 0 && allPositions[0]) {
      return allPositions[0]
    }
    for (const drone of drones) {
      const home = parseCoordinate(drone.home_position as any)
      if (home) return [home[0], home[1]]
    }
    if (selectedMission?.pickup) {
      const p = parseCoordinate(selectedMission.pickup as any)
      if (p) return [p[0], p[1]]
    }
    return DEFAULT_MAP_CENTER
  }, [allPositions, drones, selectedMission])

  // Layer toggle menu state
  const [layersMenuOpen, setLayersMenuOpen] = useState(false)

  return (
    <section
      className="relative h-full min-h-[500px] w-full flex-1 overflow-hidden bg-[#0a0d0f]"
      aria-label="Tactical airspace map"
    >
      <MapContainer
        center={center}
        zoom={13}
        zoomControl={false}
        className="h-full w-full min-h-[500px]"
        style={{ height: '100%', width: '100%' }}
      >
        <MapResizer />

        {/* Dynamic Basemap Tile Layer */}
        <TileLayer
          key={activeBasemap}
          attribution={BASEMAP_TILES[activeBasemap].attribution}
          url={BASEMAP_TILES[activeBasemap].url}
          subdomains={BASEMAP_TILES[activeBasemap].subdomains || 'abcd'}
          maxZoom={BASEMAP_TILES[activeBasemap].maxZoom}
        />


        <MapCameraController
          focusCoords={focusCoords}
          selectedMission={selectedMission}
          selectedDronePos={selectedDronePos}
          cameraMode={cameraMode}
        />

        <CursorCoordinateTracker
          onMove={(lat, lng, zoom) => setCursorCoords({ lat, lng, zoom })}
        />

        {/* ─── Geofence Operating Boundary ───────────────────────────────── */}
        {showGeofence && (
          <>
            <Polygon
              positions={DEFAULT_GEOFENCE_COORDS}
              pathOptions={{
                color: '#06b6d4',
                weight: 1.5,
                dashArray: '4 4',
                fillColor: '#06b6d4',
                fillOpacity: 0.04,
              }}
            />
          </>
        )}

        {/* ─── Breadcrumb Trajectory Trails ──────────────────────────────── */}
        {showBreadcrumbs &&
          Object.entries(breadcrumbsRef.current).map(([droneId, path]) => {
            if (path.length < 2) return null
            const isSelected = droneId === selectedDroneId
            return (
              <Polyline
                key={`trail-${droneId}`}
                positions={path}
                pathOptions={{
                  color: isSelected ? '#38bdf8' : '#10b981',
                  weight: isSelected ? 3 : 1.8,
                  opacity: isSelected ? 0.8 : 0.45,
                  dashArray: '3 6',
                }}
              />
            )
          })}

        {/* ─── Mission Corridors & Waypoint Beacons ──────────────────────── */}
        {showFlightCorridors && (() => {
          const p = parseCoordinate(selectedMission?.pickup as any)
          const d = parseCoordinate(selectedMission?.dropoff as any)
          if (!p || !d) return null
          return (
            <>
              {/* Glowing Underlay */}
              <Polyline
                positions={[
                  [p[0], p[1]],
                  [d[0], d[1]],
                ]}
                pathOptions={{
                  color: '#06b6d4',
                  weight: 6,
                  opacity: 0.22,
                }}
              />
              {/* Main Animated Vector Line */}
              <Polyline
                positions={[
                  [p[0], p[1]],
                  [d[0], d[1]],
                ]}
                pathOptions={{
                  color: '#e7edf0',
                  weight: 2.2,
                  dashArray: '8 6',
                  opacity: 0.9,
                }}
              />
              {/* Launch Waypoint */}
              <Marker
                position={[p[0], p[1]]}
                icon={launchDepotIcon}
              >
                <Popup>
                  <div className="p-2 font-mono text-xs">
                    <div className="font-bold text-emerald-400">LAUNCH POINT (DEP)</div>
                    <div className="mt-1 text-zinc-300">
                      {p[0].toFixed(5)}, {p[1].toFixed(5)}
                    </div>
                    <div className="mt-1 text-[10px] text-zinc-400">
                      Mission: {selectedMission?.mission_id}
                    </div>
                  </div>
                </Popup>
              </Marker>
              {/* Delivery Target Waypoint */}
              <Marker
                position={[d[0], d[1]]}
                icon={dropoffTargetIcon}
              >
                <Popup>
                  <div className="p-2 font-mono text-xs">
                    <div className="font-bold text-rose-400">DELIVERY TARGET (ARR)</div>
                    <div className="mt-1 text-zinc-300">
                      {d[0].toFixed(5)}, {d[1].toFixed(5)}
                    </div>
                    <div className="mt-1 text-[10px] text-zinc-400">
                      Payload: {selectedMission?.payload_weight_kg ?? 0.5} kg
                    </div>
                  </div>
                </Popup>
              </Marker>
            </>
          )
        })()}


        {/* ─── Live Aircraft Markers & Tactical Popups ───────────────────── */}
        {visibleDrones.map(({ drone, position }) => {
          const telemetry = drone.telemetry!
          const name = (drone as any).drone_name || drone.metadata?.drone_name || drone.drone_id

          const isSelected = drone.drone_id === selectedDroneId
          const batt = telemetry.battery_pct ?? 0

          return (
            <Marker
              key={drone.drone_id}
              position={position}
              icon={createTacticalDroneIcon(drone, isSelected, showLabels)}
              eventHandlers={{
                click: () => onSelectDrone?.(drone.drone_id),
              }}
            >
              <Popup>
                <div className="w-64 p-3 font-mono text-xs">
                  {/* Top Header */}
                  <div className="flex items-center justify-between border-b border-white/10 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="size-2 rounded-full bg-emerald-400 animate-pulse"></span>
                      <strong className="font-bold tracking-wide text-foreground text-sm">
                        {name}
                      </strong>
                    </div>
                    <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300 border border-cyan-500/30">
                      {telemetry.flight_mode || 'STABILIZE'}
                    </span>
                  </div>

                  {/* Telemetry Metrics Grid */}
                  <div className="mt-2.5 grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded bg-white/5 p-1.5 border border-white/5">
                      <span className="text-zinc-400 text-[10px]">ALTITUDE</span>
                      <p className="font-bold text-foreground">
                        {telemetry.altitude_m != null ? `${telemetry.altitude_m.toFixed(1)} m` : '—'}
                      </p>
                    </div>
                    <div className="rounded bg-white/5 p-1.5 border border-white/5">
                      <span className="text-zinc-400 text-[10px]">SPEED</span>
                      <p className="font-bold text-foreground">
                        {telemetry.groundspeed_ms != null
                          ? `${(telemetry.groundspeed_ms * 3.6).toFixed(1)} km/h`
                          : '—'}
                      </p>
                    </div>
                    <div className="rounded bg-white/5 p-1.5 border border-white/5">
                      <span className="text-zinc-400 text-[10px]">HEADING</span>
                      <p className="font-bold text-foreground">
                        {telemetry.heading_deg != null ? `${telemetry.heading_deg}°` : '—'}
                      </p>
                    </div>
                    <div className="rounded bg-white/5 p-1.5 border border-white/5">
                      <span className="text-zinc-400 text-[10px]">GPS SAT</span>
                      <p className="font-bold text-foreground">
                        {telemetry.satellites_visible ?? '10'} sats (3D)
                      </p>
                    </div>
                  </div>

                  {/* Battery Health Indicator */}
                  <div className="mt-2.5 rounded bg-white/5 p-1.5 border border-white/5">
                    <div className="flex justify-between text-[10px] text-zinc-400">
                      <span>BATTERY POWER</span>
                      <span className="font-bold text-cyan-300">{batt}% ({telemetry.battery_voltage_v?.toFixed(1) ?? '12.6'}V)</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          batt > 40 ? 'bg-emerald-400' : batt > 20 ? 'bg-amber-400' : 'bg-rose-500'
                        }`}
                        style={{ width: `${Math.min(100, Math.max(0, batt))}%` }}
                      />
                    </div>
                  </div>

                  {/* Quick Action Button */}
                  <button
                    type="button"
                    onClick={() => onSelectDrone?.(drone.drone_id)}
                    className="mt-3 flex w-full items-center justify-center gap-1.5 rounded bg-cyan-500/20 py-1.5 font-sans text-xs font-semibold text-cyan-200 border border-cyan-500/40 hover:bg-cyan-500/30 transition-colors"
                  >
                    <Crosshair size={13} />
                    Inspect Aircraft Telemetry
                  </button>
                </div>
              </Popup>
            </Marker>
          )
        })}
      </MapContainer>

      {/* ─── TOP LEFT: TACTICAL AIRSPACE TELEMETRY HUD ───────────────────── */}
      <div className="pointer-events-none absolute left-4 top-4 z-[900] flex flex-col gap-1.5 font-mono">
        <div className="rounded-lg border border-white/10 bg-black/85 px-3.5 py-2.5 text-xs text-foreground shadow-2xl backdrop-blur-md">
          <div className="flex items-center gap-2">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500"></span>
            </span>
            <span className="font-bold uppercase tracking-widest text-[11px] text-white">
              Tactical Airspace
            </span>
            <span className="rounded bg-zinc-800/80 px-1 py-0.2 text-[9px] font-semibold text-emerald-400 border border-emerald-500/30">
              5 Hz LIVE
            </span>
          </div>

          <div className="mt-2 flex items-center gap-3 text-[11px] text-zinc-300">
            <div>
              <span className="text-[10px] text-zinc-500">FLEET: </span>
              <strong className="text-white">{visibleDrones.length}</strong> active
            </div>
            <div className="h-3 w-[1px] bg-zinc-800"></div>
            <div>
              <span className="text-[10px] text-zinc-500">SECTOR: </span>
              <strong className="text-white">LOS-01</strong>
            </div>
            <div className="h-3 w-[1px] bg-zinc-800"></div>
            <div>
              <span className="text-[10px] text-zinc-500">CEILING: </span>
              <strong className="text-amber-400">120m</strong>
            </div>
          </div>
        </div>

        {/* Active Mission Pill */}
        {selectedMission && (
          <div className="rounded-md border border-cyan-500/30 bg-black/80 px-3 py-1.5 text-[10px] text-cyan-200 backdrop-blur-md flex items-center gap-2">
            <Target size={12} className="text-cyan-400" />
            <span>
              Mission <strong>{selectedMission.mission_id}</strong> &bull;{' '}
              {formatMissionStatus(selectedMission.status)}
            </span>
          </div>
        )}
      </div>

      {/* ─── TOP RIGHT: FLOATING TACTICAL TOOLBAR ────────────────────────── */}
      <div className="absolute right-4 top-4 z-[1000] flex items-center gap-2 font-mono text-xs">
        {/* Basemap Switcher Segmented Control */}
        <div className="flex rounded-lg border border-white/10 bg-black/85 p-1 shadow-2xl backdrop-blur-md">
          {(['dark', 'satellite', 'streets'] as BasemapId[]).map((id) => {
            const def = BASEMAP_TILES[id]
            const active = activeBasemap === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveBasemap(id)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
                  active
                    ? 'bg-cyan-500 text-black font-bold shadow-sm'
                    : 'text-zinc-400 hover:text-white hover:bg-white/5'
                }`}
                title={`Switch to ${def.name}`}
              >
                {id === 'satellite' ? (
                  <Satellite size={12} />
                ) : id === 'streets' ? (
                  <MapIcon size={12} />
                ) : (
                  <Radio size={12} />
                )}
                {def.label}
              </button>
            )
          })}
        </div>

        {/* Layers & Overlays Toggle Button */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setLayersMenuOpen((prev) => !prev)}
            className={`grid size-9 place-items-center rounded-lg border border-white/10 bg-black/85 shadow-2xl backdrop-blur-md transition-colors ${
              layersMenuOpen ? 'border-cyan-400 text-cyan-300' : 'text-zinc-300 hover:text-white hover:bg-white/10'
            }`}
            title="Toggle Map Layers"
          >
            <Layers size={15} />
          </button>

          {/* Layer Options Popover */}
          {layersMenuOpen && (
            <div className="absolute right-0 top-11 w-48 rounded-lg border border-white/15 bg-black/95 p-2 shadow-2xl backdrop-blur-xl flex flex-col gap-1 text-[11px] font-mono">
              <span className="px-2 py-1 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                Map Overlays
              </span>
              <label className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-white/10 cursor-pointer text-zinc-300">
                <span>Callsign Labels</span>
                <input
                  type="checkbox"
                  checked={showLabels}
                  onChange={(e) => setShowLabels(e.target.checked)}
                  className="rounded border-zinc-700 accent-cyan-500"
                />
              </label>
              <label className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-white/10 cursor-pointer text-zinc-300">
                <span>Breadcrumb Trails</span>
                <input
                  type="checkbox"
                  checked={showBreadcrumbs}
                  onChange={(e) => setShowBreadcrumbs(e.target.checked)}
                  className="rounded border-zinc-700 accent-cyan-500"
                />
              </label>
              <label className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-white/10 cursor-pointer text-zinc-300">
                <span>Geofence Perimeter</span>
                <input
                  type="checkbox"
                  checked={showGeofence}
                  onChange={(e) => setShowGeofence(e.target.checked)}
                  className="rounded border-zinc-700 accent-cyan-500"
                />
              </label>
              <label className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-white/10 cursor-pointer text-zinc-300">
                <span>Mission Corridors</span>
                <input
                  type="checkbox"
                  checked={showFlightCorridors}
                  onChange={(e) => setShowFlightCorridors(e.target.checked)}
                  className="rounded border-zinc-700 accent-cyan-500"
                />
              </label>
            </div>
          )}
        </div>

        {/* Camera Tracking Mode Controls */}
        <div className="flex flex-col gap-1 rounded-lg border border-white/10 bg-black/85 p-1 shadow-2xl backdrop-blur-md">
          <button
            type="button"
            onClick={() => setCameraMode((prev) => (prev === 'follow' ? 'free' : 'follow'))}
            className={`grid size-7 place-items-center rounded transition-colors ${
              cameraMode === 'follow'
                ? 'bg-cyan-500 text-black font-bold'
                : 'text-zinc-400 hover:text-white hover:bg-white/10'
            }`}
            title={cameraMode === 'follow' ? 'Follow Lock: ON' : 'Follow Lock: OFF'}
          >
            <Navigation size={13} className={cameraMode === 'follow' ? 'animate-pulse' : ''} />
          </button>
          <button
            type="button"
            onClick={() => {
              setCameraMode('fit')
              setTimeout(() => setCameraMode('free'), 1000)
            }}
            className="grid size-7 place-items-center rounded text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Fit All Fleet"
          >
            <Maximize2 size={13} />
          </button>
        </div>
      </div>

      {/* ─── BOTTOM LEFT: RETICLE & GPS TELEMETRY READOUT ────────────────── */}
      <div className="pointer-events-none absolute bottom-4 left-4 z-[900] flex items-center gap-3 font-mono text-[10px] text-zinc-400 rounded-lg border border-white/10 bg-black/80 px-3 py-1.5 shadow-xl backdrop-blur-md">
        <div className="flex items-center gap-1.5 text-zinc-200">
          <Crosshair size={13} className="text-cyan-400" />
          <span>
            {cursorCoords.lat.toFixed(5)}°N, {cursorCoords.lng.toFixed(5)}°E
          </span>
        </div>
        <div className="h-3 w-[1px] bg-zinc-800"></div>
        <div>
          <span>ZOOM: </span>
          <strong className="text-white">{cursorCoords.zoom}x</strong>
        </div>
        <div className="h-3 w-[1px] bg-zinc-800"></div>
        <div className="text-emerald-400 flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-emerald-400"></span>
          <span>WGS84 GPS SYNCED</span>
        </div>
      </div>

      {/* ─── BOTTOM RIGHT: TACTICAL COMPASS & SCALE INDICATOR ─────────────── */}
      <div className="pointer-events-none absolute bottom-4 right-4 z-[900] flex items-center gap-2 font-mono text-[10px]">
        <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/80 px-2.5 py-1.5 text-zinc-300 shadow-xl backdrop-blur-md">
          <Compass size={14} className="text-cyan-400" />
          <span className="font-bold text-white tracking-widest">N 000°</span>
        </div>
      </div>
    </section>
  )
}
