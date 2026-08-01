import { cn } from '../../lib/utils';
import styles from './LoadingSpinner.module.css';

export interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  text?: string;
  fullScreen?: boolean;
  className?: string;
}

export function LoadingSpinner({
  size = 'md',
  text,
  fullScreen = false,
  className,
}: LoadingSpinnerProps) {
  return (
    <div className={cn(styles.container, fullScreen && styles.fullScreen, className)}>
      <div className={cn(styles.spinner, styles[size])} />
      {text && <span className={styles.text}>{text}</span>}
    </div>
  );
}
