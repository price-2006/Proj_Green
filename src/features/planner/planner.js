'use strict';
/* planner.js — Weekly Calendar Grid */

document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('panel-planner')) return;

  const DAYS   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const HOURS  = Array.from({ length: 17 }, (_, i) => i + 7); // 7am–11pm
  const COLORS = ['#30d158','#0a84ff','#ff9f0a','#ff453a','#bf5af2'];

  let tasks        = [];
  let weekOffset   = 0;
  let editingId    = null;
  let selectedColor = COLORS[0];

  // ── Week helpers ───────────────────────────────────────
  function getWeekStart(offset = 0) {
    const d = new Date();
    const day = d.getDay();
    const diff = (day === 0 ? -6 : 1 - day); // Monday-based
    d.setDate(d.getDate() + diff + offset * 7);
    d.setHours(0,0,0,0);
    return d;
  }

  function getWeekDates(offset = 0) {
    const start = getWeekStart(offset);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d;
    });
  }

  function dateStr(d) { return d.toISOString().split('T')[0]; }

  // ── Render grid ────────────────────────────────────────
  function renderGrid() {
    const dates = getWeekDates(weekOffset);
    const grid  = document.getElementById('planner-grid');
    const label = document.getElementById('week-label');
    const today = dateStr(new Date());

    // Update week label
    const m0 = dates[0], m6 = dates[6];
    label.textContent = `${m0.toLocaleDateString([],{month:'short',day:'numeric'})} – ${m6.toLocaleDateString([],{month:'short',day:'numeric'})}`;

    grid.innerHTML = '';

    // Time column
    const timeCol = document.createElement('div');
    timeCol.className = 'grid-time-col';
    // header spacer
    const spacer = document.createElement('div');
    spacer.style.cssText = 'height:44px;border-bottom:1px solid rgba(255,255,255,0.06)';
    timeCol.appendChild(spacer);
    HOURS.forEach(h => {
      const lbl = document.createElement('div');
      lbl.className = 'time-slot-label';
      lbl.textContent = `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
      timeCol.appendChild(lbl);
    });
    grid.appendChild(timeCol);

    // Day columns
    dates.forEach((date, di) => {
      const col = document.createElement('div');
      col.className = 'day-col';

      // Header
      const header = document.createElement('div');
      header.className = 'day-header' + (dateStr(date) === today ? ' today' : '');
      header.innerHTML = `<span class="day-name">${DAYS[di]}</span><span class="day-num">${date.getDate()}</span>`;
      col.appendChild(header);

      // Slots
      const ds = dateStr(date);
      HOURS.forEach(h => {
        const slot = document.createElement('div');
        slot.className = 'grid-slot';
        slot.dataset.date = ds;
        slot.dataset.hour = h;
        slot.addEventListener('click', () => openModal(ds, h));
        col.appendChild(slot);
      });

      // Render tasks on this day
      tasks.filter(t => t.date === ds).forEach(task => {
        const [sh, sm] = task.start.split(':').map(Number);
        const [eh, em] = task.end.split(':').map(Number);
        const startH = sh + sm / 60;
        const endH   = eh + em / 60;
        const topOffset    = (startH - HOURS[0]) * 56 + 44; // px
        const heightPx     = Math.max((endH - startH) * 56, 24);

        const block = document.createElement('div');
        block.className = 'task-block';
        block.style.cssText = `top:${topOffset}px;height:${heightPx}px;background:${task.color}22;color:${task.color};border-left:3px solid ${task.color}`;
        block.textContent = task.title;
        block.title = `${task.title}\n${task.start}–${task.end}${task.notes ? '\n'+task.notes : ''}`;
        block.addEventListener('click', e => { e.stopPropagation(); openModal(ds, sh, task.id); });
        col.style.position = 'relative';
        col.appendChild(block);
      });

      grid.appendChild(col);
    });
  }

  // ── Modal ──────────────────────────────────────────────
  const overlay    = document.getElementById('task-modal-overlay');
  const titleInput = document.getElementById('task-title');
  const dateInput  = document.getElementById('task-date');
  const startInput = document.getElementById('task-start');
  const endInput   = document.getElementById('task-end');
  const notesInput = document.getElementById('task-notes');
  const modalTitle = document.getElementById('modal-title');
  const colorDots  = document.querySelectorAll('.color-dot');

  function openModal(date, hour, taskId = null) {
    editingId = taskId;
    modalTitle.textContent = taskId ? 'Edit Task' : 'New Task';

    if (taskId) {
      const t = tasks.find(x => x.id === taskId);
      if (!t) return;
      titleInput.value = t.title;
      dateInput.value  = t.date;
      startInput.value = t.start;
      endInput.value   = t.end;
      notesInput.value = t.notes || '';
      selectedColor = t.color;
    } else {
      titleInput.value = '';
      dateInput.value  = date;
      startInput.value = `${String(hour).padStart(2,'0')}:00`;
      endInput.value   = `${String(hour+1).padStart(2,'0')}:00`;
      notesInput.value = '';
      selectedColor = COLORS[0];
    }

    colorDots.forEach(d => d.classList.toggle('active', d.dataset.color === selectedColor));
    overlay.classList.remove('hidden');
    titleInput.focus();
  }

  function closeModal() { overlay.classList.add('hidden'); editingId = null; }

  colorDots.forEach(d => d.addEventListener('click', () => {
    selectedColor = d.dataset.color;
    colorDots.forEach(x => x.classList.toggle('active', x.dataset.color === selectedColor));
  }));

  document.getElementById('btn-modal-cancel')?.addEventListener('click', closeModal);
  overlay?.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  document.getElementById('btn-modal-save')?.addEventListener('click', () => {
    const title = titleInput.value.trim();
    if (!title) { titleInput.focus(); return; }

    const task = {
      id:    editingId || `t_${Date.now()}`,
      title, color: selectedColor,
      date:  dateInput.value,
      start: startInput.value,
      end:   endInput.value,
      notes: notesInput.value.trim(),
    };

    if (editingId) {
      tasks = tasks.map(t => t.id === editingId ? task : t);
    } else {
      tasks.push(task);
    }

    saveTasks();
    closeModal();
    renderGrid();
  });

  // Delete on 'Delete' key when modal is open
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Delete' && editingId && !overlay.classList.contains('hidden')) {
      if (confirm('Delete this task?')) {
        tasks = tasks.filter(t => t.id !== editingId);
        saveTasks(); closeModal(); renderGrid();
      }
    }
  });

  // ── Add Task button ─────────────────────────────────────
  document.getElementById('btn-add-task')?.addEventListener('click', () => {
    openModal(dateStr(new Date()), new Date().getHours());
  });

  // ── Week nav ───────────────────────────────────────────
  document.getElementById('btn-week-prev')?.addEventListener('click', () => { weekOffset--; renderGrid(); });
  document.getElementById('btn-week-next')?.addEventListener('click', () => { weekOffset++; renderGrid(); });

  // ── Persist ────────────────────────────────────────────
  async function saveTasks() {
    try { await window.electronAPI?.plannerSave?.(tasks); } catch(e) { console.warn('planner save err', e); }
  }

  async function loadTasks() {
    try {
      const data = await window.electronAPI?.plannerLoad?.();
      if (data?.tasks) tasks = data.tasks;
    } catch(e) { console.warn('planner load err', e); }
    renderGrid();
  }

  loadTasks();
});
