import { useState, useRef } from 'react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { useImportBook } from '../../../hooks/useKnowledge';
import type { Book, StarredNote } from '../../../types';
import styles from './ImportBookModal.module.css';

interface ImportData {
  book: Partial<Book>;
  notes: Partial<StarredNote>[];
  exportedBy?: string;
  exportedAt?: string;
}

interface ImportBookModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ImportBookModal({ isOpen, onClose }: ImportBookModalProps) {
  const [importData, setImportData] = useState<ImportData | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importBook = useImportBook();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');
    setImportData(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);

        // Validate structure
        if (!data.book || !data.notes) {
          throw new Error('Invalid import file format');
        }

        setImportData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to parse import file');
      }
    };
    reader.onerror = () => {
      setError('Failed to read file');
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!importData) return;

    setError('');

    try {
      await importBook.mutateAsync({
        book: importData.book,
        notes: importData.notes,
      });
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import book');
    }
  };

  const handleClose = () => {
    setImportData(null);
    setError('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={'\u{1F4E5} Import Book'}
      footer={
        <div className={styles.footer}>
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleImport}
            disabled={!importData || importBook.isPending}
          >
            {importBook.isPending ? 'Importing...' : 'Import Book'}
          </Button>
        </div>
      }
    >
      <div className={styles.content}>
        <p className={styles.description}>
          Import a book shared by a friend (JSON file)
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className={styles.fileInput}
        />

        {importData && (
          <div className={styles.preview}>
            <h4 className={styles.previewTitle}>Preview</h4>
            <div className={styles.previewItem}>
              <span className={styles.previewLabel}>Book:</span>
              <span className={styles.previewValue}>{importData.book.name}</span>
            </div>
            <div className={styles.previewItem}>
              <span className={styles.previewLabel}>Notes:</span>
              <span className={styles.previewValue}>{importData.notes.length}</span>
            </div>
            {importData.exportedBy && (
              <div className={styles.previewItem}>
                <span className={styles.previewLabel}>Exported by:</span>
                <span className={styles.previewValue}>{importData.exportedBy}</span>
              </div>
            )}
            {importData.exportedAt && (
              <div className={styles.previewItem}>
                <span className={styles.previewLabel}>Exported:</span>
                <span className={styles.previewValue}>
                  {new Date(importData.exportedAt).toLocaleDateString()}
                </span>
              </div>
            )}
          </div>
        )}

        {error && <p className={styles.error}>{error}</p>}
      </div>
    </Modal>
  );
}
