'use strict';
/* assistant.js — Ollama (Qwen2.5) streaming chatbot for the PDF viewer sidebar
 *
 * Architecture:
 *  - Supports two modes: local Ollama (dev) or Cloud Run URL (production)
 *  - Uses ReadableStream for token streaming → minimum Time-To-First-Token
 *  - Markdown is rendered AFTER the stream completes (raw text during streaming)
 *  - Model name + endpoint URL are persisted via Electron's secure storage
 */

// ── Endpoint Config ────────────────────────────────────────────────────────────
// In production, ollamaEndpoint is overridden with the Cloud Run service URL.
// The default falls back to localhost for local development.
const LOCAL_OLLAMA   = 'http://localhost:11434/api';
const DEFAULT_MODEL  = 'qwen2.5';

// ── State ──────────────────────────────────────────────────────────────────────
let ollamaModel    = null;    // e.g. "qwen2.5"
let ollamaEndpoint = null;    // e.g. "https://ollama-xxx-uc.a.run.app/api"
let chatHistory    = [];      // [{ role: 'user'|'assistant', content: '...' }]
let currentPdf     = null;    // filename of currently open PDF
let isSending      = false;
let abortController = null;   // allows cancelling an in-flight stream

// ── DOM helpers ────────────────────────────────────────────────────────────────
const keySetup  = () => document.getElementById('chat-key-setup');
const msgList   = () => document.getElementById('chat-messages');
const inputRow  = () => document.getElementById('chat-input-row');
const chatInput = () => document.getElementById('chat-input');

// ── Markdown-lite renderer ─────────────────────────────────────────────────────
function renderMarkdown(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // fenced code blocks
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
    // paragraph breaks & line breaks
    .replace(/\n\n+/g, '</p><p>')
    .replace(/\n/g, '<br>');
}

// ── Message rendering ──────────────────────────────────────────────────────────
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

/**
 * Creates an empty streaming reply bubble and returns a handle to update it.
 * The bubble appears on screen the moment the first token arrives,
 * giving the user immediate feedback (low perceived TTFT).
 */
function createStreamBubble() {
  const el = document.createElement('div');
  el.className = 'chat-msg ai streaming';
  el.innerHTML = `
    <div class="chat-bubble">
      <div class="chat-bubble-text" id="stream-text-target"></div>
    </div>`;
  msgList().appendChild(el);
  msgList().scrollTop = msgList().scrollHeight;

  const target = el.querySelector('#stream-text-target');

  return {
    /** Append a raw token to the bubble during streaming */
    appendToken(token) {
      target.textContent += token;
      msgList().scrollTop = msgList().scrollHeight;
    },
    /** Replace raw text with rendered markdown once streaming is done */
    finalise(fullText) {
      target.innerHTML = `<p>${renderMarkdown(fullText)}</p>`;
      el.classList.remove('streaming');
    },
    /** Show an error inside the bubble */
    showError(msg) {
      target.innerHTML = `<span class="stream-error">Error: ${msg}</span>`;
      el.classList.remove('streaming');
    },
  };
}

function setWelcome(pdfName) {
  const m = msgList();
  if (!m) return;
  m.innerHTML = '';
  const greeting = pdfName
    ? `Hi! I'm your Qwen2.5 study assistant. Ask me anything about **${pdfName}**.`
    : `Hi! I'm powered by **Qwen2.5**. Open a PDF and ask me anything about it.`;
  appendMessage('ai', greeting);
}

// ── Streaming Ollama API call ──────────────────────────────────────────────────
/**
 * Calls the Ollama /api/chat endpoint with stream:true.
 * Invokes onToken(token) for every chunk received from the server.
 * Returns the full concatenated reply string.
 *
 * @param {string} userText  - The user's message
 * @param {(token: string) => void} onToken - Called with each token as it arrives
 * @returns {Promise<string>} The complete response text
 */
