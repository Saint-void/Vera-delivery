'use client'

import dynamic from 'next/dynamic'
import type { VellaDrone, VellaMission } from '@/lib/vella'
import type { MapViewProps } from './map-view'

const MapView = dynamic(() => import('./map-view').then((module) => module.MapView), {
  ssr: false,
  loading: () => <div className="h-full min-h-[500px] flex-1 bg-[#101315]" aria-label="Loading fleet map" />,
})

export function MapClient(props: MapViewProps) {
  return <MapView {...props} />
}
