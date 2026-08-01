// HAL Import — Claude.ai Content Script
// Extracts conversation data from Claude.ai pages. Uses the shared turndown
// setup from lib/halMarkdown.js (loaded ahead of this script via manifest).

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
      platform: 'claude',
      title: null,
      messages: [],
      url: window.location.href,
      extractedAt: new Date().toISOString()
    };

    const titleEl = document.querySelector('h1') ||
      document.querySelector('[class*="conversation-title"]') ||
      document.querySelector('title');
    if (titleEl) {
      result.title = titleEl.textContent.trim();
      if (result.title.includes(' - Claude')) {
        result.title = result.title.replace(/ - Claude$/, '');
      }
    }

    // Strategy 1: font-user / font-claude classes (older Claude UI)
    let userMsgs = dedupe(Array.from(document.querySelectorAll('[class*="font-user"]')));
    let assistantMsgs = dedupe(Array.from(document.querySelectorAll('[class*="font-claude"]')));

    if (userMsgs.length > 0 || assistantMsgs.length > 0) {
      const all = [
        ...userMsgs.map(el => ({ role: 'user', el })),
        ...assistantMsgs.map(el => ({ role: 'assistant', el }))
      ];
      all.sort((a, b) => {
        const rectA = a.el.getBoundingClientRect();
        const rectB = b.el.getBoundingClientRect();
        return rectA.top - rectB.top;
      });
      for (const item of all) {
        result.messages.push({
          role: item.role,
          content: htmlToMarkdown(item.el)
        });
      }
    }

    // Strategy 2: data-testid or role-based attributes
    if (result.messages.length === 0) {
      const turns = dedupe(Array.from(document.querySelectorAll(
        '[data-testid*="message"], [data-testid*="turn"], [class*="turn-"]'
      )));
      for (const turn of turns) {
        const isUser = turn.querySelector('[data-testid*="human"], [class*="human"]') ||
          turn.getAttribute('data-testid')?.includes('human') ||
          turn.classList.toString().includes('human') ||
          turn.classList.toString().includes('user');
        result.messages.push({
          role: isUser ? 'user' : 'assistant',
          content: htmlToMarkdown(turn)
        });
      }
    }

    // Strategy 3: message containers by common patterns
    if (result.messages.length === 0) {
      const candidates = [
        '[class*="conversation"] > div',
        '[class*="messages"] > div',
        '[class*="chat-messages"] > div',
        '[role="main"] [class*="message"]',
        '[class*="Thread"] > div > div'
      ];

      for (const selector of candidates) {
        const elements = dedupe(Array.from(document.querySelectorAll(selector)));
        if (elements.length >= 2) {
          let isUser = true;
          for (const el of elements) {
            const text = el.textContent.trim();
            if (text.length < 2) continue;
            result.messages.push({
              role: isUser ? 'user' : 'assistant',
              content: htmlToMarkdown(el)
            });
            isUser = !isUser;
          }
          if (result.messages.length >= 2) break;
        }
      }
    }

    // Strategy 4: broadest semantic matching
    if (result.messages.length === 0) {
      const allDivs = document.querySelectorAll('div[class]');
      const messageDivs = [];
      for (const div of allDivs) {
        const cls = div.className.toLowerCase();
        if ((cls.includes('human') || cls.includes('user') || cls.includes('assistant') || cls.includes('claude')) &&
            (cls.includes('message') || cls.includes('content') || cls.includes('text') || cls.includes('body'))) {
          const isUser = cls.includes('human') || cls.includes('user');
          messageDivs.push({ role: isUser ? 'user' : 'assistant', el: div });
        }
      }
      const deduped = dedupe(messageDivs.map(m => m.el));
      const dedupedSet = new Set(deduped);
      const final = messageDivs.filter(m => dedupedSet.has(m.el));
      final.sort((a, b) => a.el.getBoundingClientRect().top - b.el.getBoundingClientRect().top);
      for (const item of final) {
        result.messages.push({
          role: item.role,
          content: htmlToMarkdown(item.el)
        });
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
