"""
vera/safety.py

Failsafe and mission-abort logic. GPS failures are detected by Vera
and explicitly request RTL; ArduPilot remains the aircraft-level fallback.
Battery and geofence auto-triggers get added here once a phase calls
for aborts that fire on their own mid-mission -- this file grows,
it doesn't get rewritten.
"""

from vera.connection import set_mode
from vera.config import GEOFENCE


def point_in_geofence(lat, lon):
    return (GEOFENCE["lat_min"] <= lat <= GEOFENCE["lat_max"] and
            GEOFENCE["lon_min"] <= lon <= GEOFENCE["lon_max"])


class GPSFailureError(RuntimeError):
    """Raised when telemetry is no longer sufficient for safe navigation."""


def require_healthy_gps(state):
    if state.gps_receivers:
        healthy_receivers = [
            receiver for receiver, data in state.gps_receivers.items()
            if data.get("fix_type", 0) >= 3
            and data.get("satellites_visible", 0) >= 5
        ]
        if healthy_receivers:
            return
        raise GPSFailureError(
            "GPS failure: no receiver has a 3D fix with at least 5 satellites"
        )
    if state.latitude is None or state.longitude is None:
        raise GPSFailureError("GPS failure: position unavailable")
    if state.gps_fix_type is None or state.gps_fix_type < 3:
        raise GPSFailureError(
            f"GPS failure: fix type {state.gps_fix_type!r} is not a 3D fix"
        )
    if state.satellites_visible is None or state.satellites_visible < 5:
        raise GPSFailureError(
            f"GPS failure: only {state.satellites_visible!r} satellites visible"
        )


def rtl(conn):
    """Switches to RTL mode and blocks until ArduPilot has flown home,
    landed, and disarmed on its own."""
    set_mode(conn, "RTL")
    print("RTL triggered, returning home...")
    conn.motors_disarmed_wait()
    print("Home, landed, and disarmed.")
