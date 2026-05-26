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
let currentFolderId = 'root';
let currentView  = 'mydrive'; // 'mydrive' | 'starred'
let breadcrumbPath = [{ id: 'root', name: 'My Drive' }];
let objectUrlToRevoke = null;
let pdfCurrentZoom = 1.0;
let pdfProgressObserver = null; // MutationObserver for the progress bar

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
  const iframe = document.getElementById('pdf-iframe');
  const pomoBody = document.getElementById('pomo-body');
  const timerContainer = document.getElementById('pdf-timer-container');

  // Tell the Gemini assistant which PDF is open
  window._geminiSetPdf?.(f.name);

  if (objectUrlToRevoke) {
    URL.revokeObjectURL(objectUrlToRevoke);
    objectUrlToRevoke = null;
  }
  
  if (pomoBody && timerContainer) {
    timerContainer.appendChild(pomoBody);
  }
  
  // Inject the pill progress bar into .timer-display if not already there
  setTimeout(() => {
    const timerDisplay = timerContainer.querySelector('.timer-display');
    if (timerDisplay && !timerDisplay.querySelector('.pdf-progress-track')) {
      const track = document.createElement('div');
      track.className = 'pdf-progress-track';
      const fill = document.createElement('div');
      fill.className = 'pdf-progress-fill';
      track.appendChild(fill);
      timerDisplay.appendChild(track);
    }
    
    // Sync --pomo-pct from the ring's dashoffset or timer-time text
    const syncProgress = () => {
      const ring = timerContainer.querySelector('.ring-progress');
      if (ring && ring._c) {
        const offset = parseFloat(ring.style.strokeDashoffset) || 0;
        const pct = ring._c > 0 ? Math.max(0, 1 - offset / ring._c) : 1;
        timerContainer.style.setProperty('--pomo-pct', (pct * 100).toFixed(2) + '%');
        
        // Also tint the fill based on timer mode
        const fill = timerContainer.querySelector('.pdf-progress-fill');
        if (fill) {
          const mode = timerContainer.querySelector('.mode-tab.active')?.dataset?.mode;
          const colors = { work: '#30d158', short: '#0a84ff', long: '#bf5af2' };
          fill.style.background = colors[mode] || 'var(--accent)';
          fill.style.boxShadow = `0 0 8px ${colors[mode] || 'var(--accent-glow)'}66`;
        }
      }
    };
    
    // Disconnect any old observer
    if (pdfProgressObserver) pdfProgressObserver.disconnect();
    
    // Watch the ring-progress element's style attribute for changes
    const ringEl = timerContainer.querySelector('.ring-progress');
    if (ringEl) {
      pdfProgressObserver = new MutationObserver(syncProgress);
      pdfProgressObserver.observe(ringEl, { attributes: true, attributeFilter: ['style'] });
      syncProgress(); // initial sync
    }
  }, 100);
  
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
    
    // Teleport pomo-body back to its original panel
    const pomoBody = document.getElementById('pomo-body');
    const panelPomodoro = document.getElementById('panel-pomodoro');
    if (pomoBody && panelPomodoro) {
      panelPomodoro.appendChild(pomoBody);
    }
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