async function callOllamaStreaming(userText, onToken) {
  const systemInstruction = currentPdf
    ? `You are a helpful study assistant. The user is currently reading a PDF called "${currentPdf}". Answer questions about it concisely and clearly. If a question is unrelated to the document, still help but gently note it is off-topic.`
    : `You are a helpful study assistant. Answer questions concisely and clearly.`;

  // Add the user turn to history before the call
  chatHistory.push({ role: 'user', content: userText });

  const messages = [
    { role: 'system', content: systemInstruction },
    ...chatHistory,
  ];

  const endpoint = ollamaEndpoint || LOCAL_OLLAMA;

  // Create a fresh AbortController so we can cancel mid-stream if needed
  abortController = new AbortController();

  const res = await fetch(`${endpoint}/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    signal:  abortController.signal,
    body: JSON.stringify({
      model:   ollamaModel,
      messages,
      stream:  true,           // ← STREAMING: receive tokens as they generate
      options: {
        temperature:  0.7,
        num_predict:  2048,    // max output tokens
        top_p:        0.9,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama API returned HTTP ${res.status}. Is the service running?`);
  }

  // ── ReadableStream token loop ──────────────────────────────────────────────
  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let fullReply = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    // Each read() may contain one or more newline-delimited JSON objects
    const raw   = decoder.decode(value, { stream: true });
    const lines = raw.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const chunk = JSON.parse(line);
        const token = chunk?.message?.content ?? '';
        if (token) {
          fullReply += token;
          onToken(token);
        }
        if (chunk.done) break;
      } catch {
        // Partial JSON chunk — safe to skip, next read will have the rest
      }
    }
  }

  // Append the completed assistant turn to history
  chatHistory.push({ role: 'assistant', content: fullReply });
  return fullReply;
}

// ── Send flow (streaming) ──────────────────────────────────────────────────────
async function sendMessage() {
  const input = chatInput();
  const text  = input?.value?.trim();
  if (!text || isSending || !ollamaModel) return;

  isSending = true;
  input.value = '';
  input.style.height = 'auto';
  document.getElementById('btn-chat-send')?.classList.add('sending');

  // Render user message immediately
  appendMessage('user', text);

  // Show thinking dots until first token arrives
  const thinkingId = 'chat-thinking-' + Date.now();
  appendMessage('thinking', '', thinkingId);

  let streamBubble = null;

  try {
    await callOllamaStreaming(text, (token) => {
      // On first token: remove thinking dots, create the streaming bubble
      if (!streamBubble) {
        document.getElementById(thinkingId)?.remove();
        streamBubble = createStreamBubble();
      }
      streamBubble.appendToken(token);
    });

    // Stream complete — render final markdown
    if (streamBubble) {
      const lastReply = chatHistory[chatHistory.length - 1]?.content ?? '';
      streamBubble.finalise(lastReply);
    } else {
      // Empty response (unusual)
      document.getElementById(thinkingId)?.remove();
      appendMessage('ai', '_(No response from model)_');
    }
  } catch (e) {
    document.getElementById(thinkingId)?.remove();

    if (e.name === 'AbortError') {
      // User cancelled — bubble already shows partial text
      if (streamBubble) {
        const partial = chatHistory[chatHistory.length - 1]?.content ?? '';
        streamBubble.finalise(partial + ' _(cancelled)_');
      }
    } else {
      if (streamBubble) {
        streamBubble.showError(e.message);
      } else {
        appendMessage('ai', `Error: ${e.message}`);
      }
      console.error('Ollama stream error', e);
    }
  } finally {
    isSending = false;
    abortController = null;
    document.getElementById('btn-chat-send')?.classList.remove('sending');
  }
}

// ── Model / Endpoint setup UI ──────────────────────────────────────────────────
function showKeySetup() {
  keySetup()?.classList.remove('hidden');
  inputRow()?.classList.add('hidden');
}

function hideKeySetup() {
  keySetup()?.classList.add('hidden');
  inputRow()?.classList.remove('hidden');
}

function setKeyError(msg, isSuccess = false) {
  const el = document.getElementById('chat-key-error');
  if (!el) return;
  el.textContent = msg;
  el.style.color = msg
    ? isSuccess ? 'var(--green, #30d158)' : 'var(--red, #ff453a)'
    : '';
}

