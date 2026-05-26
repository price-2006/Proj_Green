'use strict';
/* pomodoro.js — Timer + Music Player */

const PRESETS = {
  classic: { work: 25, short: 5,  long: 15 },
  long50:  { work: 50, short: 10, long: 20 },
  long45:  { work: 45, short: 8,  long: 20 },
};

const state = {
  mode: 'work', durations: { ...PRESETS.classic },
  totalSeconds: 0, remainingSeconds: 0,
  isRunning: false, intervalId: null,
  sessionsCompleted: 0, sessionsUntilLong: 4,
  soundEnabled: true, activePreset: 'classic',
  settingsOpen: false, musicOpen: false,
  // music
  tracks: [], currentTrack: -1, musicPlaying: false, autoplay: false,
};

const $ = id => document.getElementById(id);
const dom = {
  timerTime: $('timer-time'), timerLabel: $('timer-label'),
  btnPlayPause: $('btn-play-pause'), btnPlayIcon: $('btn-play-icon'),
  btnReset: $('btn-reset'), btnSkip: $('btn-skip'),
  btnSettings: $('btn-settings'), btnMusicToggle: $('btn-music-toggle'),
  modeTabs: document.querySelectorAll('.mode-tab'),
  sessionDots: $('session-dots'), ringProgress: $('ring-progress'),
  settingsCard: $('settings-card'), musicCard: $('music-card'),
  rangeWork: $('range-work'), rangeShort: $('range-short'), rangeLong: $('range-long'),
  valWork: $('val-work'), valShort: $('val-short'), valLong: $('val-long'),
  toggleSound: $('toggle-sound'), presetBtns: document.querySelectorAll('.preset-btn'),
  // music
  musicAudio: $('music-audio'), musicNowPlaying: $('music-now-playing'),
  musicPlayPause: $('music-playpause'), musicPrev: $('music-prev'), musicNext: $('music-next'),
  musicVolume: $('music-volume'), musicVolLabel: $('music-vol-label'),
  musicList: $('music-list'), toggleAutoplay: $('toggle-autoplay'),
};

/* ── Ring ── */
function setupRing() {
  const r = parseFloat(dom.ringProgress.getAttribute('r'));
  const c = 2 * Math.PI * r;
  dom.ringProgress.style.strokeDasharray  = c;
  dom.ringProgress.style.strokeDashoffset = 0;
  dom.ringProgress._c = c;
}
function setRingProgress(f) {
  dom.ringProgress.style.strokeDashoffset = dom.ringProgress._c - f * dom.ringProgress._c;
}

/* ── Helpers ── */
const toSec  = m => m * 60;
const fmt    = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
const LABELS = { work:'Focus Time', short:'Short Break', long:'Long Break' };

/* ── Render ── */
function renderTime()  { dom.timerTime.textContent = fmt(state.remainingSeconds); }
function renderRing()  { setRingProgress(state.totalSeconds > 0 ? state.remainingSeconds / state.totalSeconds : 1); }
function renderPlay()  { dom.btnPlayIcon.textContent = state.isRunning ? '⏸' : '▶'; }
function renderMode() {
  dom.modeTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === state.mode));
  dom.timerLabel.textContent = LABELS[state.mode];
  const colors = { work: '#30d158', short: '#0a84ff', long: '#bf5af2' };
  dom.ringProgress.style.stroke = colors[state.mode];
  dom.btnPlayPause.style.background = colors[state.mode];
}
function renderDots() {
  dom.sessionDots.innerHTML = '';
  for (let i = 0; i < state.sessionsUntilLong; i++) {
    const d = document.createElement('div');
    d.className = 'dot' + (i < state.sessionsCompleted ? ' completed' : '');
    dom.sessionDots.appendChild(d);
  }
}
function renderSettings() {
  dom.rangeWork.value  = state.durations.work;
  dom.rangeShort.value = state.durations.short;
  dom.rangeLong.value  = state.durations.long;
  dom.valWork.textContent  = `${state.durations.work} min`;
  dom.valShort.textContent = `${state.durations.short} min`;
  dom.valLong.textContent  = `${state.durations.long} min`;
  dom.toggleSound.checked  = state.soundEnabled;
  dom.presetBtns.forEach(b => b.classList.toggle('active', b.dataset.preset === state.activePreset));
  dom.settingsCard.classList.toggle('open', state.settingsOpen);
  dom.musicCard.classList.toggle('open', state.musicOpen);
}
function renderAll() { renderTime(); renderRing(); renderPlay(); renderMode(); renderDots(); renderSettings(); }

