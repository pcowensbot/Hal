// HAL Import — Turndown setup shared by content-claude.js / content-chatgpt.js.
// Loaded as a content script BEFORE the platform-specific scripts; sets up
// window.__halTurndown with the rules the old hand-rolled htmlToMarkdown was
// missing: GFM tables, code-fence escalation, and aria-hidden filtering.

(() => {
  if (window.__halMarkdownReady) return;

  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    fence: '```',
  });

  td.addRule('skipAriaHidden', {
    filter: (node) =>
      node.nodeType === 1 &&
      typeof node.getAttribute === 'function' &&
      (node.getAttribute('aria-hidden') === 'true' ||
        /(visually|sr-only|screen-reader-only)/.test(node.className || '')),
    replacement: () => '',
  });

  td.addRule('fencedCode', {
    filter: (node) =>
      node.nodeName === 'PRE' &&
      node.firstChild &&
      node.firstChild.nodeName === 'CODE',
    replacement: (_content, node) => {
      const codeEl = node.firstChild;
      const code = codeEl.textContent || '';
      const langMatch = (codeEl.className || node.className || '')
        .match(/language-([A-Za-z0-9_:.\-+]+)/);
      const lang = langMatch ? langMatch[1] : '';
      const longestRun = (code.match(/`{3,}/g) || []).reduce(
        (m, s) => Math.max(m, s.length),
        2,
      );
      const fenceLen = Math.max(3, longestRun + 1);
      const fence = '`'.repeat(fenceLen);
      return `\n\n${fence}${lang}\n${code.replace(/\n+$/, '')}\n${fence}\n\n`;
    },
  });

  td.addRule('table', {
    filter: 'table',
    replacement: (_content, node) => {
      const rows = Array.from(node.querySelectorAll('tr'));
      if (rows.length === 0) return '';
      const escapeCell = (s) => s.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
      const cellsOf = (row) =>
        Array.from(row.querySelectorAll('th, td')).map((c) =>
          escapeCell(c.textContent || ''),
        );
      const grid = rows.map(cellsOf).filter((r) => r.length > 0);
      if (grid.length === 0) return '';
      const cols = Math.max(...grid.map((r) => r.length));
      const pad = (r) => r.concat(Array(cols - r.length).fill(''));
      const lines = [];
      lines.push('| ' + pad(grid[0]).join(' | ') + ' |');
      lines.push('| ' + Array(cols).fill('---').join(' | ') + ' |');
      for (let i = 1; i < grid.length; i++) {
        lines.push('| ' + pad(grid[i]).join(' | ') + ' |');
      }
      return '\n\n' + lines.join('\n') + '\n\n';
    },
  });

  window.__halTurndown = td;

  // Filter a NodeList of message elements down to outermost-only matches —
  // Claude.ai's share view sometimes renders each message twice (visible card
  // + accessibility twin), and both can match the same selector. Keeping
  // only matches whose ancestors don't already match drops the twins.
  window.__halDedupeOutermost = (elements) => {
    const set = new Set(elements);
    const out = [];
    for (const el of elements) {
      let parent = el.parentElement;
      let hasAncestor = false;
      while (parent) {
        if (set.has(parent)) {
          hasAncestor = true;
          break;
        }
        parent = parent.parentElement;
      }
      if (!hasAncestor) out.push(el);
    }
    return out;
  };

  window.__halMarkdownReady = true;
})();
