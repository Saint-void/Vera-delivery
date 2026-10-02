# Vella Operations Dashboard

The Vella Operations Dashboard is the web console for the Vera drone fleet.
It does not contact individual drones directly. The dashboard talks to **Vella**,
and Vella synchronizes with each registered **Vera** process.

```text
Browser → Next.js dashboard → Next.js /api/vella proxy → Vella API → Vera processes → aircraft
```

This boundary is deliberate: one central fleet service owns fleet visibility,
mission assignment, and the connection to each Vera process. A browser never
needs access to a drone's Vera HTTP endpoint.

## What the dashboard does

- Opens one Server-Sent Events connection to Vella for live fleet updates; the rail and fleet map show only currently connected aircraft and their current missions.
- Renders aircraft whose telemetry contains latitude/longitude on the fleet map.
- Displays an active mission's derived drone launch position, drop-off, and planned route when selected.
- Lets an operator plan a mission by selecting an aircraft (or Vella auto-assignment),
  placing a delivery pin, setting altitude and payload, then submitting it
  to `POST /missions`.
- Supports place/address search and reverse geocoding so a map pin displays both
  coordinates and a human-readable location.

Vella remains authoritative for dispatch and flight safety. Vera still validates
missions, applies geofences and battery rules, performs navigation, and handles
return/landing behavior.

## Prerequisites

- Node.js 20 or later
- pnpm (via Corepack is fine)
- A reachable Vella API

The Vella service must already be running and have at least one registered Vera
drone before the dashboard can display live fleet information.

## Run locally

### 1. Start Vella

From the repository root, activate the Python environment and start Vella:

```bash
source .venv/bin/activate
uvicorn vella.api:app --host 127.0.0.1 --port 8000
```

Vera processes register themselves with Vella. See the repository-level
[`vella/README.md`](../vella/README.md) for fleet and Vera configuration.

### 2. Configure the dashboard

From this directory:

```bash
cp .env.local.example .env.local
```

Set `VELLA_API_URL` to the address that the Next.js server can use to reach Vella.
For the local setup it stays `http://127.0.0.1:8000`.

### 3. Install and run

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

To check the production build:

```bash
corepack pnpm typecheck
corepack pnpm build
```

## Mission planning flow

1. Click **Plan mission** in the mission rail.
2. Choose **Auto-assign nearest aircraft** to let Vella choose an available drone,
   or select a currently available aircraft.
3. Search for the delivery location or click its position on the map. The pin's
   exact latitude and longitude are captured automatically.
4. Set the mission altitude in metres and payload weight in kilograms, review the
   delivery coordinate, then select **Submit to Vella**.

The dashboard sends this shape to Vella:

```json
{
  "mission_id": "WEB-AB12CD34",
  "drone_id": "VERA_001",
  "dropoff": { "lat": 6.5350, "lon": 3.3800, "alt": 30 },
  "payload_weight_kg": 0.5
}
```

`drone_id` is omitted when auto-assignment is selected. Vella then chooses the
nearest available drone using its current telemetry or configured home position.
It derives the launch position from that drone; operators never enter a pickup
coordinate.

## API proxy and environment

Browser requests use same-origin Next.js routes:

| Dashboard route | Forwarded Vella route |
| --- | --- |
| `GET /api/vella/drones` | `GET /drones` |
| `GET /api/vella/missions` | `GET /missions` |
| `POST /api/vella/missions` | `POST /missions` |
| `POST /api/vella/drones/{id}/command` | `POST /drones/{id}/command` |
| `GET /api/vella/fleet/stream` | `GET /fleet/stream` (SSE) |

The proxy is in `app/api/vella/[...path]/route.ts`. It keeps `VELLA_API_URL`
server-side and avoids requiring permissive browser CORS on the Vella service.

The dashboard opens `GET /fleet/stream` after its initial snapshot. Vella emits
a fleet event only when its mirrored drones or missions change, checks for a
change at most once per second, and sends a keep-alive every 15 seconds. This
does not cause each connected browser to poll Vera; Vella's single background
synchronizer remains responsible for collecting drone telemetry.

`app/api/geocode/route.ts` provides the map's search and reverse-geocoding route.
It currently uses OpenStreetMap's Nominatim service for development. Set a clear
`GEOCODER_USER_AGENT` that identifies your deployment, follow Nominatim's usage
policy, and use a contracted geocoding provider before relying on it for frequent
or production dispatch.

## Operational notes

- A green **Vella live** indicator only means the dashboard can read Vella; it is
  not a guarantee that an aircraft is safe to fly.
- A mission appears in the rail immediately after Vella accepts it; its status and
  telemetry update during the next poll.
- Vella returns an error to the UI if it is unavailable or rejects a mission. The
  dialog keeps the operator's plan open so it can be adjusted and resubmitted.
- This UI has no authentication or role control yet. Keep it on a trusted network
  until operator authentication, authorization, and audit logging are added.
