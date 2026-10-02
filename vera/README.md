# Vera / Vella

Vera is an independent flight-side process. Every drone has its own Vera
process, MAVLink connection, HTTP port, SQLite state database, and telemetry
log. Vella is the fleet backend and reporting API; it does not own a MAVLink
connection or flight worker.

## Architecture

Vella maintains a durable fleet registry. On startup, and then periodically,
each Vera posts its identity and reachable HTTP address to Vella. The registry
contains the `drone_id`, drone name, machine host, Vera URL, local MAVLink
connection, status, connection state, home position when known, latest
telemetry, and current mission. Vella then synchronizes each registered Vera
independently and stores mission history and telemetry with the owning
`drone_id`.

When a mission does not specify a drone, Vella assigns it to the nearest
available drone using current telemetry, falling back to the configured home
position. A mission can also target a specific available drone with
`drone_id`. The mission is assigned in Vella before it is sent to Vera, which
prevents the same mission from being assigned to multiple drones.

Vera remains responsible for mission validation, geofence checks, battery
safety, navigation, return-to-home, landing, abort, and recovery behavior.

## Installation

From this directory:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
mkdir -p runtime logs
```

## Distributed deployment (one to N machines)

Run Vella once on an address reachable from every drone machine. It owns the
fleet registry only; it does not connect to MAVLink. For example, on machine
`192.168.95.10`:

```bash
uvicorn vella.api:app --host 0.0.0.0 --port 8000
```

Each drone machine has a separate `vera/.env` file. Vera loads it at startup;
variables supplied by a service manager, container, or IDE override the file.
The normal application command on every drone remains exactly:

```bash
python -m vera
```

`VERA_HOST` controls where the local HTTP server binds. `VERA_BASE_URL` is the
separate, routable address Vella uses to call that Vera. Always set
`VERA_BASE_URL` explicitly for multi-machine deployments; it must not be
`localhost` unless Vella is on the same machine.

The complete schema for each Vera environment is:

```text
VERA_CONNECTION_STRING=udp:127.0.0.1:14551   # local ArduPilot only
VERA_HOST=0.0.0.0                            # local HTTP bind address
VERA_PORT=8765                               # local HTTP listening port
VERA_BASE_URL=http://192.168.95.10:8765      # Vella-reachable Vera URL
VERA_MACHINE_HOST=192.168.95.10              # reported inventory address
VERA_DRONE_ID=VERA_001                       # immutable fleet identity
VERA_DRONE_NAME=VERA_000                     # human-readable display name
VERA_DRONE_ID_NUM=001                        # optional numeric identity
VERA_STATE_DB=/var/lib/vera/vera-001.sqlite3 # private to this Vera only
VERA_TELEMETRY_LOG=/var/log/vera/vera-001.csv # private to this Vera only
VERA_HOME_POSITION=6.641083,3.318111,10      # optional: send only if known
VELLA_BASE_URL=http://192.168.95.10:8000     # central Vella URL
VELLA_REGISTRATION_INTERVAL_S=15             # optional heartbeat interval
VELLA_REGISTRATION_TIMEOUT_S=3               # optional HTTP timeout
```

`VELLA_DRONE_ID` and `VERA_NAME_ID` remain accepted as compatibility aliases,
but new deployments should use `VERA_DRONE_ID` and `VERA_DRONE_NAME`.

For the requested three-machine fleet, the per-machine differences are:

```bash
machine A: VERA_DRONE_ID=VERA_001
           VERA_CONNECTION_STRING=udp:127.0.0.1:14551
           VERA_BASE_URL=http://192.168.95.10:8765
           VERA_STATE_DB=/var/lib/vera/vera-001.sqlite3
           VERA_TELEMETRY_LOG=/var/log/vera/vera-001.csv
```

```bash
machine B: VERA_DRONE_ID=VERA_002
           VERA_CONNECTION_STRING=udp:127.0.0.1:14551
           VERA_BASE_URL=http://192.168.95.11:8765
           VERA_STATE_DB=/var/lib/vera/vera-002.sqlite3
           VERA_TELEMETRY_LOG=/var/log/vera/vera-002.csv
```

```bash
machine C: VERA_DRONE_ID=VERA_003
           VERA_CONNECTION_STRING=udp:127.0.0.1:14551
           VERA_BASE_URL=http://192.168.95.12:8765
           VERA_STATE_DB=/var/lib/vera/vera-003.sqlite3
           VERA_TELEMETRY_LOG=/var/log/vera/vera-003.csv
```

All three can use port `8765` because ports are scoped to a machine. Their
MAVLink strings can also all use `udp:127.0.0.1:14551`, because each targets
the local ArduPilot on its own machine. If a drone moves networks, change only
that machine's advertised host/base URL and central `VELLA_BASE_URL` if needed.

Vera sends `POST {VELLA_BASE_URL}/drones` after its HTTP server has bound and
every registration interval thereafter. The payload is shaped as follows:

```bash
{
  "drone_id": "VERA_001",
  "drone_name": "VERA_000",
  "host": "192.168.95.10",
  "base_url": "http://192.168.95.10:8765",
  "mavlink_connection": "udp:127.0.0.1:14551",
  "status": "available",
  "connected": true,
  "home_position": {"lat": 6.641083, "lon": 3.318111, "alt": 10}
}
```

Vella upserts this entry by `drone_id`, retains it in its own fleet database,
and polls the registered `base_url` for health, telemetry, and mission state.
If Vella is temporarily down, registration retries; local flight control is
unaffected. Vella never creates a default `localhost` drone.

## Fleet API

The interactive API documentation is available at
`http://127.0.0.1:8000/docs`.

