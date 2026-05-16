'use strict';
/* drive.js — Google Drive OAuth 2.0 + File Browser */

/**
 * HOW GOOGLE DRIVE OAUTH WORKS IN THIS APP:
 * ──────────────────────────────────────────
 * 1. User clicks "Sign in with Google"
 * 2. We open the Google OAuth URL in the system browser via Electron shell.openExternal
 * 3. Google redirects to your OAuth redirect URI with a ?code= parameter
 * 4. You paste that code into the app (or set up a local redirect server)
 * 5. We exchange the code for access + refresh tokens
 * 6. Tokens are saved to userData via IPC
 *
 * For setup instructions, see README.md → "Google Drive Setup"
 */

// ── CONFIG — replace with your own credentials ───────────
const DRIVE_CONFIG = {
  client_id:     '365915079402-j3t42dj21dp7im9pi1fcbtgjlhttndg6.apps.googleusercontent.com',
  client_secret: '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',
  // redirect_uri is set dynamically by the main process loopback server
  scope:         'https://www.googleapis.com/auth/drive.readonly',
};

const DRIVE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const DRIVE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_API_URL  = 'https://www.googleapis.com/drive/v3';

// ── State ─────────────────────────────────────────────────
let driveToken   = null;
let currentFiles = [];
let searchQuery  = '';

// ── DOM refs ──────────────────────────────────────────────
const authView   = document.getElementById('drive-auth-view');
const fileView   = document.getElementById('drive-file-view');
const statusText = document.getElementById('drive-status-text');
const fileList   = document.getElementById('drive-file-list');
const searchInput = document.getElementById('drive-search');

// ── Helpers ───────────────────────────────────────────────
function showAuthView()  { authView?.classList.remove('hidden'); fileView?.classList.add('hidden'); }
function showFileView()  { authView?.classList.add('hidden');    fileView?.classList.remove('hidden'); }

function setStatus(msg, isError = false) {
  if (statusText) { statusText.textContent = msg; statusText.style.color = isError ? 'var(--red)' : ''; }
}

function getMimeIcon(mimeType) {
  if (!mimeType) return '📄';
  if (mimeType.includes('folder'))      return '📁';
  if (mimeType.includes('spreadsheet')) return '📊';
  if (mimeType.includes('document'))    return '📝';
  if (mimeType.includes('presentation'))return '📋';
  if (mimeType.includes('pdf'))         return '📕';
  if (mimeType.includes('image'))       return '🖼️';
  if (mimeType.includes('video'))       return '🎬';
  if (mimeType.includes('audio'))       return '🎵';
  if (mimeType.includes('zip'))         return '🗜️';
  return '📄';
}

