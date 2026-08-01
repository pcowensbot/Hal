import { ArtifactCard } from './ArtifactCard';
import { cn } from '../../../lib/utils';
import type { Artifact } from '../../../types';
import styles from './ArtifactsPanel.module.css';

export interface ArtifactsPanelProps {
  artifacts: Artifact[];
  isOpen: boolean;
  onClose: () => void;
  onSaveToKnowledge: (artifact: Artifact) => Promise<void>;
}

export function ArtifactsPanel({
  artifacts,
  isOpen,
  onClose,
  onSaveToKnowledge,
}: ArtifactsPanelProps) {
  if (!isOpen) return null;

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={cn(styles.backdrop, styles.backdropVisible)}
        onClick={onClose}
      />

      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          {/* Back button (mobile only) */}
          <button
            type="button"
            className={styles.backBtn}
            onClick={onClose}
            aria-label="Close artifacts"
          >
            {'\u2190'}
          </button>

          <h2 className={styles.panelTitle}>
            Artifacts
            <span className={styles.artifactCount}>{artifacts.length}</span>
          </h2>

          {/* Close button (desktop only) */}
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close artifacts panel"
          >
            {'\u2715'}
          </button>
        </div>

        <div className={styles.artifactList}>
          {artifacts.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>{'\u{1F4C4}'}</div>
              <p className={styles.emptyText}>
                No artifacts yet. Code files generated in chat will appear here.
              </p>
            </div>
          ) : (
            artifacts.map((artifact) => (
              <ArtifactCard
                key={artifact.id}
                artifact={artifact}
                onSaveToKnowledge={onSaveToKnowledge}
              />
            ))
          )}
        </div>
      </div>
    </>
  );
}
