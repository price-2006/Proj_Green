'use strict';
/* app.js — Router + sidebar + clock */

document.addEventListener('DOMContentLoaded', () => {
  // ── Sidebar routing ────────────────────────────────────
  const navBtns  = document.querySelectorAll('.nav-btn');
  const panels   = document.querySelectorAll('.panel');

  function showPanel(id) {
    panels.forEach(p => p.classList.toggle('active', p.id === `panel-${id}`));
    navBtns.forEach(b => b.classList.toggle('active', b.dataset.panel === id));
    localStorage.setItem('pg-active-panel', id);
  }

  navBtns.forEach(btn => btn.addEventListener('click', () => showPanel(btn.dataset.panel)));

  const saved = localStorage.getItem('pg-active-panel') || 'pomodoro';
  showPanel(saved);

  // ── Clock ──────────────────────────────────────────────
  const clock = document.getElementById('clock-display');
  function updateClock() {
    clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  updateClock();
  setInterval(updateClock, 1000);

  // ── Window controls (custom titlebar) ─────────────────
  document.getElementById('btn-minimize')?.addEventListener('click', () => window.electronAPI?.windowMinimize());
  document.getElementById('btn-maximize')?.addEventListener('click', () => window.electronAPI?.windowMaximize());
  document.getElementById('btn-close')?.addEventListener('click',    () => window.electronAPI?.windowClose());
});
