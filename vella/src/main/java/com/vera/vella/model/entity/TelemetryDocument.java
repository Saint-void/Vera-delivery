package com.vera.vella.model.entity;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.Map;

@Document(collection = "telemetry")
@JsonInclude(JsonInclude.Include.ALWAYS)
public class TelemetryDocument {

    @Id
    private String id;

    @Indexed
    @JsonProperty("drone_id")
    private String droneId;

    @Indexed
    @JsonProperty("mission_id")
    private String missionId;

    @Indexed
    @JsonProperty("timestamp")
    private String timestamp;

    @JsonProperty("latitude")
    private Double latitude;

    @JsonProperty("longitude")
    private Double longitude;

    @JsonProperty("altitude_m")
    private Double altitudeM;

    @JsonProperty("groundspeed_ms")
    private Double groundspeedMs;

    @JsonProperty("vertical_speed_ms")
    private Double verticalSpeedMs;

    @JsonProperty("heading_deg")
    private Double headingDeg;

    @JsonProperty("battery_pct")
    private Integer batteryPct;

    @JsonProperty("battery_voltage_v")
    private Double batteryVoltageV;

    @JsonProperty("battery_low")
    private boolean batteryLow;

    @JsonProperty("battery_status_text")
    private String batteryStatusText;

    @JsonProperty("flight_mode")
    private String flightMode;

    @JsonProperty("armed")
    private Boolean armed;

    @JsonProperty("gps_fix_type")
    private Integer gpsFixType;

    @JsonProperty("satellites_visible")
    private Integer satellitesVisible;

    @JsonProperty("gps_receivers")
    private Map<String, Object> gpsReceivers;

    @JsonProperty("autopilot_time_boot_ms")
    private Long autopilotTimeBootMs;

    @JsonProperty("autopilot_time_usec")
    private Long autopilotTimeUsec;

    public TelemetryDocument() {}

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getDroneId() {
        return droneId;
    }

    public void setDroneId(String droneId) {
        this.droneId = droneId;
    }

    public String getMissionId() {
        return missionId;
    }

    public void setMissionId(String missionId) {
        this.missionId = missionId;
    }

    public String getTimestamp() {
        return timestamp;
    }

    public void setTimestamp(String timestamp) {
        this.timestamp = timestamp;
    }

    public Double getLatitude() {
        return latitude;
    }

    public void setLatitude(Double latitude) {
        this.latitude = latitude;
    }

    public Double getLongitude() {
        return longitude;
    }

    public void setLongitude(Double longitude) {
        this.longitude = longitude;
    }

    public Double getAltitudeM() {
        return altitudeM;
    }

    public void setAltitudeM(Double altitudeM) {
        this.altitudeM = altitudeM;
    }

    public Double getGroundspeedMs() {
        return groundspeedMs;
    }

    public void setGroundspeedMs(Double groundspeedMs) {
        this.groundspeedMs = groundspeedMs;
    }

    public Double getVerticalSpeedMs() {
        return verticalSpeedMs;
    }

    public void setVerticalSpeedMs(Double verticalSpeedMs) {
        this.verticalSpeedMs = verticalSpeedMs;
    }

    public Double getHeadingDeg() {
        return headingDeg;
    }

    public void setHeadingDeg(Double headingDeg) {
        this.headingDeg = headingDeg;
    }

    public Integer getBatteryPct() {
        return batteryPct;
    }

    public void setBatteryPct(Integer batteryPct) {
        this.batteryPct = batteryPct;
    }

    public Double getBatteryVoltageV() {
        return batteryVoltageV;
    }

    public void setBatteryVoltageV(Double batteryVoltageV) {
        this.batteryVoltageV = batteryVoltageV;
    }

    public boolean isBatteryLow() {
        return batteryLow;
    }

    public void setBatteryLow(boolean batteryLow) {
        this.batteryLow = batteryLow;
    }

    public String getBatteryStatusText() {
        return batteryStatusText;
    }

    public void setBatteryStatusText(String batteryStatusText) {
        this.batteryStatusText = batteryStatusText;
    }

    public String getFlightMode() {
        return flightMode;
    }

    public void setFlightMode(String flightMode) {
        this.flightMode = flightMode;
    }

    public Boolean getArmed() {
        return armed;
    }

    public void setArmed(Boolean armed) {
        this.armed = armed;
    }

    public Integer getGpsFixType() {
        return gpsFixType;
    }

    public void setGpsFixType(Integer gpsFixType) {
        this.gpsFixType = gpsFixType;
    }

    public Integer getSatellitesVisible() {
        return satellitesVisible;
    }

    public void setSatellitesVisible(Integer satellitesVisible) {
        this.satellitesVisible = satellitesVisible;
    }

    public Map<String, Object> getGpsReceivers() {
        return gpsReceivers;
    }

    public void setGpsReceivers(Map<String, Object> gpsReceivers) {
        this.gpsReceivers = gpsReceivers;
    }

    public Long getAutopilotTimeBootMs() {
        return autopilotTimeBootMs;
    }

    public void setAutopilotTimeBootMs(Long autopilotTimeBootMs) {
        this.autopilotTimeBootMs = autopilotTimeBootMs;
    }

    public Long getAutopilotTimeUsec() {
        return autopilotTimeUsec;
    }

    public void setAutopilotTimeUsec(Long autopilotTimeUsec) {
        this.autopilotTimeUsec = autopilotTimeUsec;
    }
}
