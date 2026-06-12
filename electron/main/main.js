'use strict';

const {
  app, BrowserWindow, Menu, Notification,
  ipcMain, nativeTheme, dialog, shell
} = require('electron');
const path = require('path');
const fs   = require('fs');
const http = require('http');
const { URL } = require('url');

/* ══════════════════════════════════════════════════════════
   WINDOW CONFIG
══════════════════════════════════════════════════════════ */
const WINDOW_CONFIG = {
  width:     1120,
  height:    720,
  minWidth:  900,
  minHeight: 600,
};

/* ══════════════════════════════════════════════════════════
   createWindow
══════════════════════════════════════════════════════════ */
function createWindow() {
  nativeTheme.themeSource = 'dark';

  const win = new BrowserWindow({
    width:     WINDOW_CONFIG.width,
    height:    WINDOW_CONFIG.height,
    minWidth:  WINDOW_CONFIG.minWidth,
    minHeight: WINDOW_CONFIG.minHeight,

    title: 'Project Green',

    // Frameless so we render our own Apple-style titlebar
    frame:           false,
    titleBarStyle:   'hidden',
    backgroundColor: '#1c1c1e',

    webPreferences: {
      preload:          path.join(__dirname, '..', 'preload', 'preload.js'),
      nodeIntegration:  false,
      contextIsolation: true,
      sandbox:          false,
    },
  });

  // Load the hub shell
  win.loadFile(path.join(__dirname, '..', '..', 'src', 'index.html'));

  // Uncomment for DevTools during development:
  // win.webContents.openDevTools();

  return win;
}

