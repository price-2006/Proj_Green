#!/usr/bin/env bash
# =============================================================================
# scripts/build-and-push.sh
# Build the Ollama + Qwen2.5 Docker image and push it to Google Container Registry.
#
# Usage:
#   chmod +x scripts/build-and-push.sh
#   ./scripts/build-and-push.sh
#
# Prerequisites:
#   - Docker Desktop running
#   - gcloud auth login && gcloud auth configure-docker
#   - PROJECT_ID set (or passed as first argument)
# =============================================================================
set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────────
PROJECT_ID="${1:-${PROJECT_ID:-"YOUR_PROJECT_ID"}}"
IMAGE_NAME="ollama-qwen25"
TAG="$(date +%Y%m%d-%H%M%S)"       # Timestamp tag for traceability
REGISTRY="gcr.io"
FULL_IMAGE="${REGISTRY}/${PROJECT_ID}/${IMAGE_NAME}"
DOCKERFILE_DIR="$(cd "$(dirname "$0")/../docker" && pwd)"

# ── Validation ─────────────────────────────────────────────────────────────────
if [[ "$PROJECT_ID" == "YOUR_PROJECT_ID" ]]; then
  echo "❌ ERROR: Set PROJECT_ID environment variable or pass it as the first argument."
  echo "   Example: PROJECT_ID=my-gcp-project ./scripts/build-and-push.sh"
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🐳  Building Ollama + Qwen2.5 Image"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Project : $PROJECT_ID"
echo "  Image   : ${FULL_IMAGE}:${TAG}"
echo "  Context : $DOCKERFILE_DIR"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "⚠️  NOTE: The first build will download ~4.7 GB of Qwen2.5 weights."
echo "   Subsequent builds use Docker layer cache if the base image hasn't changed."
echo ""

# ── Option A: Local Docker Build ───────────────────────────────────────────────
# Uncomment this block if you prefer building locally and pushing the image.
#
# echo "🔨 Building image locally..."
# docker build \
#   --platform linux/amd64 \
#   --file "${DOCKERFILE_DIR}/Dockerfile" \
#   --tag "${FULL_IMAGE}:${TAG}" \
#   --tag "${FULL_IMAGE}:latest" \
#   "${DOCKERFILE_DIR}"
#
# echo "✅ Build complete. Pushing to GCR..."
# docker push "${FULL_IMAGE}:${TAG}"
# docker push "${FULL_IMAGE}:latest"

# ── Option B: Cloud Build (Recommended) ───────────────────────────────────────
# Builds directly in Google's infrastructure — no uploading gigabytes from laptop.
echo "☁️  Submitting to Cloud Build (recommended — avoids large upload)..."
gcloud builds submit \
  --project="${PROJECT_ID}" \
  --tag="${FULL_IMAGE}:${TAG}" \
  "${DOCKERFILE_DIR}"

# Also tag as 'latest'
gcloud container images add-tag \
  "${FULL_IMAGE}:${TAG}" \
  "${FULL_IMAGE}:latest" \
  --quiet

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅  Image pushed successfully!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Tagged  : ${FULL_IMAGE}:${TAG}"
echo "  Latest  : ${FULL_IMAGE}:latest"
echo ""
echo "  Next step → run: ./scripts/deploy.sh $PROJECT_ID"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
