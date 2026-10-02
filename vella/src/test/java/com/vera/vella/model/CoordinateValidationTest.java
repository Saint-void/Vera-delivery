package com.vera.vella.model;

import com.vera.vella.exception.MissionValidationError;
import com.vera.vella.model.dto.Coordinate;
import com.vera.vella.service.FleetOrchestratorService;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class CoordinateValidationTest {

    private final FleetOrchestratorService service = new FleetOrchestratorService(null, null, null, null, null);

    @Test
    void testValidCoordinatesAndPayload() {
        Coordinate pickup = new Coordinate(6.5244, 3.3792, 25.0);
        Coordinate dropoff = new Coordinate(6.5280, 3.3850, 20.0);
        assertDoesNotThrow(() -> service.validateMissionRequest(pickup, dropoff, 1.5));
    }

    @Test
    void testInvalidLatitude() {
        Coordinate badLat = new Coordinate(95.0, 3.3792, 25.0);
        Coordinate dropoff = new Coordinate(6.5280, 3.3850, 20.0);
        MissionValidationError ex = assertThrows(
                MissionValidationError.class,
                () -> service.validateMissionRequest(badLat, dropoff, 1.0)
        );
        assertTrue(ex.getMessage().contains("coordinates out of range"));
    }

    @Test
    void testInvalidAltitude() {
        Coordinate badAlt = new Coordinate(6.5244, 3.3792, -5.0);
        Coordinate dropoff = new Coordinate(6.5280, 3.3850, 20.0);
        MissionValidationError ex = assertThrows(
                MissionValidationError.class,
                () -> service.validateMissionRequest(badAlt, dropoff, 1.0)
        );
        assertTrue(ex.getMessage().contains("altitude must be positive"));
    }

    @Test
    void testNegativePayloadWeight() {
        Coordinate pickup = new Coordinate(6.5244, 3.3792, 25.0);
        Coordinate dropoff = new Coordinate(6.5280, 3.3850, 20.0);
        MissionValidationError ex = assertThrows(
                MissionValidationError.class,
                () -> service.validateMissionRequest(pickup, dropoff, -2.0)
        );
        assertTrue(ex.getMessage().contains("payload_weight_kg cannot be negative"));
    }

    @Test
    void testHaversineDistance() {
        // Distance between two known points in Lagos
        double lat1 = 6.5244;
        double lon1 = 3.3792;
        double lat2 = 6.5280;
        double lon2 = 3.3850;

        double distance = FleetOrchestratorService.haversineM(lat1, lon1, lat2, lon2);
        assertTrue(distance > 700 && distance < 800, "Distance should be ~750m, got: " + distance);
    }
}
