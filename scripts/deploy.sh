#!/usr/bin/env bash
# =============================================================================
# scripts/deploy.sh
# Deploy the Ollama + Qwen2.5 container to Google Cloud Run with full GPU
# optimisation: NVIDIA L4, no CPU throttling, always-warm min instance.
#
# Usage:
#   chmod +x scripts/deploy.sh
#   ./scripts/deploy.sh [PROJECT_ID] [REGION]
#
# Prerequisites:
#   - gcloud components install beta
#   - GPU quota approved in target region
#   - Image already built & pushed (run build-and-push.sh first)
# =============================================================================
set -euo pipefail

# ── Configuration — edit these or set as environment variables ─────────────────
PROJECT_ID="${1:-${PROJECT_ID:-"YOUR_PROJECT_ID"}}"
REGION="${2:-${REGION:-"us-central1"}}"          # L4 available: us-central1, us-east4, europe-west4, asia-southeast1
SERVICE_NAME="ollama-qwen25"
IMAGE="gcr.io/${PROJECT_ID}/ollama-qwen25:latest"

# ── Validation ─────────────────────────────────────────────────────────────────
if [[ "$PROJECT_ID" == "YOUR_PROJECT_ID" ]]; then
  echo "❌ ERROR: Set PROJECT_ID as env var or pass as the first argument."
  echo "   Example: PROJECT_ID=my-gcp-project ./scripts/deploy.sh"
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🚀  Deploying Ollama + Qwen2.5 to Cloud Run"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Project : $PROJECT_ID"
echo "  Region  : $REGION"
echo "  Service : $SERVICE_NAME"
echo "  Image   : $IMAGE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Ensure required APIs are enabled ──────────────────────────────────────────
echo ""
echo "🔧 Enabling required Google Cloud APIs..."
gcloud services enable \
  run.googleapis.com \
  containerregistry.googleapis.com \
  cloudbuild.googleapis.com \
  --project="${PROJECT_ID}" \
  --quiet

# ── Deploy to Cloud Run ────────────────────────────────────────────────────────
echo ""
echo "☁️  Deploying service (this may take 2–5 minutes on first deploy)..."
echo ""

gcloud beta run deploy "${SERVICE_NAME}" \
  --image="${IMAGE}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  \
  `# ── GPU: NVIDIA L4 ─────────────────────────────────────────────────` \
  --gpu=1 \
  --gpu-type=nvidia-l4 \
  \
  `# ── Resources: tuned for qwen2.5:7b on L4 (24 GB VRAM) ─────────────` \
  --memory=16Gi \
  --cpu=8 \
  \
  `# ── Latency: no CPU throttling + always-warm instance ────────────────` \
  --no-cpu-throttling \
  --min-instances=1 \
  --max-instances=2 \
  \
  `# ── Concurrency: matches OLLAMA_NUM_PARALLEL inside the container ─────` \
  --concurrency=4 \
  \
  `# ── Timeouts: generous for long generations ──────────────────────────` \
  --timeout=300 \
  --port=11434 \
  \
  `# ── Access: public endpoint ────────────────────────────────────────────` \
  `# SECURITY: Remove --allow-unauthenticated and add your own auth layer   ` \
  `#           (API Gateway, Cloud Endpoints, or IAM token validation)      ` \
  --no-gpu-zonal-redundancy \
  \
  `# ── Access: public endpoint ────────────────────────────────────────────────` \
  `# SECURITY: Remove --allow-unauthenticated and add your own auth layer   ` \
  `#           (API Gateway, Cloud Endpoints, or IAM token validation)      ` \
  --allow-unauthenticated

# ── Fetch the deployed URL ─────────────────────────────────────────────────────
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --format='value(status.url)')

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅  Deployment complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Service URL : $SERVICE_URL"
echo ""
echo "  Quick test:"
echo "    curl ${SERVICE_URL}/api/tags"
echo ""
echo "  Set this URL in your Electron app:"
echo "    OLLAMA_ENDPOINT=${SERVICE_URL}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Useful post-deploy commands ────────────────────────────────────────────────
echo ""
echo "📋 Useful commands:"
echo "  Tail logs  : gcloud run services logs tail ${SERVICE_NAME} --region=${REGION}"
echo "  Status     : gcloud run services describe ${SERVICE_NAME} --region=${REGION}"
echo "  Scale to 0 : gcloud run services update ${SERVICE_NAME} --min-instances=0 --region=${REGION}"
echo "  Delete     : gcloud run services delete ${SERVICE_NAME} --region=${REGION}"
