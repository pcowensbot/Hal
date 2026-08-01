/**
 * Inject turndown into a puppeteer page so HTML→Markdown conversion runs in
 * the live DOM context. Sets up `window.__halTurndown` (idempotent) plus the
 * extra rules the previous hand-rolled converter was missing:
 *
 *   - GFM tables → pipe syntax (turndown core doesn't handle tables)
 *   - Code-fence escalation (outer fence must use more backticks than any
 *     inner fence — fixes the "nested ```sql inside ```markdown" pattern that
 *     used to render as three broken blocks)
 *   - Strip aria-hidden subtrees (Claude.ai's share view appears to attach
 *     screen-reader twins of rendered messages — they were being captured
 *     verbatim by the old converter and concatenated to the message body,
 *     producing the "duplicated content with formatting stripped" artifact)
 *   - Strip the orphan language label that shows up immediately above pre
 *     blocks ("markdown\n\n```markdown..." pattern from Claude.ai's UI chrome)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TURNDOWN_UMD_PATH = path.join(__dirname, '../../node_modules/turndown/dist/turndown.js');
const turndownSource = fs.readFileSync(TURNDOWN_UMD_PATH, 'utf8');

export async function injectMarkdownConverter(page) {
  await page.addScriptTag({ content: turndownSource });
  await page.evaluate(() => {
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
    window.__halMarkdownReady = true;
  });
}

/**
 * Filter a NodeList of message-element matches down to outermost-only.
 * Some share views render each message twice (e.g. visible card + hidden
 * accessibility twin) — both end up matching `[class*="font-..."]`. Keeping
 * only matches whose ancestors don't already match drops the twins.
 */
export const dedupeOutermostScript = `
  function halDedupeOutermost(elements) {
    const set = new Set(elements);
    const out = [];
    for (const el of elements) {
      let parent = el.parentElement;
      let hasAncestor = false;
      while (parent) {
        if (set.has(parent)) { hasAncestor = true; break; }
        parent = parent.parentElement;
      }
      if (!hasAncestor) out.push(el);
    }
    return out;
  }
`;
