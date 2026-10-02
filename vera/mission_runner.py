"""Legacy synchronous adapter for the Vera controller.

The production entrypoint is ``python -m vera``. This adapter is retained for
older local scripts but delegates execution to the same telemetry-driven
controller; it contains no independent flight state machine.
"""

import os
import tempfile
import uuid

from vera.connection import connect
from vera.controller import VeraController
from vera.mission_request import MissionRequest
from vera.mission_state import MissionState, MissionStateMachine
from vera.storage import VeraStateStore
from vera.telemetry import TelemetryState, request_data_streams, update_telemetry


def run_delivery_mission(destination, takeoff_alt=10, on_change=None):
    conn = connect()
    request_data_streams(conn)
    telemetry = update_telemetry(conn, TelemetryState())
    if telemetry.latitude is None or telemetry.longitude is None:
        raise RuntimeError("cannot start legacy mission without current GPS position")
    request = MissionRequest(
        mission_id="legacy-" + uuid.uuid4().hex[:10],
        pickup=(telemetry.latitude, telemetry.longitude, takeoff_alt),
        dropoff=tuple(destination),
        payload_weight_kg=1.0,
    )
    state_path = os.path.join(tempfile.gettempdir(), "vera-legacy-%s.sqlite3" % uuid.uuid4().hex)
    store = VeraStateStore(state_path)
    store.create_or_get(request)
    controller = VeraController(store=store)
    controller.conn = conn
    controller.connected = True
    controller._execute(store.get(request.mission_id))
    final = store.get(request.mission_id)
    result = MissionStateMachine(on_change=on_change)
    result.state = MissionState[final["status"]]
    result.history = [event for event in final["history"] if event.get("event_type") == "STATE"]
    return result
