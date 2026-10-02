"""
vera/mission_request.py

The mission contract: what RECEIVE MISSION looks like as data, and
what VALIDATE MISSION checks before Vera ever arms.

Validation runs on pure coordinates -- no live drone connection
needed -- so a bad request never costs you a connect() or an arm().
"""

from dataclasses import dataclass
from datetime import datetime, timezone

from vera.safety import point_in_geofence
from vera.navigation import haversine_m
from vera.config import MAX_MISSION_RANGE_M


@dataclass
class MissionRequest:
    mission_id: str
    pickup: tuple    # (lat, lon, alt)
    dropoff: tuple   # (lat, lon, alt)
    payload_weight_kg: float = 0.0
    requested_at: str = None

    def __post_init__(self):
        if self.requested_at is None:
            self.requested_at = datetime.now(timezone.utc).isoformat()

    def to_dict(self):
        return {
            "mission_id": self.mission_id,
            "pickup": list(self.pickup),
            "dropoff": list(self.dropoff),
            "payload_weight_kg": self.payload_weight_kg,
            "requested_at": self.requested_at,
        }

    @classmethod
    def from_dict(cls, value):
        return cls(
            mission_id=value["mission_id"],
            pickup=tuple(value["pickup"]),
            dropoff=tuple(value["dropoff"]),
            payload_weight_kg=float(value.get("payload_weight_kg", 0.0)),
            requested_at=value.get("requested_at"),
        )


class MissionValidationError(Exception):
    pass


def validate_mission(request: MissionRequest):
    """Raises MissionValidationError with a specific reason on the
    first check that fails. Returns None on success."""
    for name, point in (("pickup", request.pickup), ("dropoff", request.dropoff)):
        if len(point) != 3:
            raise MissionValidationError(f"{name} must be (lat, lon, alt), got {point}")
        lat, lon, alt = point
        if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
            raise MissionValidationError(f"{name} coordinates out of range: {point}")
        if alt <= 0:
            raise MissionValidationError(f"{name} altitude must be positive, got {alt}")

    if not point_in_geofence(*request.pickup[:2]):
        raise MissionValidationError(f"pickup {request.pickup[:2]} is outside the geofence")
    if not point_in_geofence(*request.dropoff[:2]):
        raise MissionValidationError(f"dropoff {request.dropoff[:2]} is outside the geofence")

    distance_m = haversine_m(*request.pickup[:2], *request.dropoff[:2])
    if distance_m > MAX_MISSION_RANGE_M:
        raise MissionValidationError(
            f"mission distance {distance_m:.0f}m exceeds "
            f"MAX_MISSION_RANGE_M ({MAX_MISSION_RANGE_M}m)"
        )

    if request.payload_weight_kg < 0:
        raise MissionValidationError(
            f"payload_weight_kg cannot be negative: {request.payload_weight_kg}"
        )
