"""Environment-only configuration for one independent Vera process."""

import os
import socket


def _load_env_file(path):
    """Load simple KEY=VALUE lines without overriding real process env."""
    if not os.path.isfile(path):
        return
    with open(path, encoding="utf-8") as env_file:
        for raw_line in env_file:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if key and key not in os.environ:
                os.environ[key] = value.strip().strip('"').strip("'")


# ``python -m vera`` loads ``vera/.env`` when present.  A service manager may
# instead set environment variables directly; those always take precedence.
_load_env_file(os.getenv("VERA_ENV_FILE", os.path.join(os.path.dirname(__file__), ".env")))

CONNECTION_STRING = os.getenv("VERA_CONNECTION_STRING", "udp:127.0.0.1:14551")
# Bind separately from the address advertised to Vella.  A process normally
# listens on all local interfaces, while Vella must be given a routable URL.
VERA_HOST = os.getenv("VERA_HOST", "0.0.0.0")
VERA_PORT = int(os.getenv("VERA_PORT", "8765"))
VERA_DRONE_ID_NUM = os.getenv("VERA_DRONE_ID_NUM", "").strip()
# VELLA_DRONE_ID and VERA_NAME_ID are accepted for compatibility with the
# original deployment examples.  New deployments should set VERA_DRONE_ID
# and VERA_DRONE_NAME explicitly.
VERA_DRONE_ID = (
    os.getenv("VERA_DRONE_ID")
    or os.getenv("VELLA_DRONE_ID")
    or (f"VERA_{VERA_DRONE_ID_NUM}" if VERA_DRONE_ID_NUM else None)
    or os.getenv("VERA_NAME_ID")
    or "VERA-001"
)
VERA_DRONE_NAME = os.getenv("VERA_DRONE_NAME") or os.getenv("VERA_NAME_ID") or VERA_DRONE_ID
VERA_ADVERTISE_HOST = os.getenv("VERA_ADVERTISE_HOST", socket.getfqdn())
VERA_MACHINE_HOST = os.getenv("VERA_MACHINE_HOST", VERA_ADVERTISE_HOST)
VERA_BASE_URL = os.getenv("VERA_BASE_URL", f"http://{VERA_ADVERTISE_HOST}:{VERA_PORT}").rstrip("/")


def _optional_position(value):
    if not value:
        return None
    try:
        lat, lon, alt = (float(item.strip()) for item in value.split(","))
    except ValueError as exc:
        raise ValueError("VERA_HOME_POSITION must be 'latitude,longitude,altitude_m'") from exc
    return (lat, lon, alt)


# An idle aircraft may not have an active mission record from which Vera can
# recover home.  Set this when a fixed home is known; otherwise it is omitted.
VERA_HOME_POSITION = _optional_position(os.getenv("VERA_HOME_POSITION", ""))

# Leaving VELLA_BASE_URL empty deliberately disables registration.  It never
# affects local MAVLink control or the Vera HTTP API.
VELLA_BASE_URL = os.getenv("VELLA_BASE_URL", "").rstrip("/")
VELLA_REGISTRATION_PATH = os.getenv("VELLA_REGISTRATION_PATH", "/drones")
VELLA_REGISTRATION_INTERVAL_S = float(os.getenv("VELLA_REGISTRATION_INTERVAL_S", "15"))
VELLA_REGISTRATION_TIMEOUT_S = float(os.getenv("VELLA_REGISTRATION_TIMEOUT_S", "3"))
VERA_STATE_DB = os.getenv(
    "VERA_STATE_DB",
    os.path.join(os.path.dirname(__file__), "db", "vera.sqlite3"),
)
VERA_TELEMETRY_LOG = os.getenv("VERA_TELEMETRY_LOG", "logs/vera_telemetry.csv")

TAKEOFF_ALT_M = 10
ARRIVAL_RADIUS_M = 2.0
WAYPOINT_TIMEOUT_S = 1200
TAKEOFF_TIMEOUT_S = int(os.getenv("VERA_TAKEOFF_TIMEOUT_S", "180"))
HOME_ARRIVAL_RADIUS_M = float(os.getenv("VERA_HOME_ARRIVAL_RADIUS_M", "5"))
HOME_TIMEOUT_S = int(os.getenv("VERA_HOME_TIMEOUT_S", "1200"))
LANDING_TIMEOUT_S = int(os.getenv("VERA_LANDING_TIMEOUT_S", "300"))
LANDING_MAX_GROUNDSPEED_MS = float(os.getenv("VERA_LANDING_MAX_GROUNDSPEED_MS", "0.75"))
VERA_BATTERY_CAPACITY_MAH = int(os.getenv("VERA_BATTERY_CAPACITY_MAH", "0")) or None

# Placeholder bounding box around the SITL default spawn (CMAC).
# Replace with your real operating area once you have one.
GEOFENCE = {
    "lat_min": 6.30, "lat_max": 6.75,
    "lon_min": 2.70, "lon_max": 3.75,
}

# Placeholder -- no real airframe/battery spec exists yet. Revisit
# once you pick or estimate one; this just stops absurd mission
# requests from being accepted in the meantime.
MAX_MISSION_RANGE_M = 20000

# Altitude ceiling is a PLACEHOLDER (120m mirrors FAA Part 107, not
# any Nigerian rule) -- replace with NCAA's actual limit before this
# means anything real.
MIN_ALT_M = 2
MAX_ALT_M = 120
