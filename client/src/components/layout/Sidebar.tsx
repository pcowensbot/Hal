import { type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useThemeStore, useAuthStore, useUIStore } from '../../stores';
import { cn } from '../../lib/utils';
import { Avatar } from './Avatar';
import styles from './Sidebar.module.css';

export interface NavItemConfig {
  to: string;
  icon: ReactNode;
  label: string;
  badge?: number | string;
  onClick?: () => void;
}

export interface NavSectionConfig {
  title?: string;
  items: NavItemConfig[];
}

export interface SidebarProps {
  logo?: ReactNode;
  subtitle?: string;
  navSections?: NavSectionConfig[];
  footer?: ReactNode;
  className?: string;
}

export function Sidebar({
  logo = 'HAL',
  subtitle = 'Home AI Assistant',
  navSections,
  footer,
  className,
}: SidebarProps) {
  const navigate = useNavigate();
  const { sidebarCollapsed, toggleSidebar } = useThemeStore();
  const { mobileMenuOpen, setMobileMenuOpen } = useUIStore();
  const user = useAuthStore((state) => state.user);

  const handleNavClick = () => {
    // Close mobile menu when navigating
    if (mobileMenuOpen) {
      setMobileMenuOpen(false);
    }
  };

  const handleUserClick = () => {
    navigate('/profile');
    handleNavClick();
  };

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={cn(styles.backdrop, mobileMenuOpen && styles.visible)}
        onClick={() => setMobileMenuOpen(false)}
      />

      <aside
        className={cn(
          styles.sidebar,
          sidebarCollapsed && styles.collapsed,
          mobileMenuOpen && styles.mobileOpen,
          className
        )}
      >
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.logoRow}>
            <NavLink to="/chat" className={styles.logo} onClick={handleNavClick}>
              {logo}
            </NavLink>
            <button
              type="button"
              className={styles.collapseButton}
              onClick={toggleSidebar}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <span className={styles.collapseIcon}>{'\u2039'}</span>
            </button>
          </div>
          <span className={styles.subtitle}>{subtitle}</span>
        </div>

        {/* Navigation */}
        <nav className={styles.nav}>
          {navSections?.map((section, sectionIndex) => (
            <div key={sectionIndex} className={styles.navSection}>
              {section.title && (
                <div className={styles.navSectionTitle}>{section.title}</div>
              )}
              {section.items.map((item, itemIndex) => (
                <NavLink
                  key={itemIndex}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(styles.navItem, isActive && styles.active)
                  }
                  onClick={() => {
                    item.onClick?.();
                    handleNavClick();
                  }}
                >
                  <span className={styles.navIcon}>{item.icon}</span>
                  <span className={styles.navText}>{item.label}</span>
                  {item.badge !== undefined && (
                    <span className={styles.navBadge}>{item.badge}</span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className={styles.footer}>
          {footer}

          {/* User section */}
          {user && (
            <div className={styles.userSection} onClick={handleUserClick}>
              <Avatar
                src={user.avatar}
                name={user.firstName}
                size={sidebarCollapsed ? 'sm' : 'md'}
              />
              <div className={styles.userInfo}>
                <div className={styles.userName}>{user.firstName}</div>
                <div className={styles.userRole}>
                  {user.customRole?.name || user.role}
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
