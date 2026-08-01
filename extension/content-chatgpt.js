// HAL Import — ChatGPT Content Script
// Uses the shared turndown setup from lib/halMarkdown.js (loaded ahead of
// this script via manifest).

(() => {
  function htmlToMarkdown(el) {
    if (!window.__halTurndown) return el.textContent || '';
    return window.__halTurndown.turndown(el.outerHTML).trim();
  }

  function dedupe(els) {
    return window.__halDedupeOutermost ? window.__halDedupeOutermost(els) : els;
  }

  function extractConversation() {
    const result = {
      platform: 'chatgpt',
      title: null,
      messages: [],
      url: window.location.href,
      extractedAt: new Date().toISOString()
    };

    // Title
    const titleEl = document.querySelector('h1') || document.querySelector('title');
    if (titleEl) {
      result.title = titleEl.textContent.trim().replace(/ \| ChatGPT$/, '');
    }

    // Strategy 1: data-message-author-role attribute (most reliable)
    const authorRoleMsgs = dedupe(Array.from(document.querySelectorAll('[data-message-author-role]')));
    if (authorRoleMsgs.length > 0) {
      for (const el of authorRoleMsgs) {
        const role = el.getAttribute('data-message-author-role');
        if (role === 'user' || role === 'assistant') {
          const contentEl = el.querySelector('[class*="markdown"], .whitespace-pre-wrap') || el;
          result.messages.push({
            role,
            content: htmlToMarkdown(contentEl)
          });
        }
      }
    }

    // Strategy 2: ChatGPT turn containers with user/assistant indicators
    if (result.messages.length === 0) {
      const turns = dedupe(Array.from(document.querySelectorAll('[data-testid*="conversation-turn"]')));
      for (const turn of turns) {
        // ChatGPT marks user turns with an avatar or specific class
        const isUser = !!turn.querySelector('[data-message-author-role="user"]') ||
          turn.textContent.includes('You') && turn.querySelector('img[alt*="User"]');
        const contentEl = turn.querySelector('[class*="markdown"], .whitespace-pre-wrap') || turn;
        const content = htmlToMarkdown(contentEl);
        if (content.length > 0) {
          result.messages.push({
            role: isUser ? 'user' : 'assistant',
            content
          });
        }
      }
    }

    // Strategy 3: Look for message groups by common ChatGPT classes
    if (result.messages.length === 0) {
      const groups = document.querySelectorAll('[class*="group"]');
      const messageLike = [];
      for (const group of groups) {
        const text = group.textContent.trim();
        if (text.length < 5) continue;
        const hasMarkdown = group.querySelector('[class*="markdown"]');
        if (hasMarkdown || group.querySelector('.whitespace-pre-wrap')) {
          messageLike.push(group);
        }
      }
      let isUser = true;
      for (const el of messageLike) {
        const contentEl = el.querySelector('[class*="markdown"], .whitespace-pre-wrap') || el;
        result.messages.push({
          role: isUser ? 'user' : 'assistant',
          content: htmlToMarkdown(contentEl)
        });
        isUser = !isUser;
      }
    }

    // Group consecutive same-role messages
    const grouped = [];
    for (const msg of result.messages) {
      if (!msg.content) continue;
      const last = grouped[grouped.length - 1];
      if (last && last.role === msg.role) {
        last.content += '\n\n' + msg.content;
      } else {
        grouped.push({ ...msg });
      }
    }
    result.messages = grouped;

    return result;
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extract') {
      try {
        const data = extractConversation();
        sendResponse({ success: true, data });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    }
    return true;
  });
})();
