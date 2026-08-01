import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import styles from './Card.module.css';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'elevated' | 'bordered' | 'flat';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hoverable?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'elevated', padding = 'md', hoverable = false, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          styles.card,
          variant === 'bordered' && styles.bordered,
          variant === 'flat' && styles.flat,
          styles[padding],
          hoverable && styles.hoverable,
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';

// Card subcomponents
export interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  description?: string;
  compact?: boolean;
  action?: ReactNode;
}

export function CardHeader({
  className,
  title,
  description,
  compact = false,
  action,
  children,
  ...props
}: CardHeaderProps) {
  return (
    <div className={cn(styles.header, compact && styles.compact, className)} {...props}>
      {(title || description) && (
        <div>
          {title && <h3 className={styles.title}>{title}</h3>}
          {description && <p className={styles.description}>{description}</p>}
        </div>
      )}
      {action && <div>{action}</div>}
      {children}
    </div>
  );
}

export interface CardBodyProps extends HTMLAttributes<HTMLDivElement> {
  compact?: boolean;
}

export function CardBody({ className, compact = false, children, ...props }: CardBodyProps) {
  return (
    <div className={cn(styles.body, compact && styles.compact, className)} {...props}>
      {children}
    </div>
  );
}

export interface CardFooterProps extends HTMLAttributes<HTMLDivElement> {
  compact?: boolean;
}

export function CardFooter({ className, compact = false, children, ...props }: CardFooterProps) {
  return (
    <div className={cn(styles.footer, compact && styles.compact, className)} {...props}>
      {children}
    </div>
  );
}
