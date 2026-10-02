"""Durable, Vera-owned mission state.

This database is deliberately inside Vera's process boundary.  It contains
the complete active mission and event history needed to continue or enter a
safe state when Vella is unavailable or Vera itself is restarted.
"""

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

from vera.config import VERA_STATE_DB
from vera.mission_state import MissionState, ALLOWED_TRANSITIONS, IllegalTransitionError


def _now():
    return datetime.now(timezone.utc).isoformat()


def _telemetry_sample_time(telemetry):
    if telemetry is None:
        return None
    return telemetry.get("timestamp") if isinstance(telemetry, dict) else telemetry.timestamp


def _autopilot_boot_ms(telemetry):
    if telemetry is None:
        return None
    return telemetry.get("autopilot_time_boot_ms") if isinstance(telemetry, dict) else telemetry.autopilot_time_boot_ms


class VeraStateStore:
    def __init__(self, path=VERA_STATE_DB):
        self.path = path
        directory = os.path.dirname(os.path.abspath(path))
        os.makedirs(directory, exist_ok=True)
        self._init_db()

    @contextmanager
    def _connect(self):
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _init_db(self):
        with self._connect() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS missions (
                    mission_id TEXT PRIMARY KEY,
                    definition TEXT NOT NULL,
                    status TEXT NOT NULL,
                    home_position TEXT,
                    accepted_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_reason TEXT,
                    cancel_requested INTEGER NOT NULL DEFAULT 0,
                    pause_requested INTEGER NOT NULL DEFAULT 0,
                    delivery_confirmed INTEGER NOT NULL DEFAULT 0
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS mission_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    mission_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    reason TEXT,
                    event_type TEXT NOT NULL DEFAULT 'STATE',
                    details TEXT,
                    event_time_utc TEXT,
                    telemetry_sample_time_utc TEXT,
                    autopilot_time_boot_ms INTEGER,
                    command_ack_time_utc TEXT,
                    UNIQUE(mission_id, status, timestamp),
                    FOREIGN KEY(mission_id) REFERENCES missions(mission_id)
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS telemetry (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    mission_id TEXT,
                    timestamp TEXT NOT NULL,
                    latitude REAL,
                    longitude REAL,
                    altitude_m REAL,
                    groundspeed_ms REAL,
                    vertical_speed_ms REAL,
                    heading_deg REAL,
                    battery_pct INTEGER,
                    battery_remaining INTEGER,
                    battery_voltage_v REAL,
                    consumed_mah INTEGER,
                    battery_capacity_mah INTEGER,
                    remaining_mah INTEGER,
                    battery_low INTEGER NOT NULL DEFAULT 0,
                    battery_status_text TEXT,
                    flight_mode TEXT,
                    armed INTEGER,
                    gps_fix_type INTEGER,
                    satellites_visible INTEGER,
                    gps_receivers TEXT,
                    autopilot_time_boot_ms INTEGER,
                    autopilot_time_usec INTEGER
                )
            """)
            mission_columns = {row["name"] for row in conn.execute("PRAGMA table_info(missions)")}
            if "delivery_confirmed" not in mission_columns:
                conn.execute("ALTER TABLE missions ADD COLUMN delivery_confirmed INTEGER NOT NULL DEFAULT 0")
            event_columns = {row["name"] for row in conn.execute("PRAGMA table_info(mission_events)")}
            if "event_type" not in event_columns:
                conn.execute("ALTER TABLE mission_events ADD COLUMN event_type TEXT NOT NULL DEFAULT 'STATE'")
            if "details" not in event_columns:
                conn.execute("ALTER TABLE mission_events ADD COLUMN details TEXT")
            if "event_time_utc" not in event_columns:
                conn.execute("ALTER TABLE mission_events ADD COLUMN event_time_utc TEXT")
            if "telemetry_sample_time_utc" not in event_columns:
                conn.execute("ALTER TABLE mission_events ADD COLUMN telemetry_sample_time_utc TEXT")
            if "autopilot_time_boot_ms" not in event_columns:
                conn.execute("ALTER TABLE mission_events ADD COLUMN autopilot_time_boot_ms INTEGER")
            if "command_ack_time_utc" not in event_columns:
                conn.execute("ALTER TABLE mission_events ADD COLUMN command_ack_time_utc TEXT")
            telemetry_columns = {row["name"] for row in conn.execute("PRAGMA table_info(telemetry)")}
            if "autopilot_time_boot_ms" not in telemetry_columns:
                conn.execute("ALTER TABLE telemetry ADD COLUMN autopilot_time_boot_ms INTEGER")
            if "autopilot_time_usec" not in telemetry_columns:
                conn.execute("ALTER TABLE telemetry ADD COLUMN autopilot_time_usec INTEGER")
            if "vertical_speed_ms" not in telemetry_columns:
                conn.execute("ALTER TABLE telemetry ADD COLUMN vertical_speed_ms REAL")
            if "battery_low" not in telemetry_columns:
                conn.execute("ALTER TABLE telemetry ADD COLUMN battery_low INTEGER NOT NULL DEFAULT 0")
            if "battery_status_text" not in telemetry_columns:
                conn.execute("ALTER TABLE telemetry ADD COLUMN battery_status_text TEXT")
            if "battery_remaining" not in telemetry_columns:
                conn.execute("ALTER TABLE telemetry ADD COLUMN battery_remaining INTEGER")
            if "consumed_mah" not in telemetry_columns:
                conn.execute("ALTER TABLE telemetry ADD COLUMN consumed_mah INTEGER")
            if "battery_capacity_mah" not in telemetry_columns:
                conn.execute("ALTER TABLE telemetry ADD COLUMN battery_capacity_mah INTEGER")
            if "remaining_mah" not in telemetry_columns:
                conn.execute("ALTER TABLE telemetry ADD COLUMN remaining_mah INTEGER")

    def create_or_get(self, request):
        definition = json.dumps(request.to_dict(), sort_keys=True)
        now = _now()
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM missions WHERE mission_id = ?", (request.mission_id,)
            ).fetchone()
            if row:
                if row["definition"] != definition:
                    raise ValueError("mission_id already exists with a different definition")
                return self.get(request.mission_id), False
            conn.execute(
                "INSERT INTO missions(mission_id, definition, status, accepted_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (request.mission_id, definition, MissionState.IDLE.name, now, now),
            )
            conn.execute(
                "INSERT INTO mission_events(mission_id, status, timestamp, reason, event_type, event_time_utc) VALUES (?, ?, ?, ?, ?, ?)",
                (request.mission_id, MissionState.IDLE.name, now, None, "STATE", now),
            )
        self.transition(request.mission_id, MissionState.PREPARING.name, "mission accepted")
        return self.get(request.mission_id), True

    def transition(self, mission_id, status, reason=None, timestamp=None, details=None, telemetry=None):
        new_state = MissionState[status] if isinstance(status, str) else status
        timestamp = timestamp or _now()
        with self._connect() as conn:
            row = conn.execute(
                "SELECT status FROM missions WHERE mission_id = ?", (mission_id,)
            ).fetchone()
            if row is None:
                raise KeyError(mission_id)
            current = MissionState[row["status"]]
            if new_state == current:
                return self.get(mission_id)
            if new_state not in ALLOWED_TRANSITIONS[current]:
                raise IllegalTransitionError(
                    f"Cannot go from {current.name} to {new_state.name}"
                )
            conn.execute(
                "UPDATE missions SET status = ?, updated_at = ?, last_reason = ? WHERE mission_id = ?",
                (new_state.name, timestamp, reason, mission_id),
            )
            conn.execute(
                "INSERT OR IGNORE INTO mission_events(mission_id, status, timestamp, reason, event_type, details, "
                "event_time_utc, telemetry_sample_time_utc, autopilot_time_boot_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (mission_id, new_state.name, timestamp, reason, "STATE", json.dumps(details) if details else None,
                 timestamp, _telemetry_sample_time(telemetry), _autopilot_boot_ms(telemetry)),
            )
        return self.get(mission_id)

    def record_event(self, mission_id, event_type, status, reason=None, details=None,
                     timestamp=None, telemetry=None, command_ack_time_utc=None):
        timestamp = timestamp or _now()
        with self._connect() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO mission_events(mission_id, status, timestamp, reason, event_type, details, "
                "event_time_utc, telemetry_sample_time_utc, autopilot_time_boot_ms, command_ack_time_utc) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (mission_id, status or event_type, timestamp, reason, event_type,
                 json.dumps(details) if details is not None else None, timestamp,
                 _telemetry_sample_time(telemetry), _autopilot_boot_ms(telemetry), command_ack_time_utc),
            )

    def set_home_position(self, mission_id, position):
        with self._connect() as conn:
            conn.execute(
                "UPDATE missions SET home_position = ?, updated_at = ? WHERE mission_id = ?",
                (json.dumps(position), _now(), mission_id),
            )

    def set_delivery_confirmed(self, mission_id):
        with self._connect() as conn:
            conn.execute(
                "UPDATE missions SET delivery_confirmed = 1, updated_at = ? WHERE mission_id = ?",
                (_now(), mission_id),
            )

    def request(self, mission_id, field, value=True):
        if field not in {"cancel_requested", "pause_requested"}:
            raise ValueError(field)
        with self._connect() as conn:
            conn.execute(
                f"UPDATE missions SET {field} = ?, updated_at = ? WHERE mission_id = ?",
                (int(value), _now(), mission_id),
            )

    def clear_request(self, mission_id, field):
        self.request(mission_id, field, False)

    def log_telemetry(self, mission_id, telemetry):
        values = (
            mission_id, telemetry.timestamp, telemetry.latitude, telemetry.longitude,
            telemetry.altitude_m, telemetry.groundspeed_ms, telemetry.vertical_speed_ms,
            telemetry.heading_deg,
            telemetry.battery_pct, telemetry.battery_remaining, telemetry.battery_voltage_v,
            telemetry.consumed_mah, telemetry.battery_capacity_mah, telemetry.remaining_mah,
            int(telemetry.battery_low), telemetry.battery_status_text, telemetry.flight_mode,
            None if telemetry.armed is None else int(telemetry.armed), telemetry.gps_fix_type,
            telemetry.satellites_visible, json.dumps(telemetry.gps_receivers),
            telemetry.autopilot_time_boot_ms, telemetry.autopilot_time_usec,
        )
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO telemetry(mission_id, timestamp, latitude, longitude, altitude_m, "
                "groundspeed_ms, vertical_speed_ms, heading_deg, battery_pct, battery_remaining, battery_voltage_v, consumed_mah, "
                "battery_capacity_mah, remaining_mah, battery_low, battery_status_text, flight_mode, "
                "armed, gps_fix_type, satellites_visible, gps_receivers, autopilot_time_boot_ms, autopilot_time_usec) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", values,
            )

    def active(self):
        with self._connect() as conn:
            row = conn.execute(
                "SELECT mission_id FROM missions WHERE status NOT IN ('IDLE', 'LANDED', 'COMPLETED', 'ABORTED', 'EMERGENCY') "
                "ORDER BY accepted_at LIMIT 1"
            ).fetchone()
        return self.get(row["mission_id"]) if row else None

    def get(self, mission_id):
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM missions WHERE mission_id = ?", (mission_id,)).fetchone()
            if row is None:
                return None
            result = dict(row)
            result["definition"] = json.loads(result["definition"])
            result["phase"] = result["status"]
            result["delivery_confirmed"] = bool(result["delivery_confirmed"])
            result["home_position"] = json.loads(result["home_position"]) if result["home_position"] else None
            result["cancel_requested"] = bool(result["cancel_requested"])
            result["pause_requested"] = bool(result["pause_requested"])
            result["history"] = [dict(event) for event in conn.execute(
                "SELECT status, timestamp, reason, event_type, details, event_time_utc, "
                "telemetry_sample_time_utc, autopilot_time_boot_ms, command_ack_time_utc "
                "FROM mission_events WHERE mission_id = ? ORDER BY id",
                (mission_id,),
            ).fetchall()]
            for event in result["history"]:
                event["event_time_utc"] = event["event_time_utc"] or event["timestamp"]
                event["timestamp"] = event["event_time_utc"]
                if event["details"]:
                    event["details"] = json.loads(event["details"])
            telemetry = conn.execute(
                "SELECT * FROM telemetry WHERE mission_id = ? ORDER BY id DESC LIMIT 1", (mission_id,)
            ).fetchone()
            result["telemetry"] = dict(telemetry) if telemetry else None
            if result["telemetry"] and result["telemetry"]["gps_receivers"]:
                result["telemetry"]["gps_receivers"] = json.loads(result["telemetry"]["gps_receivers"])
            return result

    def list(self):
        with self._connect() as conn:
            ids = [r["mission_id"] for r in conn.execute("SELECT mission_id FROM missions ORDER BY accepted_at")]
        return [self.get(mission_id) for mission_id in ids]

    def latest_telemetry(self):
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM telemetry ORDER BY id DESC LIMIT 1").fetchone()
            if row is None:
                return None
            result = dict(row)
            if result["gps_receivers"]:
                result["gps_receivers"] = json.loads(result["gps_receivers"])
            return result
