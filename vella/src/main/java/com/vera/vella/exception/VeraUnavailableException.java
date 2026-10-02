package com.vera.vella.exception;

public class VeraUnavailableException extends RuntimeException {
    public VeraUnavailableException(String message) {
        super(message);
    }

    public VeraUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }
}
