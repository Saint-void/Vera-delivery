'use client'

import { useEffect, useState } from 'react'
import { BatteryCharging, ChevronLeft, Eye, MapPin, Plane, Settings, X } from 'lucide-react'
import { needsCharging, type VellaDrone } from '@/lib/vella'

type Props = {
  drone: VellaDrone | null
  onClose: () => void
  onViewDrone: () => void
  onAssignMission: () => void
}

function droneName(drone: VellaDrone) {
  return drone.metadata?.drone_name || drone.drone_id
}

export function DroneActionsDialog({ drone, onClose, onViewDrone, onAssignMission }: Props) {
  const [showSettings, setShowSettings] = useState(false)
  useEffect(() => { setShowSettings(false) }, [drone?.drone_id])
  if (!drone) return null
  const charging = needsCharging(drone)

  return <div className="fixed inset-0 z-[2000] grid place-items-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="aircraft-actions-title">
    <div className="w-full max-w-sm border border-border bg-card text-card-foreground shadow-2xl">
      <div className="flex items-start justify-between border-b border-border px-5 py-4"><div>{showSettings && <button type="button" onClick={() => setShowSettings(false)} className="mb-2 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"><ChevronLeft size={13} />Actions</button>}<p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Live aircraft</p><h2 id="aircraft-actions-title" className="mt-1 text-lg font-medium">{showSettings ? 'Aircraft settings' : droneName(drone)}</h2><p className="mt-1 font-mono text-[11px] text-muted-foreground">{drone.drone_id}</p></div><button type="button" aria-label="Close aircraft actions" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button></div>
      {showSettings ? <div className="space-y-4 p-5 text-xs"><p className="text-muted-foreground">Aircraft flight controls and safety values are managed by Vera. The dashboard shows the current connection configuration.</p><div className="space-y-3 border border-border bg-muted p-3"><Setting label="Vera endpoint" value={drone.base_url} /><Setting label="Home position" value={drone.home_position ? `${drone.home_position[0].toFixed(5)}, ${drone.home_position[1].toFixed(5)}` : 'Not configured'} /><Setting label="Mission battery reserve" value="40% minimum" /></div></div> : <div className="space-y-3 p-5">{charging && <div className="flex gap-2 border border-critical/50 bg-critical/10 p-3 text-xs text-foreground"><BatteryCharging size={15} className="shrink-0 text-critical" /><span>Battery is below 40%. Charge this aircraft before assigning a mission.</span></div>}<button type="button" onClick={onViewDrone} className="flex w-full items-center gap-3 border border-border px-3 py-3 text-left text-sm hover:bg-muted"><Eye size={16} /><span><span className="block">View drone</span><span className="mt-0.5 block text-[11px] text-muted-foreground">Live status, position, and mission details</span></span></button><button type="button" onClick={() => setShowSettings(true)} className="flex w-full items-center gap-3 border border-border px-3 py-3 text-left text-sm hover:bg-muted"><Settings size={16} /><span><span className="block">Settings</span><span className="mt-0.5 block text-[11px] text-muted-foreground">Home position and Vera configuration</span></span></button><button type="button" onClick={onAssignMission} disabled={charging || drone.status !== 'available'} className="flex w-full items-center gap-3 border border-foreground bg-foreground px-3 py-3 text-left text-sm text-background hover:bg-foreground/80 disabled:cursor-not-allowed disabled:opacity-40"><Plane size={16} /><span><span className="block">Assign Mission</span><span className="mt-0.5 block text-[11px] text-background/65">{charging ? 'Charge required before assignment' : drone.status === 'available' ? 'Plan a delivery for this aircraft' : 'Aircraft is not currently available'}</span></span></button></div>}
    </div>
  </div>
}

function Setting({ label, value }: { label: string; value: string }) {
  return <div><p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground"><MapPin size={11} />{label}</p><p className="mt-1 break-all font-mono text-[11px] text-foreground">{value}</p></div>
}
