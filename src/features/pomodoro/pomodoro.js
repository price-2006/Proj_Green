/**
 * pomodoro.js — Pomodoro Timer Logic
 * Project Green
 *
 * HOW IT WORKS (great for learning!):
 * ─────────────────────────────────────────────────────────────
 * 1. STATE   — one object holds everything the app "knows"
 * 2. RENDER  — functions read state and update the DOM
 * 3. EVENTS  — user actions update state, then call render
 * ─────────────────────────────────────────────────────────────
 *
 * ELECTRON INTEGRATION:
 * ─────────────────────────────────────────────────────────────
 * When running as an Electron desktop app, `window.electronAPI`
 * is injected by electron/preload/preload.js via contextBridge.
 * We use it to send OS desktop notifications when a session ends.
 * The guard `if (window.electronAPI)` means the page still works
 * if you open it directly in a browser (no Electron).
 * ─────────────────────────────────────────────────────────────
 */

'use strict';

/* ══════════════════════════════════════════════════════════
   1.  PRESETS
   Each preset defines durations (in minutes) for the three
   session types. You can add more presets here easily!
══════════════════════════════════════════════════════════ */
const PRESETS = {
  classic: { label: '25 / 5 / 15',  work: 25, short: 5,  long: 15 },
  long50:  { label: '50 / 10 / 20', work: 50, short: 10, long: 20 },
  long45:  { label: '45 / 8 / 20',  work: 45, short: 8,  long: 20 },
};

/* ══════════════════════════════════════════════════════════
   2.  APPLICATION STATE
   Everything the app needs to know lives here.
══════════════════════════════════════════════════════════ */
const state = {
  /* Current timer mode: 'work' | 'short' | 'long' */
  mode: 'work',

  /* Duration values in MINUTES — user can change these */
  durations: { ...PRESETS.classic },   // default preset = classic

  /* Timer internals */
  totalSeconds: 0,      // total seconds for this session
  remainingSeconds: 0,  // seconds left on the clock
  isRunning: false,      // is the timer ticking?
  intervalId: null,      // setInterval handle

  /* Session tracking — how many work sessions done? */
  sessionsCompleted: 0,
  sessionsUntilLong: 4, // after this many work sessions → long break

  /* Settings */
  soundEnabled: true,
  activePreset: 'classic',

  /* Settings panel open/closed */
  settingsOpen: false,
};

/* ══════════════════════════════════════════════════════════
   3.  DOM REFERENCES
   Grab all DOM elements once at startup.
══════════════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);

const dom = {
  body:           document.body,
  timerTime:      $('timer-time'),
  timerLabel:     $('timer-label'),
  btnPlayPause:   $('btn-play-pause'),
  btnPlayIcon:    $('btn-play-icon'),
  btnReset:       $('btn-reset'),
  btnSkip:        $('btn-skip'),
  btnSettings:    $('btn-settings'),
  modeTabs:       document.querySelectorAll('.mode-tab'),
  sessionDots:    $('session-dots'),
  ringProgress:   $('ring-progress'),
  settingsCard:   $('settings-card'),
  // Settings controls
  rangeWork:      $('range-work'),
  rangeShort:     $('range-short'),
  rangeLong:      $('range-long'),
  valWork:        $('val-work'),
  valShort:       $('val-short'),
  valLong:        $('val-long'),
  toggleSound:    $('toggle-sound'),
  presetBtns:     document.querySelectorAll('.preset-btn'),
};

/* ══════════════════════════════════════════════════════════
   4.  SVG RING SETUP
   The progress ring is an SVG circle. We control how much
   of it is "drawn" using stroke-dashoffset.
══════════════════════════════════════════════════════════ */
function setupRing() {
  const circle = dom.ringProgress;
  const r = parseFloat(circle.getAttribute('r'));
  // Circumference = 2 × π × radius
  const circumference = 2 * Math.PI * r;
  circle.style.strokeDasharray = circumference;
  circle.style.strokeDashoffset = 0;
  // Store for later use
  dom.ringProgress._circumference = circumference;
}

/**
 * Update the ring to show `fraction` progress (0 = empty, 1 = full).
 * @param {number} fraction - value between 0 and 1
 */
function setRingProgress(fraction) {
  const c = dom.ringProgress._circumference;
  // dashoffset = circumference means 0% drawn
  // dashoffset = 0 means 100% drawn
  dom.ringProgress.style.strokeDashoffset = c - fraction * c;
}

/* ══════════════════════════════════════════════════════════
   5.  HELPERS
══════════════════════════════════════════════════════════ */

/** Convert minutes → seconds */
const minutesToSeconds = m => m * 60;

/** Format seconds as MM:SS string */
function formatTime(totalSec) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Human-readable label for each mode */
const MODE_LABELS = {
  work:  'Focus Time',
  short: 'Short Break',
  long:  'Long Break',
};

