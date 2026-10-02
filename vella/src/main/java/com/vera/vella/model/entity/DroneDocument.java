package com.vera.vella.model.entity;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.vera.vella.model.dto.Coordinate;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.Map;

@Document(collection = "drones")
@JsonInclude(JsonInclude.Include.ALWAYS)
public class DroneDocument {

    @Id
    @JsonProperty("drone_id")
    private String droneId;

    @JsonProperty("drone_name")
    private String droneName;

    @JsonProperty("base_url")
    private String baseUrl;

    @JsonProperty("host")
    private String host;

    @JsonProperty("mavlink_connection")
    private String mavlinkConnection;

    @JsonProperty("status")
    private String status = "available";

    @JsonProperty("connected")
    private boolean connected = true;

    @JsonProperty("home_position")
    private Coordinate homePosition;

    @JsonProperty("current_mission_id")
    private String currentMissionId;

    @JsonProperty("metadata")
    private Map<String, Object> metadata;

    @JsonProperty("telemetry")
    private Map<String, Object> telemetry;

    @JsonProperty("updated_at")
    private Instant updatedAt;

    @JsonProperty("last_seen_at")
    private Instant lastSeenAt;

    public DroneDocument() {}

    public DroneDocument(String droneId, String baseUrl) {
        this.droneId = droneId;
        this.baseUrl = baseUrl;
        this.updatedAt = Instant.now();
        this.lastSeenAt = Instant.now();
    }

    public String getDroneId() {
        return droneId;
    }

    public void setDroneId(String droneId) {
        this.droneId = droneId;
    }

    public String getDroneName() {
        return droneName;
    }

    public void setDroneName(String droneName) {
        this.droneName = droneName;
    }

    public String getBaseUrl() {
        return baseUrl;
    }

    public void setBaseUrl(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    public String getHost() {
        return host;
    }

    public void setHost(String host) {
        this.host = host;
    }

    public String getMavlinkConnection() {
        return mavlinkConnection;
    }

    public void setMavlinkConnection(String mavlinkConnection) {
        this.mavlinkConnection = mavlinkConnection;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public boolean isConnected() {
        return connected;
    }

    public void setConnected(boolean connected) {
        this.connected = connected;
    }

    public Coordinate getHomePosition() {
        return homePosition;
    }

    public void setHomePosition(Coordinate homePosition) {
        this.homePosition = homePosition;
    }

    public String getCurrentMissionId() {
        return currentMissionId;
    }

    public void setCurrentMissionId(String currentMissionId) {
        this.currentMissionId = currentMissionId;
    }

    public Map<String, Object> getMetadata() {
        return metadata;
    }

    public void setMetadata(Map<String, Object> metadata) {
        this.metadata = metadata;
    }

    public Map<String, Object> getTelemetry() {
        return telemetry;
    }

    public void setTelemetry(Map<String, Object> telemetry) {
        this.telemetry = telemetry;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }

    public Instant getLastSeenAt() {
        return lastSeenAt;
    }

    public void setLastSeenAt(Instant lastSeenAt) {
        this.lastSeenAt = lastSeenAt;
    }
}
