package com.vera.vella.controller;

import com.vera.vella.model.dto.CommandRequest;
import com.vera.vella.model.dto.RegisterDroneRequest;
import com.vera.vella.model.entity.DroneDocument;
import com.vera.vella.service.FleetOrchestratorService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;
import java.util.Set;

@RestController
@RequestMapping("/drones")
public class DroneController {

    private static final Set<String> ALLOWED_COMMANDS = Set.of("rtl", "cancel", "pause", "resume");

    private final FleetOrchestratorService orchestrator;

    public DroneController(FleetOrchestratorService orchestrator) {
        this.orchestrator = orchestrator;
    }

    @GetMapping
    public List<DroneDocument> listDrones() {
        return orchestrator.listDrones();
    }

    @PostMapping
    public ResponseEntity<DroneDocument> registerDrone(@Valid @RequestBody RegisterDroneRequest request) {
        FleetOrchestratorService.DroneRegisterResult result = orchestrator.registerDrone(request);
        HttpStatus status = result.created() ? HttpStatus.CREATED : HttpStatus.OK;
        return ResponseEntity.status(status).body(result.drone());
    }

    @GetMapping("/{drone_id}")
    public DroneDocument getDrone(@PathVariable("drone_id") String droneId) {
        return orchestrator.getDrone(droneId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "drone not found"));
    }

    @GetMapping("/{drone_id}/telemetry")
    public Map<String, Object> getDroneTelemetry(@PathVariable("drone_id") String droneId) {
        DroneDocument drone = orchestrator.getDrone(droneId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "drone not found"));

        if (drone.getTelemetry() == null) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "no telemetry yet");
        }
        return drone.getTelemetry();
    }

    @PostMapping("/{drone_id}/command")
    public Map<String, String> sendCommand(
            @PathVariable("drone_id") String droneId,
            @Valid @RequestBody CommandRequest request
    ) {
        if (!ALLOWED_COMMANDS.contains(request.command().toLowerCase())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "unsupported command '" + request.command() + "'");
        }

        orchestrator.sendCommand(droneId, request.command().toLowerCase(), request.missionId());
        return Map.of("status", request.command().toLowerCase() + "_requested");
    }

    @DeleteMapping("/{drone_id}")
    public ResponseEntity<Void> deleteDrone(@PathVariable("drone_id") String droneId) {
        boolean deleted = orchestrator.deleteDrone(droneId);
        return deleted ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
    }
}
