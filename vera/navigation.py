"""
vera/navigation.py

Movement primitives: distance math and waypoint travel (the MOVE step).
Failsafe checks (battery, geofence) live in vera/safety.py and get
wired into this loop starting in a later phase -- deliberately absent
here so Phase 1 stays just "can it fly."
"""

import math
import time

from pymavlink import mavutil

from vera.config import ARRIVAL_RADIUS_M, WAYPOINT_TIMEOUT_S


def haversine_m(lat1, lon1, lat2, lon2):
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def goto_and_wait(conn, lat, lon, alt, radius_m=ARRIVAL_RADIUS_M,
                   timeout=WAYPOINT_TIMEOUT_S, on_tick=None, on_message=None):
    """on_tick(cur_lat, cur_lon, dist_remaining_m), if given, fires on
    every loop iteration -- this is the REPORT PROGRESS hook, kept as
    a callback here instead of duplicated in whatever calls this."""
    conn.mav.mission_item_send(
        conn.target_system, conn.target_component,
        0, mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT,
        mavutil.mavlink.MAV_CMD_NAV_WAYPOINT,
        2, 0, 0, 0, 0, 0,
        lat, lon, alt,
    )
    print(f"Heading to {lat}, {lon}, {alt}m ...")

    start = time.time()
    while time.time() - start < timeout:
        # Do not filter recv_match by message type.  pymavlink discards
        # messages that do not match the filter, which used to drop
        # BATTERY_STATUS/SYS_STATUS messages while the aircraft was moving.
        msg = conn.recv_match(blocking=True, timeout=2)
        if msg is None:
            continue
        if on_message:
            on_message(msg)
        if msg.get_type() != "GLOBAL_POSITION_INT":
            continue
        cur_lat = msg.lat / 1e7
        cur_lon = msg.lon / 1e7
        dist = haversine_m(cur_lat, cur_lon, lat, lon)
        if on_tick:
            on_tick(cur_lat, cur_lon, dist)
        if dist <= radius_m:
            print(f"Arrived (within {dist:.1f}m).")
            return

    raise TimeoutError(f"Did not reach waypoint within {timeout}s.")
