import { useState, useMemo } from 'react';
import { tokenize } from './syntaxHighlight';
import { copyToClipboard, cn } from '../../../lib/utils';
import { toast } from '../../../stores';
import type { Artifact } from '../../../types';
import styles from './ArtifactCard.module.css';

interface ArtifactCardProps {
  artifact: Artifact;
  onSaveToKnowledge: (artifact: Artifact) => Promise<void>;
}

function downloadArtifact(artifact: Artifact) {
  const blob = new Blob([artifact.content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = artifact.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ArtifactCard({ artifact, onSaveToKnowledge }: ArtifactCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const highlighted = useMemo(
    () => tokenize(artifact.content, artifact.language),
    [artifact.content, artifact.language]
  );

  const handleCopy = async () => {
    const success = await copyToClipboard(artifact.content);
    if (success) {
      setCopied(true);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error('Failed to copy');
    }
  };

  const handleDownload = () => {
    downloadArtifact(artifact);
    toast.success(`Downloaded ${artifact.filename}`);
  };

  const handleSave = async () => {
    if (saved || saving) return;
    setSaving(true);
    try {
      await onSaveToKnowledge(artifact);
      setSaved(true);
      toast.success(`Saved ${artifact.filename} to Knowledge Base`);
    } catch {
      toast.error('Failed to save to Knowledge Base');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader} onClick={() => setExpanded(!expanded)}>
        <div className={styles.fileInfo}>
          <span className={styles.filename}>{artifact.filename}</span>
          <span className={styles.langBadge}>{artifact.language}</span>
          <span className={styles.lineCount}>{artifact.lineCount} lines</span>
        </div>
        <span className={cn(styles.expandIcon, expanded && styles.expanded)}>
          {'\u25BC'}
        </span>
      </div>

      {expanded && (
        <div className={styles.preview}>
          <pre>
            <code>
              {highlighted.map((token, i) =>
                token.type === 'plain' ? (
                  <span key={i}>{token.text}</span>
                ) : (
                  <span key={i} className={styles[`tok_${token.type}`]}>{token.text}</span>
                )
              )}
            </code>
          </pre>
        </div>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.actionBtn} onClick={handleCopy}>
          {copied ? '\u2713 Copied' : '\u{1F4CB} Copy'}
        </button>
        <button type="button" className={styles.actionBtn} onClick={handleDownload}>
          {'\u2B07'} Download
        </button>
        <button
          type="button"
          className={cn(styles.actionBtn, saved && styles.saved)}
          onClick={handleSave}
          disabled={saved || saving}
        >
          {saved ? '\u2713 Saved' : saving ? 'Saving...' : '\u{1F4DA} Knowledge'}
        </button>
      </div>
    </div>
  );
}