/** Updates the connection-mode badge in the chat header */
function updateModeBadge() {
  const badge = document.getElementById('chat-mode-badge');
  if (!badge) return;
  if (ollamaEndpoint && ollamaEndpoint !== LOCAL_OLLAMA) {
    badge.textContent = 'Cloud Run';
    badge.title = ollamaEndpoint;
  } else {
    badge.textContent = 'Local';
    badge.title = 'http://localhost:11434';
  }
}

// ── Public API (called from drive.js when a PDF is opened) ────────────────────
window._geminiSetPdf = function (pdfFilename) {
  currentPdf = pdfFilename;
  chatHistory = [];
  setWelcome(pdfFilename);
};

// ── Initialisation ─────────────────────────────────────────────────────────────
async function initAssistant() {
  // Load persisted config (model name + endpoint URL)
  try {
    const saved = await window.electronAPI?.ollamaLoadConfig?.();
    ollamaModel    = saved?.model    || null;
    ollamaEndpoint = saved?.endpoint || LOCAL_OLLAMA;
  } catch {
    ollamaModel    = null;
    ollamaEndpoint = LOCAL_OLLAMA;
  }

  setWelcome(null);
  updateModeBadge();

  if (ollamaModel) {
    hideKeySetup();
  } else {
    showKeySetup();
  }

  // ── Save / Connect button ──────────────────────────────────────────────────
  document.getElementById('btn-chat-save-key')?.addEventListener('click', async () => {
    const modelVal    = (document.getElementById('chat-key-input')?.value ?? '').trim() || DEFAULT_MODEL;
    const endpointVal = (document.getElementById('chat-endpoint-input')?.value ?? '').trim() || LOCAL_OLLAMA;

    setKeyError('Connecting…');

    try {
      // Verify the endpoint is reachable and the model exists
      const testRes = await fetch(`${endpointVal}/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:    modelVal,
          messages: [{ role: 'user', content: 'Hi' }],
          stream:   false,
        }),
      });

      if (!testRes.ok) {
        throw new Error(`HTTP ${testRes.status} — is Ollama running at ${endpointVal}?`);
      }

      ollamaModel    = modelVal;
      ollamaEndpoint = endpointVal;

      // Persist to Electron's userData storage
      await window.electronAPI?.ollamaSaveConfig?.({ model: ollamaModel, endpoint: ollamaEndpoint });

      setKeyError(`Connected to ${ollamaModel}`, true);
      setTimeout(() => setKeyError(''), 2000);
      hideKeySetup();
      updateModeBadge();
      setWelcome(currentPdf);
    } catch (e) {
      setKeyError(`Connection failed: ${e.message}`);
    }
  });

  // ── "Download Ollama" link ─────────────────────────────────────────────────
  document.getElementById('chat-key-link')?.addEventListener('click', e => {
    e.preventDefault();
    window.electronAPI?.driveOpenUrl?.('https://ollama.com/download');
  });

  // ── Send button ────────────────────────────────────────────────────────────
  document.getElementById('btn-chat-send')?.addEventListener('click', sendMessage);

  // ── Enter to send (Shift+Enter = newline) ──────────────────────────────────
  document.getElementById('chat-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // ── Auto-resize textarea ───────────────────────────────────────────────────
  document.getElementById('chat-input')?.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });

  // ── Clear conversation ─────────────────────────────────────────────────────
  document.getElementById('btn-chat-clear')?.addEventListener('click', () => {
    // If a stream is in progress, abort it first
    abortController?.abort();
    chatHistory = [];
    setWelcome(currentPdf);
  });

  // ── Change model / endpoint ────────────────────────────────────────────────
  document.getElementById('btn-chat-settings')?.addEventListener('click', () => {
    // Pre-fill with current values
    const modelInput    = document.getElementById('chat-key-input');
    const endpointInput = document.getElementById('chat-endpoint-input');
    if (modelInput)    modelInput.value    = ollamaModel    || DEFAULT_MODEL;
    if (endpointInput) endpointInput.value = ollamaEndpoint || LOCAL_OLLAMA;
    showKeySetup();
  });
}

document.addEventListener('DOMContentLoaded', initAssistant);
