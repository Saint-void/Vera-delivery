package com.vera.vella.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.vera.vella.client.VeraClient;
import com.vera.vella.exception.MissionAlreadyExistsException;
import com.vera.vella.exception.MissionValidationError;
import com.vera.vella.exception.VeraClientException;
import com.vera.vella.exception.VeraUnavailableException;
import com.vera.vella.model.dto.*;
import com.vera.vella.model.entity.DroneDocument;
import com.vera.vella.model.entity.FlightLogEntry;
import com.vera.vella.model.entity.MissionDocument;
import com.vera.vella.model.entity.TelemetryDocument;
import com.vera.vella.repository.DroneRepository;
import com.vera.vella.repository.MissionRepository;
import com.vera.vella.repository.TelemetryRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicLong;

@Service
public class FleetOrchestratorService {

    private static final Logger log = LoggerFactory.getLogger(FleetOrchestratorService.class);

    private static final Set<String> ACTIVE_MISSION_STATUSES = Set.of(
            "PREPARING", "TAKEOFF", "EN_ROUTE", "DELIVERY", "RETURNING", "LANDING"
    );
    private static final Set<String> TERMINAL_MISSION_STATUSES = Set.of(
            "LANDED", "COMPLETED", "ABORTED", "EMERGENCY", "REJECTED"
    );

    private final DroneRepository droneRepository;
    private final MissionRepository missionRepository;
    private final TelemetryRepository telemetryRepository;
    private final VeraClient veraClient;
    private final ObjectMapper objectMapper;

    @Value("${vella.mission.min-battery-pct:40}")
    private int minBatteryPct;

    @Value("${vella.telemetry.stale-timeout-seconds:5.0}")
    private double staleTimeoutSeconds;

    private final AtomicLong fleetVersion = new AtomicLong(0);
    private final List<SseEmitter> sseEmitters = new CopyOnWriteArrayList<>();
    private final Map<String, DroneDocument> liveDrones = new ConcurrentHashMap<>();

    public FleetOrchestratorService(
            DroneRepository droneRepository,
            MissionRepository missionRepository,
            TelemetryRepository telemetryRepository,
            VeraClient veraClient,
            ObjectMapper objectMapper
    ) {
        this.droneRepository = droneRepository;
        this.missionRepository = missionRepository;
        this.telemetryRepository = telemetryRepository;
        this.veraClient = veraClient;
        this.objectMapper = objectMapper;
    }

