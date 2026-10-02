package com.vera.vella.controller;

import com.vera.vella.model.entity.MissionDocument;
import com.vera.vella.service.FleetOrchestratorService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/delivery")
public class DeliveryController {

    private final FleetOrchestratorService orchestrator;

    public DeliveryController(FleetOrchestratorService orchestrator) {
        this.orchestrator = orchestrator;
    }

    @PostMapping("/{mission_id}/complete")
    public MissionDocument completeDelivery(@PathVariable("mission_id") String missionId) {
        MissionDocument mission = orchestrator.confirmDelivery(missionId);
        if (mission == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "mission not found");
        }
        return mission;
    }
}
