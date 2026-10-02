# Vella (Spring Boot + MongoDB)

Vella is the centralized fleet management backend and mission coordinator for autonomous delivery drones running **Vera**.

Vera is an independent flight-side process (on the drone companion computer) connecting to ArduPilot via MAVLink. **Vella is purely the cloud/server fleet backend and reporting API**; it communicates with Vera drones strictly over HTTP/JSON and persistent WebSockets.

---

## Architecture

Vella maintains a fleet registry in **MongoDB** (`drones`, `missions`, and `telemetry` collections):
* **Registration**: On startup and periodically, each Vera drone posts its identity to `POST /drones`.
* **Telemetry Streaming**: Drones maintain a persistent WebSocket stream at `/ws/telemetry/{drone_id}` pushing telemetry frames in real-time.
* **Dispatch & Nearest Drone**: When a mission is submitted without specifying a drone (`POST /missions`), Vella evaluates battery reserve ($\ge 40\%$) and calculates Haversine distance from the pickup location to select the nearest available drone.
* **Mission Assignment**: Vella atomically assigns the drone and posts the mission to Vera's `POST /missions` endpoint.
* **Live SSE Broadcast**: Operator dashboards (like the Next.js **Vera App**) connect to `GET /fleet/stream` via Server-Sent Events (SSE) to receive real-time updates without polling.

---

## Tech Stack & Prerequisites

* **Java**: OpenJDK 21+
* **Build Tool**: Apache Maven 3.9+
* **Framework**: Spring Boot 3.3.4 (with Java 21 Virtual Threads)
* **Database**: MongoDB 6+ / 7+ (local or MongoDB Atlas)

---

## Running Vella

### 1. Ensure MongoDB is Running
Locally via Docker or brew:
```bash
docker run -d --name mongodb -p 27017:27017 mongo:7
```
Or set your Atlas / remote connection string:
```bash
export SPRING_DATA_MONGODB_URI="mongodb://localhost:27017/vella_fleet"
```

### 2. Start Vella
From the `vella/` directory:
```bash
mvn spring-boot:run
```
By default, Vella starts on port **8000** (`http://127.0.0.1:8000`), matching what Vera drones and the Next.js frontend proxy expect.

To build an executable jar:
```bash
mvn clean package -DskipTests
java -jar target/vella-0.1.0.jar
```

---

## Configuration Properties (`application.properties`)

| Property | Default | Description |
| :--- | :--- | :--- |
| `server.port` | `8000` | HTTP port for REST, SSE, and WebSockets |
| `spring.data.mongodb.uri` | `mongodb://localhost:27017/vella_fleet` | MongoDB connection URI |
| `vella.mission.min-battery-pct` | `40` | Minimum battery percentage to accept missions |
| `vella.telemetry.stale-timeout-seconds` | `5.0` | Heartbeat stale timeout |
| `spring.threads.virtual.enabled` | `true` | Java 21 Virtual Threads for high-concurrency SSE & WebSockets |

---

## API Endpoints

### Missions
* `POST /missions`: Submit a delivery mission (202 Accepted).
* `GET /missions`: List all missions.
* `GET /missions/{mission_id}`: Get mission details.

### Drones
* `GET /drones`: List registered drones.
* `POST /drones`: Register a drone (201 Created / 200 OK).
* `GET /drones/{drone_id}`: Drone status and latest telemetry.
* `GET /drones/{drone_id}/telemetry`: Latest telemetry frame.
* `POST /drones/{drone_id}/command`: Issue flight command (`rtl`, `cancel`, `pause`, `resume`).

### Fleet & Realtime
* `GET /fleet/status`: Fleet statistics (process, total, active, available drones).
* `GET /fleet/stream`: **Server-Sent Events (SSE)** live stream with event name `fleet`.
* `GET /fleet/drones/active`: Active drones.
* `GET /fleet/drones/available`: Available drones with battery reserve.
* `GET /fleet/missions/assigned`: Currently assigned active missions.
* `POST /delivery/{mission_id}/complete`: Operator confirmation of package drop.

### Telemetry WebSocket
* `ws://{host}:{port}/ws/telemetry/{drone_id}`: Persistent WebSocket where Vera drones stream 5–10 Hz telemetry JSON frames.

---

## Running Tests

```bash
mvn test
```
All unit and web mock tests validate coordinate bounds, Haversine geometry, battery rejection rules, and API error formatting.
