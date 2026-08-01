/**
 * Lightweight syntax highlighter — regex-based tokenizer.
 * Returns an array of { text, type } spans for rendering.
 */

export type TokenType =
  | 'keyword'
  | 'string'
  | 'comment'
  | 'number'
  | 'function'
  | 'operator'
  | 'punctuation'
  | 'type'
  | 'property'
  | 'plain';

export interface Token {
  text: string;
  type: TokenType;
}

interface LangRule {
  pattern: RegExp;
  type: TokenType;
}

const JS_KEYWORDS = 'abstract|arguments|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|let|new|of|package|private|protected|public|return|set|static|super|switch|this|throw|try|typeof|var|void|while|with|yield';
const PY_KEYWORDS = 'and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|True|False|None';
const SQL_KEYWORDS = 'SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TABLE|INDEX|INTO|VALUES|SET|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AND|OR|NOT|IN|IS|NULL|AS|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|UNION|ALL|DISTINCT|COUNT|SUM|AVG|MIN|MAX|CASE|WHEN|THEN|ELSE|END|EXISTS|BETWEEN|LIKE|PRIMARY|KEY|FOREIGN|REFERENCES|CASCADE';
const GO_KEYWORDS = 'break|case|chan|const|continue|default|defer|else|fallthrough|for|func|go|goto|if|import|interface|map|package|range|return|select|struct|switch|type|var';
const RUST_KEYWORDS = 'as|async|await|break|const|continue|crate|dyn|else|enum|extern|fn|for|if|impl|in|let|loop|match|mod|move|mut|pub|ref|return|self|Self|static|struct|super|trait|type|unsafe|use|where|while';
const TS_TYPES = 'string|number|boolean|void|null|undefined|any|never|unknown|object|Array|Promise|Record|Partial|Required|Readonly|Pick|Omit|Exclude|Extract|Map|Set';

