# Multi-stage lightweight image for Vera Autonomous Companion Daemon
FROM python:3.11-slim AS builder

WORKDIR /app

# Install build dependencies for pymavlink if needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Final runtime image
FROM python:3.11-slim AS runner

WORKDIR /app

# Install curl for container health check
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy installed Python packages from builder
COPY --from=builder /root/.local /root/.local
ENV PATH=/root/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    VERA_HOST=0.0.0.0 \
    VERA_PORT=8765

# Copy application source
COPY vera/ ./vera/

# Expose HTTP API port
EXPOSE 8765

# Container health probe
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8765/health || exit 1

# Launch independent companion daemon
CMD ["python", "-m", "vera"]
