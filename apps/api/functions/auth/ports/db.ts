/**
 * Database port for the auth domain.
 *
 * Design notes (conventions.md):
 * - No string-interpolated SQL: repositories use parameterized queries only.
 * - Per-request session vars (app.current_user_id / app.current_role /
 *   app.current_patient_id) are set on the connection used inside a
 *   transaction, never bypassing RLS with a superuser role.
 * - Auth-table bootstrap access (find-or-create identity/user) happens as the
 *   service before a user context exists; the port exposes a transaction
 *   scope so those writes are atomic.
 *
 * The concrete adapter (RDS Proxy + node-postgres) lives behind this port and
 * is faked in unit tests — no real DB in tests.
 */

export type UserRole = 'patient' | 'caregiver' | 'doctor' | 'admin';
export type UserStatus = 'active' | 'pending_verification' | 'disabled';
export type AuthProvider = 'google' | 'x' | 'sms';

export interface UserRecord {
  id: string;
  role: UserRole;
  displayName: string;
  email: string | null;
  phoneNumber: string | null;
  status: UserStatus;
  linkedPatientId: string | null;
}

export interface AuthIdentityRecord {
  id: string;
  userId: string;
  provider: AuthProvider;
  providerSubject: string;
}

export interface OtpChallengeRecord {
  id: string;
  phoneNumber: string;
  otpHash: string;
  expiresAt: Date;
  attempts: number;
  verifiedAt: Date | null;
}

export interface NewUserInput {
  id: string;
  role: UserRole;
  displayName: string;
  email: string | null;
  phoneNumber: string | null;
  status: UserStatus;
}

export interface NewIdentityInput {
  id: string;
  userId: string;
  provider: AuthProvider;
  providerSubject: string;
  emailFromProvider: string | null;
}

export interface NewSessionInput {
  id: string;
  userId: string;
  expiresAt: Date;
}

/** Session context applied to a connection before user-scoped queries run. */
export interface SessionContext {
  userId: string;
  role: UserRole;
  patientId?: string | null;
}

/**
 * Transaction-scoped repository. All methods use parameterized queries.
 * `setSessionContext` sets the RLS session vars for the current connection.
 */
export interface AuthRepository {
  setSessionContext(ctx: SessionContext): Promise<void>;

  findIdentity(provider: AuthProvider, providerSubject: string): Promise<AuthIdentityRecord | null>;
  findUserById(userId: string): Promise<UserRecord | null>;
  findUserByEmail(email: string): Promise<UserRecord | null>;

  createUser(input: NewUserInput): Promise<UserRecord>;
  createIdentity(input: NewIdentityInput): Promise<AuthIdentityRecord>;
  updateLastLogin(userId: string, at: Date): Promise<void>;

  createSession(input: NewSessionInput): Promise<void>;
  revokeSessionsForUser(userId: string, at: Date): Promise<number>;

  insertOtpChallenge(input: {
    id: string;
    phoneNumber: string;
    otpHash: string;
    expiresAt: Date;
  }): Promise<void>;
  findOtpChallenge(challengeId: string): Promise<OtpChallengeRecord | null>;
  incrementOtpAttempts(challengeId: string): Promise<number>;
  invalidateOtpChallenge(challengeId: string): Promise<void>;
  markOtpVerified(challengeId: string, at: Date): Promise<void>;
}

/** DB port entrypoint: run work inside a single transaction. */
export interface DbPort {
  transaction<T>(fn: (repo: AuthRepository) => Promise<T>): Promise<T>;
}
