package com.vera.vella.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;

public record RegisterDroneRequest(
        @NotBlank(message = "drone_id is required")
        @JsonProperty("drone_id")
        String droneId,

        @NotBlank(message = "base_url is required")
        @JsonProperty("base_url")
        String baseUrl,

        @JsonProperty("drone_name")
        String droneName,

        @JsonProperty("host")
        String host,

        @JsonProperty("mavlink_connection")
        String mavlinkConnection,

        @JsonProperty("home_position")
        Coordinate homePosition,

        @JsonProperty("status")
        String status,

        @JsonProperty("connected")
        Boolean connected
) {
    public String safeStatus() {
        return (status != null && !status.isBlank()) ? status : "available";
    }

    public boolean safeConnected() {
        return connected == null || connected;
    }
}
