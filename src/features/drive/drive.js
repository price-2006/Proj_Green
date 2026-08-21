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

// ── CONFIG — loaded from src/config.js (gitignored) ──────
// Clone this repo? Copy src/config.example.js → src/config.js and fill in your credentials.
const _cfg = window.APP_CONFIG?.googleDrive;
if (!_cfg?.client_id || _cfg.client_id === 'YOUR_GOOGLE_CLIENT_ID') {
  console.warn('[Drive] No credentials found. Copy src/config.example.js → src/config.js and add your Google OAuth credentials.');
}
const DRIVE_CONFIG = {
  client_id:     _cfg?.client_id     || '',
  client_secret: _cfg?.client_secret || '',
  scope:         'https://www.googleapis.com/auth/drive.readonly',
};

const DRIVE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const DRIVE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_API_URL  = 'https://www.googleapis.com/drive/v3';

// ── State ─────────────────────────────────────────────────
let driveToken   = null;
let currentFiles = [];
let searchQuery  = '';
let currentFolderId = 'root';
let currentView  = 'mydrive'; // 'mydrive' | 'starred'
let breadcrumbPath = [{ id: 'root', name: 'My Drive' }];
let objectUrlToRevoke = null;
let pdfCurrentZoom = 1.0;

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
  // All SVGs are 28×28, designed to sit inside .drive-file-icon (font-size:28px slot)
  const s = (path, color) =>
    `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${path}</svg>`;

  if (!mimeType) return s(
    `<rect x="4" y="3" width="16" height="18" rx="2" fill="#8e8e93"/><line x1="8" y1="8" x2="16" y2="8" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><line x1="8" y1="12" x2="14" y2="12" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>`
  );

  // Folder — warm yellow, recognisable shape
  if (mimeType.includes('folder')) return s(
    `<path d="M2 6.5C2 5.67 2.67 5 3.5 5H9.5l2 2.5H20.5C21.33 7.5 22 8.17 22 9v9.5c0 .83-.67 1.5-1.5 1.5h-17C2.67 20 2 19.33 2 18.5V6.5z" fill="#ffba00"/><path d="M2 9h20" stroke="rgba(0,0,0,0.1)" stroke-width="0.5"/>`
  );

  // Google Docs — blue
  if (mimeType.includes('document')) return s(
    `<rect x="4" y="2" width="16" height="20" rx="2" fill="#4285f4"/><line x1="7" y1="8" x2="17" y2="8" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><line x1="7" y1="12" x2="17" y2="12" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><line x1="7" y1="16" x2="13" y2="16" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>`
  );

  // Google Sheets — green
  if (mimeType.includes('spreadsheet')) return s(
    `<rect x="4" y="2" width="16" height="20" rx="2" fill="#0f9d58"/><line x1="4" y1="9" x2="20" y2="9" stroke="rgba(255,255,255,0.35)" stroke-width="1"/><line x1="4" y1="15" x2="20" y2="15" stroke="rgba(255,255,255,0.35)" stroke-width="1"/><line x1="12" y1="2" x2="12" y2="22" stroke="rgba(255,255,255,0.35)" stroke-width="1"/>`
  );

  // Google Slides — amber/orange
  if (mimeType.includes('presentation')) return s(
    `<rect x="2" y="4" width="20" height="16" rx="2" fill="#f4b400"/><rect x="7" y="8" width="10" height="7" rx="1" fill="rgba(255,255,255,0.3)"/>`
  );

  // PDF — red
  if (mimeType.includes('pdf')) return s(
    `<rect x="4" y="2" width="16" height="20" rx="2" fill="#ea4335"/><text x="12" y="15.5" text-anchor="middle" fill="#fff" font-size="7" font-weight="700" font-family="system-ui,sans-serif">PDF</text>`
  );

  // Image — purple
  if (mimeType.includes('image')) return s(
    `<rect x="3" y="4" width="18" height="16" rx="2" fill="#bf5af2"/><circle cx="8.5" cy="9.5" r="1.5" fill="rgba(255,255,255,0.7)"/><path d="M3 16l5-5 4 4 3-3 6 6" stroke="rgba(255,255,255,0.8)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
  );

  // Video — dark teal
  if (mimeType.includes('video')) return s(
    `<rect x="2" y="5" width="20" height="14" rx="2" fill="#3a3a3c"/><polygon points="10,9 10,15 16,12" fill="#ff9f0a"/>`
  );

  // Audio — accent green
  if (mimeType.includes('audio')) return s(
    `<rect x="4" y="2" width="16" height="20" rx="2" fill="#30d158"/><path d="M9 15V9l8-2v6" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="7.5" cy="15.5" r="1.5" fill="#fff"/><circle cx="15.5" cy="13.5" r="1.5" fill="#fff"/>`
  );

  // Zip / archive — brown-grey
  if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('archive')) return s(
    `<rect x="4" y="2" width="16" height="20" rx="2" fill="#636366"/><line x1="12" y1="2" x2="12" y2="14" stroke="rgba(255,255,255,0.4)" stroke-width="3" stroke-dasharray="2 2"/><rect x="9" y="14" width="6" height="4" rx="1" fill="rgba(255,255,255,0.7)"/>`
  );

  // Default — neutral grey file
  return s(
    `<path d="M5 3h9l5 5v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="#48484a"/><polyline points="14 3 14 8 19 8" fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>`
  );
}


