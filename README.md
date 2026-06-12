# Project Green

An all-in-one productivity desktop app built with **Electron** — Apple Sequoia-inspired clean UI.

## Applets

| Applet | Description |
|--------|-------------|
| 🍅 Pomodoro | Focus timer with music player |
| 📝 Notepad | Rich text editor (bold/italic/bullets) — auto-saves |
| 📅 College Planner | Weekly calendar grid with task cards |
| ☁️ Google Drive | Browse, open files & starred folders from your Drive |
| 🤖 AI Assistant | Qwen2.5 streaming chatbot — works locally or via Cloud Run |

## Running the App

```bash
npm install
npm start
```

## Adding Music

Drop `.mp3`, `.wav`, `.ogg`, `.flac`, or `.aac` files into:

```
public/music/
```

They will appear in the Pomodoro → Music player automatically.

## Google Drive Setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or select an existing one)
3. Go to **APIs & Services → Library** → search "Google Drive API" → **Enable**
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
5. Application type: **Desktop app**
6. Download the credentials JSON — note your **Client ID** and **Client Secret**
7. Open `src/features/drive/drive.js` and replace:
   ```js
   client_id:     'YOUR_GOOGLE_CLIENT_ID',
   client_secret: 'YOUR_GOOGLE_CLIENT_SECRET',
   ```
8. Restart the app and click **Sign in with Google**
9. Authorize in your browser, then paste the code shown back into the app

> **Note**: The redirect URI is set to `urn:ietf:wg:oauth:2.0:oob` (out-of-band) — this shows the auth code directly in the browser so you can paste it into the app.

## AI Assistant (Qwen2.5)

The AI Assistant sidebar uses **Ollama** to run Qwen2.5 locally or in production via Google Cloud Run.
It streams tokens in real time for minimum Time-to-First-Token.

### Mode A — Local (Development)

**Prerequisites:** [Ollama](https://ollama.com/download) installed.

```bash
# Pull the model (one-time, ~4.7 GB)
ollama pull qwen2.5

# Ollama starts automatically on login; or start manually:
ollama serve
```

In the app, open the AI Assistant panel → ⚙️ Settings and enter:
- **Endpoint:** `http://localhost:11434/api`
- **Model:** `qwen2.5`

The header badge will show **🖥️ Local**.

---

### Mode B — Cloud Run (Production)

Runs Qwen2.5 on a Google Cloud **NVIDIA L4 GPU** with zero cold-start latency.

#### Prerequisites

```powershell
# Install Google Cloud CLI (Windows)
winget install Google.CloudSDK

# Restart your terminal, then authenticate
gcloud auth login
gcloud auth configure-docker
```

#### Step 1 — Enable APIs

```powershell
gcloud services enable run.googleapis.com containerregistry.googleapis.com cloudbuild.googleapis.com --project=YOUR_PROJECT_ID
```

#### Step 2 — Request GPU Quota

Cloud Run GPU quota is **not enabled by default**. Request it at:
[console.cloud.google.com/iam-admin/quotas](https://console.cloud.google.com/iam-admin/quotas)

Search for `cloud run nvidia` and request **1–2 units** for:
- `Total NVIDIA L4 GPU allocation, per project per region`
- `Total GPU allocation without zonal redundancy`

Select **Region: `us-central1`**. Approval usually takes 1–3 business days.

#### Step 3 — Build & Push Image

The Dockerfile bakes the model weights into the image at build time (no runtime download).
Build runs entirely inside Google's infrastructure via Cloud Build:

```powershell
$env:PROJECT_ID = "your-gcp-project-id"
./scripts/build-and-push.sh $env:PROJECT_ID
# ~10–25 minutes on first build
```

> **Tip:** If Cloud Build times out, add `--timeout=40m` to the `gcloud builds submit` call in `build-and-push.sh`.

#### Step 4 — Deploy to Cloud Run

```powershell
./scripts/deploy.sh $env:PROJECT_ID
```

Or manually (PowerShell):

```powershell
$env:PATH += ";$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin"
$env:CLOUDSDK_PYTHON = (& "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" components copy-bundled-python 2>&1 | Select-Object -Last 1)

gcloud beta run deploy ollama-qwen25 `
  --image="gcr.io/YOUR_PROJECT_ID/ollama-qwen25:latest" `
  --region="us-central1" `
  --project="YOUR_PROJECT_ID" `
  --gpu=1 --gpu-type=nvidia-l4 `
  --memory=16Gi --cpu=8 `
  --no-cpu-throttling `
  --min-instances=1 --max-instances=2 `
  --concurrency=4 --timeout=300 --port=11434 `
  --no-gpu-zonal-redundancy `
  --allow-unauthenticated
```

> **Note on `--max-instances=2`:** The default `us-central1` quota is 20 vCPUs / 40 GB RAM.
> With 8 CPU × 16 GB per instance, 2 instances (16 vCPUs / 32 GB) stays safely within quota.
> Request a quota increase if you need more.

> **Note on `--no-gpu-zonal-redundancy`:** Required unless you have explicit zonal redundancy
> GPU quota approved. Single-zone is standard for most production workloads.

#### Step 5 — Connect the App

```powershell
# Get your service URL
gcloud run services describe ollama-qwen25 --region=us-central1 --format='value(status.url)'
```

In the app, open the AI Assistant panel → ⚙️ Settings and enter:
- **Endpoint:** `https://YOUR-SERVICE-URL.a.run.app/api`
- **Model:** `qwen2.5`

The header badge will switch to **☁️ Cloud Run**.

#### Key Docker ENV Variables

| Variable | Value | Purpose |
|---|---|---|
| `OLLAMA_KEEP_ALIVE` | `-1` | Never unload model from VRAM |
| `OLLAMA_HOST` | `0.0.0.0:11434` | Accept traffic from Cloud Run |
| `OLLAMA_NUM_PARALLEL` | `4` | Concurrent inference slots per instance |
| `OLLAMA_FLASH_ATTENTION` | `1` | Reduced VRAM usage for long contexts |
| `OLLAMA_MAX_QUEUE` | `512` | Max queued requests before HTTP 503 |

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play/Pause Pomodoro timer |
| `R` | Reset timer |
| `S` | Toggle Pomodoro settings |
| `Ctrl+B` | Bold (Notepad) |
| `Ctrl+I` | Italic (Notepad) |
| `Ctrl+U` | Underline (Notepad) |
| `F12` | Toggle DevTools |
| `F11` | Toggle Fullscreen |
