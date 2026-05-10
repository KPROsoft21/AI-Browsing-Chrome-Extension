// AI Page Assistant — Popup UI

// ── State ─────────────────────────────────────────────────────────────────────

let apiKey = '';
let model  = 'claude-opus-4-6';
let tabId  = null;
let conversationMessages = [];
let isThinking = false;

// ── DOM refs ──────────────────────────────────────────────────────────────────

const messagesEl    = document.getElementById('messages');
const msgInput      = document.getElementById('msgInput');
const sendBtn       = document.getElementById('sendBtn');
const typingBar     = document.getElementById('typingBar');
const typingLabel   = document.getElementById('typingLabel');
const statusDot     = document.getElementById('statusDot');
const settingsPanel = document.getElementById('settingsPanel');
const settingsBtn   = document.getElementById('settingsBtn');
const newChatBtn    = document.getElementById('newChatBtn');
const apiKeyInput   = document.getElementById('apiKeyInput');
const modelSelect   = document.getElementById('modelSelect');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const toast         = document.getElementById('toast');

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  // Load saved settings
  const stored = await chrome.storage.local.get(['apiKey', 'model']);
  if (stored.apiKey) {
    apiKey = stored.apiKey;
    apiKeyInput.value = stored.apiKey;
  }
  if (stored.model) {
    model = stored.model;
    modelSelect.value = stored.model;
  }

  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;

  // Status dot
  updateStatusDot();

  // Listen for progress updates from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'progress') {
      typingLabel.textContent = msg.status || 'Thinking...';
    }
  });

  // Show welcome screen
  showWelcome();

  setupEventListeners();
}

// ── Status dot ────────────────────────────────────────────────────────────────

function updateStatusDot() {
  if (apiKey && tabId) {
    statusDot.classList.add('connected');
  } else {
    statusDot.classList.remove('connected');
  }
}

// ── Event Listeners ───────────────────────────────────────────────────────────

function setupEventListeners() {
  // Auto-resize textarea
  msgInput.addEventListener('input', () => {
    msgInput.style.height = 'auto';
    msgInput.style.height = Math.min(msgInput.scrollHeight, 110) + 'px';
    sendBtn.disabled = !msgInput.value.trim() || isThinking;
  });

  // Send on Enter (Shift+Enter = newline)
  msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) sendMessage();
    }
  });

  // Send button
  sendBtn.addEventListener('click', sendMessage);

  // Settings toggle
  settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('open');
  });

  // New chat
  newChatBtn.addEventListener('click', () => {
    conversationMessages = [];
    messagesEl.innerHTML = '';
    showWelcome();
    msgInput.value = '';
    msgInput.style.height = 'auto';
    sendBtn.disabled = true;
    settingsPanel.classList.remove('open');
  });

  // Save settings
  saveSettingsBtn.addEventListener('click', saveSettings);
  apiKeyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveSettings();
  });
}

async function saveSettings() {
  const key = apiKeyInput.value.trim();
  const m   = modelSelect.value;

  if (!key) {
    showToast('Enter your API key first');
    return;
  }

  apiKey = key;
  model  = m;
  await chrome.storage.local.set({ apiKey: key, model: m });

  updateStatusDot();
  settingsPanel.classList.remove('open');
  showToast('Settings saved');
}

// ── Welcome Screen ────────────────────────────────────────────────────────────

function showWelcome() {
  const examples = [
    'Summarize this page',
    'Find all links',
    'Fill out this form',
    'Click the sign in button',
    'Scroll to the bottom',
    'What can I do here?'
  ];

  const html = `
    <div class="welcome">
      <div class="welcome-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
            stroke="#8177f0" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <h2>AI Page Assistant</h2>
      <p>I can read and interact with the page you're on. Tell me what to do.</p>
      <div class="examples">
        ${examples.map(e => `<button class="example-chip">${e}</button>`).join('')}
      </div>
    </div>
  `;

  messagesEl.innerHTML = html;

  messagesEl.querySelectorAll('.example-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      msgInput.value = chip.textContent;
      msgInput.style.height = 'auto';
      msgInput.style.height = Math.min(msgInput.scrollHeight, 110) + 'px';
      sendBtn.disabled = false;
      msgInput.focus();
    });
  });
}

