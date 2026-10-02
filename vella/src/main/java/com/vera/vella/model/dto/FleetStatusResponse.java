package com.vera.vella.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.vera.vella.model.entity.DroneDocument;

import java.util.List;

public record FleetStatusResponse(
        @JsonProperty("process") String process,
        @JsonProperty("total_drones") int totalDrones,
        @JsonProperty("active_drones") int activeDrones,
        @JsonProperty("available_drones") int availableDrones,
        @JsonProperty("assigned_missions") int assignedMissions,
        @JsonProperty("drone_ids") List<String> droneIds,
        @JsonProperty("drone_statuses") List<DroneDocument> droneStatuses
) {}
