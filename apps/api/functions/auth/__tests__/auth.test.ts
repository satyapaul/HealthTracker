/**
 * WP 1.1 auth Lambda unit tests. All dependencies are injected fakes — no real
 * AWS / DB / Redis / HTTP. Covers the DoD (all three sign-in methods reach the
 * correct portal; audit rows written) plus the required failure paths.
 */
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { route } from '../router';
import type { AuthRequest } from '../http';
import { oauthStateKey, oauthPkceKey } from '../handlers/oauth-callback';
import { sessionKey } from '../services/session';
import { makeBundle } from './fakes';

function req(partial: Partial<AuthRequest> & Pick<AuthRequest, 'method' | 'path'>): AuthRequest {
  return { headers: {}, body: null, ...partial };
}

function jsonBody(obj: unknown): string {
  return JSON.stringify(obj);
}

function parse(body: string): { success: boolean; data: unknown; error: { code: string } | null } {
  return JSON.parse(body);
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('POST /auth/google/callback', () => {
  it('happy path issues a session and writes an audit row', async () => {
    const b = makeBundle();
    await b.redis.set(oauthStateKey('state-1'), JSON.stringify({ redirectUri: 'https://app' }));

    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: '/auth/google/callback',
        body: jsonBody({ code: 'c', state: 'state-1', redirect_uri: 'https://app' }),
      })
    );

    expect(res.statusCode).toBe(200);
    const env = parse(res.body);
    expect(env.success).toBe(true);
    expect(env.error).toBeNull();
    const data = env.data as { sessionToken: string; user: { role: string } };
    expect(data.sessionToken).toBe('token-1');
    expect(data.user.role).toBe('patient');

    // Session stored in Redis + auth_sessions, audit row written.
    expect(await b.redis.get(sessionKey('token-1'))).not.toBeNull();
    expect(b.db.sessions).toHaveLength(1);
    expect(b.audit.events.map((e) => e.eventType)).toContain('AUTH_LOGIN_GOOGLE');
    // State consumed (single-use CSRF).
    expect(await b.redis.get(oauthStateKey('state-1'))).toBeNull();
  });

  it('rejects a missing/invalid state with VALIDATION_ERROR (400)', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: '/auth/google/callback',
        body: jsonBody({ code: 'c', state: 'nope', redirect_uri: 'https://app' }),
      })
    );
    expect(res.statusCode).toBe(400);
    const env = parse(res.body);
    expect(env.success).toBe(false);
    expect(env.error?.code).toBe('VALIDATION_ERROR');
    expect(b.audit.events).toHaveLength(0);
  });

  it('maps an identity conflict to CONFLICT (409)', async () => {
    const b = makeBundle({
      googleProfile: {
        providerSubject: 'g-sub',
        email: 'shared@example.com',
        emailVerified: true,
        displayName: 'G',
      },
    });
    // Pre-existing user with same email but already linked to a google identity
    // bound to the SAME subject on a DIFFERENT user id -> conflict.
    b.db.users.set('other-user', {
      id: 'other-user',
      role: 'patient',
      displayName: 'Other',
      email: 'shared@example.com',
      phoneNumber: null,
      status: 'active',
      linkedPatientId: null,
    });
    b.db.usersByEmail.set('shared@example.com', 'other-user');
    b.db.identities.push({
      id: 'id-x',
      userId: 'someone-else',
      provider: 'google',
      providerSubject: 'g-sub',
    });
    await b.redis.set(oauthStateKey('s'), '{}');

    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: '/auth/google/callback',
        body: jsonBody({ code: 'c', state: 's', redirect_uri: 'https://app' }),
      })
    );
    // findIdentity finds the existing (google, g-sub) -> loads user 'someone-else'
    // which does not exist -> CONFLICT.
    expect(res.statusCode).toBe(409);
    expect(parse(res.body).error?.code).toBe('CONFLICT');
  });

  it('links a NEW identity to an existing user when the email is provider-verified', async () => {
    const b = makeBundle({
      googleProfile: {
        providerSubject: 'new-google-sub',
        email: 'shared@example.com',
        emailVerified: true,
        displayName: 'G',
      },
    });
    // Existing user with email E, but NO identity for (google, new-google-sub).
    b.db.users.set('existing-user', {
      id: 'existing-user',
      role: 'doctor',
      displayName: 'Existing',
      email: 'shared@example.com',
      phoneNumber: null,
      status: 'active',
      linkedPatientId: null,
    });
    b.db.usersByEmail.set('shared@example.com', 'existing-user');
    await b.redis.set(oauthStateKey('s'), '{}');

    const identitiesBefore = b.db.identities.length;
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: '/auth/google/callback',
        body: jsonBody({ code: 'c', state: 's', redirect_uri: 'https://app' }),
      })
    );

    expect(res.statusCode).toBe(200);
    const data = parse(res.body).data as {
      sessionToken: string;
      user: { id: string; role: string };
    };
    // Logged in AS the existing user (same id + role), not a new account.
    expect(data.user.id).toBe('existing-user');
    expect(data.user.role).toBe('doctor');
    // A new identity was linked to that user, session issued.
    expect(b.db.identities.length).toBe(identitiesBefore + 1);
    const linked = b.db.identities.find(
      (i) => i.provider === 'google' && i.providerSubject === 'new-google-sub'
    );
    expect(linked?.userId).toBe('existing-user');
    expect(await b.redis.get(sessionKey(data.sessionToken))).not.toBeNull();
    expect(b.db.sessions).toHaveLength(1);
  });

  it('refuses to link/login when the matching email is NOT provider-verified -> CONFLICT (409)', async () => {
    const b = makeBundle({
      googleProfile: {
        providerSubject: 'new-google-sub',
        email: 'shared@example.com',
        emailVerified: false,
        displayName: 'G',
      },
    });
    b.db.users.set('existing-user', {
      id: 'existing-user',
      role: 'doctor',
      displayName: 'Existing',
      email: 'shared@example.com',
      phoneNumber: null,
      status: 'active',
      linkedPatientId: null,
    });
    b.db.usersByEmail.set('shared@example.com', 'existing-user');
    await b.redis.set(oauthStateKey('s'), '{}');

    const identitiesBefore = b.db.identities.length;
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: '/auth/google/callback',
        body: jsonBody({ code: 'c', state: 's', redirect_uri: 'https://app' }),
      })
    );

    expect(res.statusCode).toBe(409);
    expect(parse(res.body).error?.code).toBe('CONFLICT');
    // No account takeover: no new identity, no session.
    expect(b.db.identities.length).toBe(identitiesBefore);
    expect(b.db.sessions).toHaveLength(0);
  });
});

