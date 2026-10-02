package com.vera.vella.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.vera.vella.exception.VeraClientException;
import com.vera.vella.model.dto.Coordinate;
import com.vera.vella.model.dto.CreateMissionRequest;
import com.vera.vella.model.entity.MissionDocument;
import com.vera.vella.service.FleetOrchestratorService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = {MissionController.class, GlobalExceptionHandler.class})
class MissionControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private FleetOrchestratorService orchestrator;

    @Test
    void testCreateMissionReturns202() throws Exception {
        MissionDocument doc = new MissionDocument(
                "m-001",
                new Coordinate(6.5244, 3.3792, 25.0),
                new Coordinate(6.5280, 3.3850, 20.0),
                1.5
        );
        doc.setDroneId("VERA_001");

        when(orchestrator.submitMission(any())).thenReturn(doc);

        CreateMissionRequest req = new CreateMissionRequest(
                "m-001",
                new Coordinate(6.5280, 3.3850, 20.0),
                new Coordinate(6.5244, 3.3792, 25.0),
                1.5,
                "VERA_001"
        );

        mockMvc.perform(post("/missions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.mission_id").value("m-001"))
                .andExpect(jsonPath("$.drone_id").value("VERA_001"));
    }

    @Test
    void testCreateMissionVeraErrorPropagates400WithDetail() throws Exception {
        when(orchestrator.submitMission(any()))
                .thenThrow(new VeraClientException("dropoff is outside the geofence", 400));

        CreateMissionRequest req = new CreateMissionRequest(
                "m-001",
                new Coordinate(6.5280, 3.3850, 20.0),
                new Coordinate(6.5244, 3.3792, 25.0),
                1.5,
                "VERA_001"
        );

        mockMvc.perform(post("/missions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("dropoff is outside the geofence"));
    }
}