/* ══════════════════════════════════════════════════════════
   MENU (minimal — most UI lives in renderer)
══════════════════════════════════════════════════════════ */
function buildMenu(win) {
  const template = [
    {
      label: 'App',
      submenu: [
        { label: 'About Project Green', role: 'about' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload',                accelerator: 'CmdOrCtrl+R', click: () => win.reload() },
        { label: 'Toggle Developer Tools', accelerator: 'F12',         click: () => win.webContents.toggleDevTools() },
        { type: 'separator' },
        { label: 'Zoom In',    accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn'   },
        { label: 'Zoom Out',   accelerator: 'CmdOrCtrl+-',    role: 'zoomOut'  },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0',    role: 'resetZoom'},
        { type: 'separator' },
        { label: 'Toggle Fullscreen', accelerator: 'F11', role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ══════════════════════════════════════════════════════════
   PERSISTENCE HELPERS
   Notes and Planner data are stored in Electron's userData
   directory so they survive app restarts.
══════════════════════════════════════════════════════════ */
function dataPath(filename) {
  return path.join(app.getPath('userData'), filename);
}

function readJSON(filename, fallback) {
  try {
    const raw = fs.readFileSync(dataPath(filename), 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJSON(filename, data) {
  try {
    fs.writeFileSync(dataPath(filename), JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('writeJSON error:', e);
    return false;
  }
}

/* ══════════════════════════════════════════════════════════
   IPC HANDLERS
══════════════════════════════════════════════════════════ */
function registerIpcHandlers() {

  // ── Window controls (custom titlebar) ──────────────────
  ipcMain.on('window:minimize', () => {
    BrowserWindow.getFocusedWindow()?.minimize();
  });
  ipcMain.on('window:maximize', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return;
    win.isMaximized() ? win.unmaximize() : win.maximize();
  });
  ipcMain.on('window:close', () => {
    BrowserWindow.getFocusedWindow()?.close();
  });

  // ── Pomodoro: timer complete notification ───────────────
  ipcMain.on('timer:complete', (_event, data) => {
    if (!Notification.isSupported()) return;
    const messages = {
      work:  { title: '🍅 Focus session complete!', body: `Time for a ${data.nextMode === 'long' ? 'long' : 'short'} break. Well done!` },
      short: { title: '☕ Break over!',              body: "Ready to focus again? Let's go!"                                           },
      long:  { title: '🌿 Long break over!',         body: 'Refreshed? Start your next focus session.'                                },
    };
    const msg = messages[data.mode] || { title: 'Timer complete', body: 'Session ended.' };
    new Notification({ title: msg.title, body: msg.body, silent: true }).show();
  });

  // ── Music: list files in the fixed music folder ─────────
  ipcMain.handle('music:listFiles', () => {
    const musicDir = path.join(__dirname, '..', '..', 'public', 'music');
    try {
      if (!fs.existsSync(musicDir)) {
        fs.mkdirSync(musicDir, { recursive: true });
        return [];
      }
      const AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a'];
      return fs.readdirSync(musicDir)
        .filter(f => AUDIO_EXTS.includes(path.extname(f).toLowerCase()))
        .map(f => ({ name: f, path: path.join(musicDir, f) }));
    } catch (e) {
      console.error('music:listFiles error:', e);
      return [];
    }
  });

  // ── Notes: save / load ──────────────────────────────────
  ipcMain.handle('notes:load', () => {
    return readJSON('notes.json', { html: '', updatedAt: null });
  });
  ipcMain.handle('notes:save', (_event, data) => {
    return writeJSON('notes.json', { html: data, updatedAt: new Date().toISOString() });
  });

  // ── Planner: save / load ────────────────────────────────
  ipcMain.handle('planner:load', () => {
    return readJSON('planner.json', { tasks: [] });
  });
  ipcMain.handle('planner:save', (_event, data) => {
    return writeJSON('planner.json', { tasks: data, updatedAt: new Date().toISOString() });
  });

  // ── Google Drive: open arbitrary URL in system browser ──
  ipcMain.on('drive:openUrl', (_event, url) => {
    shell.openExternal(url);
  });

  // ── Google Drive: loopback OAuth flow ───────────────────
  // Starts a temporary local HTTP server, opens the auth URL in the
  // system browser with redirect_uri=http://127.0.0.1:{port},
  // waits for Google to redirect back, then resolves with the auth code.
  ipcMain.handle('drive:startAuth', (_event, baseAuthUrl) => {
    return new Promise((resolve, reject) => {
      let responded    = false; // guard against duplicate requests (e.g. favicon)
      let redirectUri  = '';    // set once the server is listening and port is known

      const server = http.createServer((req, res) => {
        // Ignore any request after we've already handled the OAuth callback
        if (responded) {
          res.writeHead(204);
          res.end();
          return;
        }

        try {
          const parsed = new URL(req.url, 'http://127.0.0.1');
          const code   = parsed.searchParams.get('code');
          const error  = parsed.searchParams.get('error');

          // If neither code nor error is present (e.g. /favicon.ico), ignore silently
          if (!code && !error) {
            res.writeHead(204);
            res.end();
            return;
          }

          responded = true;

          const html = (msg, ok) => `
            <!DOCTYPE html><html><head><meta charset="UTF-8"/>
            <style>body{font-family:system-ui;background:#1c1c1e;color:#f5f5f7;display:flex;
            align-items:center;justify-content:center;height:100vh;margin:0;}
            .box{text-align:center;padding:40px;background:#2c2c2e;border-radius:16px;max-width:400px}
            h2{color:${ok?'#30d158':'#ff453a'};margin-bottom:12px}p{color:#8e8e93}</style></head>
            <body><div class="box"><h2>${ok?'✅ Connected!':'❌ Failed'}</h2><p>${msg}</p>
            <p style="margin-top:20px;font-size:12px">You can close this tab and return to Project Green.</p>
            </div></body></html>`;

          if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html('Google Drive connected successfully.', true));
            server.close();
            resolve({ code, redirectUri }); // redirectUri is now accessible here
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html(`Authorization denied: ${error || 'unknown error'}`, false));
            server.close();
            reject(new Error(error || 'Authorization denied'));
          }
        } catch (e) {
          if (!res.headersSent) {
            res.writeHead(500);
            res.end('Internal error');
          }
          if (!responded) {
            responded = true;
            server.close();
            reject(e);
          }
        }
      });

      // Listen on a random available port — set redirectUri here so the request
      // handler above can access it via closure
      server.listen(0, '127.0.0.1', () => {
        const port  = server.address().port;
        redirectUri = `http://127.0.0.1:${port}`; // assign to outer-scope variable

        const authUrl = new URL(baseAuthUrl);
        authUrl.searchParams.set('redirect_uri', redirectUri);

        shell.openExternal(authUrl.toString());
      });

      server.on('error', (e) => { if (!responded) reject(e); });

      // Auto-close after 5 minutes
      setTimeout(() => {
        if (!responded) {
          responded = true;
          server.close();
          reject(new Error('Authentication timed out (5 min)'));
        }
      }, 5 * 60 * 1000);
    });
  });

  // ── Drive token: save / load ────────────────────────────
  ipcMain.handle('drive:loadToken', () => {
    return readJSON('drive_token.json', null);
  });
  ipcMain.handle('drive:saveToken', (_event, token) => {
    return writeJSON('drive_token.json', token);
  });
  ipcMain.handle('drive:clearToken', () => {
    try {
      const p = dataPath('drive_token.json');
      if (fs.existsSync(p)) fs.unlinkSync(p);
      return true;
    } catch { return false; }
  });

  // ── Ollama config: save / load { model, endpoint } ──────────────────
  ipcMain.handle('ollama:loadConfig', () => {
    return readJSON('ollama_config.json', null);
  });
  ipcMain.handle('ollama:saveConfig', (_event, cfg) => {
    return writeJSON('ollama_config.json', cfg);
  });
}

/* ══════════════════════════════════════════════════════════
   APP LIFECYCLE
══════════════════════════════════════════════════════════ */
app.whenReady().then(() => {
  registerIpcHandlers();
  const win = createWindow();
  buildMenu(win);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
