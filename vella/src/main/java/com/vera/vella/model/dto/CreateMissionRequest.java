package com.vera.vella.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record CreateMissionRequest(
        @NotBlank(message = "mission_id is required")
        @JsonProperty("mission_id")
        String missionId,

        @NotNull(message = "dropoff coordinate is required")
        @JsonProperty("dropoff")
        Coordinate dropoff,

        @JsonProperty("pickup")
        Coordinate pickup,

        @JsonProperty("payload_weight_kg")
        Double payloadWeightKg,

        @JsonProperty("drone_id")
        String droneId
) {
    public double safePayloadWeight() {
        return payloadWeightKg != null ? payloadWeightKg : 0.0;
    }
}
