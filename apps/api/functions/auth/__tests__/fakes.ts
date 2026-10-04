/**
 * Full fake bundle for the auth unit tests. The vitest-free fakes (FakeDb,
 * FakeRedis, FakeIds, FixedClock, fakeHasher, FakeAudit, config, logger) live
 * in ./fakes-core so they can also be used by the non-test harness; this module
 * re-exports them and adds the spy-based `makeBundle` (which uses `vi.fn()` for
 * the OAuth/SMS ports so tests can assert calls).
 */
import { vi } from 'vitest';
import type { AuthDeps } from '../deps';
import type { GoogleOAuthPort, XOAuthPort, OAuthProfile } from '../ports/oauth';
import type { SmsGateway } from '../ports/sms';
import {
  FakeDb,
  FakeRedis,
  FakeAudit,
  FakeIds,
  FixedClock,
  fakeHasher,
  noopLogger,
  defaultConfig,
} from './fakes-core';

export {
  FakeDb,
  FakeRedis,
  FakeAudit,
  FakeIds,
  FixedClock,
  fakeHasher,
  noopLogger,
  defaultConfig,
} from './fakes-core';

export interface FakeBundle {
  deps: AuthDeps;
  db: FakeDb;
  redis: FakeRedis;
  audit: FakeAudit;
  ids: FakeIds;
  clock: FixedClock;
  google: GoogleOAuthPort;
  x: XOAuthPort;
  sms: SmsGateway & { sent: { to: string; message: string }[] };
}

/** Assemble a full fake dependency bundle with sensible defaults + spies. */
export function makeBundle(overrides?: {
  googleProfile?: OAuthProfile;
  xProfile?: OAuthProfile;
  googleImpl?: GoogleOAuthPort;
  xImpl?: XOAuthPort;
  now?: Date;
}): FakeBundle {
  const db = new FakeDb();
  const redis = new FakeRedis();
  const audit = new FakeAudit();
  const ids = new FakeIds();
  const clock = new FixedClock(overrides?.now ?? new Date('2026-01-01T00:00:00.000Z'));

  const google: GoogleOAuthPort =
    overrides?.googleImpl ??
    ({
      exchangeAndVerify: vi.fn(
        async () =>
          overrides?.googleProfile ?? {
            providerSubject: 'google-sub-1',
            email: 'g@example.com',
            emailVerified: true,
            displayName: 'Google User',
          }
      ),
    } as GoogleOAuthPort);

  const x: XOAuthPort =
    overrides?.xImpl ??
    ({
      exchangeAndVerify: vi.fn(
        async () =>
          overrides?.xProfile ?? {
            providerSubject: 'x-sub-1',
            email: null,
            emailVerified: false,
            displayName: 'X User',
          }
      ),
    } as XOAuthPort);

  const sent: { to: string; message: string }[] = [];
  const sms = {
    sent,
    send: vi.fn(async (input: { to: string; message: string }) => {
      sent.push(input);
    }),
  };

  const deps: AuthDeps = {
    db,
    redis,
    google,
    x,
    sms,
    audit,
    hasher: fakeHasher,
    clock,
    ids,
    logger: noopLogger,
    config: { ...defaultConfig },
  };

  return { deps, db, redis, audit, ids, clock, google, x, sms };
}
