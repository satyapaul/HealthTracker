/**
 * Client-side session token store. The backend issues an opaque session token
 * (validated against Redis by the WP 1.2 authorizer); the SPA stores it and
 * sends it as `Authorization: Bearer <token>`.
 *
 * Stored in localStorage so a refresh keeps the user signed in. This holds only
 * the opaque token — never PHI. Listeners are notified on change so auth-gated
 * UI can react.
 */
const STORAGE_KEY = 'postopcare.session';

export interface SessionInfo {
  token: string;
  role: 'patient' | 'caregiver' | 'doctor' | 'admin';
  /** Present for patient/caregiver sessions only. */
  patientId?: string;
}

type Listener = (s: SessionInfo | null) => void;
const listeners = new Set<Listener>();
let current: SessionInfo | null = readFromStorage();

function readFromStorage(): SessionInfo | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SessionInfo) : null;
  } catch {
    return null;
  }
}

export function getSession(): SessionInfo | null {
  return current;
}

export function getSessionToken(): string | null {
  return current?.token ?? null;
}

export function setSession(info: SessionInfo | null): void {
  current = info;
  try {
    if (info) localStorage.setItem(STORAGE_KEY, JSON.stringify(info));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors (private mode); in-memory session still works.
  }
  for (const l of listeners) l(info);
}

export function clearSession(): void {
  setSession(null);
}

export function onSessionChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
