package com.vera.vella.repository;

import com.vera.vella.model.entity.MissionDocument;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface MissionRepository extends MongoRepository<MissionDocument, String> {
    List<MissionDocument> findByStatusIn(List<String> statuses);
    List<MissionDocument> findByDroneIdIsNotNullAndStatusIn(List<String> statuses);
    Optional<MissionDocument> findFirstByStatusInOrderByCreatedAtAsc(List<String> statuses);
}
