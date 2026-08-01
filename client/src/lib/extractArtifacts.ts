import type { Message, Artifact } from '../types';

const MIN_LINES = 10;

interface FencedBlock {
  language: string;
  filename?: string;
  code: string;
  startIndex: number;
}

/**
 * Walk a string and yield CommonMark-correct fenced code blocks. Tracks the
 * opening fence width — a closing fence must be the same character with at
 * least as many backticks/tildes. This is what makes nested fences work
 * (outer ```` ... inner ``` ... ```` is one block, not three broken ones).
 *
 * Recognizes the project convention `lang:filename` in the info string.
 */
function findFencedBlocks(content: string): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  const lines = content.split('\n');
  let i = 0;
  let charOffset = 0;

  while (i < lines.length) {
    const line = lines[i];
    const fenceMatch = line.match(/^(\s{0,3})(`{3,}|~{3,})(.*)$/);
    if (!fenceMatch) {
      charOffset += line.length + 1;
      i += 1;
      continue;
    }

    const [, indent, fence, info] = fenceMatch;
    const fenceChar = fence[0];
    const fenceLen = fence.length;
    const startIndex = charOffset;
    const trimmedInfo = info.trim();
    const colonIdx = trimmedInfo.indexOf(':');
    const language =
      colonIdx >= 0 ? trimmedInfo.slice(0, colonIdx).trim() : trimmedInfo.split(/\s/)[0] || 'text';
    const filename =
      colonIdx >= 0 ? trimmedInfo.slice(colonIdx + 1).split(/\s/)[0] || undefined : undefined;

    charOffset += line.length + 1;
    i += 1;

    const bodyLines: string[] = [];
    let closed = false;
    while (i < lines.length) {
      const inner = lines[i];
      const closeMatch = inner.match(new RegExp('^\\s{0,3}([' + fenceChar + ']{' + fenceLen + ',})\\s*$'));
      if (closeMatch) {
        charOffset += inner.length + 1;
        i += 1;
        closed = true;
        break;
      }
      // Strip the same indent the opener used so inner content lines up cleanly.
      bodyLines.push(indent && inner.startsWith(indent) ? inner.slice(indent.length) : inner);
      charOffset += inner.length + 1;
      i += 1;
    }

    if (!closed && bodyLines.length === 0) continue;

    blocks.push({
      language: language || 'text',
      filename,
      code: bodyLines.join('\n'),
      startIndex,
    });
  }

  return blocks;
}

// Structural signals that indicate a complete file
const STRUCTURAL_PATTERNS = [
  /^#!\//m,                          // shebang
  /^import\s+/m,                     // JS/Python/Go imports
  /^from\s+\S+\s+import/m,          // Python from-imports
  /^const\s+\w+\s*=\s*require\(/m,  // CommonJS require
  /^package\s+\w+/m,                // Go/Java package
  /^<!DOCTYPE/im,                    // HTML
  /^<html/im,                       // HTML
  /^def\s+main\s*\(/m,             // Python main
  /^fn\s+main\s*\(/m,              // Rust main
  /^func\s+main\s*\(/m,            // Go main
  /^public\s+class\s+/m,           // Java class
  /^export\s+default/m,            // JS/TS default export
  /^export\s+(function|const|class)/m, // JS/TS named exports
  /^apiVersion:/m,                  // Kubernetes YAML
  /^FROM\s+/m,                     // Dockerfile
  /^\[tool\.poetry\]/m,            // pyproject.toml
  /^\[package\]/m,                 // Cargo.toml
];

// Context clues in text preceding a code block
const CONTEXT_CLUES = [
  /here(?:'s| is) (?:the |a |your )?(?:complete |full |final )?(?:script|file|code|program|implementation|solution)/i,
  /save (?:this |it )?as/i,
  /create (?:a |this )?file/i,
  /(?:complete|full|entire|whole) (?:script|file|code|program)/i,
  /copy (?:this |the following )?(?:into|to) (?:a )?file/i,
];

// Language to file extension mapping
const LANG_EXTENSIONS: Record<string, string> = {
  javascript: 'js',
  typescript: 'ts',
  python: 'py',
  ruby: 'rb',
  rust: 'rs',
  go: 'go',
  java: 'java',
  csharp: 'cs',
  cpp: 'cpp',
  c: 'c',
  bash: 'sh',
  shell: 'sh',
  sh: 'sh',
  zsh: 'sh',
  powershell: 'ps1',
  sql: 'sql',
  html: 'html',
  css: 'css',
  scss: 'scss',
  json: 'json',
  yaml: 'yaml',
  yml: 'yml',
  xml: 'xml',
  markdown: 'md',
  md: 'md',
  dockerfile: 'Dockerfile',
  docker: 'Dockerfile',
  makefile: 'Makefile',
  toml: 'toml',
  ini: 'ini',
  lua: 'lua',
  php: 'php',
  swift: 'swift',
  kotlin: 'kt',
  r: 'r',
  perl: 'pl',
  tsx: 'tsx',
  jsx: 'jsx',
  vue: 'vue',
  svelte: 'svelte',
};

function inferFilename(language: string, content: string, index: number): string {
  const lang = language.toLowerCase();
  const ext = LANG_EXTENSIONS[lang];

  // Special cases where filename can be inferred from content
  if (lang === 'dockerfile' || lang === 'docker' || content.trimStart().startsWith('FROM ')) {
    return 'Dockerfile';
  }
  if (lang === 'makefile' || content.trimStart().startsWith('.PHONY')) {
    return 'Makefile';
  }

  // Try to detect common filename patterns from content
  if (lang === 'html' && /<!DOCTYPE/i.test(content)) {
    return 'index.html';
  }
  if ((lang === 'javascript' || lang === 'js') && /express\(\)|createServer/.test(content)) {
    return 'server.js';
  }
  if ((lang === 'typescript' || lang === 'ts') && /express\(\)|createServer/.test(content)) {
    return 'server.ts';
  }
  if ((lang === 'python' || lang === 'py') && /if\s+__name__\s*==\s*['"]__main__['"]/m.test(content)) {
    return 'main.py';
  }

  if (ext) {
    return `artifact-${index + 1}.${ext}`;
  }

  return `artifact-${index + 1}.txt`;
}

function hasStructuralSignals(content: string): boolean {
  return STRUCTURAL_PATTERNS.some(pattern => pattern.test(content));
}

function hasContextClues(precedingText: string): boolean {
  return CONTEXT_CLUES.some(pattern => pattern.test(precedingText));
}

function isArtifactCandidate(
  code: string,
  language: string | undefined,
  filename: string | undefined,
  precedingText: string,
): boolean {
  const trimmed = code.trim();
  const lineCount = trimmed.split('\n').length;

  // Explicit filename always qualifies (user/model intent is clear)
  if (filename) return true;

  // Must meet minimum line count
  if (lineCount < MIN_LINES) return false;

  // Check for structural signals OR context clues
  if (hasStructuralSignals(trimmed)) return true;
  if (hasContextClues(precedingText)) return true;

  // Long code blocks (30+ lines) with a known language are likely files
  if (lineCount >= 30 && language && language !== 'text') return true;

  return false;
}

export function extractArtifacts(messages: Message[]): Artifact[] {
  const artifacts: Artifact[] = [];
  let globalIndex = 0;

  for (const message of messages) {
    if (message.role !== 'assistant') continue;

    const content = message.content;
    const blocks = findFencedBlocks(content);

    blocks.forEach((block, blockIndex) => {
      const code = block.code.trim();
      const precedingText = content.slice(Math.max(0, block.startIndex - 300), block.startIndex);

      if (isArtifactCandidate(code, block.language, block.filename, precedingText)) {
        const filename = block.filename || inferFilename(block.language, code, globalIndex);

        artifacts.push({
          id: `${message.id}-${blockIndex}`,
          messageId: message.id,
          language: block.language,
          filename,
          content: code,
          lineCount: code.split('\n').length,
        });

        globalIndex++;
      }
    });
  }

  return artifacts;
}
