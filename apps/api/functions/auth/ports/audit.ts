/**
 * Audit writer -> DynamoDB audit_auth table. Append-only, immutable
 * (conventions.md). Faked in tests.
 *
 * IMPORTANT: no raw PHI in audit payloads. Store opaque ids + event type only;
 * phone numbers are recorded as an opaque hashed ref, never raw.
 */
export type AuthEventType =
  | 'AUTH_LOGIN_GOOGLE'
  | 'AUTH_LOGIN_X'
  | 'AUTH_LOGIN_OTP'
  | 'AUTH_OTP_SENT'
  | 'AUTH_LOGOUT';

export interface AuthAuditEvent {
  eventType: AuthEventType;
  /** Opaque user id (nullable for pre-auth events like OTP send). */
  userId?: string | null;
  /** Opaque subject reference (hashed phone ref or provider subject id). */
  subjectRef?: string | null;
  /** ISO timestamp. */
  occurredAt: string;
  /** Non-PHI structured detail (e.g. { provider: 'google' }). */
  detail?: Record<string, unknown>;
}

export interface AuditWriter {
  write(event: AuthAuditEvent): Promise<void>;
}
