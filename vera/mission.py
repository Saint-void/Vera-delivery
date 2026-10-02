"""
vera/mission.py

Phase 1: Basic flight.
ARM -> TAKEOFF -> ASCEND -> MOVE -> LAND

This direct helper has the same battery guard as the controller: at 20% it
commands RTL, and at 10% it commands LAND. It remains a minimal flight helper
without payload release or durable mission state.
"""

from vera.connection import connect, set_mode, arm, takeoff, land
from vera.navigation import goto_and_wait
from vera.safety import rtl
from vera.config import TAKEOFF_ALT_M
from vera.telemetry import TelemetryState, request_data_streams, update_telemetry_message


class BatteryFailsafeTriggered(RuntimeError):
    pass


def _battery_monitor(conn):
    """Return a navigation message callback for the direct-flight helper."""
    state = TelemetryState()
    triggered = False

    def on_message(message):
        nonlocal triggered
        update_telemetry_message(conn, state, message)
        if triggered or state.battery_remaining in (None, -1):
            return

        if state.battery_remaining <= 10:
            triggered = True
            set_mode(conn, "LAND")
            conn.motors_disarmed_wait()
            raise BatteryFailsafeTriggered("CRITICAL_BATTERY")
        if state.battery_remaining <= 20:
            triggered = True
            set_mode(conn, "RTL")
            conn.motors_disarmed_wait()
            raise BatteryFailsafeTriggered("LOW_BATTERY")

    return on_message


def basic_flight(destination, takeoff_alt=TAKEOFF_ALT_M):
    """
    destination: (lat, lon, alt) tuple to fly to before landing.
    Returns the live connection in case the caller wants to inspect
    final state (battery, position, etc.) after landing.
    """
    conn = connect()
    request_data_streams(conn)
    set_mode(conn, "GUIDED")

    arm(conn)
    takeoff(conn, takeoff_alt)          # TAKEOFF + ASCEND
    try:
        goto_and_wait(conn, *destination, on_message=_battery_monitor(conn))  # MOVE
    except BatteryFailsafeTriggered as exc:
        print(f"Battery failsafe triggered: {exc}")
        return conn
    land(conn)                          # LAND

    return conn


def waypoint_mission(waypoints, takeoff_alt=TAKEOFF_ALT_M):
    """
    Phase 2: HOME -> WP1 -> WP2 -> ... -> WPn -> HOME.

    waypoints: list of (lat, lon, alt) tuples, flown in order.
    "HOME" isn't a coded step -- the start is just wherever Vera
    launches from, and the end is RTL, which flies back, lands, and
    disarms without needing stored home coordinates from us.
    """
    conn = connect()
    request_data_streams(conn)
    set_mode(conn, "GUIDED")

    arm(conn)
    takeoff(conn, takeoff_alt)

    for i, wp in enumerate(waypoints, start=1):
        print(f"-- Waypoint {i}/{len(waypoints)} --")
        try:
            goto_and_wait(conn, *wp, on_message=_battery_monitor(conn))
        except BatteryFailsafeTriggered as exc:
            print(f"Battery failsafe triggered: {exc}")
            return conn

    rtl(conn)

    return conn
