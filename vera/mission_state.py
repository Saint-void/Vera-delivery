"""
vera/mission_state.py

Formal state machine for a single delivery mission. This is the
model Vella will eventually poll or log against -- getting the
failure path right now matters, because retrofitting it onto a
happy-path-only diagram later means touching every phase again.
"""

from enum import Enum
from datetime import datetime, timezone


class MissionState(Enum):
    IDLE = "IDLE"
    PREPARING = "PREPARING"
    TAKEOFF = "TAKEOFF"
    EN_ROUTE = "EN_ROUTE"
    DELIVERY = "DELIVERY"
    RETURNING = "RETURNING"
    LANDING = "LANDING"
    LANDED = "LANDED"
    COMPLETED = "COMPLETED"
    ABORTED = "ABORTED"
    EMERGENCY = "EMERGENCY"


# Legal next-states from each state. A transition not listed here
# raises instead of silently mutating -- a state machine that accepts
# illegal transitions isn't actually one.
ALLOWED_TRANSITIONS = {
    MissionState.IDLE:      {MissionState.PREPARING},
    MissionState.PREPARING: {MissionState.TAKEOFF, MissionState.RETURNING, MissionState.LANDING, MissionState.ABORTED, MissionState.EMERGENCY},
    MissionState.TAKEOFF:   {MissionState.EN_ROUTE, MissionState.RETURNING, MissionState.LANDING, MissionState.ABORTED, MissionState.EMERGENCY},
    MissionState.EN_ROUTE:  {MissionState.DELIVERY, MissionState.RETURNING, MissionState.LANDING, MissionState.ABORTED, MissionState.EMERGENCY},
    MissionState.DELIVERY:  {MissionState.RETURNING, MissionState.LANDING, MissionState.ABORTED, MissionState.EMERGENCY},
    MissionState.RETURNING: {MissionState.LANDING, MissionState.ABORTED, MissionState.EMERGENCY},
    MissionState.LANDING:   {MissionState.LANDED, MissionState.ABORTED, MissionState.EMERGENCY},
    MissionState.LANDED:    {MissionState.COMPLETED, MissionState.ABORTED, MissionState.EMERGENCY},
    MissionState.COMPLETED: set(),
    MissionState.ABORTED:   set(),
    MissionState.EMERGENCY: set(),
}


class IllegalTransitionError(Exception):
    pass


class MissionStateMachine:
    """Tracks one mission's state. on_change(old_state, new_state,
    timestamp, reason) fires on every transition -- that hook is how
    Vella will observe progress without polling internals or parsing
    logs."""

    def __init__(self, on_change=None):
        self.state = MissionState.IDLE
        self.history = [{
            "status": self.state.name,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "reason": None,
        }]
        self.on_change = on_change

    def transition(self, new_state: MissionState, reason: str = None):
        if new_state == self.state:
            return None
        if new_state not in ALLOWED_TRANSITIONS[self.state]:
            raise IllegalTransitionError(
                f"Cannot go from {self.state.name} to {new_state.name}"
            )
        old_state = self.state
        self.state = new_state
        timestamp = datetime.now(timezone.utc)
        event = {
            "status": new_state.name,
            "timestamp": timestamp.isoformat(),
            "reason": reason,
        }
        self.history.append(event)
        print(
            f"[{timestamp.isoformat()}] {old_state.name} -> {new_state.name}"
            + (f" ({reason})" if reason else "")
        )
        if self.on_change:
            self.on_change(old_state, new_state, timestamp, reason)
        return event

    def abort(self, reason: str):
        if self.state not in {MissionState.COMPLETED, MissionState.ABORTED, MissionState.EMERGENCY}:
            return self.transition(MissionState.ABORTED, reason=reason)

    def emergency(self, reason: str):
        if self.state not in {MissionState.COMPLETED, MissionState.ABORTED, MissionState.EMERGENCY}:
            return self.transition(MissionState.EMERGENCY, reason=reason)
