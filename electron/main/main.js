/**
 * electron/main/main.js — Electron Main Process
 * Project Green
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LEARNING NOTES: HOW ELECTRON WORKS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Electron has TWO types of processes:
 *
 *  1. MAIN PROCESS (this file)
 *     - Runs in Node.js — has full access to the filesystem, OS, etc.
 *     - Responsible for creating windows, menus, and OS-level features.
 *     - There is exactly ONE main process per app.
 *
 *  2. RENDERER PROCESS (your HTML/CSS/JS files)
 *     - Runs in Chromium (like a browser tab).
 *     - Handles all the UI — your pomodoro.html runs here.
 *     - There is one renderer process per BrowserWindow.
 *
 *  3. PRELOAD SCRIPT (electron/preload/preload.js)
 *     - A special script that runs BEFORE the renderer loads.
 *     - It can safely "bridge" selected Node.js APIs to the renderer.
 *     - This keeps your renderer secure (no raw Node access).
 *
 * ─────────────────────────────────────────────────────────────────────────
 */

'use strict';

const { app, BrowserWindow, Menu, Notification, ipcMain, nativeTheme } = require('electron');
const path = require('path');

/* ══════════════════════════════════════════════════════════
   CONSTANTS — tweak these to change the window appearance
══════════════════════════════════════════════════════════ */
const WINDOW_CONFIG = {
  width:  520,
  height: 760,
  minWidth:  400,
  minHeight: 600,
};

/* ══════════════════════════════════════════════════════════
   createWindow — builds and shows the main app window
══════════════════════════════════════════════════════════ */
function createWindow() {
  // Force dark mode at the OS level so native controls match our theme
  nativeTheme.themeSource = 'dark';

  const win = new BrowserWindow({
    width:     WINDOW_CONFIG.width,
    height:    WINDOW_CONFIG.height,
    minWidth:  WINDOW_CONFIG.minWidth,
    minHeight: WINDOW_CONFIG.minHeight,

    title: 'Project Green — Pomodoro',

    // Background colour to avoid white flash while the page loads
    backgroundColor: '#0d1117',

    // Preload script path — the bridge between main and renderer
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),

      // Security best practices — keep these as-is:
      nodeIntegration: false,    // renderer cannot use require() directly
      contextIsolation: true,    // renderer runs in isolated context
      sandbox: false,            // needed so preload can use Node APIs
    },
  });

  // Load the Pomodoro HTML page into the window
  win.loadFile(path.join(__dirname, '..', '..', 'src', 'features', 'pomodoro', 'pomodoro.html'));

  // Uncomment the next line to open DevTools automatically during development:
  // win.webContents.openDevTools();

  return win;
}

/* ══════════════════════════════════════════════════════════
   APPLICATION MENU
   Removes the default Electron menu (Edit, View, etc.) and
   replaces it with a minimal app-specific one.
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
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => win.reload() },
        { type: 'separator' },
        { label: 'Toggle Developer Tools', accelerator: 'F12', click: () => win.webContents.toggleDevTools() },
        { type: 'separator' },
        { label: 'Zoom In',  accelerator: 'CmdOrCtrl+Plus',  role: 'zoomIn'  },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-',     role: 'zoomOut' },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0',  role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Toggle Fullscreen', accelerator: 'F11', role: 'togglefullscreen' },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

/* ══════════════════════════════════════════════════════════
   IPC HANDLERS
   IPC = Inter-Process Communication.
   The renderer sends messages via window.electronAPI (defined
   in the preload). The main process listens here and acts.
══════════════════════════════════════════════════════════ */
function registerIpcHandlers() {
  /**
   * 'timer:complete' — renderer tells us a session just ended.
   * We show an OS desktop notification.
   *
   * data = { mode: 'work'|'short'|'long', nextMode: string }
   */
  ipcMain.on('timer:complete', (_event, data) => {
    // Only show notification if the system supports it
    if (!Notification.isSupported()) return;

    const messages = {
      work:  { title: '🍅 Focus session complete!', body: `Time for a ${data.nextMode === 'long' ? 'long' : 'short'} break. Well done!` },
      short: { title: '☕ Break over!',             body: 'Ready to focus again? Let\'s go!'   },
      long:  { title: '🌿 Long break over!',         body: 'Refreshed? Start your next focus session.' },
    };

    const msg = messages[data.mode] || { title: 'Timer complete', body: 'Session ended.' };

    const notification = new Notification({
      title: msg.title,
      body:  msg.body,
      // icon: path.join(__dirname, '..', '..', 'public', 'icon.png'), // optional icon
      silent: true, // we play our own sound in the renderer
    });
    notification.show();
  });
}

/* ══════════════════════════════════════════════════════════
   APP LIFECYCLE EVENTS
   Electron has a specific startup/shutdown sequence.
══════════════════════════════════════════════════════════ */

// 'ready' fires when Electron has finished initialising.
// You MUST wait for this before creating any BrowserWindow.
app.whenReady().then(() => {
  registerIpcHandlers();
  const win = createWindow();
  buildMenu(win);

  // macOS: re-create window when dock icon is clicked and no windows are open
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// On Linux & Windows: quit the app when all windows are closed.
// On macOS, apps typically stay open until Cmd+Q (handled by the activate handler above).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
