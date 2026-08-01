import { useState } from 'react';
import { Modal } from '../../ui/Modal';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';
import { useCreateBook, useUpdateBook } from '../../../hooks/useKnowledge';
import type { Book } from '../../../types';
import styles from './CreateBookModal.module.css';

interface CreateBookModalProps {
  isOpen: boolean;
  onClose: () => void;
  editBook?: Book | null;
}

export function CreateBookModal({ isOpen, onClose, editBook }: CreateBookModalProps) {
  const [name, setName] = useState(editBook?.name || '');
  const [description, setDescription] = useState(editBook?.description || '');
  const [error, setError] = useState('');

  const createBook = useCreateBook();
  const updateBook = useUpdateBook();

  const isEditing = !!editBook;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Book name is required');
      return;
    }

    try {
      if (isEditing) {
        await updateBook.mutateAsync({
          id: editBook.id,
          name: name.trim(),
          description: description.trim() || undefined,
        });
      } else {
        await createBook.mutateAsync({
          name: name.trim(),
          description: description.trim() || undefined,
        });
      }
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save book');
    }
  };

  const handleClose = () => {
    setName('');
    setDescription('');
    setError('');
    onClose();
  };

  // Reset form when editBook changes
  if (isOpen && editBook && name !== editBook.name) {
    setName(editBook.name);
    setDescription(editBook.description || '');
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={isEditing ? '\u{270F}\u{FE0F} Edit Book' : '\u{1F4DA} Create New Book'}
      footer={
        <div className={styles.footer}>
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={createBook.isPending || updateBook.isPending}
          >
            {createBook.isPending || updateBook.isPending
              ? 'Saving...'
              : isEditing
              ? 'Save Changes'
              : 'Create Book'}
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className={styles.form}>
        <Input
          label="Book Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Python Notes, Recipes, Family Tips"
          required
          autoFocus
        />
        <div className={styles.textareaWrapper}>
          <label className={styles.label}>Description (optional)</label>
          <textarea
            className={styles.textarea}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this book about?"
            rows={3}
          />
        </div>
        {error && <p className={styles.error}>{error}</p>}
      </form>
    </Modal>
  );
}
