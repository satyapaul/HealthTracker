/**
 * Vitest-free in-memory fakes for the auth ports. These carry NO dependency on
 * `vitest`, so they can be imported from non-test runtimes (e.g. the local HTTP
 * harness) as well as from unit tests. The spy-based `makeBundle` (which uses
 * `vi.fn()`) lives in ./fakes and re-exports everything here.
 */
import type { AuthConfig } from '../deps';
import type {
  AuthIdentityRecord,
  AuthProvider,
  AuthRepository,
  DbPort,
  NewIdentityInput,
  NewSessionInput,
  NewUserInput,
  OtpChallengeRecord,
  SessionContext,
  UserRecord,
} from '../ports/db';
import type { RedisPort } from '../ports/redis';
import type { AuditWriter, AuthAuditEvent } from '../ports/audit';
import type { Hasher } from '../ports/hasher';
import type { Clock } from '../ports/clock';
import type { IdGenerator } from '../ports/ids';
import type { Logger } from '../logger';

/** Deterministic id generator: incrementing counters + a queue of OTP codes. */
export class FakeIds implements IdGenerator {
  private uuidN = 0;
  private tokenN = 0;
  public otpQueue: string[] = ['000000'];

  uuid(): string {
    this.uuidN += 1;
    return `uuid-${this.uuidN}`;
  }
  sessionToken(): string {
    this.tokenN += 1;
    return `token-${this.tokenN}`;
  }
  otpCode(): string {
    return this.otpQueue.length > 1 ? (this.otpQueue.shift() as string) : this.otpQueue[0];
  }
}

export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
  set(next: Date): void {
    this.current = next;
  }
  advanceSeconds(s: number): void {
    this.current = new Date(this.current.getTime() + s * 1000);
  }
}

/** Plaintext "hasher" — deterministic and fast; no bcrypt in unit tests. */
export const fakeHasher: Hasher = {
  hash: async (plain) => `hashed:${plain}`,
  compare: async (plain, hash) => hash === `hashed:${plain}`,
};

export class FakeRedis implements RedisPort {
  public store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }
  async incr(key: string): Promise<number> {
    const n = Number(this.store.get(key) ?? '0') + 1;
    this.store.set(key, String(n));
    return n;
  }
  async expire(): Promise<void> {
    /* TTLs are irrelevant for in-memory tests */
  }
}

interface StoredSession {
  id: string;
  userId: string;
  revokedAt: Date | null;
}

/** In-memory auth repository + a DbPort that just runs the fn (single scope). */
export class FakeDb implements DbPort, AuthRepository {
  public users = new Map<string, UserRecord>();
  public usersByEmail = new Map<string, string>();
  public identities: AuthIdentityRecord[] = [];
  public sessions: StoredSession[] = [];
  public otp = new Map<string, OtpChallengeRecord>();
  public sessionContexts: SessionContext[] = [];
  public lastLogins: { userId: string; at: Date }[] = [];

  async transaction<T>(fn: (repo: AuthRepository) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async setSessionContext(ctx: SessionContext): Promise<void> {
    this.sessionContexts.push(ctx);
  }

  async findIdentity(
    provider: AuthProvider,
    providerSubject: string
  ): Promise<AuthIdentityRecord | null> {
    return (
      this.identities.find(
        (i) => i.provider === provider && i.providerSubject === providerSubject
      ) ?? null
    );
  }
  async findUserById(userId: string): Promise<UserRecord | null> {
    return this.users.get(userId) ?? null;
  }
  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const id = this.usersByEmail.get(email.toLowerCase());
    return id ? (this.users.get(id) ?? null) : null;
  }
  async createUser(input: NewUserInput): Promise<UserRecord> {
    const user: UserRecord = { ...input, linkedPatientId: null };
    this.users.set(user.id, user);
    if (user.email) this.usersByEmail.set(user.email.toLowerCase(), user.id);
    return user;
  }
  async createIdentity(input: NewIdentityInput): Promise<AuthIdentityRecord> {
    const rec: AuthIdentityRecord = {
      id: input.id,
      userId: input.userId,
      provider: input.provider,
      providerSubject: input.providerSubject,
    };
    this.identities.push(rec);
    return rec;
  }
  async updateLastLogin(userId: string, at: Date): Promise<void> {
    this.lastLogins.push({ userId, at });
  }
  async createSession(input: NewSessionInput): Promise<void> {
    this.sessions.push({ id: input.id, userId: input.userId, revokedAt: null });
  }
  async revokeSessionsForUser(userId: string, at: Date): Promise<number> {
    let n = 0;
    for (const s of this.sessions) {
      if (s.userId === userId && s.revokedAt === null) {
        s.revokedAt = at;
        n += 1;
      }
    }
    return n;
  }
  async insertOtpChallenge(input: {
    id: string;
    phoneNumber: string;
    otpHash: string;
    expiresAt: Date;
  }): Promise<void> {
    this.otp.set(input.id, {
      id: input.id,
      phoneNumber: input.phoneNumber,
      otpHash: input.otpHash,
      expiresAt: input.expiresAt,
      attempts: 0,
      verifiedAt: null,
    });
  }
  async findOtpChallenge(challengeId: string): Promise<OtpChallengeRecord | null> {
    const c = this.otp.get(challengeId);
    return c ? { ...c } : null;
  }
  async incrementOtpAttempts(challengeId: string): Promise<number> {
    const c = this.otp.get(challengeId);
    if (!c) return 0;
    c.attempts += 1;
    return c.attempts;
  }
  async invalidateOtpChallenge(challengeId: string): Promise<void> {
    this.otp.delete(challengeId);
  }
  async markOtpVerified(challengeId: string, at: Date): Promise<void> {
    const c = this.otp.get(challengeId);
    if (c) c.verifiedAt = at;
  }
}

export class FakeAudit implements AuditWriter {
  public events: AuthAuditEvent[] = [];
  async write(event: AuthAuditEvent): Promise<void> {
    this.events.push(event);
  }
}

export const noopLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

export const defaultConfig: AuthConfig = {
  sessionTtlSeconds: 2_592_000,
  otpTtlSeconds: 300,
  otpMaxAttempts: 5,
  otpSendMaxPerHour: 3,
  otpSendWindowSeconds: 3600,
  otpResendAfterSeconds: 60,
  appName: 'PostOp Care',
};
