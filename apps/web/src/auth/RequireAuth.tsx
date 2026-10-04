import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from './useSession';
import type { UserRole } from '../api/types';

export interface RequireAuthProps {
  /** Roles allowed to view this route group. */
  roles: UserRole[];
  children: ReactNode;
}

/**
 * Route guard. Redirects unauthenticated users to the welcome screen, and
 * sends an authenticated user whose role is not permitted to their own portal.
 * This is a UX gate only — the API + RLS are the real authorization boundary.
 */
export function RequireAuth({ roles, children }: RequireAuthProps) {
  const session = useSession();
  const location = useLocation();

  if (!session) {
    return <Navigate to="/welcome" replace state={{ from: location.pathname }} />;
  }
  if (!roles.includes(session.role)) {
    return <Navigate to={homePathForRole(session.role)} replace />;
  }
  return <>{children}</>;
}

/** The landing route for each role. */
export function homePathForRole(role: UserRole): string {
  switch (role) {
    case 'doctor':
      return '/doctor';
    case 'admin':
      return '/admin';
    default:
      return '/app/home';
  }
}
