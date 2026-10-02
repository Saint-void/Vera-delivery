package com.vera.vella.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;

public record CommandRequest(
        @NotBlank(message = "command is required")
        @JsonProperty("command")
        String command,

        @JsonProperty("mission_id")
        String missionId
) {}
