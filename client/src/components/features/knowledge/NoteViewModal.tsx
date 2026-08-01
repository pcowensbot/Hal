import { useState, useEffect } from 'react';
import { Modal } from '../../ui/Modal';
import { MarkdownContent } from '../../ui/MarkdownContent';
import { Button } from '../../ui/Button';
import { useUpdateNote } from '../../../hooks/useKnowledge';
import { toast } from '../../../stores';
import type { StarredNote } from '../../../types';
import { cn } from '../../../lib/utils';
import styles from './NoteViewModal.module.css';

export interface NoteViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onEdit?: () => void;
  note: StarredNote | null;
}

export function NoteViewModal({ isOpen, onClose, note }: NoteViewModalProps) {
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [noteContent, setNoteContent] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const updateNote = useUpdateNote();

  // Sync note content when note changes
  useEffect(() => {
    if (note) {
      setNoteContent(note.note || '');
      setIsDirty(false);
    }
  }, [note]);

  if (!note) return null;

  const title = note.title || 'Untitled Note';
  const originalContent = note.message?.content || '';
  const hasNotes = !!(note.note || '').trim();

  const date = new Date(note.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  const handleNoteChange = (value: string) => {
    setNoteContent(value);
    setIsDirty(value !== (note.note || ''));
  };

  const handleSaveNotes = async () => {
    try {
      await updateNote.mutateAsync({
        id: note.id,
        note: noteContent.trim() || undefined,
      });
      setIsDirty(false);
      toast.success('Notes saved');
    } catch {
      toast.error('Failed to save notes');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title=""
      size="xl"
    >
      <div className={styles.container}>
        {/* Main content */}
        <div className={styles.mainContent}>
          {/* Header bar — title, meta, edit pencil */}
          <div className={styles.header}>
            <div className={styles.headerLeft}>
              <h2 className={styles.title}>{title}</h2>
              <div className={styles.meta}>
                <span className={styles.date}>{date}</span>
                {note.book && (
                  <span className={styles.metaBadge}>
                    {'\uD83D\uDCD6'} {note.book.name}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Message content with markdown rendering */}
          <div className={styles.messageContent}>
            {originalContent ? (
              <MarkdownContent content={originalContent} />
            ) : (
              <p className={styles.emptyMessage}>No message content</p>
            )}
          </div>
        </div>

        {/* Notes panel — always visible as tab, expands to full panel */}
        <div className={cn(styles.notesPanel, notesExpanded && styles.expanded)}>
          {/* Tab handle — always visible */}
          <button
            type="button"
            className={styles.notesTab}
            onClick={() => setNotesExpanded(!notesExpanded)}
            title={notesExpanded ? 'Collapse notes' : 'Expand notes'}
          >
            <span className={styles.notesTabIcon}>{'\uD83D\uDCDD'}</span>
            {!notesExpanded && hasNotes && <span className={styles.notesTabDot} />}
          </button>

          {/* Expanded notes content */}
          <div className={styles.notesContent}>
            <div className={styles.notesHeader}>
              <h3 className={styles.notesTitle}>Notes</h3>
              {isDirty && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSaveNotes}
                  loading={updateNote.isPending}
                >
                  Save
                </Button>
              )}
            </div>
            <textarea
              className={styles.notesTextarea}
              value={noteContent}
              onChange={(e) => handleNoteChange(e.target.value)}
              placeholder="Add your notes, annotations, or context..."
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