/* ══════════════════════════════════════════════════════════
   6.  RENDER FUNCTIONS
   These read from `state` and update the DOM. They do NOT
   change state themselves.
══════════════════════════════════════════════════════════ */

/** Update the big timer numbers */
function renderTime() {
  dom.timerTime.textContent = formatTime(state.remainingSeconds);
}

/** Update the ring arc */
function renderRing() {
  const fraction = state.totalSeconds > 0
    ? state.remainingSeconds / state.totalSeconds
    : 1;
  setRingProgress(fraction);
}

/** Update play/pause icon */
function renderPlayPause() {
  dom.btnPlayIcon.textContent = state.isRunning ? '⏸' : '▶';
}

/** Update mode tab highlights and body class */
function renderMode() {
  dom.modeTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.mode === state.mode);
  });
  dom.body.className = `mode-${state.mode}`;
  dom.timerLabel.textContent = MODE_LABELS[state.mode];
}

/** Render session dots (up to 4) */
function renderSessionDots() {
  dom.sessionDots.innerHTML = '';
  for (let i = 0; i < state.sessionsUntilLong; i++) {
    const dot = document.createElement('div');
    dot.className = 'dot' + (i < state.sessionsCompleted ? ' completed' : '');
    dom.sessionDots.appendChild(dot);
  }
}

/** Render settings panel values */
function renderSettings() {
  dom.rangeWork.value  = state.durations.work;
  dom.rangeShort.value = state.durations.short;
  dom.rangeLong.value  = state.durations.long;
  dom.valWork.textContent  = `${state.durations.work} min`;
  dom.valShort.textContent = `${state.durations.short} min`;
  dom.valLong.textContent  = `${state.durations.long} min`;
  dom.toggleSound.checked  = state.soundEnabled;

  // Highlight active preset
  dom.presetBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === state.activePreset);
  });

  // Open/close the panel
  dom.settingsCard.classList.toggle('open', state.settingsOpen);
}

/** Call ALL render functions — a full UI sync */
function renderAll() {
  renderTime();
  renderRing();
  renderPlayPause();
  renderMode();
  renderSessionDots();
  renderSettings();
}

/* ══════════════════════════════════════════════════════════
   7.  TIMER CORE
══════════════════════════════════════════════════════════ */

/** Load the current mode's duration into state */
function loadDuration() {
  const seconds = minutesToSeconds(state.durations[state.mode]);
  state.totalSeconds = seconds;
  state.remainingSeconds = seconds;
}

/** Start the countdown */
function startTimer() {
  if (state.isRunning) return;
  state.isRunning = true;

  state.intervalId = setInterval(() => {
    if (state.remainingSeconds <= 0) {
      onTimerComplete();
      return;
    }
    state.remainingSeconds--;
    renderTime();
    renderRing();
  }, 1000);

  renderPlayPause();
}

/** Pause the countdown */
function pauseTimer() {
  if (!state.isRunning) return;
  state.isRunning = false;
  clearInterval(state.intervalId);
  state.intervalId = null;
  renderPlayPause();
}

/** Reset the current session (don't change mode or sessions) */
function resetTimer() {
  pauseTimer();
  loadDuration();
  renderTime();
  renderRing();
}

/** Called when the timer reaches zero */
function onTimerComplete() {
  pauseTimer();

  // Flash the time display
  dom.timerTime.classList.add('flash');
  setTimeout(() => dom.timerTime.classList.remove('flash'), 1500);

  // Play a sound if enabled
  if (state.soundEnabled) playBeep();

  // Determine which mode comes next (before switching)
  let nextMode;
  if (state.mode === 'work') {
    const nextCount = state.sessionsCompleted + 1;
    nextMode = nextCount >= state.sessionsUntilLong ? 'long' : 'short';
  } else {
    nextMode = 'work';
  }

  // ── Electron Desktop Notification ──────────────────────────
  // window.electronAPI is injected by the preload script ONLY
  // when running inside Electron. This guard keeps the code
  // safe to run in a plain browser too.
  if (window.electronAPI) {
    window.electronAPI.timerComplete({
      mode:     state.mode,
      nextMode: nextMode,
    });
  }

  // Track work sessions, then auto-switch mode
  if (state.mode === 'work') {
    state.sessionsCompleted++;
    if (state.sessionsCompleted >= state.sessionsUntilLong) {
      // Time for a long break!
      state.sessionsCompleted = 0;
      switchMode('long');
    } else {
      switchMode('short');
    }
  } else {
    // After any break, go back to work
    switchMode('work');
  }
}

/* ══════════════════════════════════════════════════════════
   8.  MODE SWITCHING
══════════════════════════════════════════════════════════ */

