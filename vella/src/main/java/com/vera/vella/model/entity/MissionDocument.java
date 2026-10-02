package com.vera.vella.model.entity;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.vera.vella.model.dto.Coordinate;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@Document(collection = "missions")
@JsonInclude(JsonInclude.Include.ALWAYS)
public class MissionDocument {

    @Id
    @JsonProperty("mission_id")
    private String missionId;

    @JsonProperty("drone_id")
    private String droneId;

    @JsonProperty("status")
    private String status = "QUEUED";

    @JsonProperty("assignment_state")
    private String assignmentState = "UNASSIGNED";

    @JsonProperty("pickup")
    private Coordinate pickup;

    @JsonProperty("dropoff")
    private Coordinate dropoff;

    @JsonProperty("payload_weight_kg")
    private double payloadWeightKg;

    @JsonProperty("delivery_confirmed")
    private boolean deliveryConfirmed = false;

    @JsonProperty("created_at")
    private String createdAt;

    @JsonProperty("assigned_at")
    private String assignedAt;

    @JsonProperty("completed_at")
    private String completedAt;

    @JsonProperty("history")
    private List<FlightLogEntry> history = new ArrayList<>();

    public MissionDocument() {}

    public MissionDocument(String missionId, Coordinate pickup, Coordinate dropoff, double payloadWeightKg) {
        this.missionId = missionId;
        this.pickup = pickup;
        this.dropoff = dropoff;
        this.payloadWeightKg = payloadWeightKg;
        this.createdAt = Instant.now().toString();
    }

    public String getMissionId() {
        return missionId;
    }

    public void setMissionId(String missionId) {
        this.missionId = missionId;
    }

    public String getDroneId() {
        return droneId;
    }

    public void setDroneId(String droneId) {
        this.droneId = droneId;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getAssignmentState() {
        return assignmentState;
    }

    public void setAssignmentState(String assignmentState) {
        this.assignmentState = assignmentState;
    }

    public Coordinate getPickup() {
        return pickup;
    }

    public void setPickup(Coordinate pickup) {
        this.pickup = pickup;
    }

    public Coordinate getDropoff() {
        return dropoff;
    }

    public void setDropoff(Coordinate dropoff) {
        this.dropoff = dropoff;
    }

    public double getPayloadWeightKg() {
        return payloadWeightKg;
    }

    public void setPayloadWeightKg(double payloadWeightKg) {
        this.payloadWeightKg = payloadWeightKg;
    }

    public boolean isDeliveryConfirmed() {
        return deliveryConfirmed;
    }

    public void setDeliveryConfirmed(boolean deliveryConfirmed) {
        this.deliveryConfirmed = deliveryConfirmed;
    }

    public String getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(String createdAt) {
        this.createdAt = createdAt;
    }

    public String getAssignedAt() {
        return assignedAt;
    }

    public void setAssignedAt(String assignedAt) {
        this.assignedAt = assignedAt;
    }

    public String getCompletedAt() {
        return completedAt;
    }

    public void setCompletedAt(String completedAt) {
        this.completedAt = completedAt;
    }

    public List<FlightLogEntry> getHistory() {
        return history;
    }

    public void setHistory(List<FlightLogEntry> history) {
        this.history = history;
    }
}
