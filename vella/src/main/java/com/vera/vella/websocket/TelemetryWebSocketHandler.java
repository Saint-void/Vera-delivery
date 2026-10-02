package com.vera.vella.websocket;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.vera.vella.service.FleetOrchestratorService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.net.URI;
import java.util.Map;

@Component
public class TelemetryWebSocketHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(TelemetryWebSocketHandler.class);

    private final FleetOrchestratorService orchestrator;
    private final ObjectMapper objectMapper;

    public TelemetryWebSocketHandler(FleetOrchestratorService orchestrator, ObjectMapper objectMapper) {
        this.orchestrator = orchestrator;
        this.objectMapper = objectMapper;
    }

    private String extractDroneId(WebSocketSession session) {
        URI uri = session.getUri();
        if (uri == null) return null;
        String path = uri.getPath();
        int lastSlash = path.lastIndexOf('/');
        if (lastSlash != -1 && lastSlash < path.length() - 1) {
            return path.substring(lastSlash + 1);
        }
        return null;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        String droneId = extractDroneId(session);
        log.info("[vella-ws] Vera '{}' connected (session: {})", droneId, session.getId());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        String droneId = extractDroneId(session);
        if (droneId == null) {
            return;
        }

        try {
            Map<String, Object> payload = objectMapper.readValue(
                    message.getPayload(),
                    new TypeReference<>() {}
            );
            orchestrator.pushTelemetry(droneId, payload);
        } catch (Exception e) {
            log.error("[vella-ws] Error parsing telemetry from '{}': {}", droneId, e.getMessage());
        }
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        String droneId = extractDroneId(session);
        log.warn("[vella-ws] Transport error on session for '{}': {}", droneId, exception.getMessage());
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        String droneId = extractDroneId(session);
        log.info("[vella-ws] Vera '{}' disconnected — marking offline", droneId);
        if (droneId != null) {
            orchestrator.onDroneDisconnected(droneId);
        }
    }
}
