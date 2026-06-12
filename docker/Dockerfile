# =============================================================================
# Project Green — Ollama + Qwen2.5 Production Image
# =============================================================================
# Strategy:
#   Stage 1 (model-puller): Start Ollama daemon, pull qwen2.5 weights into
#            /root/.ollama/models, shut daemon down. Weights are now a layer.
#   Stage 2 (runtime): Copy that layer into the final image. The container
#            starts with the model already present — zero runtime download.
# =============================================================================

# ── Stage 1: Bake the model weights ───────────────────────────────────────────
FROM ollama/ollama:latest AS model-puller

# Start daemon in background, wait for it to be ready, pull the model.
# The sleep + retry loop is more robust than a fixed sleep on slow build machines.
RUN ollama serve & \
    SERVER_PID=$! && \
    echo "Waiting for Ollama to start..." && \
    for i in $(seq 1 30); do \
      sleep 2 && \
      curl -sf http://localhost:11434/ && \
      break || echo "Attempt $i/30 — waiting..."; \
    done && \
    echo "Pulling qwen2.5..." && \
    ollama pull qwen2.5 && \
    echo "Model pull complete." && \
    kill $SERVER_PID && \
    wait $SERVER_PID 2>/dev/null || true


# ── Stage 2: Production runtime image ─────────────────────────────────────────
FROM ollama/ollama:latest

# ── Copy baked model weights from Stage 1 ─────────────────────────────────────
COPY --from=model-puller /root/.ollama /root/.ollama

# ── Performance & Reliability Configuration ────────────────────────────────────

# Never unload model from VRAM — eliminates the 2–10s reload penalty on idle
ENV OLLAMA_KEEP_ALIVE="-1"

# Bind to all interfaces (required for Cloud Run health checks & traffic routing)
ENV OLLAMA_HOST="0.0.0.0:11434"

# Number of parallel inference slots per instance
# L4 has 24 GB VRAM; qwen2.5:7b uses ~4.7 GB → up to 4 parallel slots safely
ENV OLLAMA_NUM_PARALLEL="4"

# Max queue depth before returning HTTP 503 (prevents unbounded queue buildup)
ENV OLLAMA_MAX_QUEUE="512"

# Flash Attention — reduces VRAM bandwidth for long context windows
ENV OLLAMA_FLASH_ATTENTION="1"

# Disable progress bars in logs (cleaner Cloud Run log output)
ENV OLLAMA_NOPRUNE="true"

# ── Networking ─────────────────────────────────────────────────────────────────
EXPOSE 11434

# ── Health Check ───────────────────────────────────────────────────────────────
# Cloud Run waits for this to pass before routing live traffic to the instance.
# start-period gives time for the daemon to initialise on cold start.
HEALTHCHECK \
    --interval=10s \
    --timeout=5s \
    --start-period=60s \
    --retries=5 \
    CMD curl -sf http://localhost:11434/ || exit 1

# ── Entrypoint ─────────────────────────────────────────────────────────────────
ENTRYPOINT ["/bin/ollama"]
CMD ["serve"]
