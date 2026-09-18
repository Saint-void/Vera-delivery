# Vera Delivery Project Description

This repository contains a full drone fleet system split into three major parts:

1. Vella — the central fleet backend and mission coordinator.
2. Vera — the independent flight-side process for one drone.
3. Vera app — the Next.js operations dashboard used by a human operator.

Together, they implement a distributed drone operations architecture where each aircraft runs its own Vera process, while Vella keeps the fleet registry, assigns missions, and exposes the fleet API.

---

## 1. Project Overview

The application is designed around a distributed fleet model:

- Vella does not directly fly aircraft.
- Vera owns the local MAVLink connection and flight logic for a single drone.
- Any number of Vera instances may register to one Vella backend.
- Vella stores fleet-wide mission and telemetry state in a SQLite database.
- Each Vera process stores its own mission and telemetry data locally in a separate SQLite database and telemetry log.
- The dashboard reads fleet data from Vella, not from the drones directly.

The system is structured so that a drone can continue flying even if Vella is temporarily unavailable. The local flight controller remains independent from the backend.

---

## 2. Vella

### Purpose

Vella is the fleet control and reporting layer. It is the account of the whole fleet, not the aircraft itself. It keeps:

- the list of registered drones,
- their health and telemetry,
- assigned missions,
- mission history,
- fleet status,
- a central API for dispatch and monitoring.

### Core architecture

Vella includes:

- `vella/api.py` — FastAPI server exposing the fleet API.
- `vella/orchestrator.py` — central orchestration logic for syncing drones and assigning missions.
- `vella/storage.py` — fleet mirror storage wrapper.
- `vella/db.py` — SQLite persistence layer for fleet data.
- `vella/models.py` — request/response schemas used over HTTP.
- `vella/vera_client.py` — HTTP client that calls each Vera instance.

### Main responsibilities

- register each drone with a unique `drone_id`
- track drone state: available, busy, offline, landed, returning, error
- monitor each Vera instance by polling its `/health` and `/missions` endpoints
- mirror telemetry from each drone to Vella
- auto-assign missions to the nearest available drone
- support targeted mission assignment with `drone_id`
- reject low-battery drones from mission assignment
- keep a mission history and fleet snapshot
- stream updates to dashboards via Server-Sent Events

### Fleet API features

The API includes endpoints such as:

- `GET /drones`
- `GET /drones/{drone_id}`
- `GET /drones/{drone_id}/telemetry`
- `POST /drones`
- `POST /drones/{drone_id}/command`
- `GET /missions`
- `GET /missions/{mission_id}`
- `POST /missions`
- `GET /fleet/status`
- `GET /fleet/stream`
- `GET /fleet/drones/active`
- `GET /fleet/drones/available`
- `POST /delivery/{mission_id}/complete`

Vella exposes mission records including:

- `mission_id`
- `pickup`
- `dropoff`
- `payload_weight_kg`
- `status`
- `drone_id`
- `assignment_state`
- `delivery_confirmed`
- `history`
- `telemetry`

### Mission assignment logic

Vella chooses a drone based on:

- current drone availability,
- current telemetry location,
- configured home position when live telemetry is missing,
- battery reserve requirements.

Mission assignment checks:

- nearest available drone for auto-assignment,
- targeted assignment when `drone_id` is passed,
- minimum launch battery threshold,
- rejection if a requested drone is offline or not available.

The system also supports a dropoff-only mission flow. In that case, Vella derives the launch point from the selected drone's current position or home position.

### Fleet database design

The Vella SQLite schema includes:

- `drones` table
- `missions` table
- `flight_logs` table
- `telemetry` table

Key drone fields include:

- `drone_id`
- `base_url`
- `status`
- `connected`
- `home_position`
- `current_mission_id`
- `last_seen_at`
- `metadata`

Key mission fields include:

- `mission_id`
- `pickup`
- `dropoff`
- `payload_weight_kg`
- `status`
- `delivery_confirmed`
- `drone_id`
- `assignment_state`
- `assigned_at`
- `completed_at`

### Synchronization behavior

Vella maintains a sync loop that polls each registered drone and updates its fleet mirror. It does not control the aircraft. It only:

- fetches health,
- fetches the list of missions,
- copies mission snapshots,
- updates telemetry,
- updates status and mission assignment.

This is the boundary between the backend and the independent flight controller.

---

## 3. Vera

### Purpose

Vera is the independent flight-side process for one specific aircraft. It owns:

- the local MAVLink connection,
- mission queue and state machine,
- local SQLite mission store,
- telemetry logger,
- battery safety logic,
- geofence and navigation validation,
- command execution and recovery behavior.