/* ── Timer core ── */
function loadDuration() {
  const s = toSec(state.durations[state.mode]);
  state.totalSeconds = s; state.remainingSeconds = s;
}
function startTimer() {
  if (state.isRunning) return;
  state.isRunning = true;
  state.intervalId = setInterval(() => {
    if (state.remainingSeconds <= 0) { onComplete(); return; }
    state.remainingSeconds--;
    renderTime(); renderRing();
  }, 1000);
  renderPlay();
  if (state.autoplay && !state.musicPlaying) musicPlay();
}
function pauseTimer() {
  if (!state.isRunning) return;
  state.isRunning = false;
  clearInterval(state.intervalId); state.intervalId = null;
  renderPlay();
}
function resetTimer() { pauseTimer(); loadDuration(); renderTime(); renderRing(); }

function onComplete() {
  pauseTimer();
  dom.timerTime.classList.add('flash');
  setTimeout(() => dom.timerTime.classList.remove('flash'), 1500);
  if (state.soundEnabled) playBeep();

  let nextMode;
  if (state.mode === 'work') {
    const next = state.sessionsCompleted + 1;
    nextMode = next >= state.sessionsUntilLong ? 'long' : 'short';
  } else { nextMode = 'work'; }

  window.electronAPI?.timerComplete({ mode: state.mode, nextMode });

  if (state.mode === 'work') {
    state.sessionsCompleted++;
    if (state.sessionsCompleted >= state.sessionsUntilLong) {
      state.sessionsCompleted = 0; switchMode('long');
    } else { switchMode('short'); }
  } else { switchMode('work'); }
}

function switchMode(m) { pauseTimer(); state.mode = m; loadDuration(); renderMode(); renderTime(); renderRing(); renderDots(); }

/* ── Audio (beep) ── */
let audioCtx = null;
function playBeep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    [{ f:880,s:0,d:.12 },{ f:880,s:.18,d:.12 },{ f:1100,s:.36,d:.25 }].forEach(({ f,s,d }) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, audioCtx.currentTime + s);
      g.gain.linearRampToValueAtTime(0.4, audioCtx.currentTime + s + .01);
      g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + s + d);
      o.start(audioCtx.currentTime + s); o.stop(audioCtx.currentTime + s + d + .05);
    });
  } catch(e) { console.warn('beep failed', e); }
}

/* ── Music player ── */
async function loadTracks() {
  state.tracks = (await window.electronAPI?.musicListFiles?.()) || [];
  renderTrackList();
}

function renderTrackList() {
  const ul = dom.musicList;
  ul.innerHTML = '';
  if (!state.tracks.length) {
    ul.innerHTML = '<li class="music-empty">No audio files found in public/music/</li>';
    return;
  }
  state.tracks.forEach((t, i) => {
    const li = document.createElement('li');
    li.className = 'music-track' + (i === state.currentTrack ? ' active' : '');
    li.textContent = t.name.replace(/\.[^.]+$/, '');
    li.setAttribute('role', 'option');
    li.addEventListener('click', () => { state.currentTrack = i; musicPlay(); renderTrackList(); });
    ul.appendChild(li);
  });
}

function musicPlay() {
  if (!state.tracks.length) return;
  if (state.currentTrack < 0) state.currentTrack = 0;
  const t = state.tracks[state.currentTrack];
  // Use file:// path
  dom.musicAudio.src = `file://${t.path.replace(/\\/g,'/')}`;
  dom.musicAudio.volume = parseInt(dom.musicVolume.value) / 100;
  dom.musicAudio.play().catch(e => console.warn('music play err', e));
  state.musicPlaying = true;
  dom.musicPlayPause.innerHTML = '⏸';
  dom.musicNowPlaying.textContent = t.name.replace(/\.[^.]+$/, '');
  renderTrackList();
}

