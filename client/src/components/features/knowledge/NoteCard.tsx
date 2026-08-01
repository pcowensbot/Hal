import { useState } from 'react';
import { cn } from '../../../lib/utils';
import { useDeleteNote } from '../../../hooks/useKnowledge';
import type { StarredNote } from '../../../types';
import styles from './NoteCard.module.css';

interface NoteCardProps {
  note: StarredNote;
  onView: (note: StarredNote) => void;
  onEdit: (note: StarredNote) => void;
  showBook?: boolean;
}

export function NoteCard({ note, onView, onEdit, showBook = true }: NoteCardProps) {
  const deleteNote = useDeleteNote();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete) {
      await deleteNote.mutateAsync(note.id);
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  const handleClick = () => {
    onView(note);
  };

  // Get display content - prefer note's title, fallback to message content
  const title = note.title || 'Untitled Note';
  const content = note.note || note.message?.content || '';

  // Format date
  const date = new Date(note.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className={styles.card} onClick={handleClick}>
      <div className={styles.header}>
        <h3 className={styles.title}>{title}</h3>
        <div className={styles.actions}>
          <button
            className={styles.action}
            onClick={(e) => {
              e.stopPropagation();
              onEdit(note);
            }}
            title="Edit note"
          >
            {'\u{270F}\u{FE0F}'}
          </button>
          <button
            className={cn(styles.action, styles.danger)}
            onClick={handleDelete}
            title={confirmDelete ? 'Click again to confirm' : 'Delete note'}
          >
            {confirmDelete ? '\u{2757}' : '\u{1F5D1}\u{FE0F}'}
          </button>
        </div>
      </div>

      {content && <p className={styles.content}>{content}</p>}

      <div className={styles.meta}>
        <div className={styles.metaLeft}>
          {showBook && note.book && (
            <span className={styles.book}>
              {'\u{1F4D6}'} {note.book.name}
            </span>
          )}
        </div>
        <span className={styles.date}>{date}</span>
      </div>
    </div>
  );
}
