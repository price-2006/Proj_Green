'use strict';
/* assistant.js — Gemini chatbot, authenticated via Google Drive OAuth token */

const GEMINI_MODEL = 'gemini-2.0-flash-lite';
const GEMINI_API   = 'https://generativelanguage.googleapis.com/v1beta/models';

// ── State ──────────────────────────────────────────────────
let chatHistory = [];    // [{ role: 'user'|'model', parts: [{ text }] }]
let currentPdf  = null;  // filename of the currently open PDF
let isSending   = false;

// ── DOM helpers ────────────────────────────────────────────
const msgList   = () => document.getElementById('chat-messages');
const inputRow  = () => document.getElementById('chat-input-row');
const signinMsg = () => document.getElementById('chat-signin-prompt');

function showSigninPrompt() {
  signinMsg()?.classList.remove('hidden');
  inputRow()?.classList.add('hidden');
}
function hideSigninPrompt() {
  signinMsg()?.classList.add('hidden');
  inputRow()?.classList.remove('hidden');
}

// ── Markdown-lite renderer ─────────────────────────────────
function renderMarkdown(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^[-•] (.+)/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]+?<\/li>)/g, '<ul>$1</ul>')
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

// ── Gemini API call (OAuth Bearer) ─────────────────────────
async function callGemini(userText) {
  let token = window._driveGetToken?.();
  if (!token) throw new Error('Not signed in to Google');

  const systemInstruction = currentPdf
    ? `You are a helpful study assistant. The user is reading a PDF called "${currentPdf}". Answer questions about it concisely and clearly. If a question is unrelated to the document, still help but note it's off-topic.`
    : `You are a helpful study assistant. Answer questions concisely and clearly.`;

  chatHistory.push({ role: 'user', parts: [{ text: userText }] });

  const body = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: chatHistory,
    generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
  };

  async function post(accessToken) {
    return fetch(`${GEMINI_API}/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });
  }

  let res = await post(token.access_token);

  // Token expired — refresh and retry once
  if (res.status === 401) {
    try {
      await window._driveRefreshToken?.();
      token = window._driveGetToken?.();
      res = await post(token.access_token);
    } catch {
      throw new Error('Session expired. Please sign out and sign in again.');
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    // 403 often means the scope wasn't granted — guide the user
    if (res.status === 403) {
      throw new Error('Gemini access denied. Please sign out of Google Drive and sign in again to grant Gemini permissions.');
    }
    throw new Error(err?.error?.message || `API error ${res.status}`);
  }

  const data = await res.json();
  const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!reply) throw new Error('Empty response from Gemini');

  chatHistory.push({ role: 'model', parts: [{ text: reply }] });
  return reply;
}

// ── Send flow ──────────────────────────────────────────────
async function sendMessage() {
  const input = document.getElementById('chat-input');
  const text  = input?.value?.trim();
  if (!text || isSending) return;

  // Check token present before sending
  if (!window._driveGetToken?.()) {
    showSigninPrompt();
    return;
  }

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

// ── Public API (called from drive.js) ─────────────────────
window._geminiSetPdf = function(pdfFilename) {
  currentPdf   = pdfFilename;
  chatHistory  = [];
  // Show/hide input based on whether user is signed in
  if (window._driveGetToken?.()) {
    hideSigninPrompt();
  } else {
    showSigninPrompt();
  }
  setWelcome(pdfFilename);
};

// ── Init ───────────────────────────────────────────────────
function initAssistant() {
  setWelcome(null);

  // Check token state on init
  // drive.js loads the token asynchronously; we poll briefly for it
  // (drive.js runs after assistant.js per script order but token is loaded async)
  setTimeout(() => {
    if (window._driveGetToken?.()) {
      hideSigninPrompt();
    } else {
      showSigninPrompt();
    }
  }, 500);

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
  document.getElementById('chat-input')?.addEventListener('input', function() {
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
