/**
 * Dependency bundle for the auth domain. Core logic takes these as parameters
 * so unit tests inject fakes; the Lambda entry (index.ts) builds them from env.
 */
import type { DbPort } from './ports/db';
import type { RedisPort } from './ports/redis';
import type { GoogleOAuthPort, XOAuthPort } from './ports/oauth';
import type { SmsGateway } from './ports/sms';
import type { AuditWriter } from './ports/audit';
import type { Hasher } from './ports/hasher';
import type { Clock } from './ports/clock';
import type { IdGenerator } from './ports/ids';
import type { Logger } from './logger';

export interface AuthConfig {
  sessionTtlSeconds: number;
  otpTtlSeconds: number;
  otpMaxAttempts: number;
  /** Max OTP sends per phone per hour. */
  otpSendMaxPerHour: number;
  /** Rate-limit window for OTP sends (seconds). */
  otpSendWindowSeconds: number;
  /** Resend cooldown surfaced to the client (seconds). */
  otpResendAfterSeconds: number;
  /** App name for the non-PHI SMS body. */
  appName: string;
}

export interface AuthDeps {
  db: DbPort;
  redis: RedisPort;
  google: GoogleOAuthPort;
  x: XOAuthPort;
  sms: SmsGateway;
  audit: AuditWriter;
  hasher: Hasher;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
  config: AuthConfig;
}
