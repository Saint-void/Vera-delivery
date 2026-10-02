"""Vera's independent flight-side controller.

The controller owns the mission queue, state transitions, MAVLink link and
recovery logic.  It has no import from Vella and does not use FastAPI.
"""

import threading
import time

from vera.config import (
    TAKEOFF_ALT_M, VERA_TELEMETRY_LOG, HOME_ARRIVAL_RADIUS_M,
    HOME_TIMEOUT_S, LANDING_TIMEOUT_S, LANDING_MAX_GROUNDSPEED_MS,
    TAKEOFF_TIMEOUT_S, VERA_BATTERY_CAPACITY_MAH, VERA_DRONE_ID, VERA_DRONE_NAME,
)
from vera.connection import connect, set_mode as send_mode, arm, takeoff, land
from vera.mission_request import MissionRequest, validate_mission
from vera.mission_state import MissionState
from vera.navigation import ARRIVAL_RADIUS_M, goto_and_wait, haversine_m
from vera.safety import GPSFailureError, require_healthy_gps
from vera.storage import VeraStateStore
from vera.telemetry import (
    TelemetryLogger, TelemetryState, request_data_streams, update_telemetry,
    update_telemetry_message,
)

LANDING_ALT_THRESHOLD_M = 3.0


class BatteryFailsafeTriggered(RuntimeError):
    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


ACTIVE_STATES = {
    MissionState.PREPARING.name, MissionState.TAKEOFF.name, MissionState.EN_ROUTE.name,
    MissionState.DELIVERY.name, MissionState.RETURNING.name, MissionState.LANDING.name,
    MissionState.LANDED.name,
}


