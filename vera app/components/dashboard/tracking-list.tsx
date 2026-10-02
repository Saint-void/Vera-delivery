'use client'

import { useMemo, useState } from 'react'
import {
  Activity,
  Battery,
  CircleAlert,
  Compass,
  Radio,
  Route,
  Search,
  X,
  Zap,
} from 'lucide-react'
import {
  formatMissionStatus,
  hasHomeLowBatteryAlert,
  needsCharging,
  type VellaDrone,
  type VellaMission,
} from '@/lib/vella'

export type FilterTab = 'all' | 'active' | 'ready' | 'charging'

type MissionRailProps = {
  missions: VellaMission[]
  drones: VellaDrone[]
  selectedDroneId: string | null
  selectedMissionId: string | null
  loading: boolean
  error: string | null
  filterTab: FilterTab
  onSelectFilterTab: (tab: FilterTab) => void
  onSelectDrone: (droneId: string) => void
  onSelectMission: (missionId: string) => void
  onOpenMissionPlanner: () => void
}

function droneName(drone: VellaDrone) {
  return (drone as any).drone_name || drone.metadata?.drone_name || drone.drone_id
}


export function MissionRail({
  missions,
  drones,
  selectedDroneId,
  selectedMissionId,
  loading,
  error,
  filterTab,
  onSelectFilterTab,
  onSelectDrone,
  onSelectMission,
}: MissionRailProps) {
  const [query, setQuery] = useState('')
  const missionsById = useMemo(
    () => new Map(missions.map((mission) => [mission.mission_id, mission])),
    [missions]
  )

  const filteredDrones = useMemo(() => {
    return drones.filter((drone) => {
      // Tab filter
      if (filterTab === 'active' && !drone.current_mission_id) return false
      if (filterTab === 'ready' && (drone.status !== 'available' || needsCharging(drone)))
        return false
      if (filterTab === 'charging' && !needsCharging(drone)) return false

      // Text query
      if (!query.trim()) return true
      const searchTarget = `${drone.drone_id} ${droneName(drone)} ${drone.status} ${
        drone.current_mission_id || ''
      }`.toLowerCase()
      return searchTarget.includes(query.toLowerCase())
    })
  }, [drones, filterTab, query])

  return (
    <section
      className="flex min-h-0 w-full shrink-0 flex-col border-r border-border bg-rail md:w-[320px] lg:w-[350px]"
      aria-label="Aircraft registry rail"
    >
      {/* Search Header */}
      <div className="border-b border-border p-3.5 pb-2.5">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-2.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search aircraft or mission ID…"
            className="h-9 w-full rounded border border-border bg-panel pl-9 pr-8 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/50"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Filter Tabs */}
        <div className="mt-2.5 flex items-center justify-between gap-1 text-[10px] font-mono">
          <button
            type="button"
            onClick={() => onSelectFilterTab('all')}
            className={`rounded px-2 py-1 transition-colors ${
              filterTab === 'all'
                ? 'bg-panel font-semibold text-foreground border border-border'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            All ({drones.length})
          </button>
          <button
            type="button"
            onClick={() => onSelectFilterTab('active')}
            className={`rounded px-2 py-1 transition-colors ${
              filterTab === 'active'
                ? 'bg-panel font-semibold text-foreground border border-border'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Active ({drones.filter((d) => Boolean(d.current_mission_id)).length})
          </button>
          <button
            type="button"
            onClick={() => onSelectFilterTab('ready')}
            className={`rounded px-2 py-1 transition-colors ${
              filterTab === 'ready'
                ? 'bg-panel font-semibold text-foreground border border-border'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Ready ({drones.filter((d) => d.status === 'available' && !needsCharging(d)).length})
          </button>
          <button
            type="button"
            onClick={() => onSelectFilterTab('charging')}
            className={`rounded px-2 py-1 transition-colors ${
              filterTab === 'charging'
                ? 'bg-critical/20 font-semibold text-foreground border border-critical/40'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Charge ({drones.filter(needsCharging).length})
          </button>
        </div>
      </div>

      {/* Error alert if any */}
      {error && (
        <div className="m-3 flex items-start gap-2 border border-critical/50 bg-critical/10 p-2.5 text-[11px] text-foreground">
          <CircleAlert size={14} className="mt-0.5 shrink-0 text-critical" />
          <span>{error}</span>
        </div>
      )}

      {/* Aircraft List */}
      <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-border">
        {loading && drones.length === 0 && (
          <div className="p-8 text-center text-xs text-muted-foreground">
            <Radio size={16} className="mx-auto mb-2 animate-pulse text-foreground" />
            <p>Syncing fleet telemetries…</p>
          </div>
        )}

        {!loading && filteredDrones.length === 0 && (
          <div className="p-8 text-center text-xs text-muted-foreground">
            <p>
              {query
                ? 'No matching aircraft found.'
                : 'No connected aircraft in this filter view.'}
            </p>
          </div>
        )}

        {filteredDrones.map((drone) => {
          const mission = drone.current_mission_id
            ? missionsById.get(drone.current_mission_id)
            : undefined
          const telemetry = drone.telemetry
          const isSelected = drone.drone_id === selectedDroneId
          const charging = needsCharging(drone)
          const homeLowBattery = hasHomeLowBatteryAlert(drone)

          return (
            <button
              key={drone.drone_id}
              type="button"
              onClick={() => {
                onSelectDrone(drone.drone_id)
                if (mission) onSelectMission(mission.mission_id)
              }}
              className={`w-full p-3.5 text-left transition-colors hover:bg-panel ${
                isSelected
                  ? 'bg-panel border-l-2 border-l-foreground'
                  : 'border-l-2 border-l-transparent'
              }`}
            >
              {/* Top row: Name, status badge */}
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs font-semibold text-foreground">
                  {droneName(drone)}
                </span>
                <span className="shrink-0 rounded border border-border/80 bg-card px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                  {mission ? formatMissionStatus(mission.status) : drone.status}
                </span>
              </div>

              {/* Sub row: Drone ID + Battery */}
              <div className="mt-1.5 flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                <span className="truncate">{drone.drone_id}</span>
                <span
                  className={`flex items-center gap-1 ${
                    charging ? 'font-semibold text-critical' : 'text-foreground/90'
                  }`}
                >
                  <Battery size={11} />
                  {telemetry?.battery_pct ?? '—'}%
                </span>
              </div>

              {/* Dynamic Telemetry Badges */}
              <div className="mt-2.5 flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Route size={10} />
                  {telemetry?.altitude_m !== undefined && telemetry?.altitude_m !== null
                    ? `${telemetry.altitude_m.toFixed(0)}m`
                    : '0m'}
                </span>
                <span className="flex items-center gap-1">
                  <Activity size={10} />
                  {telemetry?.flight_mode || 'STANDBY'}
                </span>
                {telemetry?.heading_deg !== undefined && telemetry?.heading_deg !== null && (
                  <span className="flex items-center gap-1">
                    <Compass size={10} />
                    {Math.round(telemetry.heading_deg)}°
                  </span>
                )}
              </div>

              {/* Warnings / Mission Tag */}
              {charging && (
                <div className="mt-2 flex items-center gap-1.5 text-[10px] text-critical">
                  <Zap size={11} />
                  <span>Battery below 40% reserve</span>
                </div>
              )}

              {mission && !charging && (
                <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                  <span className="truncate">Mission: {mission.mission_id}</span>
                  <span className="shrink-0 text-[9px] text-foreground">{mission.payload_weight_kg}kg</span>
                </div>
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}
