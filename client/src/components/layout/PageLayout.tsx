import { type ReactNode } from 'react';
import { Sidebar, type NavSectionConfig } from './Sidebar';
import { Header, type HeaderProps } from './Header';
import { ThemeToggle } from './ThemeToggle';
import { Button } from '../ui/Button';
import { useLogout } from '../../hooks';
import { useAuthStore } from '../../stores';
import { cn } from '../../lib/utils';
import styles from './PageLayout.module.css';

export interface PageLayoutProps {
  children: ReactNode;
  header?: HeaderProps;
  showSidebar?: boolean;
  showHeader?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  maxWidth?: 'full' | 'narrow' | 'medium' | 'wide';
  centered?: boolean;
  className?: string;
}

// Default navigation sections
function useDefaultNavSections(): NavSectionConfig[] {
  const user = useAuthStore((state) => state.user);
  const permissions = user?.permissions;
  const isSystemAdmin = user?.isSystemAdmin;

  const sections: NavSectionConfig[] = [
    {
      items: [
        { to: '/chat', icon: '\u{1F4AC}', label: 'Chat' },
        { to: '/knowledge', icon: '\u{1F4DA}', label: 'Knowledge' },
      ],
    },
  ];

  // Add admin section if user has any admin permissions
  const hasAdminAccess = isSystemAdmin ||
    permissions?.canManageUsers ||
    permissions?.canManageGroups ||
    permissions?.canManageRoles;

  if (hasAdminAccess) {
    sections.push({
      title: 'Admin',
      items: [
        { to: '/dashboard', icon: '\u{1F4CA}', label: 'Dashboard' },
      ],
    });
  }

  return sections;
}

export function PageLayout({
  children,
  header,
  showSidebar = true,
  showHeader = true,
  padding = 'md',
  maxWidth = 'full',
  centered = false,
  className,
}: PageLayoutProps) {
  const logout = useLogout();
  const navSections = useDefaultNavSections();

  const sidebarFooter = (
    <div style={{ display: 'flex', gap: '0.5rem' }}>
      <ThemeToggle variant="dropdown" />
      <Button
        variant="ghost"
        size="sm"
        onClick={logout}
        title="Logout"
        style={{ flex: 1 }}
      >
        {'\u{1F6AA}'} <span style={{ marginLeft: '0.25rem' }}>Logout</span>
      </Button>
    </div>
  );

  const paddingClass = {
    none: '',
    sm: styles.paddedSm,
    md: styles.padded,
    lg: styles.paddedLg,
  }[padding];

  const maxWidthClass = {
    full: '',
    narrow: styles.narrow,
    medium: styles.medium,
    wide: styles.wide,
  }[maxWidth];

  return (
    <div className={styles.layout}>
      {showSidebar && (
        <Sidebar navSections={navSections} footer={sidebarFooter} />
      )}

      <main className={styles.main}>
        {showHeader && header && <Header {...header} />}

        <div
          className={cn(
            styles.content,
            paddingClass,
            maxWidthClass,
            centered && styles.centered,
            className
          )}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
