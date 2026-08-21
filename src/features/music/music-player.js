'use strict';
/* music-player.js — Jamendo-backed music player for the Pomodoro panel
 *
 * Controls the existing <audio id="music-audio"> element.
 * Exposes a simple interface: play, pause, resume, next, prev, setVolume.
 * Fires custom DOM events so pomodoro.js can hook in without coupling.
 *
 * Events dispatched on document:
 *   'music:statechange'  — { detail: { playing, track } }
 */

import {
  getClientId, setClientId, hasClientId, validateClientId,
  searchTracks, getTagTracks, getFeaturedTracks, GENRE_CHIPS,
} from './jamendo-api.js';

// ── State ──────────────────────────────────────────────────────────────────────
let playlist      = [];   // array of normalized track objects
let currentIndex  = -1;
let isPlaying     = false;
let volume        = 0.7;

// ── DOM refs (resolved lazily after DOMContentLoaded) ─────────────────────────
const el = {
  audio:           () => document.getElementById('music-audio'),
  nowPlaying:      () => document.getElementById('music-now-playing'),
  artistLabel:     () => document.getElementById('music-artist-label'),
  coverImg:        () => document.getElementById('music-cover'),
  playPause:       () => document.getElementById('music-playpause'),
  prev:            () => document.getElementById('music-prev'),
  next:            () => document.getElementById('music-next'),
  volumeSlider:    () => document.getElementById('music-volume'),
  volLabel:        () => document.getElementById('music-vol-label'),
  trackList:       () => document.getElementById('music-list'),
  searchInput:     () => document.getElementById('music-search'),
  genreChips:      () => document.getElementById('music-genre-chips'),
  setupPanel:      () => document.getElementById('music-setup-panel'),
  playerPanel:     () => document.getElementById('music-player-panel'),
  clientIdInput:   () => document.getElementById('music-client-id-input'),
  connectBtn:      () => document.getElementById('music-connect-btn'),
  connectError:    () => document.getElementById('music-connect-error'),
  loadingState:    () => document.getElementById('music-loading'),
  emptyState:      () => document.getElementById('music-empty'),
  progressBar:     () => document.getElementById('music-progress'),
  progressFill:    () => document.getElementById('music-progress-fill'),
  currentTime:     () => document.getElementById('music-current-time'),
  totalTime:       () => document.getElementById('music-total-time'),
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtTime(secs) {
  if (!secs || isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function dispatch(playing, track) {
  document.dispatchEvent(new CustomEvent('music:statechange', {
    detail: { playing, track: track || null }
  }));
}

// ── Playback ───────────────────────────────────────────────────────────────────
export function play(index) {
  if (!playlist.length) return;
  if (index !== undefined) currentIndex = Math.max(0, Math.min(index, playlist.length - 1));
  if (currentIndex < 0) currentIndex = 0;

  const track = playlist[currentIndex];
  const audio = el.audio();
  if (!audio) return;

  audio.src    = track.streamUrl;
  audio.volume = volume;
  audio.play().catch(e => console.warn('[music] play error', e));

  isPlaying = true;
  updatePlayPauseBtn();
  updateNowPlaying(track);
  renderTrackList();
  dispatch(true, track);
}

export function pause() {
  el.audio()?.pause();
  isPlaying = false;
  updatePlayPauseBtn();
  dispatch(false, currentTrack());
}

export function resume() {
  if (!el.audio()?.src) { play(currentIndex); return; }
  el.audio()?.play().catch(e => console.warn('[music] resume error', e));
  isPlaying = true;
  updatePlayPauseBtn();
  dispatch(true, currentTrack());
}

export function toggle() {
  isPlaying ? pause() : resume();
}

export function next() {
  if (!playlist.length) return;
  play((currentIndex + 1) % playlist.length);
}

export function prev() {
  if (!playlist.length) return;
  const audio = el.audio();
  // If more than 3s in, restart current track; otherwise go back
  if (audio && audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  play((currentIndex - 1 + playlist.length) % playlist.length);
}

export function setVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  const audio = el.audio();
  if (audio) audio.volume = volume;
}

export function getIsPlaying() { return isPlaying; }

function currentTrack() {
  return playlist[currentIndex] || null;
}

// ── UI updates ─────────────────────────────────────────────────────────────────
function updatePlayPauseBtn() {
  const btn = el.playPause();
  if (!btn) return;
  // SVG play icon vs pause icon
  btn.innerHTML = isPlaying
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
}

function updateNowPlaying(track) {
  const np = el.nowPlaying();
  const ar = el.artistLabel();
  const cv = el.coverImg();
  if (np) np.textContent = track?.name  || 'No track selected';
  if (ar) ar.textContent = track?.artist || '';
  if (cv) {
    if (track?.coverUrl) {
      cv.src = track.coverUrl;
      cv.style.display = 'block';
    } else {
      cv.style.display = 'none';
    }
  }
}

function renderTrackList() {
  const ul = el.trackList();
  if (!ul) return;
  ul.innerHTML = '';

  if (!playlist.length) {
    const li = document.createElement('li');
    li.className = 'music-empty';
    li.id = 'music-empty';
    li.textContent = 'No tracks found.';
    ul.appendChild(li);
    return;
  }

  playlist.forEach((track, i) => {
    const li = document.createElement('li');
    li.className = 'music-track' + (i === currentIndex ? ' active' : '');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', i === currentIndex ? 'true' : 'false');
    li.innerHTML = `
      <div class="music-track-name">${track.name}</div>
      <div class="music-track-artist">${track.artist}</div>
    `;
    li.addEventListener('click', () => play(i));
    ul.appendChild(li);
  });
}

// ── Loading state ──────────────────────────────────────────────────────────────
function setLoading(loading) {
  const ld = el.loadingState();
  const ul = el.trackList();
  if (ld) ld.style.display = loading ? 'flex' : 'none';
  if (ul) ul.style.display = loading ? 'none' : '';
}

// ── Track loading ──────────────────────────────────────────────────────────────
let activeTag = null;  // null = featured

async function loadTracks(tag) {
  activeTag = tag;
  setLoading(true);
  try {
    playlist = tag === null
      ? await getFeaturedTracks(30)
      : await getTagTracks(tag, 30);
    currentIndex = -1;
    renderTrackList();
    updateNowPlaying(null);
  } catch (e) {
    console.error('[music] loadTracks error', e);
    const ul = el.trackList();
    if (ul) ul.innerHTML = `<li class="music-empty">Failed to load tracks: ${e.message}</li>`;
  } finally {
    setLoading(false);
  }
}

async function handleSearch(query) {
  if (!query.trim()) { loadTracks(activeTag); return; }
  setLoading(true);
  try {
    playlist = await searchTracks(query.trim(), 30);
    currentIndex = -1;
    renderTrackList();
  } catch (e) {
    console.error('[music] search error', e);
  } finally {
    setLoading(false);
  }
}

// ── Genre chips ────────────────────────────────────────────────────────────────
function renderGenreChips() {
  const container = el.genreChips();
  if (!container) return;
  container.innerHTML = '';

  GENRE_CHIPS.forEach((chip, i) => {
    const btn = document.createElement('button');
    btn.className = 'music-chip' + (i === 0 ? ' active' : '');
    btn.textContent = chip.label;
    btn.dataset.tag = chip.tag ?? '__featured__';
    btn.addEventListener('click', () => {
      container.querySelectorAll('.music-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadTracks(chip.tag);
    });
    container.appendChild(btn);
  });
}

// ── Progress bar ───────────────────────────────────────────────────────────────
function setupProgressBar() {
  const audio = el.audio();
  const fill  = el.progressFill();
  const bar   = el.progressBar();
  const cur   = el.currentTime();
  const tot   = el.totalTime();

  if (!audio) return;

  audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    if (fill) fill.style.width = `${pct}%`;
    if (cur)  cur.textContent  = fmtTime(audio.currentTime);
    if (tot)  tot.textContent  = fmtTime(audio.duration);
  });

  audio.addEventListener('ended', next);

  // Click to seek
  if (bar) {
    bar.addEventListener('click', e => {
      if (!audio.duration) return;
      const rect = bar.getBoundingClientRect();
      const pct  = (e.clientX - rect.left) / rect.width;
      audio.currentTime = pct * audio.duration;
    });
  }
}

// ── Auth / setup panel ─────────────────────────────────────────────────────────
function showSetup() {
  const setup  = el.setupPanel();
  const player = el.playerPanel();
  if (setup)  setup.classList.remove('hidden');
  if (player) player.classList.add('hidden');
}

function showPlayer() {
  const setup  = el.setupPanel();
  const player = el.playerPanel();
  if (setup)  setup.classList.add('hidden');
  if (player) player.classList.remove('hidden');
}

function setConnectError(msg, isSuccess = false) {
  const err = el.connectError();
  if (!err) return;
  err.textContent = msg;
  err.style.color = msg
    ? (isSuccess ? 'var(--accent)' : 'var(--red)')
    : '';
}

// ── Init ───────────────────────────────────────────────────────────────────────
export function init() {
  // Determine if already configured
  if (hasClientId()) {
    showPlayer();
    renderGenreChips();
    setupProgressBar();
    loadTracks(null);  // load featured tracks
  } else {
    showSetup();
  }

  // Connect button
  el.connectBtn()?.addEventListener('click', async () => {
    const raw = el.clientIdInput()?.value?.trim() ?? '';
    if (!raw) { setConnectError('Please enter your Client ID.'); return; }

    setConnectError('Connecting...');
    const valid = await validateClientId(raw);
    if (!valid) {
      setConnectError('Invalid Client ID. Check your Jamendo developer dashboard.');
      return;
    }

    setClientId(raw);
    setConnectError('Connected!', true);
    setTimeout(() => {
      showPlayer();
      renderGenreChips();
      setupProgressBar();
      loadTracks(null);
    }, 600);
  });

  // Search
  let searchTimer = null;
  el.searchInput()?.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => handleSearch(this.value), 400);
  });

  // Playback controls
  el.playPause()?.addEventListener('click', toggle);
  el.prev()?.addEventListener('click', prev);
  el.next()?.addEventListener('click', next);

  // Volume
  el.volumeSlider()?.addEventListener('input', function () {
    setVolume(this.value / 100);
    const lbl = el.volLabel();
    if (lbl) lbl.textContent = `${this.value}%`;
  });

  // Keyboard shortcut — expose the toggle for pomodoro.js
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey) toggle();
  });

  // Auto-play when pomodoro timer starts (if autoplay toggle is on in pomodoro.js)
  document.addEventListener('pomodoro:start', () => {
    if (!isPlaying && playlist.length) resume();
  });
}
