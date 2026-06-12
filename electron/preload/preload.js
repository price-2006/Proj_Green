'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * electron/preload/preload.js
 * Exposes safe IPC bridges to the renderer under window.electronAPI
 */
contextBridge.exposeInMainWorld('electronAPI', {

  // ── Window Controls ──────────────────────────────────────
  windowMinimize: ()       => ipcRenderer.send('window:minimize'),
  windowMaximize: ()       => ipcRenderer.send('window:maximize'),
  windowClose:    ()       => ipcRenderer.send('window:close'),

  // ── Pomodoro ─────────────────────────────────────────────
  timerComplete: (data)    => ipcRenderer.send('timer:complete', data),

  // ── Music ────────────────────────────────────────────────
  // Returns an array of { name, path } objects from public/music/
  musicListFiles: ()       => ipcRenderer.invoke('music:listFiles'),

  // ── Notes ────────────────────────────────────────────────
  notesLoad: ()            => ipcRenderer.invoke('notes:load'),
  notesSave: (html)        => ipcRenderer.invoke('notes:save', html),

  // ── Planner ──────────────────────────────────────────────
  plannerLoad: ()          => ipcRenderer.invoke('planner:load'),
  plannerSave: (tasks)     => ipcRenderer.invoke('planner:save', tasks),

  // ── Google Drive ─────────────────────────────────────────
  driveOpenUrl:    (url)    => ipcRenderer.send('drive:openUrl', url),
  driveStartAuth:  (url)    => ipcRenderer.invoke('drive:startAuth', url),
  driveLoadToken:  ()       => ipcRenderer.invoke('drive:loadToken'),
  driveSaveToken:  (token)  => ipcRenderer.invoke('drive:saveToken', token),
  driveClearToken: ()       => ipcRenderer.invoke('drive:clearToken'),

  // ── Ollama ──────────────────────────────────────────────────
  // Stores { model: string, endpoint: string } in userData/ollama_config.json
  ollamaLoadConfig: ()       => ipcRenderer.invoke('ollama:loadConfig'),
  ollamaSaveConfig: (cfg)    => ipcRenderer.invoke('ollama:saveConfig', cfg),

  // Legacy aliases kept for compatibility with any existing code
  geminiLoadKey: ()          => ipcRenderer.invoke('ollama:loadConfig'),
  geminiSaveKey: (key)       => ipcRenderer.invoke('ollama:saveConfig', { model: key, endpoint: 'http://localhost:11434/api' }),

});
