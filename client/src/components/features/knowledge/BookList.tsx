import { useState } from 'react';
import { cn } from '../../../lib/utils';
import { Button } from '../../ui/Button';
import { LoadingSpinner } from '../../ui/LoadingSpinner';
import { useBooks, useDeleteBook, useExportBook } from '../../../hooks/useKnowledge';
import type { Book } from '../../../types';
import styles from './BookList.module.css';

interface BookListProps {
  selectedBookId?: string | null;
  onSelectBook: (bookId: string | null) => void;
  onCreateBook: () => void;
  onEditBook: (book: Book) => void;
  onImportBook?: () => void;
}

export function BookList({
  selectedBookId,
  onSelectBook,
  onCreateBook,
  onEditBook,
  onImportBook,
}: BookListProps) {
  const { data: books, isLoading } = useBooks();
  const deleteBook = useDeleteBook();
  const exportBook = useExportBook();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const handleDelete = async (book: Book, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete === book.id) {
      await deleteBook.mutateAsync(book.id);
      if (selectedBookId === book.id) {
        onSelectBook(null);
      }
      setConfirmDelete(null);
    } else {
      setConfirmDelete(book.id);
      setTimeout(() => setConfirmDelete(null), 3000);
    }
  };

  const handleExport = async (book: Book, e: React.MouseEvent) => {
    e.stopPropagation();
    const data = await exportBook.mutateAsync(book.id);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${book.name.toLowerCase().replace(/\s+/g, '-')}-export.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleEdit = (book: Book, e: React.MouseEvent) => {
    e.stopPropagation();
    onEditBook(book);
  };

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <LoadingSpinner size="sm" />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h4 className={styles.title}>{'\u{1F4DA}'} My Books</h4>
        <div className={styles.headerActions}>
          {onImportBook && (
            <Button variant="ghost" size="sm" onClick={onImportBook} title="Import book">
              {'\u{1F4E5}'}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onCreateBook} title="Create new book">
            +
          </Button>
        </div>
      </div>

      <div className={styles.list}>
        {/* All Notes option */}
        <button
          className={cn(styles.item, selectedBookId === null && styles.active)}
          onClick={() => onSelectBook(null)}
        >
          <span className={styles.icon}>{'\u{1F4D1}'}</span>
          <span className={styles.name}>All Notes</span>
        </button>

        {/* Books */}
        {books?.map((book) => (
          <button
            key={book.id}
            className={cn(styles.item, selectedBookId === book.id && styles.active)}
            onClick={() => onSelectBook(book.id)}
          >
            <span className={styles.icon}>{'\u{1F4D6}'}</span>
            <span className={styles.name}>{book.name}</span>
            {book.notes && book.notes.length > 0 && (
              <span className={styles.count}>{book.notes.length}</span>
            )}
            <div className={styles.actions}>
              <button
                className={styles.action}
                onClick={(e) => handleEdit(book, e)}
                title="Edit book"
              >
                {'\u{270F}\u{FE0F}'}
              </button>
              <button
                className={styles.action}
                onClick={(e) => handleExport(book, e)}
                title="Export book"
              >
                {'\u{1F4E4}'}
              </button>
              <button
                className={cn(styles.action, styles.danger)}
                onClick={(e) => handleDelete(book, e)}
                title={confirmDelete === book.id ? 'Click again to confirm' : 'Delete book'}
              >
                {confirmDelete === book.id ? '\u{2757}' : '\u{1F5D1}\u{FE0F}'}
              </button>
            </div>
          </button>
        ))}

        {(!books || books.length === 0) && (
          <p className={styles.empty}>No books yet. Create one to get started.</p>
        )}
      </div>
    </div>
  );
}
