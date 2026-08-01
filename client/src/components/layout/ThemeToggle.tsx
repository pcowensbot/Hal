import { useState, useRef, useEffect } from 'react';
import { useThemeStore, type ThemeMode } from '../../stores';
import { cn } from '../../lib/utils';
import styles from './ThemeToggle.module.css';

const themeOptions: Array<{ mode: ThemeMode; icon: string; label: string }> = [
  { mode: 'light', icon: '\u2600', label: 'Light' },
  { mode: 'dark', icon: '\u263D', label: 'Dark' },
  { mode: 'system', icon: '\u2699', label: 'System' },
];

export interface ThemeToggleProps {
  variant?: 'button' | 'dropdown';
  className?: string;
}

export function ThemeToggle({ variant = 'button', className }: ThemeToggleProps) {
  const { mode, setMode } = useThemeStore();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Get current icon
  const currentOption = themeOptions.find((opt) => opt.mode === mode) || themeOptions[0];
  const resolvedIcon = mode === 'system'
    ? (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? '\u263D' : '\u2600')
    : currentOption.icon;

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Simple toggle for button variant
  const handleToggle = () => {
    if (variant === 'dropdown') {
      setIsOpen(!isOpen);
    } else {
      // Cycle through: light -> dark -> system -> light
      const currentIndex = themeOptions.findIndex((opt) => opt.mode === mode);
      const nextIndex = (currentIndex + 1) % themeOptions.length;
      setMode(themeOptions[nextIndex].mode);
    }
  };

  const handleSelectMode = (newMode: ThemeMode) => {
    setMode(newMode);
    setIsOpen(false);
  };

  if (variant === 'button') {
    return (
      <button
        type="button"
        className={cn(styles.toggle, className)}
        onClick={handleToggle}
        aria-label={`Current theme: ${currentOption.label}. Click to change.`}
        title={`Theme: ${currentOption.label}`}
      >
        <span className={styles.icon}>{resolvedIcon}</span>
      </button>
    );
  }

  // Dropdown variant
  return (
    <div ref={dropdownRef} className={cn(styles.dropdown, isOpen && styles.open, className)}>
      <button
        type="button"
        className={styles.toggle}
        onClick={handleToggle}
        aria-label={`Current theme: ${currentOption.label}. Click to change.`}
        aria-expanded={isOpen}
      >
        <span className={styles.icon}>{resolvedIcon}</span>
      </button>

      <div className={styles.dropdownMenu} role="menu">
        {themeOptions.map((option) => (
          <button
            key={option.mode}
            type="button"
            className={cn(styles.option, mode === option.mode && styles.active)}
            onClick={() => handleSelectMode(option.mode)}
            role="menuitem"
          >
            <span className={styles.optionIcon}>{option.icon}</span>
            <span>{option.label}</span>
            {mode === option.mode && <span className={styles.check}>{'\u2713'}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
