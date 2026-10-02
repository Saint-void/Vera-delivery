package com.vera.vella.model.dto;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

public record Coordinate(
        @JsonProperty("lat") double lat,
        @JsonProperty("lon") double lon,
        @JsonProperty("alt") double alt
) {
    public static Coordinate fromList(List<Double> list) {
        if (list == null || list.size() < 3) {
            return null;
        }
        return new Coordinate(list.get(0), list.get(1), list.get(2));
    }

    public List<Double> toList() {
        return List.of(lat, lon, alt);
    }
}
