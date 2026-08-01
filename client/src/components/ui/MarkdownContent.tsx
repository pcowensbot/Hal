import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { copyToClipboard } from '../../lib/utils';
import { toast } from '../../stores';
import { tokenize } from '../features/chat/syntaxHighlight';
import styles from './MarkdownContent.module.css';

export interface MarkdownContentProps {
  content: string;
  className?: string;
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <div className={`${styles.markdown} ${className || ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: CodeRenderer,
          pre: PassThrough,
          a: AnchorRenderer,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// react-markdown wraps fenced code in <pre><code>. CodeRenderer below produces
// its own <pre>, so we drop the outer <pre> wrapper for fenced blocks. Inline
// <code> never goes through here (no parent <pre>).
function PassThrough({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

function AnchorRenderer({
  href,
  children,
}: {
  href?: string;
  children?: React.ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

interface CodeRendererProps {
  className?: string;
  children?: React.ReactNode;
}

function CodeRenderer({ className, children }: CodeRendererProps) {
  // remark-rehype puts the info string from a fenced block into className as
  // `language-<info>`. Inline code has no className. Custom convention here:
  // ```lang:filename — split language and filename on the colon.
  const info = /language-(.+)/.exec(className || '')?.[1];
  if (!info) {
    return <code>{children}</code>;
  }
  const colonIdx = info.indexOf(':');
  const language = colonIdx >= 0 ? info.slice(0, colonIdx) : info;
  const filename = colonIdx >= 0 ? info.slice(colonIdx + 1) : undefined;
  const codeText = String(children).replace(/\n$/, '');
  return <CodeBlock language={language} filename={filename} code={codeText} />;
}

function CodeBlock({
  language,
  filename,
  code,
}: {
  language: string;
  filename?: string;
  code: string;
}) {
  const [copied, setCopied] = useState(false);
  const highlighted = useMemo(() => tokenize(code, language), [code, language]);

  const handleCopy = async () => {
    const success = await copyToClipboard(code);
    if (success) {
      setCopied(true);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <>
      <div className={styles.codeHeader}>
        <span className={styles.codeLang}>
          {filename ? (
            <>
              {filename} <span className={styles.codeLangSuffix}>{language}</span>
            </>
          ) : (
            language
          )}
        </span>
        <button type="button" className={styles.copyButton} onClick={handleCopy}>
          {copied ? '\u2713 Copied' : '\u{1F4CB} Copy'}
        </button>
      </div>
      <pre>
        <code>
          {highlighted.map((token, i) =>
            token.type === 'plain' ? (
              <span key={i}>{token.text}</span>
            ) : (
              <span key={i} className={styles[`tok_${token.type}`]}>
                {token.text}
              </span>
            ),
          )}
        </code>
      </pre>
    </>
  );
}
