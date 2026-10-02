import { NextRequest } from 'next/server'

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org'
const USER_AGENT = process.env.GEOCODER_USER_AGENT || 'Vella-Operations-Dashboard/1.0'

type NominatimPlace = {
  lat: string
  lon: string
  display_name: string
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')?.trim()
  const lat = request.nextUrl.searchParams.get('lat')
  const lng = request.nextUrl.searchParams.get('lng')

  if (!query && (lat === null || lng === null)) {
    return Response.json({ detail: 'Provide q, or lat and lng.' }, { status: 400 })
  }

  const url = new URL(query ? '/search' : '/reverse', NOMINATIM_URL)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('addressdetails', '1')
  if (query) {
    url.searchParams.set('q', query)
    url.searchParams.set('limit', '5')
  } else {
    url.searchParams.set('lat', lat!)
    url.searchParams.set('lon', lng!)
    url.searchParams.set('zoom', '18')
  }

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      next: { revalidate: 60 },
    })
    if (!response.ok) return Response.json({ detail: 'Location search is temporarily unavailable.' }, { status: 502 })

    const payload = await response.json()
    const places: NominatimPlace[] = Array.isArray(payload) ? payload : [payload]
    return Response.json(places.filter(Boolean).map((place) => ({
      lat: Number(place.lat),
      lng: Number(place.lon),
      label: place.display_name,
    })))
  } catch {
    return Response.json({ detail: 'Location search is unavailable.' }, { status: 503 })
  }
}