function formatSize(bytes) {
  if (!bytes) return '';
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function renderBreadcrumbs() {
  const bc = document.getElementById('drive-breadcrumb');
  if (!bc) return;
  bc.innerHTML = '';
  breadcrumbPath.forEach((item, index) => {
    if (index > 0) {
      const sep = document.createElement('span');
      sep.textContent = ' › ';
      bc.appendChild(sep);
    }
    const span = document.createElement('span');
    span.textContent = item.name;
    span.style.cursor = 'pointer';
    span.addEventListener('click', () => {
      breadcrumbPath = breadcrumbPath.slice(0, index + 1);
      renderBreadcrumbs();
      loadFiles(item.id);
    });
    bc.appendChild(span);
  });
  
  const backBtn = document.getElementById('btn-drive-back');
  if (backBtn) {
    // Hide back button when viewing starred (no folder navigation there)
    backBtn.style.display = (currentView === 'mydrive' && breadcrumbPath.length > 1) ? 'inline-block' : 'none';
  }

  // Also hide breadcrumb row when in starred view
  if (bc) bc.style.display = currentView === 'starred' ? 'none' : '';
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

async function openPdf(f) {
  const overlay = document.getElementById('pdf-viewer-overlay');
  const iframe  = document.getElementById('pdf-iframe');

  // Tell the Gemini assistant which PDF is open
  window._geminiSetPdf?.(f.name);

  if (objectUrlToRevoke) {
    URL.revokeObjectURL(objectUrlToRevoke);
    objectUrlToRevoke = null;
  }

  pdfCurrentZoom = 1.0;
  overlay.classList.remove('hidden');
  iframe.src = '';
  iframe.style.zoom = '';

  setStatus('Downloading PDF...');

  try {
    const url = `${DRIVE_API_URL}/files/${f.id}?alt=media`;
    let res = await fetch(url, { headers: { Authorization: `Bearer ${driveToken.access_token}` } });
    if (res.status === 401) {
      await refreshAccessToken();
      res = await fetch(url, { headers: { Authorization: `Bearer ${driveToken.access_token}` } });
    }
    if (!res.ok) throw new Error(`Drive API error: ${res.status}`);

    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    objectUrlToRevoke = objectUrl;
    iframe.src = objectUrl + '#toolbar=1&navpanes=0';
    setStatus('Connected to Google Drive');
  } catch (err) {
    setStatus(`Failed to load PDF: ${err.message}`, true);
    overlay.classList.add('hidden');
  }
}

// ── File listing ──────────────────────────────────────────
async function loadFiles(folderId = 'root') {
  currentView = 'mydrive';
  setActiveTab('mydrive');
  currentFolderId = folderId;
  fileList.innerHTML = '<div class="drive-loading">Loading files…</div>';
  try {
    const q = folderId === 'root'
      ? `('root' in parents or sharedWithMe=true) and trashed=false`
      : `'${folderId}' in parents and trashed=false`;
    const data = await apiGet('/files', {
      q,
      fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink)',
      orderBy: 'folder,name',
      pageSize: '50',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    currentFiles = data.files || [];
    renderFiles();
  } catch(e) {
    fileList.innerHTML = `<div class="drive-error">⚠️ ${e.message}</div>`;
    console.error('Drive loadFiles error', e);
  }
}

async function loadStarred() {
  currentView = 'starred';
  setActiveTab('starred');
  fileList.innerHTML = '<div class="drive-loading">Loading starred files…</div>';
  renderBreadcrumbs(); // hides breadcrumb + back btn
  try {
    const data = await apiGet('/files', {
      q: 'starred=true and trashed=false',
      fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink)',
      orderBy: 'folder,name',
      pageSize: '100',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    currentFiles = data.files || [];
    renderFiles();
  } catch(e) {
    fileList.innerHTML = `<div class="drive-error">⚠️ ${e.message}</div>`;
    console.error('Drive loadStarred error', e);
  }
}

function setActiveTab(view) {
  document.getElementById('btn-tab-mydrive')?.classList.toggle('active', view === 'mydrive');
  document.getElementById('btn-tab-starred')?.classList.toggle('active', view === 'starred');
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
        breadcrumbPath.push({ id: f.id, name: f.name });
        renderBreadcrumbs();
        loadFiles(f.id);
      });
    } else if (f.mimeType === 'application/pdf') {
      item.addEventListener('click', () => openPdf(f));
      item.title = `View ${f.name} in app`;
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
    renderBreadcrumbs();
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
      renderBreadcrumbs();
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
    breadcrumbPath = [{ id: 'root', name: 'My Drive' }];
    renderBreadcrumbs();
    showAuthView();
    setStatus('Connect your Google account to browse files.');
  });

  // Back
  document.getElementById('btn-drive-back')?.addEventListener('click', () => {
    if (breadcrumbPath.length > 1) {
      breadcrumbPath.pop();
      renderBreadcrumbs();
      loadFiles(breadcrumbPath[breadcrumbPath.length - 1].id);
    }
  });

  // Refresh
  document.getElementById('btn-drive-refresh')?.addEventListener('click', () => {
    if (currentView === 'starred') loadStarred();
    else loadFiles(currentFolderId);
  });

  // View tabs — My Drive / Starred
  document.getElementById('btn-tab-mydrive')?.addEventListener('click', () => {
    if (currentView !== 'mydrive') {
      breadcrumbPath = [{ id: 'root', name: 'My Drive' }];
      renderBreadcrumbs();
      loadFiles('root');
    }
  });
  document.getElementById('btn-tab-starred')?.addEventListener('click', () => {
    if (currentView !== 'starred') loadStarred();
  });

  // Search
  searchInput?.addEventListener('input', () => { searchQuery = searchInput.value; renderFiles(); });

  // PDF Viewer Close
  document.getElementById('btn-close-pdf')?.addEventListener('click', () => {
    document.getElementById('pdf-viewer-overlay')?.classList.add('hidden');
    if (objectUrlToRevoke) {
      URL.revokeObjectURL(objectUrlToRevoke);
      objectUrlToRevoke = null;
    }
    const iframe = document.getElementById('pdf-iframe');
    iframe.src = '';
    iframe.style.zoom = '';
  });

  // PDF Navigation — prev / next page via postMessage to PDF viewer
  document.getElementById('btn-pdf-prev')?.addEventListener('click', () => {
    const iframe = document.getElementById('pdf-iframe');
    try { iframe.contentWindow.postMessage('previousPage', '*'); } catch(e) {}
    // Chromium PDF viewer also responds to keyboard events sent directly
    iframe.focus();
    iframe.contentWindow?.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }));
  });

  document.getElementById('btn-pdf-next')?.addEventListener('click', () => {
    const iframe = document.getElementById('pdf-iframe');
    try { iframe.contentWindow.postMessage('nextPage', '*'); } catch(e) {}
    iframe.focus();
    iframe.contentWindow?.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
  });

  // PDF Zoom
  document.getElementById('btn-pdf-zoom-in')?.addEventListener('click', () => {
    pdfCurrentZoom = Math.min(pdfCurrentZoom + 0.15, 3.0);
    document.getElementById('pdf-iframe').style.zoom = pdfCurrentZoom;
  });
  document.getElementById('btn-pdf-zoom-out')?.addEventListener('click', () => {
    pdfCurrentZoom = Math.max(pdfCurrentZoom - 0.15, 0.4);
    document.getElementById('pdf-iframe').style.zoom = pdfCurrentZoom;
  });

  // Keyboard shortcut: Escape closes PDF viewer
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.getElementById('pdf-viewer-overlay')?.classList.contains('hidden')) {
      document.getElementById('btn-close-pdf')?.click();
    }
  });

  // Setup guide link
  document.getElementById('drive-setup-link')?.addEventListener('click', e => {
    e.preventDefault();
    alert('Google Drive Setup:\n\n1. Go to console.cloud.google.com\n2. Create a new project\n3. Enable the Google Drive API\n4. Create OAuth 2.0 credentials (Desktop app type)\n5. Copy your Client ID and Client Secret\n6. Open src/features/drive/drive.js\n7. Replace YOUR_GOOGLE_CLIENT_ID and YOUR_GOOGLE_CLIENT_SECRET\n8. Restart the app');
  });
}

document.addEventListener('DOMContentLoaded', init);
