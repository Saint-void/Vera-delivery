"""Best-effort Vera-to-Vella fleet registration.

This module is intentionally outbound-only.  A Vella outage must never stop
or otherwise affect the local flight controller.
"""

import threading

import requests

from vera.config import (
    CONNECTION_STRING,
    VELLA_BASE_URL,
    VELLA_REGISTRATION_INTERVAL_S,
    VELLA_REGISTRATION_PATH,
    VELLA_REGISTRATION_TIMEOUT_S,
    VERA_BASE_URL,
    VERA_DRONE_ID,
    VERA_DRONE_NAME,
    VERA_HOME_POSITION,
    VERA_MACHINE_HOST,
)


def fleet_status(health):
    """Convert Vera's local mission state into Vella's fleet status."""
    if not health.get("connected"):
        return "offline"
    state = health.get("mission_state") or health.get("mission_phase")
    if state in {"PREPARING", "TAKEOFF", "EN_ROUTE", "DELIVERY"}:
        return "busy"
    if state == "RETURNING":
        return "returning"
    if state in {"LANDING", "LANDED"}:
        return "landed"
    if state in {"ABORTED", "EMERGENCY", "REJECTED"}:
        return "error"
    return "busy" if health.get("current_mission_id") else "available"


def registration_payload(controller):
    health = controller.status()
    home_position = None
    active = controller.store.active()
    if VERA_HOME_POSITION:
        home = VERA_HOME_POSITION
        home_position = {"lat": home[0], "lon": home[1], "alt": home[2]}
    elif active and active.get("home_position"):
        home = active["home_position"]
        home_position = {"lat": home[0], "lon": home[1], "alt": home[2]}
    return {
        "drone_id": VERA_DRONE_ID,
        "drone_name": VERA_DRONE_NAME,
        "host": VERA_MACHINE_HOST,
        "base_url": VERA_BASE_URL,
        "mavlink_connection": CONNECTION_STRING,
        "status": fleet_status(health),
        "connected": bool(health.get("connected")),
        "home_position": home_position,
    }


class VellaRegistrar:
    """Register immediately and refresh registration while Vera is running."""

    def __init__(self, controller, base_url=VELLA_BASE_URL, session=None,
                 interval_s=VELLA_REGISTRATION_INTERVAL_S,
                 timeout_s=VELLA_REGISTRATION_TIMEOUT_S):
        self.controller = controller
        self.base_url = base_url.rstrip("/") if base_url else ""
        self.session = session or requests.Session()
        self.interval_s = interval_s
        self.timeout_s = timeout_s
        self._stop = threading.Event()
        self._thread = None

    @property
    def enabled(self):
        return bool(self.base_url)

    def register_once(self):
        if not self.enabled:
            return None
        try:
            response = self.session.post(
                self.base_url + VELLA_REGISTRATION_PATH,
                json=registration_payload(self.controller),
                headers={"Connection": "close"},
                timeout=self.timeout_s,
            )
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            print("Vera could not register with Vella: %s" % exc)
            try:
                self.session.close()
            except Exception:
                pass
            self.session = requests.Session()
            return None


    def start(self):
        if not self.enabled or (self._thread and self._thread.is_alive()):
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="vera-vella-registration", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread and self._thread is not threading.current_thread():
            self._thread.join(timeout=self.timeout_s + 1)

    def _run(self):
        while not self._stop.is_set():
            self.register_once()
            self._stop.wait(self.interval_s)
