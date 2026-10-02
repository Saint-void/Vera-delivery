'use client'

import dynamic from 'next/dynamic'
import type { MapPoint } from '@/lib/vella'

const LocationPicker = dynamic(() => import('./location-picker').then((module) => module.LocationPicker), {
  ssr: false,
  loading: () => <div className="h-72 animate-pulse border border-border bg-muted" aria-label="Loading location picker" />,
})

export function LocationPickerClient({
  value,
  onChange,
  label,
}: {
  value: MapPoint | null
  onChange: (location: MapPoint) => void
  label: string
}) {
  return <LocationPicker value={value} onChange={onChange} label={label} />
}