function musicPause() {
  dom.musicAudio.pause();
  state.musicPlaying = false;
  dom.musicPlayPause.innerHTML = '▶';
}

function musicToggle() { state.musicPlaying ? musicPause() : musicPlay(); }

function musicPrev() {
  if (!state.tracks.length) return;
  state.currentTrack = (state.currentTrack - 1 + state.tracks.length) % state.tracks.length;
  if (state.musicPlaying) musicPlay(); else { dom.musicNowPlaying.textContent = state.tracks[state.currentTrack].name.replace(/\.[^.]+$/,''); renderTrackList(); }
}
function musicNext() {
  if (!state.tracks.length) return;
  state.currentTrack = (state.currentTrack + 1) % state.tracks.length;
  if (state.musicPlaying) musicPlay(); else { dom.musicNowPlaying.textContent = state.tracks[state.currentTrack].name.replace(/\.[^.]+$/,''); renderTrackList(); }
}

/* ── Events ── */
function bindEvents() {
  dom.btnPlayPause.addEventListener('click', () => state.isRunning ? pauseTimer() : startTimer());
  dom.btnReset.addEventListener('click', resetTimer);
  dom.btnSkip.addEventListener('click', () => { pauseTimer(); onComplete(); });
  dom.modeTabs.forEach(t => t.addEventListener('click', () => { if (t.dataset.mode !== state.mode) switchMode(t.dataset.mode); }));

  dom.btnSettings.addEventListener('click', () => { state.settingsOpen = !state.settingsOpen; renderSettings(); });
  dom.btnMusicToggle.addEventListener('click', () => { state.musicOpen = !state.musicOpen; if (state.musicOpen) loadTracks(); renderSettings(); });

  dom.presetBtns.forEach(b => b.addEventListener('click', () => {
    state.activePreset = b.dataset.preset;
    state.durations = { ...PRESETS[b.dataset.preset] };
    pauseTimer(); loadDuration(); renderAll();
  }));

  dom.rangeWork.addEventListener('input', function() { state.durations.work = parseInt(this.value); state.activePreset='custom'; dom.valWork.textContent=`${this.value} min`; if(state.mode==='work'&&!state.isRunning){loadDuration();renderTime();renderRing();} renderSettings(); });
  dom.rangeShort.addEventListener('input', function() { state.durations.short = parseInt(this.value); state.activePreset='custom'; dom.valShort.textContent=`${this.value} min`; if(state.mode==='short'&&!state.isRunning){loadDuration();renderTime();renderRing();} renderSettings(); });
  dom.rangeLong.addEventListener('input', function() { state.durations.long = parseInt(this.value); state.activePreset='custom'; dom.valLong.textContent=`${this.value} min`; if(state.mode==='long'&&!state.isRunning){loadDuration();renderTime();renderRing();} renderSettings(); });

  dom.toggleSound.addEventListener('change', () => { state.soundEnabled = dom.toggleSound.checked; });

  // Music
  dom.musicPlayPause.addEventListener('click', musicToggle);
  dom.musicPrev.addEventListener('click', musicPrev);
  dom.musicNext.addEventListener('click', musicNext);
  dom.musicAudio.addEventListener('ended', musicNext);
  dom.musicVolume.addEventListener('input', function() {
    dom.musicAudio.volume = this.value / 100;
    dom.musicVolLabel.textContent = `${this.value}%`;
  });
  dom.toggleAutoplay.addEventListener('change', () => { state.autoplay = dom.toggleAutoplay.checked; });

  document.addEventListener('keydown', e => {
    if (e.target.closest('#panel-notepad')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === ' ') { e.preventDefault(); dom.btnPlayPause.click(); }
    if (e.key === 'r' || e.key === 'R') resetTimer();
    if (e.key === 's' || e.key === 'S') { state.settingsOpen = !state.settingsOpen; renderSettings(); }
  });
}

function init() { setupRing(); loadDuration(); bindEvents(); renderAll(); }
document.addEventListener('DOMContentLoaded', init);
