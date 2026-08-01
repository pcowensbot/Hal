import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';
import styles from './Badge.module.css';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  dot?: boolean;
  icon?: ReactNode;
}

export function Badge({
  className,
  variant = 'default',
  size = 'md',
  dot = false,
  icon,
  children,
  ...props
}: BadgeProps) {
  return (
    <span className={cn(styles.badge, styles[variant], styles[size], className)} {...props}>
      {dot && <span className={styles.dot} />}
      {icon}
      {children}
    </span>
  );
}
