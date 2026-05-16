'use strict';
/* notepad.js — Rich text notepad with auto-save */

document.addEventListener('DOMContentLoaded', () => {
  const editor    = document.getElementById('note-editor');
  const status    = document.getElementById('note-save-status');
  const wordcount = document.getElementById('note-wordcount');
  const btnClear  = document.getElementById('btn-clear-note');
  const toolbar   = document.querySelector('.notepad-toolbar');

  if (!editor) return;

  // ── Load saved content ──────────────────────────────────
  async function loadNote() {
    try {
      const data = await window.electronAPI?.notesLoad?.();
      if (data?.html) {
        editor.innerHTML = data.html;
      }
    } catch (e) {
      console.warn('notes load error', e);
    }
    updateWordCount();
  }

  // ── Auto-save (debounced 2 s) ───────────────────────────
  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    if (status) status.textContent = 'Unsaved changes…';
    saveTimer = setTimeout(async () => {
      try {
        await window.electronAPI?.notesSave?.(editor.innerHTML);
        if (status) {
          const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          status.textContent = `Saved at ${t}`;
        }
      } catch (e) {
        if (status) status.textContent = 'Save failed';
        console.warn('notes save error', e);
      }
    }, 2000);
  }

  // ── Word / char count ───────────────────────────────────
  function updateWordCount() {
    const text  = editor.innerText || '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;
    if (wordcount) {
      wordcount.textContent = `${words} word${words !== 1 ? 's' : ''} · ${chars} char${chars !== 1 ? 's' : ''}`;
    }
  }

  // ── execCommand wrapper ─────────────────────────────────
  function exec(cmd, value = null) {
    // Make sure editor has focus before running the command
    editor.focus();
    try {
      if (cmd === 'h1') {
        document.execCommand('formatBlock', false, 'h1');
      } else if (cmd === 'h2') {
        document.execCommand('formatBlock', false, 'h2');
      } else if (cmd === 'paragraph') {
        document.execCommand('formatBlock', false, 'p');
      } else {
        document.execCommand(cmd, false, value);
      }
    } catch (e) {
      console.warn('execCommand error:', cmd, e);
    }
    updateFormatButtons();
  }

  // ── Toolbar button active states ────────────────────────
  function updateFormatButtons() {
    ['bold', 'italic', 'underline'].forEach(cmd => {
      const btn = document.querySelector(`.fmt-btn[data-cmd="${cmd}"]`);
      if (btn) btn.classList.toggle('active', document.queryCommandState(cmd));
    });
  }

  // ── Toolbar buttons ─────────────────────────────────────
  // KEY FIX: use 'mousedown' + preventDefault() so the editor NEVER loses
  // focus/selection when a toolbar button is clicked.
  if (toolbar) {
    toolbar.querySelectorAll('.fmt-btn[data-cmd]').forEach(btn => {
      btn.addEventListener('mousedown', e => {
        e.preventDefault(); // keeps editor focused + selection intact
        exec(btn.dataset.cmd);
      });
    });
  }

  // Clear button (doesn't need mousedown trick — dialog is intentional)
  btnClear?.addEventListener('click', () => {
    if (confirm('Clear all notes? This cannot be undone.')) {
      editor.innerHTML = '';
      scheduleSave();
      updateWordCount();
      editor.focus();
    }
  });

  // ── Keyboard shortcuts inside editor ────────────────────
  editor.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 'b': e.preventDefault(); exec('bold');      break;
        case 'i': e.preventDefault(); exec('italic');    break;
        case 'u': e.preventDefault(); exec('underline'); break;
      }
    }
  });

  // ── Update button state on selection changes ────────────
  editor.addEventListener('keyup',   updateFormatButtons);
  editor.addEventListener('mouseup', updateFormatButtons);
  editor.addEventListener('focus',   updateFormatButtons);

  // ── Trigger save on content change ──────────────────────
  editor.addEventListener('input', () => {
    scheduleSave();
    updateWordCount();
  });

  // Set design-mode so execCommand works reliably in Electron
  try { document.designMode = 'off'; } catch (_) {}

  loadNote();
});