class VeraController:
    """Long-lived mission executor.  Vella disappearing has no effect on it."""

    def __init__(self, store=None, connection_factory=connect, telemetry_log_path=VERA_TELEMETRY_LOG):
        self.store = store or VeraStateStore()
        self.connection_factory = connection_factory
        self.telemetry = TelemetryState()
        self.telemetry.battery_capacity_mah = VERA_BATTERY_CAPACITY_MAH
        self.telemetry_logger = TelemetryLogger(telemetry_log_path)
        self.conn = None
        self.connected = False
        self._stop = threading.Event()
        self._thread = None
        self._mission_running = False
        self._last_navigation_position = None
        self.battery_failsafe_triggered = False
        self.critical_battery_triggered = False
        self._battery_watch_mission_id = None
        self._battery_recovery_mission_id = None
        self._battery_flags_mission_id = None

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="vera-flight-controller", daemon=False)
        self._thread.start()

    def stop(self, timeout=5):
        """Stop Vera's process controller without commanding the aircraft.

        ArduPilot remains responsible for its configured failsafes when Vera
        is stopped.  This method is used by tests and clean process shutdown.
        """
        self._stop.set()
        if self._thread and self._thread is not threading.current_thread():
            self._thread.join(timeout=timeout)

    def submit(self, request):
        validate_mission(request)
        mission, created = self.store.create_or_get(request)
        if created and not self._thread:
            self.start()
        return mission, created

    def get_mission(self, mission_id):
        return self.store.get(mission_id)

    def status(self):
        active = self.store.active()
        return {
            "process": "vera",
            "pid": __import__("os").getpid(),
            "connected": self.connected,
            "drone_id": VERA_DRONE_ID,
            "drone_name": VERA_DRONE_NAME,
            "current_mission_id": active["mission_id"] if active else None,
            "mission_state": active["status"] if active else None,
            "mission_phase": active["status"] if active else None,
            "telemetry": self.store.latest_telemetry() or self._telemetry_dict(),
        }

    def command(self, command, mission_id=None):
        mission = self.store.get(mission_id) if mission_id else self.store.active()
        if command in {"cancel", "pause", "resume"}:
            if mission is None:
                raise KeyError("no active mission")
            field = {"cancel": "cancel_requested", "pause": "pause_requested", "resume": "pause_requested"}[command]
            self.store.request(mission["mission_id"], field, command != "resume")
            return self.store.get(mission["mission_id"])
        if command == "rtl":
            if not self.conn or not self.connected:
                raise RuntimeError("ArduPilot is not connected")
            result = self.set_mode("RTL")
            if mission:
                self._record_command(mission["mission_id"], "RTL", "return-to-home command accepted", result)
            return self.status()
        raise ValueError("unsupported command: %s" % command)

    def _run(self):
        while not self._stop.is_set():
            if self.conn is None:
                try:
                    self.conn = self.connection_factory()
                    request_data_streams(self.conn)
                    self.connected = True
                    self._reconcile_after_startup()
                except Exception as exc:
                    self.connected = False
                    self.conn = None
                    print("Vera waiting for ArduPilot: %s" % exc)
                    self._stop.wait(2)
                    continue

            try:
                self._report_telemetry()
                active = self.store.active()
                if active:
                    self._battery_watch_mission_id = active["mission_id"]
                mission_id = self._battery_watch_mission_id or (active["mission_id"] if active else None)
                battery_triggered = False
                if mission_id:
                    try:
                        self._check_battery_failsafes(mission_id)
                    except BatteryFailsafeTriggered:
                        battery_triggered = True
                active = self.store.active()
                if battery_triggered:
                    self._stop.wait(0.5)
                    continue
                if active and not self._mission_running:
                    self._mission_running = True
                    try:
                        self._execute(active)
                    finally:
                        self._mission_running = False
                self._stop.wait(0.5)
            except Exception as exc:
                print("Vera controller link error: %s" % exc)
                self.connected = False
                self.conn = None
                self._stop.wait(2)

    def _reconcile_after_startup(self):
        """Never resume solely from SQLite: inspect actual ArduPilot state."""
        active = self.store.active()
        if not active:
            return
        state = self._report_telemetry()
        if state.armed is None or state.altitude_m is None:
            self.store.transition(active["mission_id"], MissionState.EMERGENCY.name,
                                  "unable to reconcile aircraft state after Vera restart")
            return
        if active["status"] == MissionState.LANDING.name and self._landing_is_verified(state):
            landing = {
                "altitude_m": state.altitude_m,
                "groundspeed_ms": state.groundspeed_ms,
                "vertical_speed_ms": state.vertical_speed_ms,
                "armed": state.armed,
                "flight_mode": state.flight_mode,
                "timestamp": state.timestamp,
                "verification_basis": "disarmed_landing_mode",
            }
            self._record_verification(active["mission_id"], "LANDED", landing)
            self.store.transition(
                active["mission_id"], MissionState.LANDED.name,
                reason="landing verified during startup reconciliation",
                telemetry=self.telemetry,
            )
            return
        if not state.armed and active["status"] in {MissionState.EN_ROUTE.name, MissionState.DELIVERY.name,
                                                       MissionState.RETURNING.name, MissionState.LANDING.name}:
            self.store.transition(active["mission_id"], MissionState.EMERGENCY.name,
                                  "aircraft is disarmed while mission was airborne")
            return
        if state.armed and active["home_position"] is None and state.latitude is not None:
            self.store.set_home_position(active["mission_id"], [state.latitude, state.longitude, state.altitude_m])

    def _execute(self, record):
        request = MissionRequest.from_dict(record["definition"])
        mission_id = request.mission_id
        if self._battery_flags_mission_id != mission_id:
            self.battery_failsafe_triggered = False
            self.critical_battery_triggered = False
            self._battery_flags_mission_id = mission_id
        self._battery_watch_mission_id = mission_id
        try:
            state = record["status"]
            if state == MissionState.PREPARING.name:
                self._check_control_flags(mission_id)
                current = self._report_telemetry()
                require_healthy_gps(current)
                if record["home_position"] is None and current.latitude is not None:
                    self.store.set_home_position(mission_id, [current.latitude, current.longitude, current.altitude_m])
                mode_result = self.set_mode("GUIDED")
                self._record_command(mission_id, "GUIDED", "flight mode accepted", mode_result)
                state = MissionState.TAKEOFF.name
                self._transition(mission_id, state)

            if state == MissionState.TAKEOFF.name:
                self._check_control_flags(mission_id)
                current = self._report_telemetry()
                if not (current.armed and current.altitude_m is not None and current.altitude_m >= request.pickup[2] * 0.95):
                    arm_result = arm(self.conn)
                    self._record_command(mission_id, "ARM", "arm command completed", arm_result)
                    takeoff_result = takeoff(self.conn, request.pickup[2])
                    self._record_command(mission_id, "TAKEOFF", "takeoff command completed", takeoff_result)
                verified = self._wait_for_takeoff_verification(mission_id, request.pickup[2])
                self._record_verification(mission_id, "TAKEOFF_CONFIRMED", {
                    "altitude_m": verified.altitude_m, "armed": verified.armed,
                })
                self._transition(mission_id, MissionState.EN_ROUTE.name)
                state = MissionState.EN_ROUTE.name

            if state == MissionState.EN_ROUTE.name:
                self._check_control_flags(mission_id)
                goto_and_wait(
                    self.conn, *request.dropoff,
                    on_tick=lambda *args: self._on_navigation_tick(mission_id, *args),
                    on_message=lambda msg: update_telemetry_message(self.conn, self.telemetry, msg),
                )
                arrival = self._verify_arrival(request)
                self._record_verification(mission_id, "DESTINATION_REACHED", arrival)
                self._transition(mission_id, MissionState.DELIVERY.name, details=arrival)
                state = MissionState.DELIVERY.name

            if state == MissionState.DELIVERY.name:
                self._check_control_flags(mission_id)
                self._release_package(request)
                self._verify_delivery(request)
                state = MissionState.RETURNING.name

            if state == MissionState.RETURNING.name:
                self._check_control_flags(mission_id)
                if self._battery_recovery_mission_id != mission_id:
                    rtl_result = self.set_mode("RTL")
                    self._record_command(mission_id, "RTL", "return-to-home command accepted", rtl_result)
                self._transition(mission_id, MissionState.RETURNING.name)
                self._wait_for_home(mission_id)
                land_result = land(self.conn)
                self._record_command(mission_id, "LAND", "landing command accepted", land_result)
                self._transition(mission_id, MissionState.LANDING.name)
                state = MissionState.LANDING.name

            if state == MissionState.LANDING.name:
                landing = self._wait_for_landing(mission_id)
                if self._battery_recovery_mission_id == mission_id:
                    self._record_verification(mission_id, "LANDED", landing)
                    self._transition(mission_id, MissionState.LANDED.name, reason="battery recovery complete", details=landing)
                    return
                if not self.store.get(mission_id)["delivery_confirmed"]:
                    raise RuntimeError("cannot complete mission before delivery confirmation")
                self._record_verification(mission_id, "LANDED", landing)
                self._transition(mission_id, MissionState.LANDED.name, details=landing)
                state = MissionState.LANDED.name

            if state == MissionState.LANDED.name:
                if not self.store.get(mission_id)["delivery_confirmed"]:
                    raise RuntimeError("cannot complete mission before delivery confirmation")
                self._transition(mission_id, MissionState.COMPLETED.name)
        except BatteryFailsafeTriggered:
            return
        except GPSFailureError as exc:
            if self._stop.is_set():
                return
            self._abort_or_rtl(mission_id, str(exc))
        except Exception as exc:
            if self._stop.is_set():
                return
            self._abort_or_rtl(mission_id, str(exc))

    def _check_control_flags(self, mission_id):
        self._check_battery_failsafes(mission_id)
        record = self.store.get(mission_id)
        if record["cancel_requested"]:
            raise RuntimeError("mission cancelled by command")
        while record["pause_requested"] and not self._stop.is_set():
            self._report_telemetry()
            time.sleep(0.5)
            record = self.store.get(mission_id)

    def _battery_remaining_pct(self):
        if self.telemetry.battery_remaining not in (None, -1):
            return self.telemetry.battery_remaining
        if self.telemetry.battery_pct not in (None, -1):
            return self.telemetry.battery_pct
        return None

    def _battery_details(self):
        return {
            "battery_remaining": self.telemetry.battery_remaining,
            "battery_pct": self.telemetry.battery_pct,
            "battery_voltage_v": self.telemetry.battery_voltage_v,
            "consumed_mah": self.telemetry.consumed_mah,
            "battery_capacity_mah": self.telemetry.battery_capacity_mah,
            "remaining_mah": self.telemetry.remaining_mah,
            "battery_status_text": self.telemetry.battery_status_text,
        }

    def abort_mission(self, mission_id, reason, preserve_recovery=False):
        if preserve_recovery:
            self.store.record_event(
                mission_id, "STATE", MissionState.ABORTED.name,
                reason=reason, details={"recovery_in_progress": True}, telemetry=self.telemetry,
            )
            return self.store.get(mission_id)
        return self.store.transition(mission_id, MissionState.ABORTED.name, reason, telemetry=self.telemetry)

    def set_mode(self, mode):
        if not self.conn or not self.connected:
            raise RuntimeError("ArduPilot is not connected")
        return send_mode(self.conn, mode)

    def _check_low_battery(self, mission_id):
        return self._check_battery_failsafes(mission_id)

    def _check_battery_failsafes(self, mission_id):
        record = self.store.get(mission_id)
        if not record or record["status"] in {
            MissionState.LANDED.name, MissionState.COMPLETED.name, MissionState.EMERGENCY.name,
        }:
            return
        battery_remaining = self._battery_remaining_pct()
        if battery_remaining is None:
            return
        details = self._battery_details()
        if battery_remaining <= 10 and not self.critical_battery_triggered:
            self.critical_battery_triggered = True
            self.battery_failsafe_triggered = True
            self.store.record_event(
                mission_id, "VERIFICATION", "CRITICAL_BATTERY",
                reason="ArduPilot reported critical battery", details=details,
                telemetry=self.telemetry,
            )
            self._battery_recovery_mission_id = mission_id
            self.abort_mission(mission_id, "CRITICAL_BATTERY", preserve_recovery=True)
            if self.conn and self.connected:
                result = self.set_mode("LAND")
                self._record_command(mission_id, "LAND", "critical battery landing command accepted", result)
            self._transition(mission_id, MissionState.LANDING.name, reason="critical battery recovery")
            raise BatteryFailsafeTriggered("CRITICAL_BATTERY")
        if battery_remaining <= 20 and not self.battery_failsafe_triggered:
            self.battery_failsafe_triggered = True
            self.store.record_event(
                mission_id, "VERIFICATION", "BATTERY_LOW",
                reason="ArduPilot reported low battery", details=details,
                telemetry=self.telemetry,
            )
            self._battery_recovery_mission_id = mission_id
            self.abort_mission(mission_id, "LOW_BATTERY", preserve_recovery=True)
            if self.conn and self.connected:
                result = self.set_mode("RTL")
                self._record_command(mission_id, "RTL", "low battery return-to-home command accepted", result)
            self._transition(mission_id, MissionState.RETURNING.name, reason="low battery recovery")
            raise BatteryFailsafeTriggered("LOW_BATTERY")

    def _abort_or_rtl(self, mission_id, reason):
        try:
            state = self.store.get(mission_id)
            if state and state["status"] in ACTIVE_STATES:
                armed = self.telemetry.armed
                if armed and self.conn:
                    rtl_result = self.set_mode("RTL")
                    self._record_command(mission_id, "RTL", "safety return-to-home command accepted", rtl_result)
                self.abort_mission(mission_id, reason)
        except Exception as exc:
            print("Vera safety handling failed: %s" % exc)

    def _on_navigation_tick(self, mission_id, latitude, longitude, distance_m):
        self._last_navigation_position = (latitude, longitude)
        self.telemetry.latitude = latitude
        self.telemetry.longitude = longitude
        self._report_telemetry(mission_id)
        self._check_control_flags(mission_id)
        require_healthy_gps(self.telemetry)

    def _transition(self, mission_id, status, reason=None, details=None):
        self._report_telemetry(mission_id)
        snapshot = {"telemetry": self._telemetry_dict()}
        if details is not None:
            snapshot["verification"] = details
        return self.store.transition(mission_id, status, reason=reason, details=snapshot, telemetry=self.telemetry)

    def _wait_for_takeoff_verification(self, mission_id, target_altitude):
        started = time.monotonic()
        while time.monotonic() - started < TAKEOFF_TIMEOUT_S:
            state = self._report_telemetry(mission_id)
            self._check_low_battery(mission_id)
            if state.armed is True and state.altitude_m is not None and state.altitude_m >= target_altitude * 0.95:
                return state
            time.sleep(0.2)
        raise TimeoutError("takeoff telemetry did not verify armed state and target altitude")

    def _record_command(self, mission_id, command, reason, command_result=None):
        command_result = command_result or {}
        details = dict(command_result)
        details["telemetry_sample_time_utc"] = self.telemetry.timestamp
        self.store.record_event(
            mission_id, "COMMAND", command, reason=reason, details=details,
            timestamp=command_result.get("command_sent_time_utc"),
            telemetry=self.telemetry,
            command_ack_time_utc=command_result.get("command_ack_time_utc"),
        )

    def _record_verification(self, mission_id, status, details):
        self.store.record_event(mission_id, "VERIFICATION", status, details=details,
                                telemetry=self.telemetry)

    def _report_telemetry(self, mission_id=None):
        if not self.conn:
            return self.telemetry
        self.telemetry = update_telemetry(self.conn, self.telemetry)
        self.telemetry_logger.log(self.telemetry)
        self.store.log_telemetry(
            mission_id or (self.store.active() or {}).get("mission_id") or self._battery_watch_mission_id,
            self.telemetry,
        )
        return self.telemetry

    def _telemetry_dict(self):
        return {
            "timestamp": self.telemetry.timestamp, "latitude": self.telemetry.latitude,
            "longitude": self.telemetry.longitude, "altitude_m": self.telemetry.altitude_m,
            "groundspeed_ms": self.telemetry.groundspeed_ms, "vertical_speed_ms": self.telemetry.vertical_speed_ms,
            "heading_deg": self.telemetry.heading_deg,
            "battery_pct": self.telemetry.battery_pct,
            "battery_remaining": self.telemetry.battery_remaining,
            "battery_voltage_v": self.telemetry.battery_voltage_v,
            "consumed_mah": self.telemetry.consumed_mah,
            "battery_capacity_mah": self.telemetry.battery_capacity_mah,
            "remaining_mah": self.telemetry.remaining_mah,
            "battery_low": self.telemetry.battery_low,
            "battery_status_text": self.telemetry.battery_status_text,
            "flight_mode": self.telemetry.flight_mode, "armed": self.telemetry.armed,
            "gps_fix_type": self.telemetry.gps_fix_type, "satellites_visible": self.telemetry.satellites_visible,
            "gps_receivers": self.telemetry.gps_receivers,
            "autopilot_time_boot_ms": self.telemetry.autopilot_time_boot_ms,
            "autopilot_time_usec": self.telemetry.autopilot_time_usec,
        }

    def telemetry_stream_payload(self):
        active = self.store.active()
        payload = dict(self._telemetry_dict())
        payload["mission_state"] = active["status"] if active else None
        payload["current_mission_id"] = active["mission_id"] if active else None
        return payload


    def _verify_arrival(self, request):
        state = self._report_telemetry(request.mission_id)
        position = self._last_navigation_position or (state.latitude, state.longitude)
        if position[0] is None or position[1] is None:
            raise RuntimeError("Cannot verify arrival: GPS position unavailable")
        distance = haversine_m(position[0], position[1], request.dropoff[0], request.dropoff[1])
        if distance > ARRIVAL_RADIUS_M:
            raise RuntimeError("arrival verification failed: %.1fm from dropoff" % distance)
        return {
            "latitude": position[0], "longitude": position[1],
            "distance_to_destination_m": distance,
            "timestamp": state.timestamp,
        }

    def _verify_delivery(self, request):
        # No timer is used as proof of delivery. The current payload actuator
        # has no independent sensor, so delivery is confirmed only after the
        # aircraft is still physically inside the destination radius following
        # the release request.
        details = self._verify_arrival(request)
        self.store.set_delivery_confirmed(request.mission_id)
        self._record_verification(request.mission_id, "DELIVERY_CONFIRMED", details)
        return details

    def _release_package(self, request):
        print("Delivery confirmed for mission %s." % request.mission_id)
        self._record_command(request.mission_id, "PAYLOAD_RELEASE", "release requested")

    def _wait_for_home(self, mission_id):
        record = self.store.get(mission_id)
        if not record["home_position"]:
            raise RuntimeError("home position was not captured before takeoff")
        home_lat, home_lon = record["home_position"][:2]
        started = time.monotonic()
        previous_distance = None
        moved_toward_home = False
        while time.monotonic() - started < HOME_TIMEOUT_S:
            self._check_control_flags(mission_id)
            state = self._report_telemetry(mission_id)
            if state.latitude is not None and state.longitude is not None:
                distance = haversine_m(state.latitude, state.longitude, home_lat, home_lon)
                if previous_distance is not None and distance < previous_distance - 0.2:
                    moved_toward_home = True
                previous_distance = distance
                if distance <= HOME_ARRIVAL_RADIUS_M and (moved_toward_home or distance <= ARRIVAL_RADIUS_M):
                    details = {"latitude": state.latitude, "longitude": state.longitude,
                               "distance_to_home_m": distance, "timestamp": state.timestamp}
                    self._record_verification(mission_id, "HOME_REACHED", details)
                    return details
            time.sleep(0.5)
        raise TimeoutError("home arrival was not verified within %ss" % HOME_TIMEOUT_S)

    def _wait_for_landing(self, mission_id):
        started = time.monotonic()
        while True:
            if time.monotonic() - started >= LANDING_TIMEOUT_S:
                raise TimeoutError("landing was not verified within %ss" % LANDING_TIMEOUT_S)
            self._check_control_flags(mission_id)
            state = self._report_telemetry(mission_id)
            low_altitude = state.altitude_m is not None and state.altitude_m <= LANDING_ALT_THRESHOLD_M
            low_speed = state.groundspeed_ms is None or state.groundspeed_ms <= LANDING_MAX_GROUNDSPEED_MS
            low_vertical_speed = state.vertical_speed_ms is None or abs(state.vertical_speed_ms) <= 0.5
            # ArduPilot's relative altitude can remain above the configured
            # threshold after it has detected ground contact (notably in
            # SITL). A disarmed vehicle in LAND/RTL mode with settled motion
            # is the stronger landing signal; do not wait forever on stale
            # altitude telemetry.
            if self._landing_is_verified(state):
                return {"altitude_m": state.altitude_m, "groundspeed_ms": state.groundspeed_ms,
                        "vertical_speed_ms": state.vertical_speed_ms, "armed": state.armed,
                        "flight_mode": state.flight_mode, "timestamp": state.timestamp,
                        "verification_basis": (
                            "altitude_and_disarmed" if low_altitude else "disarmed_landing_mode"
                        )}
            time.sleep(0.5)

    @staticmethod
    def _landing_is_verified(state):
        low_altitude = state.altitude_m is not None and state.altitude_m <= LANDING_ALT_THRESHOLD_M
        low_speed = state.groundspeed_ms is None or state.groundspeed_ms <= LANDING_MAX_GROUNDSPEED_MS
        low_vertical_speed = state.vertical_speed_ms is None or abs(state.vertical_speed_ms) <= 0.5
        disarmed_on_landing_mode = state.armed is False and state.flight_mode in {"LAND", "RTL"}
        return (
            low_speed and low_vertical_speed and state.armed is False and
            (low_altitude or disarmed_on_landing_mode)
        )
