"""
vera/telemetry.py

Continuous drone state tracking.

update_telemetry() drains whatever MAVLink messages have arrived
since the last call and merges them into a single TelemetryState.
It never blocks -- safe to call every tick of a mission loop or a
standalone monitor without stalling flight control.
"""

from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
import csv
import json
import os

from pymavlink import mavutil


@dataclass
class TelemetryState:
    timestamp: str = None
    latitude: float = None
    longitude: float = None
    altitude_m: float = None
    groundspeed_ms: float = None
    vertical_speed_ms: float = None
    heading_deg: float = None
    battery_pct: int = None
    battery_remaining: int = None
    battery_voltage_v: float = None
    consumed_mah: int = None
    battery_capacity_mah: int = None
    remaining_mah: int = None
    battery_low: bool = False
    battery_status_text: str = None
    flight_mode: str = None
    armed: bool = None
    gps_fix_type: int = None
    satellites_visible: int = None
    gps_receivers: dict = field(default_factory=dict)
    autopilot_time_boot_ms: int = None
    autopilot_time_usec: int = None


GPS_FIX_LABELS = {
    0: "NO_GPS", 1: "NO_FIX", 2: "2D_FIX",
    3: "3D_FIX", 4: "DGPS", 5: "RTK_FLOAT", 6: "RTK_FIXED",
}


def request_data_streams(conn, rate_hz=4):
    """SITL's secondary MAVLink outputs don't always inherit the
    primary link's stream rates. Ask explicitly so GPS_RAW_INT,
    SYS_STATUS, and VFR_HUD actually show up on this connection."""
    conn.mav.request_data_stream_send(
        conn.target_system, conn.target_component,
        mavutil.mavlink.MAV_DATA_STREAM_ALL,
        rate_hz, 1,
    )
    for message_name in ("GPS_RAW_INT", "GPS2_RAW"):
        message_id = getattr(mavutil.mavlink, f"MAVLINK_MSG_ID_{message_name}", None)
        if message_id is not None:
            conn.mav.command_long_send(
                conn.target_system,
                conn.target_component,
                mavutil.mavlink.MAV_CMD_SET_MESSAGE_INTERVAL,
                0,
                message_id,
                1_000_000 / rate_hz,
                0,
                0,
                0,
                0,
                0,
            )


def update_telemetry_message(conn, state: TelemetryState, msg) -> TelemetryState:
    """Merge one already-received MAVLink message into ``state``."""
    msg_type = msg.get_type()

    if msg_type == "GLOBAL_POSITION_INT":
        state.autopilot_time_boot_ms = getattr(msg, "time_boot_ms", None)
        state.latitude = msg.lat / 1e7
        state.longitude = msg.lon / 1e7
        state.altitude_m = msg.relative_alt / 1000.0

    elif msg_type == "VFR_HUD":
        state.groundspeed_ms = msg.groundspeed
        state.vertical_speed_ms = getattr(msg, "climb", None)
        state.heading_deg = msg.heading

    elif msg_type == "SYS_STATUS":
        if msg.battery_remaining != -1:
            state.battery_pct = msg.battery_remaining
            state.battery_remaining = msg.battery_remaining
        state.battery_voltage_v = msg.voltage_battery / 1000.0

    elif msg_type == "BATTERY_STATUS":
        battery_remaining = getattr(msg, "battery_remaining", None)
        if battery_remaining is not None and battery_remaining != -1:
            state.battery_remaining = battery_remaining
            state.battery_pct = battery_remaining
        state.consumed_mah = getattr(msg, "current_consumed", None)
        voltages = getattr(msg, "voltages", [])
        if voltages:
            voltage = voltages[0]
            if voltage not in (0, 65535):
                state.battery_voltage_v = voltage / 1000.0
        if state.battery_capacity_mah is not None and state.consumed_mah is not None:
            state.remaining_mah = max(state.battery_capacity_mah - state.consumed_mah, 0)

    elif msg_type == "STATUSTEXT":
        text = str(getattr(msg, "text", "")).strip()
        if text:
            state.battery_status_text = text
            lowered = text.lower()
            if "battery" in lowered and any(word in lowered for word in ("low", "critical", "emergency")):
                state.battery_low = True

    elif msg_type in ("GPS_RAW_INT", "GPS2_RAW"):
        if getattr(msg, "time_usec", None) is not None:
            state.autopilot_time_usec = msg.time_usec
        receiver = "GPS1" if msg_type == "GPS_RAW_INT" else "GPS2"
        state.gps_receivers[receiver] = {
            "fix_type": msg.fix_type,
            "satellites_visible": msg.satellites_visible,
            "latitude": getattr(msg, "lat", None),
            "longitude": getattr(msg, "lon", None),
            "altitude_m": (
                msg.alt / 1000.0 if getattr(msg, "alt", None) is not None else None
            ),
        }
        if receiver == "GPS1":
            state.gps_fix_type = msg.fix_type
            state.satellites_visible = msg.satellites_visible

    elif msg_type == "HEARTBEAT":
        state.flight_mode = conn.flightmode
        state.armed = bool(msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED)

    return state


def update_telemetry(conn, state: TelemetryState) -> TelemetryState:
    """Non-blocking: pulls every message currently buffered and
    updates only the fields those messages carry, leaving the rest
    at their last known value."""
    while True:
        msg = conn.recv_match(blocking=False)
        if msg is None:
            break
        update_telemetry_message(conn, state, msg)

    state.timestamp = datetime.now(timezone.utc).isoformat()
    return state


def gps_fix_label(state: TelemetryState) -> str:
    return GPS_FIX_LABELS.get(state.gps_fix_type, "UNKNOWN")


class TelemetryLogger:
    """Appends one CSV row per call, creating the header on first
    write. Deliberately just a CSV -- no database until vella/
    actually needs one for job history."""

    FIELDS = [
        "timestamp", "latitude", "longitude", "altitude_m",
        "groundspeed_ms", "vertical_speed_ms", "heading_deg", "battery_pct",
        "battery_remaining", "battery_voltage_v", "consumed_mah",
        "battery_capacity_mah", "remaining_mah", "flight_mode", "armed",
        "battery_low", "battery_status_text",
        "gps_fix_type", "satellites_visible",
        "gps_receivers", "autopilot_time_boot_ms", "autopilot_time_usec",
    ]

    def __init__(self, log_path):
        self.log_path = log_path
        directory = os.path.dirname(log_path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        if not os.path.exists(log_path):
            with open(log_path, "w", newline="") as f:
                csv.DictWriter(f, fieldnames=self.FIELDS).writeheader()

    def log(self, state: TelemetryState):
        with open(self.log_path, "a", newline="") as f:
            row = asdict(state)
            row["gps_receivers"] = json.dumps(row["gps_receivers"])
            csv.DictWriter(f, fieldnames=self.FIELDS).writerow(row)
