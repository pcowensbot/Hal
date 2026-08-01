import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores';
import { LoadingSpinner } from './ui';

interface AuthGuardProps {
  children: ReactNode;
  requireAuth?: boolean;
  requirePermission?: string;
  requireSystemAdmin?: boolean;
  fallback?: ReactNode;
}

/**
 * AuthGuard component for protecting routes
 *
 * Usage:
 * - Wrap protected routes to require authentication
 * - Use requirePermission to check for specific permissions
 * - Use requireSystemAdmin for system admin only routes
 */
export function AuthGuard({
  children,
  requireAuth = true,
  requirePermission,
  requireSystemAdmin = false,
  fallback,
}: AuthGuardProps) {
  const location = useLocation();
  const { isAuthenticated, user, isLoading } = useAuthStore();

  // Show loading state while checking auth
  if (isLoading) {
    return fallback ?? <LoadingSpinner fullScreen text="Loading..." />;
  }

  // Redirect to login if auth required but not authenticated
  if (requireAuth && !isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Check system admin requirement
  if (requireSystemAdmin && !user?.isSystemAdmin) {
    return <Navigate to="/chat" replace />;
  }

  // Check specific permission requirement
  if (requirePermission && user?.permissions) {
    const hasPermission = user.permissions[requirePermission as keyof typeof user.permissions];
    if (!hasPermission) {
      return <Navigate to="/chat" replace />;
    }
  }

  return <>{children}</>;
}

/**
 * PublicRoute - redirects authenticated users to chat
 */
export function PublicRoute({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const location = useLocation();

  if (isAuthenticated) {
    // Redirect to the page they were trying to access, or chat
    const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/chat';
    return <Navigate to={from} replace />;
  }

  return <>{children}</>;
}