// ── Send Message ──────────────────────────────────────────────────────────────

async function sendMessage() {
  const text = msgInput.value.trim();
  if (!text || isThinking) return;

  // Validate
  if (!apiKey) {
    settingsPanel.classList.add('open');
    apiKeyInput.focus();
    showToast('Add your API key first');
    return;
  }
  if (!tabId) {
    showToast('No active tab found');
    return;
  }

  // Clear input
  msgInput.value = '';
  msgInput.style.height = 'auto';
  sendBtn.disabled = true;

  // Remove welcome screen if present
  const welcome = messagesEl.querySelector('.welcome');
  if (welcome) welcome.remove();

  // Show user message
  addMessageToUI('user', text);

  // Add to conversation
  conversationMessages.push({ role: 'user', content: text });

  // Show thinking
  isThinking = true;
  showTypingIndicator('Thinking...');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'chat',
      apiKey,
      model,
      messages: conversationMessages,
      tabId
    });

    hideTypingIndicator();
    isThinking = false;

    if (response.success) {
      conversationMessages = response.messages;
      addMessageToUI('assistant', response.finalResponse);
    } else {
      addMessageToUI('error', response.error || 'Something went wrong.');
      // Roll back last user message on error
      conversationMessages.pop();
    }
  } catch (e) {
    hideTypingIndicator();
    isThinking = false;
    addMessageToUI('error', e.message || 'Extension error.');
    conversationMessages.pop();
  }

  sendBtn.disabled = !msgInput.value.trim();
  msgInput.focus();
}

// ── Message UI ────────────────────────────────────────────────────────────────

function addMessageToUI(role, content) {
  const wrap = document.createElement('div');
  wrap.className = `message message-${role === 'user' ? 'user' : role === 'error' ? 'error' : 'assistant'}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (role === 'user') {
    bubble.textContent = content;
  } else if (role === 'error') {
    bubble.textContent = content;
  } else {
    bubble.innerHTML = renderMarkdown(content);
  }

  wrap.appendChild(bubble);
  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── Markdown Renderer ─────────────────────────────────────────────────────────

function renderMarkdown(text) {
  // Escape HTML first (except we handle it inline)
  let html = text
    // Code blocks (``` ... ```)
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre><code>${escHtml(code.trim())}</code></pre>`;
    })
    // Inline code
    .replace(/`([^`]+)`/g, (_, code) => `<code>${escHtml(code)}</code>`)
    // Bold **text** or __text__
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => `<strong>${a || b}</strong>`)
    // Italic *text* or _text_
    .replace(/\*([^*\n]+)\*|_([^_\n]+)_/g, (_, a, b) => `<em>${a || b}</em>`)
    // Headers ### ## #
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Unordered list
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    // Ordered list
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Links [text](url)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Wrap consecutive <li> items in <ul>
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

  // Convert double newlines to paragraph breaks, single newlines to <br>
  const parts = html.split(/\n\n+/);
  html = parts.map(part => {
    part = part.trim();
    if (!part) return '';
    // Don't wrap block elements
    if (/^<(pre|ul|ol|h[1-6]|blockquote)/.test(part)) return part;
    return `<p>${part.replace(/\n/g, '<br>')}</p>`;
  }).filter(Boolean).join('\n');

  return html;
}

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Typing Indicator ──────────────────────────────────────────────────────────

function showTypingIndicator(label) {
  typingLabel.textContent = label || 'Thinking...';
  typingBar.style.display = 'flex';
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function hideTypingIndicator() {
  typingBar.style.display = 'none';
}

// ── Toast ─────────────────────────────────────────────────────────────────────

let toastTimer = null;

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
