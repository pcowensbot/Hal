import { useState } from 'react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { LoadingSpinner } from '../../ui/LoadingSpinner';
import { useAutoOrganize, useNotes, useCreateBook, useUpdateNote } from '../../../hooks/useKnowledge';
import styles from './AutoOrganizeModal.module.css';

interface Suggestion {
  noteId: string;
  suggestedBook: string;
  confidence: number;
}

interface GroupedSuggestion {
  bookName: string;
  noteIds: string[];
  avgConfidence: number;
  selected: boolean;
}

interface AutoOrganizeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AutoOrganizeModal({ isOpen, onClose }: AutoOrganizeModalProps) {
  const [suggestions, setSuggestions] = useState<GroupedSuggestion[]>([]);
  const [uncategorizedCount, setUncategorizedCount] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  const { data: notes } = useNotes();
  const autoOrganize = useAutoOrganize();
  const createBook = useCreateBook();
  const updateNote = useUpdateNote();

  const handleAnalyze = async () => {
    if (!notes || notes.length === 0) {
      setError('No notes to organize');
      return;
    }

    // Get notes without books
    const looseNotes = notes.filter((n) => !n.bookId);
    if (looseNotes.length === 0) {
      setError('All notes are already organized into books');
      return;
    }

    setIsAnalyzing(true);
    setError('');
    setSuggestions([]);
    setShowSuggestions(false);

    try {
      const result = await autoOrganize.mutateAsync(looseNotes.map((n) => n.id));

      // Group suggestions by book name
      const grouped: Record<string, { noteIds: string[]; confidences: number[] }> = {};
      let uncategorized = 0;

      result.suggestions.forEach((s: Suggestion) => {
        if (!s.suggestedBook || s.confidence < 0.5) {
          uncategorized++;
          return;
        }

        const bookName = s.suggestedBook;
        if (!grouped[bookName]) {
          grouped[bookName] = { noteIds: [], confidences: [] };
        }
        grouped[bookName].noteIds.push(s.noteId);
        grouped[bookName].confidences.push(s.confidence);
      });

      const groupedSuggestions: GroupedSuggestion[] = Object.entries(grouped).map(
        ([bookName, data]) => ({
          bookName,
          noteIds: data.noteIds,
          avgConfidence: data.confidences.reduce((a, b) => a + b, 0) / data.confidences.length,
          selected: true,
        })
      );

      setSuggestions(groupedSuggestions);
      setUncategorizedCount(uncategorized);
      setShowSuggestions(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze notes');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const toggleSuggestion = (index: number) => {
    setSuggestions((prev) =>
      prev.map((s, i) => (i === index ? { ...s, selected: !s.selected } : s))
    );
  };

  const handleApply = async () => {
    const selectedSuggestions = suggestions.filter((s) => s.selected);
    if (selectedSuggestions.length === 0) {
      setError('Please select at least one book to create');
      return;
    }

    setIsApplying(true);
    setError('');

    try {
      for (const suggestion of selectedSuggestions) {
        // Create book
        const book = await createBook.mutateAsync({
          name: suggestion.bookName,
        });

        // Update notes to be in this book
        for (const noteId of suggestion.noteIds) {
          await updateNote.mutateAsync({
            id: noteId,
            bookId: book.id,
          });
        }
      }

      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply organization');
    } finally {
      setIsApplying(false);
    }
  };

  const handleClose = () => {
    setSuggestions([]);
    setUncategorizedCount(0);
    setIsAnalyzing(false);
    setIsApplying(false);
    setError('');
    setShowSuggestions(false);
    onClose();
  };

  const looseNotesCount = notes?.filter((n) => !n.bookId).length || 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={'\u{1F916} Auto-Organize with AI'}
      size="lg"
      footer={
        <div className={styles.footer}>
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          {!showSuggestions ? (
            <Button
              variant="primary"
              onClick={handleAnalyze}
              disabled={isAnalyzing || looseNotesCount === 0}
            >
              {isAnalyzing ? 'Analyzing...' : 'Analyze Notes'}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={handleApply}
              disabled={isApplying || suggestions.filter((s) => s.selected).length === 0}
            >
              {isApplying ? 'Creating Books...' : 'Create Selected Books'}
            </Button>
          )}
        </div>
      }
    >
      <div className={styles.content}>
        {isAnalyzing ? (
          <div className={styles.loading}>
            <LoadingSpinner />
            <p className={styles.loadingText}>Analyzing your notes with local AI...</p>
            <p className={styles.loadingSubtext}>This may take 10-30 seconds</p>
          </div>
        ) : showSuggestions ? (
          <>
            <p className={styles.description}>
              AI analyzed your notes and suggests these book groupings. Select which ones to create:
            </p>

            <div className={styles.suggestions}>
              {suggestions.map((suggestion, index) => (
                <label key={suggestion.bookName} className={styles.suggestion}>
                  <input
                    type="checkbox"
                    checked={suggestion.selected}
                    onChange={() => toggleSuggestion(index)}
                    className={styles.checkbox}
                  />
                  <div className={styles.suggestionContent}>
                    <div className={styles.suggestionHeader}>
                      <span className={styles.suggestionBook}>
                        {'\u{1F4D6}'} {suggestion.bookName}
                      </span>
                      <span className={styles.suggestionCount}>
                        {suggestion.noteIds.length} notes
                      </span>
                    </div>
                    <div className={styles.suggestionConfidence}>
                      Confidence: {Math.round(suggestion.avgConfidence * 100)}%
                    </div>
                  </div>
                </label>
              ))}
            </div>

            {uncategorizedCount > 0 && (
              <div className={styles.uncategorized}>
                <h4 className={styles.uncategorizedTitle}>
                  {'\u{1F4C4}'} Uncategorized Notes ({uncategorizedCount})
                </h4>
                <p className={styles.uncategorizedText}>
                  These notes didn't fit into any clear topic group
                </p>
              </div>
            )}
          </>
        ) : (
          <div className={styles.intro}>
            <p className={styles.description}>
              Let AI analyze your loose notes and suggest book groupings based on content similarity.
            </p>
            <div className={styles.stats}>
              <div className={styles.stat}>
                <span className={styles.statValue}>{looseNotesCount}</span>
                <span className={styles.statLabel}>loose notes</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statValue}>{notes?.length || 0}</span>
                <span className={styles.statLabel}>total notes</span>
              </div>
            </div>
            {looseNotesCount === 0 && (
              <p className={styles.noNotes}>All notes are already organized into books!</p>
            )}
          </div>
        )}

        {error && <p className={styles.error}>{error}</p>}
      </div>
    </Modal>
  );
}
