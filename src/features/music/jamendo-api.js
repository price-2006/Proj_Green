'use strict';
/* jamendo-api.js — Lightweight wrapper around the Jamendo v3.0 REST API
 *
 * All requests are read-only (GET). No auth tokens needed — just a Client ID.
 * Client ID is free: https://developer.jamendo.com/v3.0
 *
 * Base URL: https://api.jamendo.com/v3.0
 *
 * Key endpoints used:
 *   /tracks/   — search, browse by tag/mood
 *   /radios/   — curated station streams (ambient, chill, etc.)
 */

const JAMENDO_BASE = 'https://api.jamendo.com/v3.0';

// ── Client ID storage ──────────────────────────────────────────────────────────
// Persisted to localStorage so the user only enters it once.
const CLIENT_ID_KEY = 'jamendo_client_id';

export function getClientId() {
  return localStorage.getItem(CLIENT_ID_KEY) || '';
}

export function setClientId(id) {
  localStorage.setItem(CLIENT_ID_KEY, id.trim());
}

export function hasClientId() {
  return !!getClientId();
}

// ── Internal fetch helper ──────────────────────────────────────────────────────
async function apiGet(endpoint, params = {}) {
  const clientId = getClientId();
  if (!clientId) throw new Error('No Jamendo Client ID configured.');

  const url = new URL(`${JAMENDO_BASE}${endpoint}`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('format', 'json');

  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Jamendo API error: HTTP ${res.status}`);

  const json = await res.json();
  if (json.headers?.status !== 'success') {
    throw new Error(json.headers?.error_message || 'Unknown Jamendo API error');
  }
  return json;
}

// ── Track normalizer ───────────────────────────────────────────────────────────
// Converts a raw Jamendo track object into the shape our player expects.
function normalizeTrack(t) {
  return {
    id:         t.id,
    name:       t.name,
    artist:     t.artist_name,
    album:      t.album_name,
    duration:   t.duration,           // seconds
    streamUrl:  t.audio,              // direct .mp3 stream URL
    coverUrl:   t.album_image || t.image || '',
    shareUrl:   t.shareurl,
    license:    t.license_ccurl,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Search tracks by keyword (name, artist, etc.)
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Track[]>}
 */
export async function searchTracks(query, limit = 30) {
  const data = await apiGet('/tracks/', {
    namesearch: query,
    limit,
    audioformat: 'mp32',
    include: 'musicinfo',
    imagesize: 200,
  });
  return (data.results || []).map(normalizeTrack);
}

/**
 * Fetch tracks by mood/genre tag (e.g. 'lofi', 'ambient', 'study', 'jazz')
 * @param {string} tag  Jamendo tag name
 * @param {number} limit
 * @returns {Promise<Track[]>}
 */
export async function getTagTracks(tag, limit = 30) {
  const data = await apiGet('/tracks/', {
    tags: tag,
    limit,
    audioformat: 'mp32',
    include: 'musicinfo',
    imagesize: 200,
    order: 'popularity_total',
  });
  return (data.results || []).map(normalizeTrack);
}

/**
 * Fetch featured / popular tracks (default state when no search).
 * Uses the 'study' and 'ambient' tags rotated for variety.
 * @returns {Promise<Track[]>}
 */
export async function getFeaturedTracks(limit = 30) {
  const data = await apiGet('/tracks/', {
    tags: 'ambient',
    limit,
    audioformat: 'mp32',
    include: 'musicinfo',
    imagesize: 200,
    order: 'popularity_month',
    boost: 'listens_month',
  });
  return (data.results || []).map(normalizeTrack);
}

/**
 * Validate the Client ID by making a minimal API call.
 * Returns true if the ID is valid.
 */
export async function validateClientId(clientId) {
  const url = new URL(`${JAMENDO_BASE}/tracks/`);
  url.searchParams.set('client_id', clientId.trim());
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');

  const res = await fetch(url.toString());
  if (!res.ok) return false;
  const json = await res.json();
  return json.headers?.status === 'success';
}

// ── Genre chips config (used by the UI) ───────────────────────────────────────
export const GENRE_CHIPS = [
  { label: 'Featured',  tag: null,       icon: '★' },
  { label: 'Lo-fi',     tag: 'lofi',     icon: null },
  { label: 'Ambient',   tag: 'ambient',  icon: null },
  { label: 'Focus',     tag: 'study',    icon: null },
  { label: 'Jazz',      tag: 'jazz',     icon: null },
  { label: 'Classical', tag: 'classical',icon: null },
  { label: 'Chill',     tag: 'chillout', icon: null },
];
