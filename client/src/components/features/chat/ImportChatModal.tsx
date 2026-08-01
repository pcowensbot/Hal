import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { toast } from '../../../stores';
import { importApi, ApiError } from '../../../lib/api';
import { chatKeys } from '../../../hooks';
import styles from './ImportChatModal.module.css';

export interface ImportChatModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ImportChatModal({ isOpen, onClose }: ImportChatModalProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [shareUrl, setShareUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  const detectPlatform = (url: string): string | null => {
    if (url.includes('claude.ai')) return 'Claude';
    if (url.includes('chatgpt.com')) return 'ChatGPT';
    return null;
  };

  const platform = shareUrl.trim() ? detectPlatform(shareUrl) : null;
  const isValidUrl = platform !== null;

  const handleImport = async () => {
    if (!shareUrl.trim()) {
      toast.error('Please paste a share link');
      return;
    }

    if (!isValidUrl) {
      toast.error('Only Claude.ai and ChatGPT share links are supported');
      return;
    }

    setIsImporting(true);
    try {
      const result = await importApi.importChat(shareUrl.trim());
      toast.success(`Imported ${result.conversation.messageCount} messages from ${result.conversation.platform}`);
      queryClient.invalidateQueries({ queryKey: chatKeys.conversations() });
      onClose();
      setShareUrl('');
      navigate(`/chat/${result.conversation.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to import conversation';
      const details = error instanceof ApiError ? (error.data as { message?: string })?.message : undefined;
      toast.error(message, { details });
    } finally {
      setIsImporting(false);
    }
  };

  const handleClose = () => {
    if (!isImporting) {
      setShareUrl('');
      onClose();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Import Conversation"
      size="md"
    >
      <div className={styles.container}>
        <p className={styles.description}>
          Paste a share link from Claude.ai or ChatGPT to import the conversation into HAL.
        </p>

        {/* URL input */}
        <div className={styles.inputGroup}>
          <label htmlFor="import-url" className={styles.label}>
            Share Link
          </label>
          <input
            id="import-url"
            type="url"
            className={styles.urlInput}
            value={shareUrl}
            onChange={(e) => setShareUrl(e.target.value)}
            placeholder="https://claude.ai/share/... or https://chatgpt.com/share/..."
            disabled={isImporting}
          />
          {shareUrl.trim() && (
            <div className={styles.platformDetected}>
              {isValidUrl ? (
                <span className={styles.platformValid}>Detected: {platform}</span>
              ) : (
                <span className={styles.platformInvalid}>Not a supported share link</span>
              )}
            </div>
          )}
        </div>

        {/* Instructions */}
        <div className={styles.instructions}>
          <h4 className={styles.instructionsTitle}>How to get a share link:</h4>
          <div className={styles.platformInstructions}>
            <div>
              <strong>Claude.ai</strong>
              <ol className={styles.instructionsList}>
                <li>Open the conversation</li>
                <li>Click the share icon</li>
                <li>Create a share link and copy it</li>
              </ol>
            </div>
            <div>
              <strong>ChatGPT</strong>
              <ol className={styles.instructionsList}>
                <li>Open the conversation</li>
                <li>Click the share icon at the top</li>
                <li>Copy the share link</li>
              </ol>
            </div>
          </div>
        </div>

        {isImporting && (
          <div className={styles.importingStatus}>
            Loading conversation... This may take a moment while we fetch the messages.
          </div>
        )}

        {/* Actions */}
        <div className={styles.footer}>
          <Button variant="ghost" onClick={handleClose} disabled={isImporting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleImport}
            loading={isImporting}
            disabled={!isValidUrl}
          >
            Import
          </Button>
        </div>
      </div>
    </Modal>
  );
}