/**
 * Switch to a new mode.
 * @param {'work'|'short'|'long'} newMode
 */
function switchMode(newMode) {
  pauseTimer();
  state.mode = newMode;
  loadDuration();
  renderMode();
  renderTime();
  renderRing();
  renderSessionDots();
}

/* ══════════════════════════════════════════════════════════
   9.  SOUND
   We generate a simple beep using the Web Audio API — no
   audio files needed! Great for learning audio on the web.
══════════════════════════════════════════════════════════ */

let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

/**
 * Play a short beep sequence using the Web Audio API.
 * OscillatorNode → GainNode → destination (speakers).
 */
function playBeep() {
  try {
    const ctx = getAudioContext();
    const beeps = [
      { freq: 880, start: 0,   dur: 0.12 },
      { freq: 880, start: 0.18, dur: 0.12 },
      { freq: 1100, start: 0.36, dur: 0.25 },
    ];
    beeps.forEach(({ freq, start, dur }) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + start);
      gain.gain.linearRampToValueAtTime(0.4, ctx.currentTime + start + 0.01);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.05);
    });
  } catch (e) {
    console.warn('Audio playback failed:', e);
  }
}

/* ══════════════════════════════════════════════════════════
   10.  EVENT LISTENERS
   Wire up all user interactions.
══════════════════════════════════════════════════════════ */

function bindEvents() {

  /* ─── Play / Pause ─── */
  dom.btnPlayPause.addEventListener('click', () => {
    if (state.isRunning) {
      pauseTimer();
    } else {
      startTimer();
    }
  });

  /* ─── Reset ─── */
  dom.btnReset.addEventListener('click', () => {
    resetTimer();
  });

  /* ─── Skip ─── */
  dom.btnSkip.addEventListener('click', () => {
    // Skip to next session (same logic as completing the session)
    pauseTimer();
    onTimerComplete();
  });

  /* ─── Mode Tabs ─── */
  dom.modeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      if (tab.dataset.mode !== state.mode) {
        switchMode(tab.dataset.mode);
      }
    });
  });

  /* ─── Settings Toggle ─── */
  dom.btnSettings.addEventListener('click', () => {
    state.settingsOpen = !state.settingsOpen;
    renderSettings();
  });

  /* ─── Preset Buttons ─── */
  dom.presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.preset;
      state.activePreset = key;
      state.durations = { ...PRESETS[key] };
      // Also sync sliders
      pauseTimer();
      loadDuration();
      renderAll();
    });
  });

  /* ─── Duration Sliders ─── */
  dom.rangeWork.addEventListener('input', () => {
    state.durations.work = parseInt(dom.rangeWork.value);
    state.activePreset = 'custom';  // no longer a preset
    dom.valWork.textContent = `${state.durations.work} min`;
    // If we're in work mode, reload duration
    if (state.mode === 'work' && !state.isRunning) {
      loadDuration();
      renderTime();
      renderRing();
    }
    renderSettings(); // re-highlight preset buttons
  });

  dom.rangeShort.addEventListener('input', () => {
    state.durations.short = parseInt(dom.rangeShort.value);
    state.activePreset = 'custom';
    dom.valShort.textContent = `${state.durations.short} min`;
    if (state.mode === 'short' && !state.isRunning) {
      loadDuration();
      renderTime();
      renderRing();
    }
    renderSettings();
  });

  dom.rangeLong.addEventListener('input', () => {
    state.durations.long = parseInt(dom.rangeLong.value);
    state.activePreset = 'custom';
    dom.valLong.textContent = `${state.durations.long} min`;
    if (state.mode === 'long' && !state.isRunning) {
      loadDuration();
      renderTime();
      renderRing();
    }
    renderSettings();
  });

  /* ─── Sound Toggle ─── */
  dom.toggleSound.addEventListener('change', () => {
    state.soundEnabled = dom.toggleSound.checked;
  });

  /* ─── Keyboard Shortcuts ─── */
  document.addEventListener('keydown', e => {
    // Ignore if user is typing in an input
    if (e.target.tagName === 'INPUT') return;

    switch (e.key) {
      case ' ':               // Space = play/pause
        e.preventDefault();
        dom.btnPlayPause.click();
        break;
      case 'r': case 'R':    // R = reset
        resetTimer();
        break;
      case 's': case 'S':    // S = settings
        state.settingsOpen = !state.settingsOpen;
        renderSettings();
        break;
    }
  });
}

/* ══════════════════════════════════════════════════════════
   11.  INIT
   Everything starts here.
══════════════════════════════════════════════════════════ */
function init() {
  setupRing();          // compute SVG circumference
  loadDuration();       // set initial time from state
  bindEvents();         // attach all listeners
  renderAll();          // paint the full UI
}

// Wait for DOM to be fully loaded before running
document.addEventListener('DOMContentLoaded', init);
