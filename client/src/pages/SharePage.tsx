import { useParams } from 'react-router-dom';
import { useSharedLogs } from '../hooks';
import type { DeviceApiLog } from '../types';
import styles from './ApiPage.module.css';

export function SharePage() {
  const { slug } = useParams<{ slug: string }>();
  const { data, isLoading, error } = useSharedLogs(slug || '');

  const formatTime = (dateStr: string) =>
    new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  const formatDuration = (ms: number | null | undefined) => {
    if (!ms) return null;
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatTokens = (count: number | null | undefined) => {
    if (!count) return null;
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M tok`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K tok`;
    return `${count} tok`;
  };

  if (isLoading) {
    return (
      <div className={styles.shareContainer}>
        <div className={styles.logEmpty}>Loading shared conversation...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={styles.shareContainer}>
        <div className={styles.logEmpty}>
          {(error as Error)?.message === 'Share link has expired'
            ? 'This share link has expired.'
            : 'Share not found.'}
        </div>
      </div>
    );
  }

  const shareDate = new Date(data.createdAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <div className={styles.shareContainer}>
      <div className={styles.shareHeader}>
        <h1 className={styles.shareTitle}>
          {data.deviceName} — Shared Log
        </h1>
        <div className={styles.shareMeta}>
          Shared by {data.sharedBy} &middot; {shareDate} &middot; {data.logs.length} entries
        </div>
      </div>

      <div className={styles.shareConversation}>
        {data.logs.map((log: DeviceApiLog) => {
          const meta = log.metadata as Record<string, unknown> | null;
          const hasToolCalls = !!meta?.hasToolCalls;
          const toolCallCount = Number(meta?.toolCallCount) || 0;

          return (
            <div key={log.id} className={styles.exchange}>
              {log.prompt && (
                <div className={styles.bubbleRow}>
                  <div className={styles.bubbleUser}>
                    <div className={styles.bubbleLabel}>Input</div>
                    <div className={styles.bubbleContent}>{log.prompt}</div>
                  </div>
                </div>
              )}

              {log.response && (
                <div className={styles.bubbleRow}>
                  <div className={styles.bubbleAssistant}>
                    <div className={styles.bubbleLabel}>Output</div>
                    <div className={styles.bubbleContent}>{log.response}</div>
                  </div>
                </div>
              )}

              <div className={styles.exchangeMeta}>
                <span>{formatTime(log.createdAt)}</span>
                {formatDuration(log.durationMs) && <span>{formatDuration(log.durationMs)}</span>}
                {formatTokens(log.tokenCount) && <span>{formatTokens(log.tokenCount)}</span>}
                {hasToolCalls && (
                  <span className={styles.toolBadge}>
                    tools{toolCallCount ? ` (${String(toolCallCount)})` : ''}
                  </span>
                )}
                {log.model && <span className={styles.modelBadge}>{log.model}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
