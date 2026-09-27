/**
 * WP 1.2 API Gateway request authorizer unit tests. All deps are injected fakes
 * (reusing __tests__/fakes.ts). Covers the DoD:
 *  - valid token -> isAuthorized true + context (userId/role/patientId), no
 *    token/PHI in context
 *  - missing/empty Authorization -> deny
 *  - unknown token (no Redis key, i.e. expired/revoked) -> deny
 *  - malformed header (no Bearer prefix) -> deny
 *  - deny paths never throw
 *  - null patientId maps to ""
 */
import { describe, it, expect } from 'vitest';
import { authorizerWithDeps, extractBearerToken } from '../authorizer';
import { sessionKey } from '../services/session';
import { makeBundle } from './fakes';

function seedSession(
  b: ReturnType<typeof makeBundle>,
  token: string,
  payload: { userId: string; role: string; patientId: string | null }
): Promise<void> {
  return b.redis.set(sessionKey(token), JSON.stringify(payload));
}

describe('authorizer — valid session', () => {
  it('allows a valid token and returns userId/role/patientId context', async () => {
    const b = makeBundle();
    await seedSession(b, 'good-token', {
      userId: 'u1',
      role: 'patient',
      patientId: 'p1',
    });

    const res = await authorizerWithDeps(b.deps)({
      identitySource: ['Bearer good-token'],
    });

    expect(res.isAuthorized).toBe(true);
    expect(res.context).toEqual({ userId: 'u1', role: 'patient', patientId: 'p1' });
    // No token or PHI in the context.
    const serialized = JSON.stringify(res.context);
    expect(serialized).not.toContain('good-token');
    expect(serialized).not.toContain('Bearer');
  });

  it('reads the token from the Authorization header (case-insensitive) too', async () => {
    const b = makeBundle();
    await seedSession(b, 'hdr-token', { userId: 'u2', role: 'doctor', patientId: null });

    const res = await authorizerWithDeps(b.deps)({
      headers: { authorization: 'Bearer hdr-token' },
    });

    expect(res.isAuthorized).toBe(true);
    expect(res.context?.userId).toBe('u2');
    expect(res.context?.role).toBe('doctor');
  });

  it('maps a null patientId to an empty string', async () => {
    const b = makeBundle();
    await seedSession(b, 'doc-token', { userId: 'u3', role: 'doctor', patientId: null });

    const res = await authorizerWithDeps(b.deps)({
      identitySource: ['Bearer doc-token'],
    });

    expect(res.isAuthorized).toBe(true);
    expect(res.context?.patientId).toBe('');
  });
});

describe('authorizer — deny paths (never throw)', () => {
  it('denies when the Authorization header is missing', async () => {
    const b = makeBundle();
    const run = () => authorizerWithDeps(b.deps)({ headers: {} });
    await expect(run()).resolves.toEqual({ isAuthorized: false });
  });

  it('denies an empty bearer token', async () => {
    const b = makeBundle();
    const res = await authorizerWithDeps(b.deps)({ headers: { Authorization: 'Bearer ' } });
    expect(res).toEqual({ isAuthorized: false });
  });

  it('denies an unknown token (no Redis key — expired/revoked)', async () => {
    const b = makeBundle();
    // Nothing seeded in Redis.
    const res = await authorizerWithDeps(b.deps)({
      headers: { Authorization: 'Bearer nonexistent' },
    });
    expect(res).toEqual({ isAuthorized: false });
  });

  it('denies a malformed header with no Bearer prefix', async () => {
    const b = makeBundle();
    await seedSession(b, 'raw-token', { userId: 'u4', role: 'admin', patientId: null });
    const res = await authorizerWithDeps(b.deps)({
      headers: { Authorization: 'raw-token' },
    });
    expect(res).toEqual({ isAuthorized: false });
  });

  it('does not throw and denies on a completely empty event', async () => {
    const b = makeBundle();
    const run = () => authorizerWithDeps(b.deps)({});
    await expect(run()).resolves.toEqual({ isAuthorized: false });
  });
});

describe('extractBearerToken', () => {
  it('prefers identitySource[0] over the header', () => {
    expect(
      extractBearerToken({
        identitySource: ['Bearer from-identity'],
        headers: { authorization: 'Bearer from-header' },
      })
    ).toBe('from-identity');
  });

  it('strips the Bearer prefix case-insensitively', () => {
    expect(extractBearerToken({ headers: { Authorization: 'bearer tok123' } })).toBe('tok123');
  });

  it('returns null for missing, empty, or non-Bearer values', () => {
    expect(extractBearerToken({})).toBeNull();
    expect(extractBearerToken({ headers: { Authorization: '' } })).toBeNull();
    expect(extractBearerToken({ headers: { Authorization: 'Bearer   ' } })).toBeNull();
    expect(extractBearerToken({ headers: { Authorization: 'Basic abc' } })).toBeNull();
    expect(extractBearerToken({ identitySource: [] })).toBeNull();
  });
});