function buildRules(lang: string): LangRule[] {
  switch (lang) {
    case 'javascript':
    case 'js':
    case 'jsx':
    case 'typescript':
    case 'ts':
    case 'tsx': {
      const rules: LangRule[] = [
        { pattern: /(\/\/.*$)/m, type: 'comment' },
        { pattern: /(\/\*[\s\S]*?\*\/)/, type: 'comment' },
        { pattern: /(`(?:[^`\\]|\\.)*`)/, type: 'string' },
        { pattern: /("(?:[^"\\]|\\.)*")/, type: 'string' },
        { pattern: /('(?:[^'\\]|\\.)*')/, type: 'string' },
        { pattern: new RegExp(`\\b(${TS_TYPES})\\b`), type: 'type' },
        { pattern: new RegExp(`\\b(${JS_KEYWORDS})\\b`), type: 'keyword' },
        { pattern: /\b(\d+\.?\d*(?:e[+-]?\d+)?|0x[\da-f]+|0b[01]+|0o[0-7]+)\b/i, type: 'number' },
        { pattern: /\b([A-Z]\w*)\b/, type: 'type' },
        { pattern: /(\w+)(?=\s*\()/, type: 'function' },
        { pattern: /(=>|===|!==|==|!=|<=|>=|&&|\|\||[+\-*/%]=?|[<>]=?)/, type: 'operator' },
        { pattern: /([{}()[\];,.:?!])/, type: 'punctuation' },
      ];
      return rules;
    }

    case 'python':
    case 'py': {
      return [
        { pattern: /(#.*$)/m, type: 'comment' },
        { pattern: /("""[\s\S]*?"""|'''[\s\S]*?''')/, type: 'string' },
        { pattern: /(f"(?:[^"\\]|\\.)*"|f'(?:[^'\\]|\\.)*')/, type: 'string' },
        { pattern: /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/, type: 'string' },
        { pattern: new RegExp(`\\b(${PY_KEYWORDS})\\b`), type: 'keyword' },
        { pattern: /\b(\d+\.?\d*(?:e[+-]?\d+)?|0x[\da-f]+|0b[01]+|0o[0-7]+)\b/i, type: 'number' },
        { pattern: /\b([A-Z]\w*)\b/, type: 'type' },
        { pattern: /(\w+)(?=\s*\()/, type: 'function' },
        { pattern: /(@\w+)/, type: 'function' },
        { pattern: /(==|!=|<=|>=|[+\-*/%]=?|[<>]=?|\*\*|\/\/)/, type: 'operator' },
        { pattern: /([{}()[\];,.:])/, type: 'punctuation' },
      ];
    }

    case 'sql': {
      return [
        { pattern: /(--.*$)/m, type: 'comment' },
        { pattern: /(\/\*[\s\S]*?\*\/)/, type: 'comment' },
        { pattern: /('(?:[^'\\]|\\.)*')/, type: 'string' },
        { pattern: new RegExp(`\\b(${SQL_KEYWORDS})\\b`, 'i'), type: 'keyword' },
        { pattern: /\b(\d+\.?\d*)\b/, type: 'number' },
        { pattern: /([(),.;*])/, type: 'punctuation' },
        { pattern: /(=|<>|!=|<=|>=|[<>])/, type: 'operator' },
      ];
    }

    case 'json': {
      return [
        { pattern: /("(?:[^"\\]|\\.)*")(\s*:)/, type: 'property' },
        { pattern: /("(?:[^"\\]|\\.)*")/, type: 'string' },
        { pattern: /\b(true|false|null)\b/, type: 'keyword' },
        { pattern: /\b(-?\d+\.?\d*(?:e[+-]?\d+)?)\b/i, type: 'number' },
        { pattern: /([{}[\],:])/, type: 'punctuation' },
      ];
    }

    case 'html':
    case 'xml':
    case 'svg': {
      return [
        { pattern: /(<!--[\s\S]*?-->)/, type: 'comment' },
        { pattern: /(<\/?)([\w-]+)/, type: 'keyword' },
        { pattern: /([\w-]+)(=)/, type: 'property' },
        { pattern: /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/, type: 'string' },
        { pattern: /([<>/])/, type: 'punctuation' },
      ];
    }

    case 'css':
    case 'scss':
    case 'less': {
      return [
        { pattern: /(\/\*[\s\S]*?\*\/)/, type: 'comment' },
        { pattern: /(\/\/.*$)/m, type: 'comment' },
        { pattern: /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/, type: 'string' },
        { pattern: /(#[\da-f]{3,8})\b/i, type: 'number' },
        { pattern: /\b(\d+\.?\d*(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?)\b/, type: 'number' },
        { pattern: /(\.[\w-]+)/, type: 'function' },
        { pattern: /(#[\w-]+)/, type: 'keyword' },
        { pattern: /(@[\w-]+)/, type: 'keyword' },
        { pattern: /([\w-]+)(?=\s*:)/, type: 'property' },
        { pattern: /([{}();:,])/, type: 'punctuation' },
      ];
    }

    case 'go':
    case 'golang': {
      return [
        { pattern: /(\/\/.*$)/m, type: 'comment' },
        { pattern: /(\/\*[\s\S]*?\*\/)/, type: 'comment' },
        { pattern: /(`[^`]*`)/, type: 'string' },
        { pattern: /("(?:[^"\\]|\\.)*")/, type: 'string' },
        { pattern: new RegExp(`\\b(${GO_KEYWORDS})\\b`), type: 'keyword' },
        { pattern: /\b(int|int8|int16|int32|int64|uint|uint8|uint16|uint32|uint64|float32|float64|complex64|complex128|byte|rune|string|bool|error)\b/, type: 'type' },
        { pattern: /\b(\d+\.?\d*(?:e[+-]?\d+)?|0x[\da-f]+)\b/i, type: 'number' },
        { pattern: /(\w+)(?=\s*\()/, type: 'function' },
        { pattern: /(:=|==|!=|<=|>=|&&|\|\||<-|[+\-*/%]=?|[<>]=?)/, type: 'operator' },
        { pattern: /([{}()[\];,.:])/, type: 'punctuation' },
      ];
    }

    case 'rust':
    case 'rs': {
      return [
        { pattern: /(\/\/.*$)/m, type: 'comment' },
        { pattern: /(\/\*[\s\S]*?\*\/)/, type: 'comment' },
        { pattern: /("(?:[^"\\]|\\.)*")/, type: 'string' },
        { pattern: new RegExp(`\\b(${RUST_KEYWORDS})\\b`), type: 'keyword' },
        { pattern: /\b(i8|i16|i32|i64|i128|u8|u16|u32|u64|u128|f32|f64|bool|char|str|String|Vec|Option|Result|Box|Rc|Arc)\b/, type: 'type' },
        { pattern: /\b(\d+\.?\d*(?:e[+-]?\d+)?|0x[\da-f]+|0b[01]+|0o[0-7]+)\b/i, type: 'number' },
        { pattern: /(\w+)(?=\s*[!(])/, type: 'function' },
        { pattern: /(=>|->|==|!=|<=|>=|&&|\|\||[+\-*/%]=?|[<>]=?)/, type: 'operator' },
        { pattern: /([{}()[\];,.:&|!])/, type: 'punctuation' },
      ];
    }

    case 'yaml':
    case 'yml': {
      return [
        { pattern: /(#.*$)/m, type: 'comment' },
        { pattern: /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/, type: 'string' },
        { pattern: /\b(true|false|null|yes|no|on|off)\b/i, type: 'keyword' },
        { pattern: /\b(\d+\.?\d*)\b/, type: 'number' },
        { pattern: /([\w.-]+)(:)/, type: 'property' },
        { pattern: /([[\]{},\-:>|])/, type: 'punctuation' },
      ];
    }

    case 'dockerfile':
    case 'docker': {
      return [
        { pattern: /(#.*$)/m, type: 'comment' },
        { pattern: /\b(FROM|RUN|CMD|LABEL|MAINTAINER|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|ONBUILD|STOPSIGNAL|HEALTHCHECK|SHELL)\b/, type: 'keyword' },
        { pattern: /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/, type: 'string' },
        { pattern: /([[\]{}])/, type: 'punctuation' },
      ];
    }

    // bash, sh, shell, zsh, fish — plain white, no highlighting
    default:
      return [];
  }
}

// Languages that should not be highlighted (plain text / terminal output)
const PLAIN_LANGS = new Set([
  'bash', 'sh', 'shell', 'zsh', 'fish', 'console', 'terminal',
  'text', 'plain', 'log', 'output', ''
]);

export function tokenize(code: string, language: string): Token[] {
  const lang = language.toLowerCase();

  if (PLAIN_LANGS.has(lang)) {
    return [{ text: code, type: 'plain' }];
  }

  const rules = buildRules(lang);
  if (rules.length === 0) {
    return [{ text: code, type: 'plain' }];
  }

  // Build a combined regex from all rules
  const combined = new RegExp(
    rules.map((r, i) => `(?<g${i}>${r.pattern.source})`).join('|'),
    'gm'
  );

  const tokens: Token[] = [];
  let lastIndex = 0;

  for (const match of code.matchAll(combined)) {
    // Add plain text before this match
    if (match.index > lastIndex) {
      tokens.push({ text: code.slice(lastIndex, match.index), type: 'plain' });
    }

    // Find which group matched
    let type: TokenType = 'plain';
    for (let i = 0; i < rules.length; i++) {
      if (match.groups?.[`g${i}`] !== undefined) {
        type = rules[i].type;
        break;
      }
    }

    tokens.push({ text: match[0], type });
    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < code.length) {
    tokens.push({ text: code.slice(lastIndex), type: 'plain' });
  }

  return tokens;
}
