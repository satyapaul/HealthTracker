import { useSyncExternalStore } from 'react';
import { getSession, onSessionChange, type SessionInfo } from '../api/session';

/**
 * Subscribe to the current session as React state. Backed by the external
 * session store (localStorage) so every component sees the same auth state and
 * re-renders on sign-in/sign-out.
 */
export function useSession(): SessionInfo | null {
  return useSyncExternalStore(onSessionChange, getSession, getSession);
}
