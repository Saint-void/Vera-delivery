package com.vera.vella.exception;

public class MissionValidationError extends RuntimeException {
    public MissionValidationError(String message) {
        super(message);
    }
}
