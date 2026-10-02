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
        if not isinstance(value, dict):
            raise MissionValidationError("Mission request body must be a JSON object")

        # Unwrap common container fields if present
        if "mission" in value and isinstance(value["mission"], dict):
            value = {**value["mission"], **value}
        if "data" in value and isinstance(value["data"], dict):
            value = {**value["data"], **value}
        if "body" in value and isinstance(value["body"], dict):
            value = {**value["body"], **value}

        def _parse_coord(raw, name):
            if raw is None:
                return None
            if isinstance(raw, (list, tuple)):
                if len(raw) < 2:
                    raise MissionValidationError(f"{name} must have at least latitude and longitude")
                lat = float(raw[0])
                lon = float(raw[1])
                alt = float(raw[2]) if len(raw) > 2 else 20.0
                return (lat, lon, alt)
            if isinstance(raw, dict):
                lat = float(raw.get("lat", raw.get("latitude", 0.0)))
                lon = float(raw.get("lon", raw.get("lng", raw.get("longitude", 0.0))))
                alt = float(raw.get("alt", raw.get("altitude", raw.get("altitude_m", 20.0))))
                return (lat, lon, alt)
            if isinstance(raw, str):
                parts = [p.strip() for p in raw.split(",") if p.strip()]
                if len(parts) >= 2:
                    lat = float(parts[0])
                    lon = float(parts[1])
                    alt = float(parts[2]) if len(parts) > 2 else 20.0
                    return (lat, lon, alt)
            raise MissionValidationError(f"Invalid coordinate format for {name}: {raw}")

        mission_id = (
            value.get("mission_id")
            or value.get("missionId")
            or value.get("id")
        )
        if not mission_id:
            import uuid
            mission_id = f"m-{uuid.uuid4().hex[:8]}"

        dropoff_raw = (
            value.get("dropoff")
            or value.get("drop_off")
            or value.get("dropOff")
            or value.get("destination")
            or value.get("target")
        )
        dropoff = _parse_coord(dropoff_raw, "dropoff")
        if dropoff is None:
            raise MissionValidationError("dropoff coordinate is required")

        pickup_raw = (
            value.get("pickup")
            or value.get("pick_up")
            or value.get("pickUp")
            or value.get("origin")
            or value.get("launch")
            or value.get("start")
        )
        pickup = _parse_coord(pickup_raw, "pickup")
        if pickup is None:
            pickup = (dropoff[0], dropoff[1], dropoff[2])

        try:
            payload_weight = float(
                value.get("payload_weight_kg")
                or value.get("payloadWeightKg")
                or value.get("payload_weight")
                or 0.0
            )
        except (ValueError, TypeError):
            payload_weight = 0.0

        return cls(
            mission_id=str(mission_id),
            pickup=pickup,
            dropoff=dropoff,
            payload_weight_kg=payload_weight,
            requested_at=value.get("requested_at") or value.get("requestedAt"),
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