describe('POST /auth/x/callback (PKCE)', () => {
  const verifier = 'the-code-verifier-value-1234567890';
  const challenge = base64url(createHash('sha256').update(verifier).digest());

  it('happy path verifies PKCE, issues a session, writes audit', async () => {
    const b = makeBundle();
    await b.redis.set(oauthStateKey('xs'), '{}');
    await b.redis.set(
      oauthPkceKey('xs'),
      JSON.stringify({ codeChallenge: challenge, method: 'S256' })
    );

    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: '/auth/x/callback',
        body: jsonBody({ code: 'c', state: 'xs', code_verifier: verifier }),
      })
    );

    expect(res.statusCode).toBe(200);
    const data = parse(res.body).data as { user: { role: string } };
    expect(data.user.role).toBe('patient');
    expect(b.audit.events.map((e) => e.eventType)).toContain('AUTH_LOGIN_X');
    // Both state + pkce entries consumed.
    expect(await b.redis.get(oauthPkceKey('xs'))).toBeNull();
    expect(await b.redis.get(oauthStateKey('xs'))).toBeNull();
  });

  it('PKCE mismatch -> UNAUTHENTICATED (401)', async () => {
    const b = makeBundle();
    await b.redis.set(oauthStateKey('xs'), '{}');
    await b.redis.set(
      oauthPkceKey('xs'),
      JSON.stringify({ codeChallenge: 'different-challenge', method: 'S256' })
    );

    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: '/auth/x/callback',
        body: jsonBody({ code: 'c', state: 'xs', code_verifier: verifier }),
      })
    );
    expect(res.statusCode).toBe(401);
    expect(parse(res.body).error?.code).toBe('UNAUTHENTICATED');
    expect(b.db.sessions).toHaveLength(0);
  });

  it('missing PKCE/state -> VALIDATION_ERROR (400)', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: '/auth/x/callback',
        body: jsonBody({ code: 'c', state: 'xs', code_verifier: verifier }),
      })
    );
    expect(res.statusCode).toBe(400);
    expect(parse(res.body).error?.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /auth/otp/send', () => {
  it('sends an OTP without leaking it, returns challenge shape, writes audit', async () => {
    const b = makeBundle();
    b.ids.otpQueue = ['123456'];

    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: '/auth/otp/send',
        body: jsonBody({ phone_number: '+919876543210' }),
      })
    );

    expect(res.statusCode).toBe(200);
    const data = parse(res.body).data as { challengeId: string; resendAfterSeconds: number };
    expect(data.resendAfterSeconds).toBe(60);
    // OTP never appears in the response body.
    expect(res.body).not.toContain('123456');
    // SMS sent with a non-PHI body containing the code + app name.
    expect(b.sms.sent).toHaveLength(1);
    expect(b.sms.sent[0].message).toContain('123456');
    expect(b.sms.sent[0].message).toContain('PostOp Care');
    // Audit written with an opaque phone ref (not the raw phone).
    const evt = b.audit.events.find((e) => e.eventType === 'AUTH_OTP_SENT');
    expect(evt).toBeDefined();
    expect(evt?.subjectRef).not.toContain('9876543210');
  });

  it('rejects a non-E.164 phone with VALIDATION_ERROR (400)', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: '/auth/otp/send',
        body: jsonBody({ phone_number: '9876543210' }),
      })
    );
    expect(res.statusCode).toBe(400);
    expect(parse(res.body).error?.code).toBe('VALIDATION_ERROR');
  });

  it('rate-limits the 4th send in the window with RATE_LIMITED (429)', async () => {
    const b = makeBundle();
    const send = () =>
      route(
        b.deps,
        req({
          method: 'POST',
          path: '/auth/otp/send',
          body: jsonBody({ phone_number: '+911111111111' }),
        })
      );

    expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(200);
    const fourth = await send();
    expect(fourth.statusCode).toBe(429);
    expect(parse(fourth.body).error?.code).toBe('RATE_LIMITED');
  });
});