Vera can function without Vella being online. It is not a client-only wrapper; it is the actual operation engine for a drone.

### Main architecture files

- `vera/__main__.py` — entry point (`python -m vera`)
- `vera/server.py` — local HTTP endpoint for mission + status operations
- `vera/controller.py` — mission state execution and safety controller
- `vera/registration.py` — outbound registration to Vella
- `vera/config.py` — environment configuration and mission constants
- `vera/mission_request.py` — mission contract and validation rules
- `vera/mission_state.py` — mission state machine definitions
- `vera/navigation.py` — pathing and geographic logic
- `vera/storage.py` — local mission state, telemetry, and event history
- `vera/telemetry.py` — telemetry parsing and logging
- `vera/connection.py` — MAVLink connection helpers
- `vera/safety.py` — safety checks such as GPS health and geofencing

### Local HTTP API

Vera exposes a local HTTP server that supports:

- `GET /health` and `GET /state`
- `GET /telemetry`
- `GET /missions`
- `GET /missions/{mission_id}`
- `POST /missions`
- `POST /commands`

This HTTP layer is used by Vella to read the drone status and push mission requests.

### Mission lifecycle

Vera validates incoming mission requests before accepting them. A request must pass:

- coordinate validity checks,
- altitude positivity,
- geofence validation,
- maximum mission range validation,
- non-negative payload weight,
- minimum battery checks before launch.

Mission state progression follows the internal machine:

- IDLE
- PREPARING
- TAKEOFF
- EN_ROUTE
- DELIVERY
- RETURNING
- LANDING
- LANDED
- COMPLETED
- ABORTED
- EMERGENCY

### Flight execution logic

The controller runs a background thread. It drives the mission sequence:

1. ensure guidance mode and safe state,
2. arm and take off if needed,
3. navigate to the destination,
4. verify arrival at the dropoff area,
5. perform payload release / delivery confirmation,
6. command RTL,
7. verify return home,
8. command landing,
9. verify landing,
10. mark mission completed.

### Safety behavior

Vera includes layers of safety logic:

- geofence checks
- GPS health validation
- battery failsafes
- emergency abort logic
- return-to-home behavior
- landing verification
- pause/cancel/resume command handling

Battery logic includes thresholds such as:

- minimum mission-reserve battery requirement before launching
- low battery interrupt at around 20%
- critical battery interrupt around 10%
- automatic RTL/LAND behavior when low battery conditions occur

When a battery condition is triggered, the system records the event, aborts or recovers the mission, and transitions to a recovery state without leaving the aircraft unmanaged.

### Telemetry and state recording

Vera logs telemetry continuously from the MAVLink connection. It records:

- timestamp
- latitude / longitude / altitude
- groundspeed and vertical speed
- heading
- battery percentage and remaining metrics
- flight mode
- armed status
- GPS fix and satellite count
- autopilot boot time

This telemetry is written locally for mission analysis, status queries, and mission event auditing.

### Vella registration

Each Vera instance registers itself with Vella through an outbound POST to `/drones`.

Registration payload includes:

- `drone_id`
- `drone_name`
- `host`
- `base_url`
- `mavlink_connection`
- `status`
- `connected`
- `home_position`

Registration repeats on a periodic interval and is designed to be best-effort. If Vella is temporarily unavailable, Vera keeps running and retries later.

---

## 4. Vera App (Next.js Dashboard)

### Purpose

The Vera app is the operator-facing dashboard. It is not a drone controller. It acts as a presentation and control layer on top of Vella.

The dashboard flow is:

- browser loads dashboard,
- Next.js server calls Vella API,
- Vella returns fleet snapshot,
- dashboard streams updates through `/api/vella/fleet/stream`.

### Technology stack

The app uses:

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- Leaflet for map rendering
- Server-side proxy routes for Vella API access

### Main UI features

- live fleet overview
- mission rail for active missions
- map-based mission planning
- reverse geocoding / address lookup via OpenStreetMap Nominatim
- aircraft action dialog
- drone detail dialog
- mission assignment controls
- battery status and charging state highlighting

### Dashboard components

Key frontend files include:

- `vera app/app/page.tsx` — main full-screen operations dashboard
- `vera app/components/dashboard/map-client.tsx` — dynamic map client wrapper
- `vera app/components/dashboard/map-view.tsx` — tactical airspace map with multi-basemap switcher (Dark Tactical, Satellite, Streets), directional vector aircraft icons, mission corridors, and telemetry HUD
- `vera app/components/dashboard/aircraft-inspector.tsx` — real-time aircraft telemetry inspector and command sidebar overlay
- `vera app/components/dashboard/tracking-list.tsx` — mission rail / fleet status pane
- `vera app/components/dashboard/add-mission-dialog.tsx` — mission creation dialog
- `vera app/components/dashboard/drone-actions-dialog.tsx` — drone action menu
- `vera app/components/dashboard/drone-details-dialog.tsx` — detailed drone view
- `vera app/components/dashboard/header.tsx` — fleet header / controls
- `vera app/components/dashboard/location-picker.tsx` — coordinate selection UI
- `vera app/components/dashboard/location-picker-client.tsx` — interactive picker behavior


