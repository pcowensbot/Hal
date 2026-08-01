import { useState } from 'react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { LoadingSpinner } from '../../ui/LoadingSpinner';
import { useBooks, useCreateNote } from '../../../hooks';
import { toast } from '../../../stores';
import type { Message } from '../../../types';
import styles from './StarMessageModal.module.css';

export interface StarMessageModalProps {
  message: Message;
  isOpen: boolean;
  onClose: () => void;
}

export function StarMessageModal({ message, isOpen, onClose }: StarMessageModalProps) {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [selectedBookId, setSelectedBookId] = useState<string>('');

  const { data: books, isLoading: isLoadingBooks } = useBooks();
  const createNoteMutation = useCreateNote();

  const handleSave = async () => {
    try {
      await createNoteMutation.mutateAsync({
        messageId: message.id,
        bookId: selectedBookId || undefined,
        title: title.trim() || undefined,
        note: note.trim() || undefined,
      });
      toast.success('Message saved to Knowledge Base');
      onClose();
      // Reset form
      setTitle('');
      setNote('');
      setSelectedBookId('');
    } catch {
      toast.error('Failed to save message');
    }
  };

  const handleClose = () => {
    if (!createNoteMutation.isPending) {
      setTitle('');
      setNote('');
      setSelectedBookId('');
      onClose();
    }
  };

  // Get a preview of the message content
  const contentPreview = message.content.length > 200
    ? message.content.substring(0, 200) + '...'
    : message.content;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Save to Knowledge Base"
      size="md"
    >
      <div className={styles.container}>
        {/* Message preview */}
        <div className={styles.preview}>
          <div className={styles.previewHeader}>
            <span className={styles.previewLabel}>
              {message.role === 'assistant' ? '\u{1F916} HAL' : '\u{1F464} You'}
            </span>
          </div>
          <div className={styles.previewContent}>
            {contentPreview}
          </div>
        </div>

        {/* Title input */}
        <Input
          label="Title (optional)"
          placeholder="Give this note a title..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        {/* Note input */}
        <div className={styles.inputGroup}>
          <label htmlFor="note-input" className={styles.label}>
            Note (optional)
          </label>
          <textarea
            id="note-input"
            className={styles.textarea}
            placeholder="Add your own notes or context..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
          />
        </div>

        {/* Book selector */}
        <div className={styles.inputGroup}>
          <label htmlFor="book-select" className={styles.label}>
            Add to Book (optional)
          </label>
          {isLoadingBooks ? (
            <div className={styles.loading}>
              <LoadingSpinner size="sm" />
            </div>
          ) : (
            <select
              id="book-select"
              className={styles.select}
              value={selectedBookId}
              onChange={(e) => setSelectedBookId(e.target.value)}
            >
              <option value="">No book (Unsorted)</option>
              {books?.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Actions */}
        <div className={styles.footer}>
          <Button
            variant="ghost"
            onClick={handleClose}
            disabled={createNoteMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            loading={createNoteMutation.isPending}
          >
            Save to Knowledge
          </Button>
        </div>
      </div>
    </Modal>
  );
}
