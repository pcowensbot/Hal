import { useState, useEffect } from 'react';
import { Modal } from '../../ui/Modal';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';
import { useUpdateNote, useBooks } from '../../../hooks/useKnowledge';
import type { StarredNote } from '../../../types';
import styles from './EditNoteModal.module.css';

interface EditNoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  note: StarredNote | null;
}

export function EditNoteModal({ isOpen, onClose, note }: EditNoteModalProps) {
  const [title, setTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [bookId, setBookId] = useState<string>('');
  const [error, setError] = useState('');

  const { data: books } = useBooks();
  const updateNote = useUpdateNote();

  // Reset form when note changes
  useEffect(() => {
    if (note) {
      setTitle(note.title || '');
      setNoteContent(note.note || '');
      setBookId(note.bookId || '');
    }
  }, [note]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note) return;

    setError('');

    try {
      await updateNote.mutateAsync({
        id: note.id,
        title: title.trim() || undefined,
        note: noteContent.trim() || undefined,
        bookId: bookId || undefined,
      });
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save note');
    }
  };

  const handleClose = () => {
    setTitle('');
    setNoteContent('');
    setBookId('');
    setError('');
    onClose();
  };

  // Get original message content for display
  const originalContent = note?.message?.content || '';

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={'\u{270F}\u{FE0F} Edit Note'}
      size="lg"
      footer={
        <div className={styles.footer}>
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={updateNote.isPending}
          >
            {updateNote.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className={styles.form}>
        <Input
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Give this note a title"
        />

        {originalContent && (
          <div className={styles.originalMessage}>
            <label className={styles.label}>Original Message</label>
            <div className={styles.messagePreview}>{originalContent}</div>
          </div>
        )}

        <div className={styles.textareaWrapper}>
          <label className={styles.label}>Your Notes</label>
          <textarea
            className={styles.textarea}
            value={noteContent}
            onChange={(e) => setNoteContent(e.target.value)}
            placeholder="Add your thoughts, annotations, or context"
            rows={4}
          />
        </div>

        <div className={styles.selectWrapper}>
          <label className={styles.label}>Book</label>
          <select
            className={styles.select}
            value={bookId}
            onChange={(e) => setBookId(e.target.value)}
          >
            <option value="">No Book (Loose Note)</option>
            {books?.map((book) => (
              <option key={book.id} value={book.id}>
                {book.name}
              </option>
            ))}
          </select>
        </div>

        {error && <p className={styles.error}>{error}</p>}
      </form>
    </Modal>
  );
}
