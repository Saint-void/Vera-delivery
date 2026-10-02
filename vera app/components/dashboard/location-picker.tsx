'use client'

import { FormEvent, useEffect, useState } from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import { Crosshair, LoaderCircle, MapPin, Search } from 'lucide-react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { MapPoint } from '@/lib/vella'

const DEFAULT_CENTER: [number, number] = [6.6423, 3.3205]

const pin = L.divIcon({
  className: '',
  html: '<div style="width:20px;height:20px;border:2px solid #f5f5f5;background:#111;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 0 0 4px rgba(0,0,0,.45)"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 20],
})

function PickerResizer() {

  const map = useMap()
  useEffect(() => {
    map.whenReady(() => {
      map.invalidateSize()
    })
    const t = setTimeout(() => {
      try {
        map.invalidateSize()
      } catch {}
    }, 250)
    return () => clearTimeout(t)
  }, [map])
  return null
}

function MoveMap({ point }: { point: MapPoint | null }) {
  const map = useMap()
  useEffect(() => {
    if (!point || typeof point.lat !== 'number' || typeof point.lng !== 'number') return
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return
    const update = () => {
      try {
        const center = map.getCenter()
        const dist = Math.hypot(center.lat - point.lat, center.lng - point.lng)
        if (dist > 0.0001) {
          const zoom = Math.max(map.getZoom() || 14, 14)
          map.setView([point.lat, point.lng], zoom, { animate: false })
        }
      } catch {
        map.setView([point.lat, point.lng], 14, { animate: false })
      }
    }
    map.whenReady(update)
  }, [map, point?.lat, point?.lng])
  return null
}


function ClickToPlace({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (event) => onPick(event.latlng.lat, event.latlng.lng) })
  return null
}

type SearchResult = MapPoint

export function LocationPicker({ value, onChange, label }: { value: MapPoint | null; onChange: (location: MapPoint) => void; label: string }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState('')

  async function setFromCoordinates(lat: number, lng: number) {
    setResolving(true)
    setError('')
    try {
      const response = await fetch(`/api/geocode?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`)
      const places = await response.json()
      if (!response.ok) throw new Error(places.detail)
      const place = places[0] as SearchResult | undefined
      onChange(place || { lat, lng, label: `${lat.toFixed(5)}, ${lng.toFixed(5)}` })
    } catch (cause) {
      onChange({ lat, lng, label: `${lat.toFixed(5)}, ${lng.toFixed(5)}` })
      setError(cause instanceof Error ? `${cause.message} Coordinates were saved.` : 'Coordinates were saved.')
    } finally {
      setResolving(false)
    }
  }

  async function search(event: FormEvent) {
    event.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    setError('')
    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(query.trim())}`)
      const places = await response.json()
      if (!response.ok) throw new Error(places.detail)
      setResults(places)
      if (!places.length) setError('No locations found. Try a more specific search.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Location search failed.')
    } finally {
      setSearching(false)
    }
  }

  function selectResult(result: SearchResult) {
    onChange(result)
    setResults([])
    setQuery(result.label)
  }

  const center: [number, number] = value ? [value.lat, value.lng] : DEFAULT_CENTER

  return <div className="space-y-3">
    <form onSubmit={search} className="relative">
      <label className="sr-only" htmlFor={`${label}-search`}>Search for {label}</label>
      <Search size={15} className="absolute left-3 top-3 text-muted-foreground" />
      <input id={`${label}-search`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search an address, landmark, or place" className="h-10 w-full border border-border bg-background pl-9 pr-10 text-sm outline-none placeholder:text-muted-foreground focus:border-foreground" />
      <button type="submit" disabled={searching} aria-label={`Search for ${label}`} className="absolute right-1 top-1 grid size-8 place-items-center text-muted-foreground hover:text-foreground disabled:opacity-50">
        {searching ? <LoaderCircle size={15} className="animate-spin" /> : <Search size={15} />}
      </button>
    </form>

    {results.length > 0 && <div className="max-h-36 overflow-auto border border-border bg-background">
      {results.map((result) => <button key={`${result.lat}-${result.lng}`} type="button" onClick={() => selectResult(result)} className="block w-full border-b border-border px-3 py-2 text-left text-xs last:border-0 hover:bg-muted"><span className="block truncate text-foreground">{result.label}</span><span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">{result.lat.toFixed(5)}, {result.lng.toFixed(5)}</span></button>)}
    </div>}

    <div className="relative h-72 overflow-hidden border border-border bg-muted">
      <MapContainer center={center} zoom={value ? 15 : 13} zoomControl={false} className="h-full w-full" style={{ width: '100%', height: '100%' }}>
        <PickerResizer />
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <MoveMap point={value} />
        <ClickToPlace onPick={setFromCoordinates} />
        {value && <Marker position={[value.lat, value.lng]} icon={pin} />}
      </MapContainer>

      <div className="pointer-events-none absolute left-3 top-3 z-[500] flex items-center gap-2 border border-white/15 bg-black/80 px-2.5 py-1.5 text-[10px] text-white/80"><MapPin size={12} />Click map to place {label}</div>
      {resolving && <div className="absolute bottom-3 left-3 z-[500] flex items-center gap-2 border border-white/15 bg-black/80 px-2.5 py-1.5 text-[10px] text-white"><LoaderCircle size={12} className="animate-spin" />Finding address…</div>}
      <button type="button" onClick={() => navigator.geolocation?.getCurrentPosition((position) => setFromCoordinates(position.coords.latitude, position.coords.longitude), () => setError('Your current location could not be accessed.'))} className="absolute bottom-3 right-3 z-[500] grid size-8 place-items-center border border-white/15 bg-black/80 text-white/80 hover:text-white" aria-label="Use current location"><Crosshair size={15} /></button>
    </div>

    {value && <div className="border border-border bg-muted px-3 py-2 text-xs"><p className="truncate text-foreground">{value.label}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{value.lat.toFixed(5)}, {value.lng.toFixed(5)}</p></div>}
    {error && <p className="text-xs text-muted-foreground">{error}</p>}
  </div>
}
