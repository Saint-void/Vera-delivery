"""
vera/connection.py

Connection lifecycle and the flight primitives that don't involve
moving laterally: arm, takeoff (includes the ascend-and-wait loop),
and land.
"""

from pymavlink import mavutil

from datetime import datetime, timezone

from vera.config import CONNECTION_STRING, TAKEOFF_ALT_M, TAKEOFF_TIMEOUT_S


def _utc_now():
    return datetime.now(timezone.utc).isoformat()


def connect(connection_string=CONNECTION_STRING):
    conn = mavutil.mavlink_connection(connection_string)
    conn.wait_heartbeat()
    print(f"Heartbeat from system {conn.target_system}, component {conn.target_component}")
    return conn


def set_mode(conn, mode):
    command_sent_time_utc = _utc_now()
    mode_id = conn.mode_mapping()[mode]
    conn.mav.set_mode_send(
        conn.target_system,
        mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
        mode_id,
    )
    ack = conn.recv_match(type="COMMAND_ACK", blocking=True, timeout=5)
    command_ack_time_utc = _utc_now() if ack is not None else None
    print(f"Mode -> {mode}")
    return {
        "command": mode,
        "command_sent_time_utc": command_sent_time_utc,
        "command_ack_time_utc": command_ack_time_utc,
        "ack_received": ack is not None,
    }


def arm(conn):
    command_sent_time_utc = _utc_now()
    conn.mav.command_long_send(
        conn.target_system, conn.target_component,
        mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
        0, 1, 0, 0, 0, 0, 0, 0,
    )
    conn.motors_armed_wait()
    print("Armed.")
    return {"command": "ARM", "command_sent_time_utc": command_sent_time_utc}


def takeoff(conn, alt=TAKEOFF_ALT_M, timeout=TAKEOFF_TIMEOUT_S):
    """Send TAKEOFF and return immediately.

    Mission-level telemetry verification owns the ascend phase so it can
    consume every MAVLink message, including low-battery alerts, while
    waiting for the target altitude.
    """
    command_sent_time_utc = _utc_now()
    conn.mav.command_long_send(
        conn.target_system, conn.target_component,
        mavutil.mavlink.MAV_CMD_NAV_TAKEOFF,
        0, 0, 0, 0, 0, 0, 0, alt,
    )
    print(f"Takeoff command sent, target alt {alt}m.")
    return {"command": "TAKEOFF", "command_sent_time_utc": command_sent_time_utc}


def land(conn):
    command_sent_time_utc = _utc_now()
    conn.mav.command_long_send(
        conn.target_system, conn.target_component,
        mavutil.mavlink.MAV_CMD_NAV_LAND,
        0, 0, 0, 0, 0, 0, 0, 0,
    )
    print("Land command sent.")
    return {"command": "LAND", "command_sent_time_utc": command_sent_time_utc}
