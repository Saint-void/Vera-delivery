'use client'

import { useEffect, useMemo, useState } from 'react'
import { Box, Check, MapPin, Navigation, Package, Plane, X } from 'lucide-react'
import { createMission, formatCoordinate, type MapPoint, type VellaDrone, type VellaMission } from '@/lib/vella'
import { LocationPickerClient } from './location-picker-client'

type Props = { open: boolean; availableDrones: VellaDrone[]; initialDroneId?: string | null; onClose: () => void; onCreated: (mission: VellaMission) => void }
const steps = ['Aircraft', 'Drop-off', 'Review']

function droneName(drone: Pick<VellaDrone, 'drone_id' | 'metadata'> | any) {
  return (drone as any).drone_name || drone.metadata?.drone_name || drone.drone_id
}


export function AddMissionDialog({ open, availableDrones, initialDroneId = null, onClose, onCreated }: Props) {
  const [step, setStep] = useState(0)
  const [droneId, setDroneId] = useState<string | null>(null)
  const [dropoff, setDropoff] = useState<MapPoint | null>(null)
  const [altitude, setAltitude] = useState('30')
  const [payloadWeight, setPayloadWeight] = useState('0.5')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const altitudeNumber = Number(altitude)
  const payloadNumber = Number(payloadWeight)
  const validFlightPlan = Number.isFinite(altitudeNumber) && altitudeNumber >= 0 && Number.isFinite(payloadNumber) && payloadNumber >= 0
  const stepReady = useMemo(() => [availableDrones.length > 0, Boolean(dropoff), Boolean(dropoff && validFlightPlan)][step], [availableDrones.length, dropoff, step, validFlightPlan])
  const selectedDrone = droneId ? availableDrones.find((drone) => drone.drone_id === droneId) : null

  useEffect(() => { if (open) { setError(''); setDroneId(initialDroneId) } }, [open, initialDroneId])
  useEffect(() => {
    if (droneId && !selectedDrone) {
      setDroneId(null)
      setError('The selected aircraft is no longer mission-ready. It must have at least 40% battery.')
    }
  }, [droneId, selectedDrone])
  if (!open) return null

  function close(force = false) {
    if (submitting && !force) return
    setStep(0); setDroneId(null); setDropoff(null); setAltitude('30'); setPayloadWeight('0.5'); setError(''); onClose()
  }

  async function submit() {
    if (!dropoff || !validFlightPlan) return
    if (droneId && !selectedDrone) {
      setError('This aircraft is no longer mission-ready. Charge it to at least 40% before assigning a mission.')
      return
    }
    setSubmitting(true); setError('')
    try {
      const mission = await createMission({ ...(droneId ? { droneId } : {}), dropoff: { lat: dropoff.lat, lng: dropoff.lng, alt: altitudeNumber }, payloadWeightKg: payloadNumber })
      onCreated(mission); close(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Mission submission failed.') } finally { setSubmitting(false) }
  }

  return <div className="fixed inset-0 z-[2000] overflow-y-auto bg-black/75 p-4 sm:grid sm:place-items-center" role="dialog" aria-modal="true" aria-labelledby="mission-title"><div className="my-4 w-full max-w-xl border border-border bg-card text-card-foreground shadow-2xl sm:my-0">
    <div className="flex items-start justify-between border-b border-border px-5 py-4"><div><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Vella mission builder</p><h2 id="mission-title" className="mt-1 text-lg font-medium">Plan a delivery</h2></div><button type="button" aria-label="Close mission builder" onClick={() => close()} disabled={submitting} className="text-muted-foreground hover:text-foreground disabled:opacity-50"><X size={18} /></button></div>
    <ol className="grid grid-cols-3 border-b border-border px-5 py-3" aria-label="Mission creation steps">{steps.map((name, index) => <li key={name} className={`text-center text-[9px] uppercase tracking-[0.12em] ${index === step ? 'text-foreground' : index < step ? 'text-muted-foreground' : 'text-muted-foreground/50'}`}><span className={`mx-auto mb-1 grid size-5 place-items-center rounded-full border text-[9px] ${index <= step ? 'border-foreground bg-foreground text-background' : 'border-border'}`}>{index < step ? <Check size={11} /> : index + 1}</span>{name}</li>)}</ol>
    <div className="p-5">
      {step === 0 && <div className="space-y-3"><div className="flex items-center gap-2 text-sm"><Plane size={16} />Select aircraft</div><p className="text-xs text-muted-foreground">Only connected aircraft with at least 40% battery can accept a mission. With auto-assignment, Vella chooses the nearest eligible aircraft.</p><button type="button" onClick={() => setDroneId(null)} className={`flex w-full items-center justify-between border px-3 py-3 text-left ${droneId === null ? 'border-foreground bg-foreground/10' : 'border-border hover:bg-muted'}`}><span><span className="block text-sm">Auto-assign nearest aircraft</span><span className="mt-1 block text-[11px] text-muted-foreground">Vella selects from safe, available aircraft.</span></span><Navigation size={16} className="text-muted-foreground" /></button>{availableDrones.map((drone) => <button key={drone.drone_id} type="button" onClick={() => setDroneId(drone.drone_id)} className={`flex w-full items-center justify-between border px-3 py-3 text-left ${droneId === drone.drone_id ? 'border-foreground bg-foreground/10' : 'border-border hover:bg-muted'}`}><span><span className="block text-sm">{droneName(drone)}</span><span className="mt-1 block font-mono text-[11px] text-muted-foreground">{drone.drone_id}</span></span><span className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{drone.telemetry?.battery_pct ?? '—'}% battery</span></button>)}{availableDrones.length === 0 && <p className="border border-dashed border-border p-3 text-xs text-muted-foreground">No mission-ready aircraft are currently available. Aircraft below 40% must be charged before assignment.</p>}</div>}
      {step === 1 && <div><div className="mb-3 flex items-center gap-2 text-sm"><MapPin size={16} />Set delivery location</div><p className="mb-3 text-xs text-muted-foreground">Search for a place or click the map to place the delivery pin. Its exact coordinates are captured automatically.</p><LocationPickerClient value={dropoff} onChange={setDropoff} label="drop-off" /></div>}
      {step === 2 && <div className="space-y-5"><div className="flex items-center gap-2 text-sm"><Package size={16} />Review delivery</div><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs text-muted-foreground">Flight altitude (m)<input min="0" step="1" type="number" value={altitude} onChange={(event) => setAltitude(event.target.value)} className="mt-1.5 h-10 w-full border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-foreground" /></label><label className="text-xs text-muted-foreground">Payload weight (kg)<input min="0" step="0.1" type="number" value={payloadWeight} onChange={(event) => setPayloadWeight(event.target.value)} className="mt-1.5 h-10 w-full border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-foreground" /></label></div>{!validFlightPlan && <p className="text-xs text-critical">Altitude and payload weight must be zero or greater.</p>}<div className="space-y-3 border border-border bg-muted p-3 text-xs"><div className="flex items-start gap-2"><Plane size={14} className="mt-0.5 text-muted-foreground" /><span><span className="block text-muted-foreground">Launch point</span><span className="text-foreground">{selectedDrone ? `${droneName(selectedDrone)} current position` : 'Chosen by Vella from live aircraft positions'}</span></span></div><div className="flex items-start gap-2"><MapPin size={14} className="mt-0.5 text-muted-foreground" /><span><span className="block text-muted-foreground">Delivery</span><span className="text-foreground">{dropoff?.label || 'Not set'}</span><span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">{formatCoordinate(dropoff)}</span></span></div><div className="flex items-start gap-2"><Box size={14} className="mt-0.5 text-muted-foreground" /><span><span className="block text-muted-foreground">Flight plan</span><span className="text-foreground">{altitude || '0'} m altitude · {payloadWeight || '0'} kg payload</span></span></div></div></div>}
      {error && <p role="alert" className="mt-4 border border-critical/50 bg-critical/10 p-3 text-xs text-foreground">{error}</p>}
      <div className="mt-6 flex items-center justify-between border-t border-border pt-4"><button type="button" onClick={step === 0 ? () => close() : () => setStep((current) => current - 1)} disabled={submitting} className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">{step === 0 ? 'Cancel' : 'Back'}</button>{step < steps.length - 1 ? <button type="button" onClick={() => setStep((current) => current + 1)} disabled={!stepReady || submitting} className="bg-foreground px-4 py-2 text-sm text-background hover:bg-foreground/80 disabled:cursor-not-allowed disabled:opacity-40">Continue</button> : <button type="button" onClick={submit} disabled={!stepReady || submitting} className="bg-foreground px-4 py-2 text-sm text-background hover:bg-foreground/80 disabled:cursor-not-allowed disabled:opacity-40">{submitting ? 'Submitting…' : 'Submit to Vella'}</button>}</div>
    </div>
  </div></div>
}
