// HAL Import — Popup Script

const DEFAULT_SERVER = 'http://localhost:3000';

let extractedData = null;

// State management
function showState(stateId) {
  document.querySelectorAll('.state').forEach(el => el.classList.remove('active'));
  document.getElementById(`state-${stateId}`).classList.add('active');
}

// Load saved settings
async function loadSettings() {
  const stored = await chrome.storage.local.get(['halServer', 'halToken']);
  const serverInput = document.getElementById('input-server');
  const tokenInput = document.getElementById('input-token');
  serverInput.value = stored.halServer || DEFAULT_SERVER;
  tokenInput.value = stored.halToken || '';
}

// Save settings on change
function setupSettingsListeners() {
  const serverInput = document.getElementById('input-server');
  const tokenInput = document.getElementById('input-token');

  serverInput.addEventListener('change', () => {
    chrome.storage.local.set({ halServer: serverInput.value.replace(/\/+$/, '') });
  });

  tokenInput.addEventListener('change', () => {
    chrome.storage.local.set({ halToken: tokenInput.value });
  });
}

// Check if current tab is a supported site
function isSupportedUrl(url) {
  return url.includes('claude.ai') || url.includes('chatgpt.com') || url.includes('chat.openai.com');
}

function getPlatformName(url) {
  if (url.includes('claude.ai')) return 'Claude';
  if (url.includes('chatgpt.com') || url.includes('chat.openai.com')) return 'ChatGPT';
  return 'Unknown';
}

// Extract conversation from active tab
async function extractFromTab() {
  showState('extracting');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !isSupportedUrl(tab.url)) {
    showState('unsupported');
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'extract' });

    if (!response || !response.success) {
      showState('empty');
      return;
    }

    extractedData = response.data;

    if (!extractedData.messages || extractedData.messages.length === 0) {
      showState('empty');
      return;
    }

    // Populate preview
    document.getElementById('preview-title').textContent =
      extractedData.title || 'Untitled Conversation';
    document.getElementById('preview-count').textContent =
      extractedData.messages.length;
    document.getElementById('preview-platform').textContent =
      getPlatformName(extractedData.url);

    const messageList = document.getElementById('message-list');
    messageList.innerHTML = '';

    for (const msg of extractedData.messages) {
      const div = document.createElement('div');
      div.className = `msg ${msg.role}`;
      div.innerHTML = `
        <div class="role">${msg.role}</div>
        <div class="text">${escapeHtml(msg.content.substring(0, 150))}${msg.content.length > 150 ? '...' : ''}</div>
      `;
      messageList.appendChild(div);
    }

    showState('preview');
  } catch (error) {
    // Content script might not be injected yet — try injecting it
    try {
      const platform = getPlatformName(tab.url);
      const scriptFile = platform === 'Claude' ? 'content-claude.js' : 'content-chatgpt.js';

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: [scriptFile]
      });

      // Retry extraction
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'extract' });

      if (!response || !response.success || !response.data.messages?.length) {
        showState('empty');
        return;
      }

      extractedData = response.data;

      document.getElementById('preview-title').textContent =
        extractedData.title || 'Untitled Conversation';
      document.getElementById('preview-count').textContent =
        extractedData.messages.length;
      document.getElementById('preview-platform').textContent =
        getPlatformName(extractedData.url);

      const messageList = document.getElementById('message-list');
      messageList.innerHTML = '';

      for (const msg of extractedData.messages) {
        const div = document.createElement('div');
        div.className = `msg ${msg.role}`;
        div.innerHTML = `
          <div class="role">${msg.role}</div>
          <div class="text">${escapeHtml(msg.content.substring(0, 150))}${msg.content.length > 150 ? '...' : ''}</div>
        `;
        messageList.appendChild(div);
      }

      showState('preview');
    } catch (retryError) {
      showState('empty');
    }
  }
}

// Send to HAL
async function importToHal() {
  if (!extractedData) return;

  showState('importing');

  const stored = await chrome.storage.local.get(['halServer', 'halToken']);
  const server = stored.halServer || DEFAULT_SERVER;
  const token = stored.halToken;

  if (!token) {
    document.getElementById('error-message').textContent = 'No auth token configured';
    document.getElementById('error-details').textContent =
      'Click "Server settings" on the preview screen to add your HAL auth token. ' +
      'You can find it in your browser\'s localStorage (key: "token") when logged into HAL.';
    showState('error');
    return;
  }

  try {
    const response = await fetch(`${server}/api/import/extension`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(extractedData)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || data.error || `Server returned ${response.status}`);
    }

    document.getElementById('success-detail').textContent =
      `${data.conversation.messageCount} messages from ${data.conversation.platform} saved as "${data.conversation.title}"`;
    showState('success');

  } catch (error) {
    document.getElementById('error-message').textContent = 'Failed to send to HAL';
    document.getElementById('error-details').textContent = error.message;
    showState('error');
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Event listeners
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  setupSettingsListeners();

  document.getElementById('btn-import').addEventListener('click', importToHal);
  document.getElementById('btn-retry').addEventListener('click', extractFromTab);
  document.getElementById('btn-retry-empty').addEventListener('click', extractFromTab);

  document.getElementById('btn-toggle-settings').addEventListener('click', () => {
    const panel = document.getElementById('settings-panel');
    panel.classList.toggle('hidden');
  });

  // Auto-extract on open
  extractFromTab();
});
