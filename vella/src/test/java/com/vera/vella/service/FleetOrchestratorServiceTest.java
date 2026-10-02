package com.vera.vella.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.vera.vella.client.VeraClient;
import com.vera.vella.model.dto.Coordinate;
import com.vera.vella.model.dto.CreateMissionRequest;
import com.vera.vella.model.dto.RegisterDroneRequest;
import com.vera.vella.model.entity.DroneDocument;
import com.vera.vella.model.entity.MissionDocument;
import com.vera.vella.repository.DroneRepository;
import com.vera.vella.repository.MissionRepository;
import com.vera.vella.repository.TelemetryRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class FleetOrchestratorServiceTest {

    @Mock
    private DroneRepository droneRepository;

    @Mock
    private MissionRepository missionRepository;

    @Mock
    private TelemetryRepository telemetryRepository;

    @Mock
    private VeraClient veraClient;

    private final ObjectMapper objectMapper = new ObjectMapper();

    private FleetOrchestratorService service;

    @BeforeEach
    void setUp() {
        service = new FleetOrchestratorService(
                droneRepository,
                missionRepository,
                telemetryRepository,
                veraClient,
                objectMapper
        );
        ReflectionTestUtils.setField(service, "minBatteryPct", 40);
    }

    @Test
    void testRegisterDrone() {
        when(droneRepository.findById("VERA_001")).thenReturn(Optional.empty());
        when(droneRepository.save(any(DroneDocument.class))).thenAnswer(invocation -> invocation.getArgument(0));

        RegisterDroneRequest req = new RegisterDroneRequest(
                "VERA_001",
                "http://192.168.1.100:8765",
                "Drone 1",
                "192.168.1.100",
                "udp:127.0.0.1:14551",
                new Coordinate(6.5244, 3.3792, 10.0),
                "available",
                true
        );

        FleetOrchestratorService.DroneRegisterResult result = service.registerDrone(req);
        assertTrue(result.created());
        assertEquals("VERA_001", result.drone().getDroneId());
        assertEquals("http://192.168.1.100:8765", result.drone().getBaseUrl());
    }

    @Test
    void testSubmitMissionSuccess() {
        DroneDocument drone = new DroneDocument("VERA_001", "http://192.168.1.100:8765");
        drone.setStatus("available");
        drone.setConnected(true);
        drone.setTelemetry(Map.of("latitude", 6.5244, "longitude", 3.3792, "battery_pct", 95));

        when(droneRepository.findByStatusAndConnected("available", true)).thenReturn(List.of(drone));
        when(missionRepository.findById("m-001")).thenReturn(Optional.empty());
        when(missionRepository.save(any(MissionDocument.class))).thenAnswer(invocation -> invocation.getArgument(0));

        ObjectNode veraResponse = objectMapper.createObjectNode();
        veraResponse.put("status", "QUEUED");
        when(veraClient.createMission(eq("http://192.168.1.100:8765"), any())).thenReturn(veraResponse);

        CreateMissionRequest request = new CreateMissionRequest(
                "m-001",
                new Coordinate(6.5280, 3.3850, 20.0),
                new Coordinate(6.5244, 3.3792, 25.0),
                1.5,
                null
        );

        MissionDocument result = service.submitMission(request);
        assertNotNull(result);
        assertEquals("m-001", result.getMissionId());
        assertEquals("VERA_001", result.getDroneId());
        verify(veraClient).createMission(eq("http://192.168.1.100:8765"), any());
    }

    @Test
    void testSubmitMissionRejectsLowBattery() {
        DroneDocument drone = new DroneDocument("VERA_001", "http://192.168.1.100:8765");
        drone.setStatus("available");
        drone.setConnected(true);
        drone.setTelemetry(Map.of("latitude", 6.5244, "longitude", 3.3792, "battery_pct", 20)); // Below 40%

        when(droneRepository.findById("VERA_001")).thenReturn(Optional.of(drone));

        CreateMissionRequest request = new CreateMissionRequest(
                "m-001",
                new Coordinate(6.5280, 3.3850, 20.0),
                new Coordinate(6.5244, 3.3792, 25.0),
                1.5,
                "VERA_001"
        );

        ResponseStatusException ex = assertThrows(
                ResponseStatusException.class,
                () -> service.submitMission(request)
        );
        assertTrue(ex.getReason().contains("minimum launch battery is 40%"));
    }
}
