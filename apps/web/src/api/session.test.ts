import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSession, getSession, getSessionToken, onSessionChange, setSession } from './session';

afterEach(() => {
  clearSession();
});

describe('session store', () => {
  it('stores and reads the current session + token', () => {
    setSession({ token: 'abc', role: 'patient', patientId: 'p1' });
    expect(getSession()).toEqual({ token: 'abc', role: 'patient', patientId: 'p1' });
    expect(getSessionToken()).toBe('abc');
  });

  it('clears the session', () => {
    setSession({ token: 'abc', role: 'doctor' });
    clearSession();
    expect(getSession()).toBeNull();
    expect(getSessionToken()).toBeNull();
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = onSessionChange(listener);

    setSession({ token: 't1', role: 'admin' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith({ token: 't1', role: 'admin' });

    unsubscribe();
    setSession({ token: 't2', role: 'admin' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps the session readable after it is set (persistence path)', () => {
    setSession({ token: 'persist-me', role: 'patient', patientId: 'p9' });
    // The in-memory + storage-backed value is immediately readable.
    expect(getSessionToken()).toBe('persist-me');
    expect(getSession()?.patientId).toBe('p9');
  });
});