### API proxy layer

The app proxies Vella requests through Next.js routes such as:

- `app/api/vella/[...path]/route.ts`
- `app/api/geocode/route.ts`

This keeps the Vella API URL server-side and avoids browser-level CORS issues.

### Mission planning workflow

The operator can:

1. select an aircraft or use auto-assignment,
2. choose a delivery point on the map or by search,
3. set altitude and payload weight,
4. submit the mission to Vella.

The mission payload sent to Vella is shaped like:

- `mission_id`
- `drone_id` (optional)
- `dropoff`
- `payload_weight_kg`

When no drone is selected, Vella decides the nearest available drone.

### Dashboard live update model

The dashboard uses a single SSE connection to Vella and updates the UI when the fleet snapshot changes. It also keeps a 15-second heartbeat for stream liveness.

This ensures the operator sees:

- connected drones,
- active mission state,
- current telemetry,
- battery state,
- updates to mission lifecycle.

---

## 5. Shared Behavior and System Boundaries

### Separation of concerns

- Vella owns fleet state and dispatch.
- Vera owns the local aircraft flight controller.
- Vella app owns the operator UI.

This is an intentional separation: the UI should never directly control individual drones, and the flight system should not depend on Vella for safe operation.

### Safety emphasis

This project strongly emphasizes safety invariants:

- Vella chooses only available drones.
- Vera validates mission geometry before takeoff.
- Vera enforces minimum battery thresholds.
- Low battery transitions to recovery behavior.
- GPS health and geofencing are treated as hard safety conditions.
- Landing and home arrival are verified before terminal completion.

### Resilience behaviour

- If Vella is down, Vera continues its local mission execution.
- If Vera is down or unreachable, Vella marks the drone offline.
- Registration is retried automatically.
- Local HTTP control remains independent from the fleet backend.

---

## 6. Tests and validation

The repository includes tests that cover:

- fleet orchestrator behavior,
- mission assignment to nearest or targeted drones,
- low-battery rejection,
- dropoff-only mission creation,
- API behavior,
- navigation message handling.

Examples include:

- `tests/test_fleet_orchestrator.py`
- `tests/test_navigation.py`
- `tests/test_vera_registration.py`
- `tests/test_vera_state.py`
- `tests/test_process_boundary.py`
- `tests/test_sitl_failure_boundary.py`

These tests validate the boundaries between Vella scheduling and Vera flight safety.

---

## 7. Runtime and deployment model

The deployment model consists of:

- **one Vella instance** — centralized orchestrator and SSE broadcast server (default port `8000`),
- **many Vera instances** across physical or SITL aircraft — local independent flight controller and MAVLink bridge (default ports `8765`, `8766`, etc.),
- **one dashboard instance** (`vera app`) — Next.js real-time tactical fleet operations dashboard (default port `3000`).

### Real-Time Telemetry & Communication Architecture

- **Vera → ArduPilot**: MAVLink over UDP (e.g. `udp:127.0.0.1:14551`).
- **Vera → Vella Telemetry**: Persistent WebSocket connection (`/ws/telemetry/{drone_id}`) streaming 5 Hz telemetry frames with exponential reconnect backoff.
- **Vella → Vera Commands & Dispatch**: REST endpoints (`/missions`, `/commands`) called over HTTP for authoritative lifecycle actions.
- **Vella → Dashboard**: Server-Sent Events (SSE) via `/fleet/stream` (proxied by Next.js at `/api/vella/fleet/stream`) providing zero-polling live updates to the frontend.

Configuration is environment-based. Each Vera process loads its own configuration (`.env` or via `VERA_ENV_FILE=vera/.env.002`) and connects to Vella automatically.


---

## 8. Summary

This project is a full drone fleet platform with a practical distributed architecture:

- Vella = central fleet orchestrator and API
- Vera = local independent flight controller for each drone
- Vera app = operator dashboard for dispatch and fleet visibility

It includes live telemetry streaming, mission assignment logic, safety checks, persistent SQLite storage, and a real operator UI for managing a drone fleet.

The current codebase is already a working drone fleet prototype with architecture, persistence, telemetry mirroring, mission workflows, battery safety, geofence checks, and an operational dashboard connected to the fleet backend.