function formatSize(bytes) {
  if (!bytes) return '';
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

// ── OAuth helpers ─────────────────────────────────────────
/**
 * Build the base auth URL — redirect_uri is a placeholder here;
 * main.js replaces it with http://127.0.0.1:{port} at runtime.
 */
function buildAuthUrl() {
  const params = new URLSearchParams({
    client_id:     DRIVE_CONFIG.client_id,
    redirect_uri:  'http://127.0.0.1',   // placeholder; main.js overrides this
    response_type: 'code',
    scope:         DRIVE_CONFIG.scope,
    access_type:   'offline',
    prompt:        'consent',
  });
  return `${DRIVE_AUTH_URL}?${params}`;
}

/**
 * Exchange the auth code for tokens.
 * @param {string} code
 * @param {string} redirectUri  The exact loopback URI used (returned by main process)
 */
async function exchangeCode(code, redirectUri) {
  setStatus('Exchanging authorization code…');
  const res = await fetch(DRIVE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     DRIVE_CONFIG.client_id,
      client_secret: DRIVE_CONFIG.client_secret,
      redirect_uri:  redirectUri,
      grant_type:    'authorization_code',
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${err}`);
  }
  return res.json();
}

async function refreshAccessToken() {
  if (!driveToken?.refresh_token) throw new Error('No refresh token');
  const res = await fetch(DRIVE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: driveToken.refresh_token,
      client_id:     DRIVE_CONFIG.client_id,
      client_secret: DRIVE_CONFIG.client_secret,
      grant_type:    'refresh_token',
    }),
  });
  if (!res.ok) throw new Error('Token refresh failed');
  const data = await res.json();
  driveToken = { ...driveToken, ...data };
  await window.electronAPI?.driveSaveToken?.(driveToken);
}

async function apiGet(path, params = {}) {
  if (!driveToken) throw new Error('Not authenticated');
  params.key = undefined; // remove key if present
  const url = `${DRIVE_API_URL}${path}?${new URLSearchParams(params)}`;
  let res = await fetch(url, { headers: { Authorization: `Bearer ${driveToken.access_token}` } });
  if (res.status === 401) {
    await refreshAccessToken();
    res = await fetch(url, { headers: { Authorization: `Bearer ${driveToken.access_token}` } });
  }
  if (!res.ok) throw new Error(`Drive API error: ${res.status}`);
  return res.json();
}

// ── File listing ──────────────────────────────────────────
async function loadFiles(folderId = 'root') {
  fileList.innerHTML = '<div class="drive-loading">Loading files…</div>';
  try {
    const q = folderId === 'root'
      ? `'root' in parents and trashed=false`
      : `'${folderId}' in parents and trashed=false`;
    const data = await apiGet('/files', {
      q,
      fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink)',
      orderBy: 'folder,name',
      pageSize: '50',
    });
    currentFiles = data.files || [];
    renderFiles();
  } catch(e) {
    fileList.innerHTML = `<div class="drive-error">⚠️ ${e.message}</div>`;
    console.error('Drive loadFiles error', e);
  }
}

function renderFiles() {
  const q = searchQuery.toLowerCase();
  const filtered = q ? currentFiles.filter(f => f.name.toLowerCase().includes(q)) : currentFiles;

  fileList.innerHTML = '';
  if (!filtered.length) {
    fileList.innerHTML = '<div class="drive-loading">No files found.</div>';
    return;
  }
  filtered.forEach(f => {
    const item = document.createElement('div');
    item.className = 'drive-file-item';
    item.setAttribute('role', 'listitem');
    item.innerHTML = `
      <div class="drive-file-icon">${getMimeIcon(f.mimeType)}</div>
      <div class="drive-file-name">${f.name}</div>
    `;
    if (f.mimeType?.includes('folder')) {
      item.addEventListener('click', () => {
        document.getElementById('drive-breadcrumb').innerHTML += ` <span>›</span> <span>${f.name}</span>`;
        loadFiles(f.id);
      });
    } else if (f.webViewLink) {
      item.addEventListener('click', () => window.electronAPI?.driveOpenUrl?.(f.webViewLink));
      item.title = `Open ${f.name} in browser`;
    }
    fileList.appendChild(item);
  });
}

// ── Init / sign-in flow ───────────────────────────────────
async function init() {
  if (!document.getElementById('panel-drive')) return;

  // Check for saved token
  try {
    driveToken = await window.electronAPI?.driveLoadToken?.();
  } catch(e) { driveToken = null; }

  if (driveToken) {
    showFileView();
    setStatus('Connected to Google Drive');
    loadFiles();
  } else {
    showAuthView();
  }

  // Sign-in button — uses loopback redirect (no manual code pasting)
  document.getElementById('btn-drive-signin')?.addEventListener('click', async () => {
    setStatus('Opening Google sign-in…');
    try {
      // Build the base auth URL (redirect_uri is overridden by main.js)
      const baseUrl = buildAuthUrl();

      // main process starts local HTTP server, opens browser, waits for callback
      // returns the auth code automatically when Google redirects back
      const { code, redirectUri } = await window.electronAPI.driveStartAuth(baseUrl);

      const token = await exchangeCode(code, redirectUri);
      driveToken = token;
      await window.electronAPI?.driveSaveToken?.(token);
      showFileView();
      setStatus('Connected to Google Drive');
      loadFiles();
    } catch(e) {
      const msg = e.message || String(e);
      setStatus(`Sign-in failed: ${msg}`, true);
      console.error('Drive OAuth error', e);
      alert(`Google Drive sign-in failed:\n\n${msg}\n\nCheck the README for setup instructions.`);
    }
  });

  // Sign-out
  document.getElementById('btn-drive-signout')?.addEventListener('click', async () => {
    await window.electronAPI?.driveClearToken?.();
    driveToken = null;
    currentFiles = [];
    showAuthView();
    setStatus('Connect your Google account to browse files.');
  });

  // Refresh
  document.getElementById('btn-drive-refresh')?.addEventListener('click', () => loadFiles());

  // Search
  searchInput?.addEventListener('input', () => { searchQuery = searchInput.value; renderFiles(); });

  // Setup guide link
  document.getElementById('drive-setup-link')?.addEventListener('click', e => {
    e.preventDefault();
    alert('Google Drive Setup:\n\n1. Go to console.cloud.google.com\n2. Create a new project\n3. Enable the Google Drive API\n4. Create OAuth 2.0 credentials (Desktop app type)\n5. Copy your Client ID and Client Secret\n6. Open src/features/drive/drive.js\n7. Replace YOUR_GOOGLE_CLIENT_ID and YOUR_GOOGLE_CLIENT_SECRET\n8. Restart the app');
  });
}

document.addEventListener('DOMContentLoaded', init);
