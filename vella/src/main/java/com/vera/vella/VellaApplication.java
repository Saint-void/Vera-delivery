package com.vera.vella;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class VellaApplication {

    public static void main(String[] args) {
        SpringApplication.run(VellaApplication.class, args);
    }
}
