import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useUIStore } from '../../stores';
import { cn } from '../../lib/utils';
import styles from './Header.module.css';

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

export interface HeaderProps {
  title?: string;
  subtitle?: string;
  breadcrumbs?: BreadcrumbItem[];
  actions?: ReactNode;
  center?: ReactNode;
  sticky?: boolean;
  transparent?: boolean;
  showMenuButton?: boolean;
  className?: string;
}

export function Header({
  title,
  subtitle,
  breadcrumbs,
  actions,
  center,
  sticky = false,
  transparent = false,
  showMenuButton = true,
  className,
}: HeaderProps) {
  const toggleMobileMenu = useUIStore((state) => state.toggleMobileMenu);

  return (
    <header
      className={cn(
        styles.header,
        sticky && styles.sticky,
        transparent && styles.transparent,
        className
      )}
    >
      <div className={styles.left}>
        {showMenuButton && (
          <button
            type="button"
            className={styles.menuButton}
            onClick={toggleMobileMenu}
            aria-label="Toggle menu"
          >
            {'\u2630'}
          </button>
        )}

        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav className={styles.breadcrumb} aria-label="Breadcrumb">
            {breadcrumbs.map((item, index) => (
              <span key={index}>
                {index > 0 && <span className={styles.breadcrumbSeparator}>/</span>}
                {item.to ? (
                  <Link to={item.to} className={styles.breadcrumbItem}>
                    {item.label}
                  </Link>
                ) : (
                  <span className={cn(styles.breadcrumbItem, styles.current)}>
                    {item.label}
                  </span>
                )}
              </span>
            ))}
          </nav>
        ) : (
          <div className={styles.titleSection}>
            {title && <h1 className={styles.title}>{title}</h1>}
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
        )}
      </div>

      {center && <div className={styles.center}>{center}</div>}

      {actions && <div className={styles.right}>{actions}</div>}
    </header>
  );
}

// Header action button helper
export interface HeaderActionProps {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
  className?: string;
}

export function HeaderAction({ icon, label, onClick, active, className }: HeaderActionProps) {
  return (
    <button
      type="button"
      className={cn(styles.action, active && styles.active, className)}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  );
}
