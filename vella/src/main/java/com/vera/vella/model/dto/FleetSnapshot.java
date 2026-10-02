package com.vera.vella.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.vera.vella.model.entity.DroneDocument;
import com.vera.vella.model.entity.MissionDocument;

import java.util.List;

public record FleetSnapshot(
        @JsonProperty("drones") List<DroneDocument> drones,
        @JsonProperty("missions") List<MissionDocument> missions
) {}
