package com.vera.vella.repository;

import com.vera.vella.model.entity.TelemetryDocument;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface TelemetryRepository extends MongoRepository<TelemetryDocument, String> {
    Optional<TelemetryDocument> findFirstByDroneIdOrderByTimestampDesc(String droneId);
    Optional<TelemetryDocument> findFirstByMissionIdOrderByTimestampDesc(String missionId);
    Optional<TelemetryDocument> findFirstByOrderByTimestampDesc();
}
