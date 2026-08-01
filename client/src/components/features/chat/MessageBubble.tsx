import { useMemo } from 'react';
import type { Message, MessageAttachment } from '../../../types';
import { formatTime, copyToClipboard, cn } from '../../../lib/utils';
import { toast } from '../../../stores';
import { MarkdownContent } from '../../ui/MarkdownContent';
import styles from './MessageBubble.module.css';

export interface MessageBubbleProps {
  message: Message;
  userName?: string;
  isStreaming?: boolean;
  onStar?: () => void;
  onImageClick?: (src: string) => void;
}

/**
 * Extract search indicators from message content.
 * Server prepends lines like: *Searched: "query"*
 */
function extractSearchInfo(content: string): { searches: string[]; cleanContent: string } {
  const searchPattern = /^\*Searched: "(.+?)"\*\n/gm;
  const searches: string[] = [];
  let match;
  while ((match = searchPattern.exec(content)) !== null) {
    searches.push(match[1]);
  }
  const cleanContent = searches.length > 0
    ? content.replace(/^\*Searched: ".+?"\*\n/gm, '').replace(/^---\n\n/, '')
    : content;
  return { searches, cleanContent };
}

export function MessageBubble({
  message,
  userName,
  isStreaming = false,
  onStar,
  onImageClick,
}: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const { searches, cleanContent } = useMemo(() => extractSearchInfo(message.content), [message.content]);

  const handleCopyMessage = async () => {
    const success = await copyToClipboard(message.content);
    if (success) {
      toast.success('Message copied');
    } else {
      toast.error('Failed to copy');
    }
  };

  const attachments: MessageAttachment[] = message.attachments || [];

  return (
    <div className={cn(styles.message, isUser ? styles.user : styles.assistant)}>
      <div className={styles.avatar}>
        {isUser ? (userName?.[0]?.toUpperCase() || 'U') : '\u{1F916}'}
      </div>

      <div className={styles.bubble}>
        {searches.length > 0 && (
          <div className={styles.searchIndicator}>
            {'\u{1F50D}'} {searches.map((q, i) => (
              <span key={i}>{i > 0 && ', '}<em>{q}</em></span>
            ))}
          </div>
        )}
        <div className={styles.content}>
          <MarkdownContent content={cleanContent} />
          {isStreaming && (
            <span className={styles.streaming}>
              <span className={styles.streamingDot} />
              <span className={styles.streamingDot} />
              <span className={styles.streamingDot} />
            </span>
          )}
        </div>

        {attachments.length > 0 && (
          <div className={styles.attachments}>
            {attachments.map((attachment, index) => (
              <img
                key={index}
                src={attachment.originalUrl}
                alt={attachment.filename}
                className={styles.attachment}
                onClick={() => onImageClick?.(attachment.originalUrl)}
              />
            ))}
          </div>
        )}

        <div className={styles.meta}>
          <span className={styles.time}>{formatTime(message.createdAt)}</span>
          {!isUser && message.modelUsed && message.modelUsed !== 'user' && message.modelUsed !== 'pending' && (
            <span className={styles.model}>{message.modelUsed}</span>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.actionButton}
              onClick={handleCopyMessage}
              title="Copy message"
            >
              {'\u{1F4CB}'}
            </button>
            {onStar && (
              <button
                type="button"
                className={styles.actionButton}
                onClick={onStar}
                title="Save to Knowledge Base"
              >
                {'\u2606'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
