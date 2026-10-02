package com.vera.vella.controller;

import com.vera.vella.model.dto.FleetStatusResponse;
import com.vera.vella.model.entity.DroneDocument;
import com.vera.vella.model.entity.MissionDocument;
import com.vera.vella.service.FleetOrchestratorService;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.List;

@RestController
@RequestMapping("/fleet")
public class FleetController {

    private final FleetOrchestratorService orchestrator;

    public FleetController(FleetOrchestratorService orchestrator) {
        this.orchestrator = orchestrator;
    }

    @GetMapping("/status")
    public FleetStatusResponse fleetStatus() {
        return orchestrator.getFleetStatus();
    }

    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter fleetStream() {
        return orchestrator.subscribeFleetStream();
    }

    @GetMapping("/drones/active")
    public List<DroneDocument> fleetActiveDrones() {
        return orchestrator.listActiveDrones();
    }

    @GetMapping("/drones/available")
    public List<DroneDocument> fleetAvailableDrones() {
        return orchestrator.listAvailableDrones();
    }

    @GetMapping("/missions/assigned")
    public List<MissionDocument> fleetAssignedMissions() {
        return orchestrator.listAssignedMissions();
    }
}
