import { useState } from 'react';
import { useUIStore, type Toast as ToastType } from '../../stores';
import { cn } from '../../lib/utils';
import styles from './Toast.module.css';

const icons = {
  success: '\u2713', // checkmark
  error: '\u2717',   // x mark
  warning: '\u26A0', // warning
  info: '\u2139',    // info
};

function ToastItem({ toast, onClose }: { toast: ToastType; onClose: () => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn(styles.toast, styles[toast.type])}>
      <span className={styles.icon}>{icons[toast.type]}</span>
      <div className={styles.content}>
        <p className={styles.message}>{toast.message}</p>
        {toast.details && !expanded && (
          <button
            type="button"
            className={styles.moreButton}
            onClick={() => setExpanded(true)}
          >
            More
          </button>
        )}
        {toast.details && expanded && (
          <p className={styles.details}>{toast.details}</p>
        )}
      </div>
      <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Dismiss">
        &times;
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useUIStore((state) => state.toasts);
  const removeToast = useUIStore((state) => state.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className={styles.container}>
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
      ))}
    </div>
  );
}