describe('POST /auth/otp/verify', () => {
  async function seedChallenge(b: ReturnType<typeof makeBundle>, code = '123456') {
    b.ids.otpQueue = [code];
    await route(
      b.deps,
      req({
        method: 'POST',
        path: '/auth/otp/send',
        body: jsonBody({ phone_number: '+919000000000' }),
      })
    );
    const challengeId = [...b.db.otp.keys()][0];
    return challengeId;
  }

  it('happy path issues a session and writes AUTH_LOGIN_OTP audit', async () => {
    const b = makeBundle();
    const challengeId = await seedChallenge(b, '123456');

    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: '/auth/otp/verify',
        body: jsonBody({ challengeId, otp: '123456' }),
      })
    );

    expect(res.statusCode).toBe(200);
    const data = parse(res.body).data as { sessionToken: string; user: { role: string } };
    expect(data.user.role).toBe('patient');
    expect(await b.redis.get(sessionKey(data.sessionToken))).not.toBeNull();
    expect(b.audit.events.map((e) => e.eventType)).toContain('AUTH_LOGIN_OTP');
    // Challenge marked verified.
    expect(b.db.otp.get(challengeId)?.verifiedAt).not.toBeNull();
  });

  it('expired challenge -> OTP_EXPIRED (400)', async () => {
    const b = makeBundle();
    const challengeId = await seedChallenge(b, '123456');
    b.clock.advanceSeconds(301); // past the 300s TTL

    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: '/auth/otp/verify',
        body: jsonBody({ challengeId, otp: '123456' }),
      })
    );
    expect(res.statusCode).toBe(400);
    expect(parse(res.body).error?.code).toBe('OTP_EXPIRED');
  });

  it('wrong code -> INVALID_OTP (401) and increments attempts', async () => {
    const b = makeBundle();
    const challengeId = await seedChallenge(b, '123456');

    const res = await route(
      b.deps,
      req({
        method: 'POST',
        path: '/auth/otp/verify',
        body: jsonBody({ challengeId, otp: '000000' }),
      })
    );
    expect(res.statusCode).toBe(401);
    expect(parse(res.body).error?.code).toBe('INVALID_OTP');
    expect(b.db.otp.get(challengeId)?.attempts).toBe(1);
  });

  it('max attempts -> OTP_MAX_ATTEMPTS (429) and invalidates the challenge', async () => {
    const b = makeBundle();
    const challengeId = await seedChallenge(b, '123456');

    // 5 wrong attempts (otpMaxAttempts = 5). The 5th increment reaches the cap
    // and invalidates the challenge, returning 429.
    let last;
    for (let i = 0; i < 5; i += 1) {
      last = await route(
        b.deps,
        req({
          method: 'POST',
          path: '/auth/otp/verify',
          body: jsonBody({ challengeId, otp: '999999' }),
        })
      );
    }
    expect(last?.statusCode).toBe(429);
    expect(parse(last!.body).error?.code).toBe('OTP_MAX_ATTEMPTS');
    expect(b.db.otp.get(challengeId)).toBeUndefined();
  });
});

