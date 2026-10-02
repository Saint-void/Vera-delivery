package com.vera.vella.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.vera.vella.exception.VeraClientException;
import com.vera.vella.exception.VeraUnavailableException;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;

import java.time.Duration;
import java.util.Map;

@Component
public class VeraClient {

    private final ObjectMapper objectMapper;
    private final RestClient restClient;

    public VeraClient(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(Duration.ofSeconds(2));
        requestFactory.setReadTimeout(Duration.ofSeconds(3));

        this.restClient = RestClient.builder()
                .requestFactory(requestFactory)
                .build();
    }

    private String normalizeUrl(String baseUrl, String path) {
        if (baseUrl == null || baseUrl.isBlank()) {
            throw new IllegalArgumentException("a registered Vera base_url is required");
        }
        String cleaned = baseUrl.replaceAll("/+$", "");
        return cleaned + path;
    }

    public JsonNode health(String baseUrl) {
        return executeGet(normalizeUrl(baseUrl, "/health"));
    }

    public JsonNode missions(String baseUrl) {
        return executeGet(normalizeUrl(baseUrl, "/missions"));
    }

    public JsonNode mission(String baseUrl, String missionId) {
        return executeGet(normalizeUrl(baseUrl, "/missions/" + missionId));
    }

    public JsonNode createMission(String baseUrl, Object payload) {
        return executePost(normalizeUrl(baseUrl, "/missions"), payload);
    }

    public JsonNode command(String baseUrl, String command, String missionId) {
        Map<String, String> body = missionId != null
                ? Map.of("command", command, "mission_id", missionId)
                : Map.of("command", command);
        return executePost(normalizeUrl(baseUrl, "/commands"), body);
    }

    private JsonNode executeGet(String url) {
        try {
            return restClient.get()
                    .uri(url)
                    .accept(MediaType.APPLICATION_JSON)
                    .exchange((request, response) -> {
                        HttpStatusCode status = response.getStatusCode();
                        if (status.is4xxClientError()) {
                            String errorBody = new String(response.getBody().readAllBytes());
                            String detail = extractDetail(errorBody, status.value());
                            throw new VeraClientException(detail, status.value());
                        }
                        if (status.isError()) {
                            throw new VeraUnavailableException("Vera returned error status: " + status.value());
                        }
                        return objectMapper.readTree(response.getBody());
                    });
        } catch (VeraClientException | VeraUnavailableException e) {
            throw e;
        } catch (ResourceAccessException e) {
            throw new VeraUnavailableException("Vera is unavailable: " + e.getMessage(), e);
        } catch (Exception e) {
            throw new VeraUnavailableException("Vera communication error: " + e.getMessage(), e);
        }
    }

    private JsonNode executePost(String url, Object body) {
        try {
            return restClient.post()
                    .uri(url)
                    .contentType(MediaType.APPLICATION_JSON)
                    .accept(MediaType.APPLICATION_JSON)
                    .body(body)
                    .exchange((request, response) -> {
                        HttpStatusCode status = response.getStatusCode();
                        if (status.is4xxClientError()) {
                            String errorBody = new String(response.getBody().readAllBytes());
                            String detail = extractDetail(errorBody, status.value());
                            throw new VeraClientException(detail, status.value());
                        }
                        if (status.isError()) {
                            throw new VeraUnavailableException("Vera returned error status: " + status.value());
                        }
                        return objectMapper.readTree(response.getBody());
                    });
        } catch (VeraClientException | VeraUnavailableException e) {
            throw e;
        } catch (ResourceAccessException e) {
            throw new VeraUnavailableException("Vera is unavailable: " + e.getMessage(), e);
        } catch (Exception e) {
            throw new VeraUnavailableException("Vera communication error: " + e.getMessage(), e);
        }
    }

    private String extractDetail(String body, int statusCode) {
        try {
            JsonNode node = objectMapper.readTree(body);
            if (node.has("detail")) {
                return node.get("detail").asText();
            }
            return body.isBlank() ? "HTTP " + statusCode : body;
        } catch (Exception e) {
            return body.isBlank() ? "HTTP " + statusCode : body;
        }
    }
}
