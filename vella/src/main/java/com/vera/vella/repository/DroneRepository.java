package com.vera.vella.repository;

import com.vera.vella.model.entity.DroneDocument;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface DroneRepository extends MongoRepository<DroneDocument, String> {
    List<DroneDocument> findByStatus(String status);
    List<DroneDocument> findByStatusAndConnected(String status, boolean connected);
    List<DroneDocument> findByStatusIn(List<String> statuses);
}
