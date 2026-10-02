package com.vera.vella.exception;

public class VeraClientException extends RuntimeException {
    private final int statusCode;

    public VeraClientException(String message, int statusCode) {
        super(message);
        this.statusCode = statusCode;
    }

    public int getStatusCode() {
        return statusCode;
    }
}
