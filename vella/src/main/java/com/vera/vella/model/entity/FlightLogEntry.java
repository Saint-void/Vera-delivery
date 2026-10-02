package com.vera.vella.model.entity;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Map;

public record FlightLogEntry(
        @JsonProperty("status") String status,
        @JsonProperty("timestamp") String timestamp,
        @JsonProperty("reason") String reason,
        @JsonProperty("event_type") String eventType,
        @JsonProperty("details") Map<String, Object> details,
        @JsonProperty("event_time_utc") String eventTimeUtc,
        @JsonProperty("telemetry_sample_time_utc") String telemetrySampleTimeUtc,
        @JsonProperty("autopilot_time_boot_ms") Long autopilotTimeBootMs,
        @JsonProperty("command_ack_time_utc") String commandAckTimeUtc
) {}