describe('DELETE /auth/session', () => {
  it('revokes the session and deletes the Redis key (204)', async () => {
    const b = makeBundle();
    // Seed a logged-in user + session.
    b.db.users.set('u1', {
      id: 'u1',
      role: 'doctor',
      displayName: 'Doc',
      email: 'd@example.com',
      phoneNumber: null,
      status: 'active',
      linkedPatientId: null,
    });
    b.db.sessions.push({ id: 's1', userId: 'u1', revokedAt: null } as never);
    await b.redis.set(
      sessionKey('tok'),
      JSON.stringify({ userId: 'u1', role: 'doctor', patientId: null })
    );

    const res = await route(
      b.deps,
      req({ method: 'DELETE', path: '/auth/session', headers: { Authorization: 'Bearer tok' } })
    );

    expect(res.statusCode).toBe(204);
    expect(await b.redis.get(sessionKey('tok'))).toBeNull();
    expect(b.db.sessions.every((s) => s.revokedAt !== null)).toBe(true);
    expect(b.audit.events.map((e) => e.eventType)).toContain('AUTH_LOGOUT');
  });

  it('missing/invalid token -> UNAUTHENTICATED (401)', async () => {
    const b = makeBundle();
    const res = await route(b.deps, req({ method: 'DELETE', path: '/auth/session' }));
    expect(res.statusCode).toBe(401);
    expect(parse(res.body).error?.code).toBe('UNAUTHENTICATED');
  });
});

describe('GET /auth/me', () => {
  it('returns the profile for a valid session', async () => {
    const b = makeBundle();
    b.db.users.set('u9', {
      id: 'u9',
      role: 'admin',
      displayName: 'Admin',
      email: 'a@example.com',
      phoneNumber: null,
      status: 'active',
      linkedPatientId: null,
    });
    await b.redis.set(
      sessionKey('tk'),
      JSON.stringify({ userId: 'u9', role: 'admin', patientId: null })
    );

    const res = await route(
      b.deps,
      req({ method: 'GET', path: '/auth/me', headers: { authorization: 'Bearer tk' } })
    );
    expect(res.statusCode).toBe(200);
    const data = parse(res.body).data as { id: string; role: string; status: string };
    expect(data.id).toBe('u9');
    expect(data.role).toBe('admin');
    expect(data.status).toBe('active');
  });

  it('invalid session -> UNAUTHENTICATED (401)', async () => {
    const b = makeBundle();
    const res = await route(
      b.deps,
      req({ method: 'GET', path: '/auth/me', headers: { authorization: 'Bearer bogus' } })
    );
    expect(res.statusCode).toBe(401);
    expect(parse(res.body).error?.code).toBe('UNAUTHENTICATED');
  });
});