Useful endpoints:

```text
GET  /fleet/status
GET  /fleet/drones/active
GET  /fleet/drones/available
GET  /fleet/missions/assigned
GET  /drones
GET  /drones/{drone_id}
GET  /drones/{drone_id}/telemetry
POST /drones
POST /drones/{drone_id}/command
GET  /missions
GET  /missions/{mission_id}
POST /missions
```

Check the fleet:

```bash
curl http://127.0.0.1:8000/fleet/status
curl http://127.0.0.1:8000/drones
curl http://127.0.0.1:8000/fleet/drones/available
```

## Submitting Missions

Without `drone_id`, Vella chooses the nearest available drone:

```bash
curl -X POST http://127.0.0.1:8000/missions \
  -H 'Content-Type: application/json' \
  -d '{
    "mission_id": "mission-001",
    "pickup": {"lat": 6.623414, "lon": 3.623414, "alt": 10},
    "dropoff": {"lat": 6.630000, "lon": 3.630000, "alt": 10},
    "payload_weight_kg": 1
  }'
```

To target a particular registered and available drone, include `drone_id`:

```bash
curl -X POST http://127.0.0.1:8000/missions \
  -H 'Content-Type: application/json' \
  -d '{
    "mission_id": "mission-002",
    "drone_id": "VERA-002",
    "pickup": {"lat": 6.623414, "lon": 3.623414, "alt": 10},
    "dropoff": {"lat": 6.630000, "lon": 3.630000, "alt": 10},
    "payload_weight_kg": 1
  }'
```

The test mission script supports the same behavior:

```bash
python -m scripts.submit_test_mission
python -m scripts.submit_test_mission --drone-id VERA-002
python -m scripts.submit_test_mission --base-url http://127.0.0.1:8000 --drone-id VERA-001
```

If `--drone-id` is omitted, the nearest available drone is selected. The
script generates a unique mission ID and waits until the mission reaches a
terminal state.

## State and Safety

Vera stores its authoritative mission and event history in its own SQLite
database. Vella stores a fleet-wide reporting mirror in its Vella database.
Never reuse one Vera SQLite path for multiple drones.

The return/landing lifecycle is `RTL` command -> `HOME_REACHED` verification
-> `LAND` command -> `LANDING` -> `LANDED` verification -> `COMPLETED`.

Battery actions are triggered once per mission:

| Battery remaining | Action |
| --- | --- |
| `<= 20%` | Abort the mission, then command `RTL`. |
| `<= 10%` | Abort the mission, then command `LAND`. |

Battery aborts remain observable during recovery. Delivery is not confirmed
unless the delivery completion endpoint is called.

Optional battery capacity configuration:

```bash
export VERA_BATTERY_CAPACITY_MAH=1000
```

Other useful Vera variables:

```text
VERA_HOST=0.0.0.0
VERA_CONNECTION_STRING=udp:127.0.0.1:14551
VERA_DRONE_ID=VERA-001
VERA_PORT=8765
VERA_BASE_URL=http://192.168.95.10:8765
VELLA_BASE_URL=http://192.168.95.10:8000
VERA_STATE_DB=runtime/vera-001.sqlite3
VERA_TELEMETRY_LOG=logs/vera-001.csv
```

## Testing

Run the focused fleet and process-boundary tests:

```bash
./.venv/bin/pytest -q tests/test_fleet_orchestrator.py tests/test_process_boundary.py
```

Run the broader unit tests:

```bash
./.venv/bin/pytest -q tests/test_vera_state.py tests/test_fleet_orchestrator.py tests/test_process_boundary.py
```

Live SITL tests are opt-in and require a running ArduPilot SITL instance:

```bash
RUN_SITL_TEST=1 ./.venv/bin/pytest -q -m sitl
```


1. Start Vella once on the central machine:

```bash
uvicorn vella.api:app --host 0.0.0.0 --port 8000
```
2. On each drone machine, create an environment file. Example for machine A:
```bash
VERA_CONNECTION_STRING=udp:127.0.0.1:14551
VERA_HOST=0.0.0.0
VERA_PORT=8765
VERA_BASE_URL=http://192.168.95.10:8765
VERA_MACHINE_HOST=192.168.95.10

VERA_DRONE_ID=VERA_001
VERA_DRONE_NAME=VERA_000
VERA_DRONE_ID_NUM=001

VERA_STATE_DB=/var/lib/vera/vera-001.sqlite3
VERA_TELEMETRY_LOG=/var/log/vera/vera-001.csv
VELLA_BASE_URL=http://192.168.95.10:8000
```

3. Change only identity, Vera address, database, and log path for B/C:
```bash
Machine B: VERA_DRONE_ID=VERA_002
           VERA_BASE_URL=http://192.168.95.11:8765

Machine C: VERA_DRONE_ID=VERA_003
           VERA_BASE_URL=http://192.168.95.12:8765
```


They can all use local udp:127.0.0.1:14551 and port 8765.
4. On each drone machine, start its local ArduPilot instance, then start Vera with its environment loaded:
```bash
python -m vera
```

Use your IDE/container/service manager to load that machine’s env file. With systemd, use EnvironmentFile=... and keep ExecStart=... python -m vera; no custom launcher is needed.

5. Confirm registration from the Vella machine:
```bash
curl http://192.168.95.10:8000/drones
curl http://192.168.95.10:8000/fleet/status
```
You should see VERA_001, VERA_002, and VERA_003. Ensure Vella can reach each machine’s VERA_BASE_URL through your network/firewall.
