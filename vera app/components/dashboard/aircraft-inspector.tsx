'use client'

import { useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Battery,
  Check,
  Compass,
  Copy,
  Gauge,
  MapPin,
  Navigation,
  Pause,
  Plane,
  Play,
  Radio,
  RotateCcw,
  Route,
  ShieldAlert,
  X,
} from 'lucide-react'
import {
  formatMissionStatus,
  hasHomeLowBatteryAlert,
  needsCharging,
  parseCoordinate,
  sendDroneCommand,
  type VellaDrone,
  type VellaMission,
} from '@/lib/vella'

type Props = {
  drone: VellaDrone | null
  mission: VellaMission | null
  onClose: () => void
  onAssignMission: (droneId: string) => void
  onFocusOnMap?: (coords: [number, number]) => void
}

function droneName(drone: VellaDrone) {
  return (drone as any).drone_name || drone.metadata?.drone_name || drone.drone_id
}


export function AircraftInspector({
  drone,
  mission,
  onClose,
  onAssignMission,
  onFocusOnMap,
}: Props) {
  const [copied, setCopied] = useState(false)
  const [commanding, setCommanding] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ text: string; isError?: boolean } | null>(null)

  if (!drone) return null

  const telemetry = drone.telemetry
  const charging = needsCharging(drone)
  const batteryPct = telemetry?.battery_pct ?? null
  const hasPosition = Number.isFinite(telemetry?.latitude) && Number.isFinite(telemetry?.longitude)

  const coordsString = hasPosition
    ? `${telemetry!.latitude!.toFixed(6)}, ${telemetry!.longitude!.toFixed(6)}`
    : null

  function copyCoordinates() {
    if (!coordsString) return
    navigator.clipboard?.writeText(coordsString)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleCommand(command: 'rtl' | 'pause' | 'resume' | 'cancel') {
    if (!drone) return
    setCommanding(command)
    setFeedback(null)
    try {
      await sendDroneCommand(drone.drone_id, command, drone.current_mission_id || undefined)
      setFeedback({ text: `Command ${command.toUpperCase()} transmitted successfully.` })
    } catch (cause) {
      setFeedback({
        text: cause instanceof Error ? cause.message : `Failed to execute ${command.toUpperCase()}`,
        isError: true,
      })
    } finally {
      setCommanding(null)
      setTimeout(() => setFeedback(null), 5000)
    }
  }

  return (
    <aside
      className="absolute bottom-0 right-0 top-0 z-[1050] flex w-full flex-col border-l border-border bg-card/95 shadow-2xl backdrop-blur-md transition-transform duration-300 sm:w-[380px] md:w-[410px]"
      aria-label="Aircraft telemetry inspector"
    >
      {/* Header */}
      <div className="flex items-start justify-between border-b border-border bg-header/70 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`size-2 rounded-full ${
                drone.connected ? 'bg-foreground' : 'bg-critical'
              }`}
            />
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
              {drone.connected ? 'Connected Aircraft' : 'Offline Aircraft'}
            </span>
          </div>
          <h2 className="mt-1 truncate font-mono text-base font-semibold tracking-tight text-foreground">
            {droneName(drone)}
          </h2>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            ID: {drone.drone_id}
          </p>
        </div>
        <button
          type="button"
          aria-label="Close aircraft inspector"
          onClick={onClose}
          className="rounded-md border border-border bg-panel p-1.5 text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          <X size={16} />
        </button>
      </div>

      {/* Scrollable Telemetry and Actions */}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 text-xs">
        {/* Command Feedback Toast */}
        {feedback && (
          <div
            role="status"
            className={`flex items-center gap-2 border p-3 font-mono text-[11px] ${
              feedback.isError
                ? 'border-critical/60 bg-critical/15 text-foreground'
                : 'border-foreground/40 bg-foreground/10 text-foreground'
            }`}
          >
            {feedback.isError ? <AlertTriangle size={14} className="text-critical" /> : <Check size={14} />}
            <span>{feedback.text}</span>
          </div>
        )}

        {/* Battery Alert Banner */}
        {charging && (
          <div className="flex items-start gap-2.5 border border-critical/50 bg-critical/10 p-3 text-foreground">
            <ShieldAlert size={15} className="mt-0.5 shrink-0 text-critical" />
            <div>
              <p className="font-medium text-foreground">Low Battery Reserve</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Battery is below 40%. Aircraft cannot accept new delivery missions until charged.
              </p>
            </div>
          </div>
        )}

        {/* Quick Location & Status Card */}
        <div className="border border-border bg-panel p-3">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-mono uppercase tracking-[0.14em] text-muted-foreground">Status</span>
            <span className="font-mono font-medium uppercase text-foreground">
              {drone.status}
            </span>
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/60 pt-2.5">
            <div className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <MapPin size={11} />
                Position
              </span>
              <p className="mt-0.5 truncate font-mono text-[11px] text-foreground">
                {coordsString || 'No fix received'}
              </p>
            </div>
            {hasPosition && (
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={copyCoordinates}
                  title="Copy coordinates"
                  className="rounded border border-border p-1.5 text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                </button>
                {onFocusOnMap && (
                  <button
                    type="button"
                    onClick={() => onFocusOnMap([telemetry!.latitude!, telemetry!.longitude!])}
                    title="Center on map"
                    className="rounded border border-border p-1.5 text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                  >
                    <Navigation size={12} />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Real-time Telemetry Metrics Grid */}
        <section aria-label="Telemetry metrics">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Live Flight Dynamics
          </p>
          <div className="grid grid-cols-2 gap-2">
            {/* Battery */}
            <div className="border border-border bg-card p-3">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em]">
                  <Battery size={13} />
                  Battery
                </span>
                <span
                  className={`font-mono text-xs font-semibold ${
                    charging ? 'text-critical' : 'text-foreground'
                  }`}
                >
                  {batteryPct !== null ? `${batteryPct}%` : '—'}
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border">
                <div
                  className={`h-full transition-all duration-300 ${
                    charging ? 'bg-critical' : 'bg-foreground'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, batteryPct ?? 0))}%` }}
                />
              </div>
            </div>

            {/* Flight Mode */}
            <div className="border border-border bg-card p-3">
              <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                <Activity size={13} />
                Mode
              </span>
              <p className="mt-1.5 truncate font-mono text-xs font-semibold text-foreground">
                {telemetry?.flight_mode || drone.status.toUpperCase()}
              </p>
            </div>

            {/* Altitude */}
            <div className="border border-border bg-card p-3">
              <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                <Route size={13} />
                Altitude
              </span>
              <p className="mt-1.5 font-mono text-xs font-semibold text-foreground">
                {telemetry?.altitude_m !== undefined && telemetry?.altitude_m !== null
                  ? `${telemetry.altitude_m.toFixed(1)} m`
                  : '—'}
              </p>
            </div>

            {/* Groundspeed */}
            <div className="border border-border bg-card p-3">
              <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                <Gauge size={13} />
                Speed
              </span>
              <p className="mt-1.5 font-mono text-xs font-semibold text-foreground">
                {telemetry?.groundspeed_ms !== undefined && telemetry?.groundspeed_ms !== null
                  ? `${telemetry.groundspeed_ms.toFixed(1)} m/s`
                  : '—'}
              </p>
            </div>

            {/* Heading */}
            <div className="border border-border bg-card p-3">
              <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                <Compass size={13} />
                Heading
              </span>
              <p className="mt-1.5 font-mono text-xs font-semibold text-foreground">
                {telemetry?.heading_deg !== undefined && telemetry?.heading_deg !== null
                  ? `${Math.round(telemetry.heading_deg)}°`
                  : '—'}
              </p>
            </div>

            {/* Link Status */}
            <div className="border border-border bg-card p-3">
              <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                <Radio size={13} />
                Link
              </span>
              <p className="mt-1.5 truncate font-mono text-xs font-semibold text-foreground">
                {drone.connected ? 'Vera MAVLink' : 'No Signal'}
              </p>
            </div>
          </div>
        </section>

        {/* Current Mission Info */}
        <section aria-label="Assigned mission details">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Current Mission
          </p>
          <div className="border border-border bg-panel p-3.5">
            {mission ? (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-foreground">
                    {mission.mission_id}
                  </span>
                  <span className="border border-border bg-card px-2 py-0.5 text-[10px] font-medium uppercase text-foreground">
                    {formatMissionStatus(mission.status)}
                  </span>
                </div>
                <div className="space-y-1 font-mono text-[11px] text-muted-foreground">
                  <p>Payload: {mission.payload_weight_kg} kg</p>
                  <p>
                    {(() => {
                      const d = parseCoordinate(mission.dropoff as any)
                      return d
                        ? `Drop-off: ${d[0].toFixed(5)}, ${d[1].toFixed(5)} (${d[2]}m)`
                        : 'Drop-off: Not configured'
                    })()}
                  </p>

                </div>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                No active delivery mission currently assigned to this aircraft.
              </p>
            )}
          </div>
        </section>

        {/* Actionable Flight Controls */}
        <section aria-label="Aircraft flight controls">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Flight Commands
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!drone.connected || commanding !== null}
              onClick={() => handleCommand('rtl')}
              className="flex items-center justify-center gap-2 border border-border bg-panel px-3 py-2.5 text-xs font-medium text-foreground transition-colors hover:border-foreground/40 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw size={14} className={commanding === 'rtl' ? 'animate-spin' : ''} />
              <span>Return (RTL)</span>
            </button>

            <button
              type="button"
              disabled={!drone.connected || commanding !== null}
              onClick={() => handleCommand('pause')}
              className="flex items-center justify-center gap-2 border border-border bg-panel px-3 py-2.5 text-xs font-medium text-foreground transition-colors hover:border-foreground/40 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Pause size={14} />
              <span>Hold / Pause</span>
            </button>

            <button
              type="button"
              disabled={!drone.connected || commanding !== null}
              onClick={() => handleCommand('resume')}
              className="flex items-center justify-center gap-2 border border-border bg-panel px-3 py-2.5 text-xs font-medium text-foreground transition-colors hover:border-foreground/40 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Play size={14} />
              <span>Resume</span>
            </button>

            <button
              type="button"
              disabled={!drone.connected || charging || drone.status !== 'available'}
              onClick={() => onAssignMission(drone.drone_id)}
              className="flex items-center justify-center gap-2 border border-foreground bg-foreground px-3 py-2.5 text-xs font-medium text-background transition-colors hover:bg-foreground/80 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plane size={14} />
              <span>Plan Mission</span>
            </button>
          </div>
        </section>

        {/* Vera Process Endpoint Info */}
        <div className="border-t border-border pt-4 text-[10px] text-muted-foreground">
          <p className="font-mono uppercase tracking-[0.14em]">Vera Process Endpoint</p>
          <p className="mt-1 break-all font-mono text-foreground/80">{drone.base_url}</p>
        </div>
      </div>
    </aside>
  )
}