    public static double haversineM(double lat1, double lon1, double lat2, double lon2) {
        final double R = 6371000.0;
        double phi1 = Math.toRadians(lat1);
        double phi2 = Math.toRadians(lat2);
        double deltaPhi = Math.toRadians(lat2 - lat1);
        double deltaLambda = Math.toRadians(lon2 - lon1);

        double a = Math.sin(deltaPhi / 2.0) * Math.sin(deltaPhi / 2.0)
                + Math.cos(phi1) * Math.cos(phi2)
                * Math.sin(deltaLambda / 2.0) * Math.sin(deltaLambda / 2.0);
        double c = 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(1.0 - a));
        return R * c;
    }

    public void validateCoordinates(Coordinate point, String name) {
        if (point == null) {
            throw new MissionValidationError(name + " coordinate must not be null");
        }
        if (point.lat() < -90 || point.lat() > 90 || point.lon() < -180 || point.lon() > 180) {
            throw new MissionValidationError(String.format("%s coordinates out of range: (%f, %f, %f)",
                    name, point.lat(), point.lon(), point.alt()));
        }
        if (point.alt() <= 0) {
            throw new MissionValidationError(String.format("%s altitude must be positive, got %f", name, point.alt()));
        }
    }

    public void validateMissionRequest(Coordinate pickup, Coordinate dropoff, double payloadWeightKg) {
        if (pickup != null) {
            validateCoordinates(pickup, "pickup");
        }
        validateCoordinates(dropoff, "dropoff");
        if (payloadWeightKg < 0) {
            throw new MissionValidationError(String.format("payload_weight_kg cannot be negative: %f", payloadWeightKg));
        }
    }

    // -------------------------------------------------------------
    // Drone Management
    // -------------------------------------------------------------

    public record DroneRegisterResult(DroneDocument drone, boolean created) {}

    public DroneRegisterResult registerDrone(RegisterDroneRequest request) {
        Optional<DroneDocument> existingOpt = droneRepository.findById(request.droneId());
        boolean created = existingOpt.isEmpty();
        DroneDocument drone = existingOpt.orElseGet(() -> new DroneDocument(request.droneId(), request.baseUrl()));

        drone.setBaseUrl(request.baseUrl());
        if (request.droneName() != null) drone.setDroneName(request.droneName());
        if (request.host() != null) drone.setHost(request.host());
        if (request.mavlinkConnection() != null) drone.setMavlinkConnection(request.mavlinkConnection());
        if (request.homePosition() != null) drone.setHomePosition(request.homePosition());
        drone.setStatus(request.safeStatus());
        drone.setConnected(request.safeConnected());
        drone.setUpdatedAt(Instant.now());
        drone.setLastSeenAt(Instant.now());

        DroneDocument saved = droneRepository.save(drone);
        liveDrones.put(saved.getDroneId(), saved);
        notifyFleetChange();

        return new DroneRegisterResult(saved, created);
    }

    public List<DroneDocument> listDrones() {
        return droneRepository.findAll();
    }

    public Optional<DroneDocument> getDrone(String droneId) {
        return droneRepository.findById(droneId);
    }

    public List<DroneDocument> listAvailableDrones() {
        return droneRepository.findByStatusAndConnected("available", true);
    }

    public List<DroneDocument> listActiveDrones() {
        return droneRepository.findByStatusIn(List.of("busy", "returning", "landed"));
    }

    public void onDroneDisconnected(String droneId) {
        droneRepository.findById(droneId).ifPresent(drone -> {
            drone.setConnected(false);
            drone.setStatus("offline");
            drone.setCurrentMissionId(null);
            drone.setUpdatedAt(Instant.now());
            droneRepository.save(drone);
            liveDrones.put(droneId, drone);
            notifyFleetChange();
            log.info("[vella] Drone {} marked offline due to disconnect", droneId);
        });
    }

    // -------------------------------------------------------------
    // Telemetry Ingestion (WebSocket & REST)
    // -------------------------------------------------------------

    public void pushTelemetry(String droneId, Map<String, Object> payload) {
        Optional<DroneDocument> droneOpt = droneRepository.findById(droneId);
        if (droneOpt.isEmpty()) {
            return;
        }

        DroneDocument drone = droneOpt.get();
        Map<String, Object> telemetryMap = new HashMap<>(payload);
        String timestamp = (String) payload.getOrDefault("timestamp", Instant.now().toString());

        TelemetryDocument telemetryDoc = new TelemetryDocument();
        telemetryDoc.setDroneId(droneId);
        telemetryDoc.setMissionId((String) payload.get("current_mission_id"));
        telemetryDoc.setTimestamp(timestamp);

        if (payload.get("latitude") instanceof Number n) telemetryDoc.setLatitude(n.doubleValue());
        if (payload.get("longitude") instanceof Number n) telemetryDoc.setLongitude(n.doubleValue());
        if (payload.get("altitude_m") instanceof Number n) telemetryDoc.setAltitudeM(n.doubleValue());
        if (payload.get("groundspeed_ms") instanceof Number n) telemetryDoc.setGroundspeedMs(n.doubleValue());
        if (payload.get("vertical_speed_ms") instanceof Number n) telemetryDoc.setVerticalSpeedMs(n.doubleValue());
        if (payload.get("heading_deg") instanceof Number n) telemetryDoc.setHeadingDeg(n.doubleValue());
        if (payload.get("battery_pct") instanceof Number n) telemetryDoc.setBatteryPct(n.intValue());
        if (payload.get("battery_voltage_v") instanceof Number n) telemetryDoc.setBatteryVoltageV(n.doubleValue());
        if (payload.get("battery_low") instanceof Boolean b) telemetryDoc.setBatteryLow(b);
        telemetryDoc.setBatteryStatusText((String) payload.get("battery_status_text"));
        telemetryDoc.setFlightMode((String) payload.get("flight_mode"));
        if (payload.get("armed") instanceof Boolean b) telemetryDoc.setArmed(b);
        if (payload.get("gps_fix_type") instanceof Number n) telemetryDoc.setGpsFixType(n.intValue());
        if (payload.get("satellites_visible") instanceof Number n) telemetryDoc.setSatellitesVisible(n.intValue());

        telemetryRepository.save(telemetryDoc);

        drone.setConnected(true);
        drone.setTelemetry(telemetryMap);
        drone.setLastSeenAt(Instant.now());
        drone.setUpdatedAt(Instant.now());

        String missionState = (String) payload.get("mission_state");
        drone.setStatus(deriveDroneStatus(missionState, payload.get("current_mission_id")));
        if (payload.get("current_mission_id") != null) {
            drone.setCurrentMissionId((String) payload.get("current_mission_id"));
        }

        droneRepository.save(drone);
        liveDrones.put(droneId, drone);
        notifyFleetChange();
    }

    private String deriveDroneStatus(String missionState, Object currentMissionId) {
        if (missionState == null) {
            return currentMissionId != null ? "busy" : "available";
        }
        return switch (missionState.toUpperCase()) {
            case "PREPARING", "TAKEOFF", "EN_ROUTE", "DELIVERY" -> "busy";
            case "RETURNING" -> "returning";
            case "LANDING", "LANDED" -> "landed";
            case "ABORTED", "EMERGENCY", "REJECTED" -> "error";
            default -> currentMissionId != null ? "busy" : "available";
        };
    }

    // -------------------------------------------------------------
    // Mission Management & Dispatch
    // -------------------------------------------------------------

    public MissionDocument submitMission(CreateMissionRequest request) {
        Coordinate pickup = request.pickup();
        Coordinate dropoff = request.dropoff();
        double weight = request.safePayloadWeight();

        validateMissionRequest(pickup, dropoff, weight);

        if (pickup == null) {
            return submitDropoffMission(request.missionId(), dropoff, weight, request.droneId());
        }

        List<DroneDocument> candidates = selectCandidates(pickup, request.droneId());
        return dispatchToCandidates(request.missionId(), pickup, dropoff, weight, candidates);
    }

    public MissionDocument submitDropoffMission(String missionId, Coordinate dropoff, double payloadWeightKg, String requestedDroneId) {
        validateMissionRequest(dropoff, dropoff, payloadWeightKg);

        List<DroneDocument> candidates = selectCandidates(dropoff, requestedDroneId);
        if (candidates.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "no available drones");
        }

        DroneDocument selectedDrone = candidates.get(0);
        Coordinate launchPoint = determineLaunchPoint(selectedDrone, dropoff.alt());
        if (launchPoint == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "drone has no current position or configured home position: " + selectedDrone.getDroneId());
        }

        validateMissionRequest(launchPoint, dropoff, payloadWeightKg);
        return dispatchToCandidates(missionId, launchPoint, dropoff, payloadWeightKg, List.of(selectedDrone));
    }

    private Coordinate determineLaunchPoint(DroneDocument drone, double altitude) {
        Map<String, Object> telem = drone.getTelemetry();
        if (telem != null && telem.get("latitude") instanceof Number lat && telem.get("longitude") instanceof Number lon) {
            return new Coordinate(lat.doubleValue(), lon.doubleValue(), altitude);
        }
        if (drone.getHomePosition() != null) {
            return new Coordinate(drone.getHomePosition().lat(), drone.getHomePosition().lon(), altitude);
        }
        return null;
    }

    private List<DroneDocument> selectCandidates(Coordinate target, String requestedDroneId) {
        syncAllDrones();

        List<DroneDocument> available = droneRepository.findByStatusAndConnected("available", true);

        if (requestedDroneId != null) {
            DroneDocument targetDrone = droneRepository.findById(requestedDroneId)
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.CONFLICT, "drone not found: " + requestedDroneId));

            validateBattery(targetDrone);

            if (!"available".equalsIgnoreCase(targetDrone.getStatus()) || !targetDrone.isConnected()) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "drone is not available: " + requestedDroneId);
            }
            return List.of(targetDrone);
        }

        List<CandidateDistance> scored = new ArrayList<>();
        List<DroneDocument> unknownDist = new ArrayList<>();

        for (DroneDocument drone : available) {
            if (!hasBatteryReserve(drone)) {
                continue;
            }
            Double dist = distanceToPoint(drone, target);
            if (dist == null) {
                unknownDist.add(drone);
            } else {
                scored.add(new CandidateDistance(dist, drone));
            }
        }

        scored.sort(Comparator.comparingDouble(CandidateDistance::distance));
        List<DroneDocument> sorted = new ArrayList<>(scored.stream().map(CandidateDistance::drone).toList());
        sorted.addAll(unknownDist);
        return sorted;
    }

    private record CandidateDistance(double distance, DroneDocument drone) {}

    private Double distanceToPoint(DroneDocument drone, Coordinate target) {
        Map<String, Object> telem = drone.getTelemetry();
        if (telem != null && telem.get("latitude") instanceof Number lat && telem.get("longitude") instanceof Number lon) {
            return haversineM(lat.doubleValue(), lon.doubleValue(), target.lat(), target.lon());
        }
        if (drone.getHomePosition() != null) {
            return haversineM(drone.getHomePosition().lat(), drone.getHomePosition().lon(), target.lat(), target.lon());
        }
        return null;
    }

    private boolean hasBatteryReserve(DroneDocument drone) {
        Map<String, Object> telem = drone.getTelemetry();
        if (telem == null || telem.get("battery_pct") == null) {
            return true;
        }
        if (telem.get("battery_pct") instanceof Number n) {
            return n.intValue() >= minBatteryPct;
        }
        return true;
    }

    private void validateBattery(DroneDocument drone) {
        Map<String, Object> telem = drone.getTelemetry();
        if (telem != null && telem.get("battery_pct") instanceof Number n) {
            if (n.intValue() < minBatteryPct) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        String.format("drone %s cannot accept a mission: battery is %d%% and needs charging (minimum launch battery is %d%%)",
                                drone.getDroneId(), n.intValue(), minBatteryPct));
            }
        }
    }

    private MissionDocument dispatchToCandidates(
            String missionId,
            Coordinate pickup,
            Coordinate dropoff,
            double weight,
            List<DroneDocument> candidates
    ) {
        Optional<MissionDocument> existingOpt = missionRepository.findById(missionId);
        if (existingOpt.isPresent()) {
            MissionDocument existing = existingOpt.get();
            if (existing.getPickup() != null && !existing.getPickup().equals(pickup)
                    || !existing.getDropoff().equals(dropoff)
                    || Double.compare(existing.getPayloadWeightKg(), weight) != 0) {
                throw new MissionAlreadyExistsException("mission_id already exists with a different definition");
            }
            if (existing.getDroneId() != null) {
                return existing;
            }
        }

        MissionDocument mission = existingOpt.orElseGet(() ->
                missionRepository.save(new MissionDocument(missionId, pickup, dropoff, weight)));

        for (DroneDocument drone : candidates) {
            String droneId = drone.getDroneId();
            mission.setDroneId(droneId);
            mission.setAssignmentState("ASSIGNED");
            mission.setAssignedAt(Instant.now().toString());
            missionRepository.save(mission);

            drone.setCurrentMissionId(missionId);
            drone.setStatus("busy");
            droneRepository.save(drone);

            Map<String, Object> payload = Map.of(
                    "mission_id", missionId,
                    "pickup", pickup.toList(),
                    "dropoff", dropoff.toList(),
                    "payload_weight_kg", weight,
                    "requested_at", Instant.now().toString()
            );

            try {
                JsonNode response = veraClient.createMission(drone.getBaseUrl(), payload);
                syncMissionFromVera(missionId, droneId, response);
                notifyFleetChange();
                return missionRepository.findById(missionId).orElse(mission);
            } catch (VeraUnavailableException e) {
                log.warn("Vera drone {} is unavailable, trying next candidate", droneId);
                drone.setStatus("offline");
                drone.setConnected(false);
                drone.setCurrentMissionId(null);
                droneRepository.save(drone);

                mission.setDroneId(null);
                mission.setAssignmentState("UNASSIGNED");
                missionRepository.save(mission);
            } catch (VeraClientException e) {
                mission.setDroneId(null);
                mission.setAssignmentState("UNASSIGNED");
                missionRepository.save(mission);
                throw e;
            } catch (Exception e) {
                mission.setDroneId(null);
                mission.setAssignmentState("UNASSIGNED");
                missionRepository.save(mission);
                throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, e.getMessage(), e);
            }
        }

        throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "no available drones");
    }

    private void syncMissionFromVera(String missionId, String droneId, JsonNode snapshot) {
        missionRepository.findById(missionId).ifPresent(mission -> {
            if (snapshot.has("status")) {
                mission.setStatus(snapshot.get("status").asText());
            }
            if (snapshot.has("history") && snapshot.get("history").isArray()) {
                List<FlightLogEntry> logs = new ArrayList<>();
                for (JsonNode item : snapshot.get("history")) {
                    logs.add(new FlightLogEntry(
                            item.has("status") ? item.get("status").asText() : null,
                            item.has("timestamp") ? item.get("timestamp").asText() : null,
                            item.has("reason") ? item.get("reason").asText() : null,
                            item.has("event_type") ? item.get("event_type").asText() : "STATE",
                            item.has("details") ? objectMapper.convertValue(item.get("details"), Map.class) : null,
                            item.has("event_time_utc") ? item.get("event_time_utc").asText() : null,
                            item.has("telemetry_sample_time_utc") ? item.get("telemetry_sample_time_utc").asText() : null,
                            item.has("autopilot_time_boot_ms") ? item.get("autopilot_time_boot_ms").asLong() : null,
                            item.has("command_ack_time_utc") ? item.get("command_ack_time_utc").asText() : null
                    ));
                }
                mission.setHistory(logs);
            }
            missionRepository.save(mission);
        });
    }

    public List<MissionDocument> listMissions() {
        return missionRepository.findAll();
    }

    public Optional<MissionDocument> getMission(String missionId) {
        return missionRepository.findById(missionId);
    }

    public List<MissionDocument> listAssignedMissions() {
        return missionRepository.findByDroneIdIsNotNullAndStatusIn(new ArrayList<>(ACTIVE_MISSION_STATUSES));
    }

    public MissionDocument confirmDelivery(String missionId) {
        return missionRepository.findById(missionId).map(mission -> {
            mission.setDeliveryConfirmed(true);
            MissionDocument saved = missionRepository.save(mission);
            notifyFleetChange();
            return saved;
        }).orElse(null);
    }

    // -------------------------------------------------------------
    // Commands
    // -------------------------------------------------------------

    public void sendCommand(String droneId, String command, String missionId) {
        DroneDocument drone = droneRepository.findById(droneId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "drone not found"));

        veraClient.command(drone.getBaseUrl(), command, missionId);
        notifyFleetChange();
    }

    // -------------------------------------------------------------
    // Fleet Status & SSE Stream
    // -------------------------------------------------------------

    public FleetStatusResponse getFleetStatus() {
        List<DroneDocument> drones = droneRepository.findAll();
        List<MissionDocument> missions = missionRepository.findAll();

        int activeDrones = (int) drones.stream()
                .filter(d -> Set.of("busy", "returning", "landed").contains(d.getStatus()))
                .count();

        int availableDrones = (int) drones.stream()
                .filter(d -> "available".equalsIgnoreCase(d.getStatus()) && d.isConnected())
                .count();

        int assignedMissions = (int) missions.stream()
                .filter(m -> m.getDroneId() != null && ACTIVE_MISSION_STATUSES.contains(m.getStatus()))
                .count();

        List<String> droneIds = drones.stream().map(DroneDocument::getDroneId).toList();

        return new FleetStatusResponse(
                "vella",
                drones.size(),
                activeDrones,
                availableDrones,
                assignedMissions,
                droneIds,
                drones
        );
    }

    public FleetSnapshot getFleetSnapshot() {
        return new FleetSnapshot(droneRepository.findAll(), missionRepository.findAll());
    }

    public SseEmitter subscribeFleetStream() {
        SseEmitter emitter = new SseEmitter(Long.MAX_VALUE);
        sseEmitters.add(emitter);

        emitter.onCompletion(() -> sseEmitters.remove(emitter));
        emitter.onTimeout(() -> sseEmitters.remove(emitter));
        emitter.onError(e -> sseEmitters.remove(emitter));

        // Immediately send current snapshot
        try {
            FleetSnapshot snapshot = getFleetSnapshot();
            String json = objectMapper.writeValueAsString(snapshot);
            emitter.send(SseEmitter.event().name("fleet").data(json));
        } catch (IOException e) {
            emitter.complete();
            sseEmitters.remove(emitter);
        }

        return emitter;
    }

    public void notifyFleetChange() {
        fleetVersion.incrementAndGet();
        FleetSnapshot snapshot = getFleetSnapshot();

        for (SseEmitter emitter : sseEmitters) {
            try {
                String json = objectMapper.writeValueAsString(snapshot);
                emitter.send(SseEmitter.event().name("fleet").data(json));
            } catch (Exception e) {
                emitter.complete();
                sseEmitters.remove(emitter);
            }
        }
    }

    @Scheduled(fixedRate = 15000)
    public void sendHeartbeat() {
        for (SseEmitter emitter : sseEmitters) {
            try {
                emitter.send(SseEmitter.event().comment("keep-alive"));
            } catch (Exception e) {
                emitter.complete();
                sseEmitters.remove(emitter);
            }
        }
    }

    public void syncAllDrones() {
        // Polls health on registered drones if needed
        List<DroneDocument> drones = droneRepository.findAll();
        for (DroneDocument drone : drones) {
            if (drone.getBaseUrl() == null) continue;
            try {
                JsonNode health = veraClient.health(drone.getBaseUrl());
                if (health != null && health.has("connected")) {
                    drone.setConnected(health.get("connected").asBoolean());
                    droneRepository.save(drone);
                }
            } catch (Exception ignored) {
                // Drone may be offline or between network changes
            }
        }
    }
}
