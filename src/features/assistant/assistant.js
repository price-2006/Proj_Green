'use strict';
/* assistant.js — Gemini chatbot for the PDF viewer sidebar */

const GEMINI_MODEL = 'gemini-3.0-flash';
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models';

// ── State ──────────────────────────────────────────────────
let geminiKey = null;   // API key
let chatHistory = [];     // [{ role: 'user'|'model', parts: [{ text }] }]
let currentPdf = null;   // filename of open PDF
let isSending = false;

// ── DOM refs ───────────────────────────────────────────────
const keySetup = () => document.getElementById('chat-key-setup');
const msgList = () => document.getElementById('chat-messages');
const inputRow = () => document.getElementById('chat-input-row');
const chatInput = () => document.getElementById('chat-input');

// ── Markdown-lite renderer ─────────────────────────────────
function renderMarkdown(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // code blocks
    .replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    // inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // bullet lists
    .replace(/^[-•] (.+)/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]+?<\/li>)/g, '<ul>$1</ul>')
    // line breaks
    .replace(/\n\n+/g, '</p><p>')
    .replace(/\n/g, '<br>');
}

// ── Message rendering ──────────────────────────────────────
function appendMessage(role, text, id = null) {
  const el = document.createElement('div');
  el.className = `chat-msg ${role}`;
  if (id) el.id = id;

  if (role === 'thinking') {
    el.innerHTML = `
      <div class="chat-bubble thinking-bubble">
        <span class="thinking-dot"></span>
        <span class="thinking-dot"></span>
        <span class="thinking-dot"></span>
      </div>`;
  } else {
    const html = renderMarkdown(text);
    el.innerHTML = `
      <div class="chat-bubble">
        <div class="chat-bubble-text"><p>${html}</p></div>
      </div>`;
  }

  msgList().appendChild(el);
  msgList().scrollTop = msgList().scrollHeight;
  return el;
}

function setWelcome(pdfName) {
  const m = msgList();
  if (!m) return;
  m.innerHTML = '';
  const greeting = pdfName
    ? `Hi! I'm here to help you with **${pdfName}**. Ask me anything about it.`
    : `Hi! Open a PDF to get started, and I'll help you understand it.`;
  appendMessage('ai', greeting);
}

// ── Gemini API call ────────────────────────────────────────
async function callGemini(userText) {
  // Build system instruction
  const systemInstruction = currentPdf
    ? `You are a helpful study assistant. The user is currently reading a PDF called "${currentPdf}". Answer questions about it concisely and clearly. If a question is unrelated to the document, still help but note it's off-topic.`
    : `You are a helpful study assistant. Answer questions concisely and clearly.`;

  // Append user turn to history
  chatHistory.push({ role: 'user', parts: [{ text: userText }] });

  const body = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: chatHistory,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024,
    },
  };

  const url = `${GEMINI_API}/${GEMINI_MODEL}:generateContent?key=${geminiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(err?.error?.message || `API error ${res.status}`);
  }

  const data = await res.json();
  const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!reply) throw new Error('Empty response from Gemini');

  // Append model turn to history
  chatHistory.push({ role: 'model', parts: [{ text: reply }] });
  return reply;
}

// ── Send flow ──────────────────────────────────────────────
async function sendMessage() {
  const input = chatInput();
  const text = input?.value?.trim();
  if (!text || isSending || !geminiKey) return;

  isSending = true;
  input.value = '';
  input.style.height = 'auto';
  document.getElementById('btn-chat-send')?.classList.add('sending');

  appendMessage('user', text);
  const thinkingId = 'chat-thinking-' + Date.now();
  appendMessage('thinking', '', thinkingId);

  try {
    const reply = await callGemini(text);
    document.getElementById(thinkingId)?.remove();
    appendMessage('ai', reply);
  } catch (e) {
    document.getElementById(thinkingId)?.remove();
    appendMessage('ai', `⚠️ ${e.message}`);
    console.error('Gemini error', e);
  } finally {
    isSending = false;
    document.getElementById('btn-chat-send')?.classList.remove('sending');
  }
}

// ── Key setup ──────────────────────────────────────────────
async function showKeySetup() {
  keySetup()?.classList.remove('hidden');
  inputRow()?.classList.add('hidden');
}

async function hideKeySetup() {
  keySetup()?.classList.add('hidden');
  inputRow()?.classList.remove('hidden');
}

function setKeyError(msg) {
  const el = document.getElementById('chat-key-error');
  if (el) { el.textContent = msg; el.style.color = msg ? 'var(--red)' : ''; }
}

// ── Public API (called from drive.js) ─────────────────────
window._geminiSetPdf = function (pdfFilename) {
  currentPdf = pdfFilename;
  chatHistory = [];
  setWelcome(pdfFilename);
};

// ── Init ───────────────────────────────────────────────────
async function initAssistant() {
  // Load saved key
  try {
    const saved = await window.electronAPI?.geminiLoadKey?.();
    geminiKey = saved?.key || null;
  } catch { geminiKey = null; }

  setWelcome(null);

  if (geminiKey) {
    hideKeySetup();
  } else {
    showKeySetup();
  }

  // Save key button
  document.getElementById('btn-chat-save-key')?.addEventListener('click', async () => {
    const val = document.getElementById('chat-key-input')?.value?.trim();
    if (!val) { setKeyError('Please paste your API key.'); return; }

    setKeyError('Verifying…');
    // Quick test call
    try {
      const testRes = await fetch(
        `${GEMINI_API}/${GEMINI_MODEL}:generateContent?key=${val}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Hi' }] }] }),
        }
      );
      if (!testRes.ok) {
        const err = await testRes.json().catch(() => ({}));
        throw new Error(err?.error?.message || `Status ${testRes.status}`);
      }
      geminiKey = val;
      await window.electronAPI?.geminiSaveKey?.(val);
      setKeyError('');
      hideKeySetup();
      setWelcome(currentPdf);
    } catch (e) {
      setKeyError(`Invalid key: ${e.message}`);
    }
  });

  // "Get API key" link
  document.getElementById('chat-key-link')?.addEventListener('click', e => {
    e.preventDefault();
    window.electronAPI?.driveOpenUrl?.('https://aistudio.google.com/app/apikey');
  });

  // Send button
  document.getElementById('btn-chat-send')?.addEventListener('click', sendMessage);

  // Enter to send (Shift+Enter = newline)
  document.getElementById('chat-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea
  document.getElementById('chat-input')?.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });

  // Clear conversation
  document.getElementById('btn-chat-clear')?.addEventListener('click', () => {
    chatHistory = [];
    setWelcome(currentPdf);
  });
}

document.addEventListener('DOMContentLoaded', initAssistant);
