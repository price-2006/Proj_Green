/**
 * electron/preload/preload.js — Preload / Bridge Script
 * Project Green
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LEARNING NOTES: WHY A PRELOAD SCRIPT?
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Security model:
 *   - The RENDERER (your HTML page) runs sandboxed, like a webpage.
 *   - The MAIN PROCESS has full OS access.
 *   - The PRELOAD runs with access to BOTH, before the page loads.
 *
 * contextBridge.exposeInMainWorld():
 *   - Creates a safe, read-only API on `window` in the renderer.
 *   - The renderer can CALL these functions, but cannot access Node.js itself.
 *   - This pattern is called "contextIsolation" and is the recommended
 *     Electron security practice.
 *
 * Think of it like a doorbell: the renderer can ring the bell (call the API),
 * but it can't walk into the main process's house.
 * ─────────────────────────────────────────────────────────────────────────
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Expose a safe API to the renderer under window.electronAPI
 *
 * The renderer (pomodoro.js) can call:
 *   window.electronAPI.timerComplete({ mode, nextMode })
 *
 * This sends an IPC message to the main process, which handles
 * showing the OS desktop notification.
 */
contextBridge.exposeInMainWorld('electronAPI', {

  /**
   * Notify the main process that a timer session just ended.
   * @param {{ mode: string, nextMode: string }} data
   */
  timerComplete: (data) => {
    // 'send' is fire-and-forget — no return value expected
    ipcRenderer.send('timer:complete', data);
  },

});
