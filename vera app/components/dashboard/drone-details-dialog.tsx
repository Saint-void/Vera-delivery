'use client'

import { Activity, Battery, MapPin, Radio, Route, X } from 'lucide-react'
import { formatMissionStatus, type VellaDrone, type VellaMission } from '@/lib/vella'

type Props = { drone: VellaDrone | null; mission: VellaMission | null; onClose: () => void }

function displayName(drone: VellaDrone) { return drone.metadata?.drone_name || drone.drone_id }
function value(value: string | number | null | undefined, suffix = '') { return value === null || value === undefined || value === '' ? '—' : `${value}${suffix}` }

export function DroneDetailsDialog({ drone, mission, onClose }: Props) {
  if (!drone) return null
  const telemetry = drone.telemetry
  const hasPosition = Number.isFinite(telemetry?.latitude) && Number.isFinite(telemetry?.longitude)

  return <div className="fixed inset-0 z-[2000] grid place-items-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="drone-details-title">
    <div className="w-full max-w-md border border-border bg-card text-card-foreground shadow-2xl"><div className="flex items-start justify-between border-b border-border px-5 py-4"><div><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Live aircraft</p><h2 id="drone-details-title" className="mt-1 text-lg font-medium">{displayName(drone)}</h2><p className="mt-1 font-mono text-[11px] text-muted-foreground">{drone.drone_id}</p></div><button type="button" aria-label="Close drone details" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button></div>
      <div className="space-y-5 p-5"><div className="flex items-center justify-between border border-border bg-muted px-3 py-2.5 text-xs"><span className="flex items-center gap-2"><Radio size={14} className={drone.connected ? 'text-foreground' : 'text-critical'} />{drone.connected ? 'Connected to Vella' : 'Disconnected'}</span><span className="font-medium uppercase tracking-[0.1em]">{drone.status}</span></div>
        <div className="grid grid-cols-2 gap-px overflow-hidden border border-border bg-border"><Detail icon={<Battery size={14} />} label="Battery" value={value(telemetry?.battery_pct, '%')} /><Detail icon={<Activity size={14} />} label="Flight mode" value={value(telemetry?.flight_mode)} /><Detail icon={<Route size={14} />} label="Altitude" value={value(telemetry?.altitude_m?.toFixed?.(1), ' m')} /><Detail icon={<Activity size={14} />} label="Ground speed" value={value(telemetry?.groundspeed_ms?.toFixed?.(1), ' m/s')} /></div>
        <section><p className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground"><MapPin size={13} />Current position</p><div className="border border-border bg-muted p-3 text-xs">{hasPosition ? <><p className="font-mono text-foreground">{telemetry!.latitude!.toFixed(6)}, {telemetry!.longitude!.toFixed(6)}</p><p className="mt-1 text-muted-foreground">Last telemetry: {telemetry?.timestamp || '—'}</p></> : <p className="text-muted-foreground">No live location has been received.</p>}</div></section>
        <section><p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Current mission</p><div className="border border-border bg-muted p-3 text-xs">{mission ? <><p className="font-mono text-foreground">{mission.mission_id}</p><p className="mt-1 text-muted-foreground">{formatMissionStatus(mission.status)} · {mission.payload_weight_kg} kg payload</p></> : <p className="text-muted-foreground">No active mission assigned.</p>}</div></section>
        <div className="border-t border-border pt-4 text-[10px] text-muted-foreground"><p>Vera endpoint</p><p className="mt-1 break-all font-mono">{drone.base_url}</p></div>
      </div>
    </div>
  </div>
}

function Detail({ icon, label, value: detailValue }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="bg-card p-3"><div className="flex items-center gap-2 text-muted-foreground">{icon}<span className="text-[10px] uppercase tracking-[0.12em]">{label}</span></div><p className="mt-2 text-sm text-foreground">{detailValue}</p></div>
}
