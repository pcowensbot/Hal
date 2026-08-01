import { NoteCard } from './NoteCard';
import { LoadingSpinner } from '../../ui/LoadingSpinner';
import { EmptyState } from '../../ui/EmptyState';
import type { StarredNote } from '../../../types';
import styles from './NoteGrid.module.css';

interface NoteGridProps {
  notes: StarredNote[] | undefined;
  isLoading: boolean;
  onViewNote: (note: StarredNote) => void;
  onEditNote: (note: StarredNote) => void;
  showBook?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function NoteGrid({
  notes,
  isLoading,
  onViewNote,
  onEditNote,
  showBook = true,
  emptyTitle = 'No notes yet',
  emptyDescription = 'Star messages from your chats to save them here.',
}: NoteGridProps) {
  if (isLoading) {
    return (
      <div className={styles.loading}>
        <LoadingSpinner />
        <p className={styles.loadingText}>Loading notes...</p>
      </div>
    );
  }

  if (!notes || notes.length === 0) {
    return (
      <EmptyState
        icon={'\u{1F4D1}'}
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  return (
    <div className={styles.grid}>
      {notes.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          onView={onViewNote}
          onEdit={onEditNote}
          showBook={showBook}
        />
      ))}
    </div>
  );
}
