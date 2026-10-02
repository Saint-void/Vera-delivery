package com.vera.vella.controller;

import com.vera.vella.model.dto.CreateMissionRequest;
import com.vera.vella.model.entity.MissionDocument;
import com.vera.vella.service.FleetOrchestratorService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@RestController
@RequestMapping("/missions")
public class MissionController {

    private final FleetOrchestratorService orchestrator;

    public MissionController(FleetOrchestratorService orchestrator) {
        this.orchestrator = orchestrator;
    }

    @PostMapping
    public ResponseEntity<MissionDocument> createMission(@Valid @RequestBody CreateMissionRequest request) {
        MissionDocument mission = orchestrator.submitMission(request);
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(mission);
    }

    @GetMapping
    public List<MissionDocument> listMissions() {
        return orchestrator.listMissions();
    }

    @GetMapping("/{mission_id}")
    public MissionDocument getMission(@PathVariable("mission_id") String missionId) {
        return orchestrator.getMission(missionId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "mission not found"));
    }
}
